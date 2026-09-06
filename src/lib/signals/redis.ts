import { ALGORITHMS } from '../algorithms';
import { parseSignal, SessionSignal } from './types';
// Type-only, so this file does not import `store.ts` at runtime — `store.ts`
// imports *this* one to choose between them, and a real cycle there would
// depend on module evaluation order to work.
import type { SignalStore, StoreStatus } from './store';

/**
 * Signals kept in Redis, over its HTTP API.
 *
 * The file store is right for a machine that owns its own disk and wrong for a
 * serverless host, where the filesystem does not survive the instance — which
 * meant the one thing on this site that compounds over time was the one thing
 * that could not be deployed. This is that gap closed.
 *
 * Redis over HTTP rather than a driver, for two reasons that are the same
 * reason: there is no connection to pool and no package to trust. A serverless
 * function is a poor place to own a TCP connection, and a `fetch` against a
 * documented REST endpoint is a dependency this project can read in full.
 *
 * The shape is Upstash's REST API, which is what Vercel's own Redis offering
 * speaks: `POST /` with a command as a JSON array, `POST /pipeline` with an
 * array of them, `Authorization: Bearer`, and `{ result }` or `{ error }`
 * back. Any server speaking that dialect works; nothing here is specific to
 * one vendor beyond the shape of the request.
 */

const KEY = process.env.ALGOSCOPE_REDIS_KEY ?? 'algoscope:signals';

/**
 * The most sessions kept.
 *
 * The file store refuses to grow past its cap rather than rotating, on the
 * grounds that silently losing the older half of the history would change
 * every rate on the insights page without saying so. The objection there was
 * to the *silence*, not to the rotation: this store does drop the oldest
 * sessions, and `status()` reports that it has, so the page can say it is
 * showing the most recent N rather than implying it is showing everything.
 * For a confusion map that is also the more useful window — where readers get
 * stuck this month is a better question than where they ever got stuck.
 */
const DEFAULT_MAX_ROWS = 50_000;

/** The cap in force, read when a store is made rather than when this file loads. */
const configuredMaxRows = () => count(process.env.ALGOSCOPE_REDIS_MAX_ROWS, DEFAULT_MAX_ROWS);

/** A request that hangs is worse than one that fails: ingest has to return. */
const TIMEOUT_MS = 5_000;

function count(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Credentials, under whichever names the platform used.
 *
 * Upstash's own integration sets `UPSTASH_REDIS_REST_*`; Vercel's Redis sets
 * `KV_REST_API_*` for the same service and the same protocol. Accepting both,
 * plus a name of this project's own, means connecting a database is a thing
 * you do in a dashboard rather than a rename you have to remember.
 */
export function redisCredentials(): { url: string; token: string } | null {
  const url =
    process.env.ALGOSCOPE_REDIS_REST_URL ??
    process.env.UPSTASH_REDIS_REST_URL ??
    process.env.KV_REST_API_URL;
  const token =
    process.env.ALGOSCOPE_REDIS_REST_TOKEN ??
    process.env.UPSTASH_REDIS_REST_TOKEN ??
    process.env.KV_REST_API_TOKEN;

  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ''), token };
}

type Command = (string | number)[];

/** One `{ result }` or `{ error }` envelope, as the REST API returns them. */
interface Envelope {
  result?: unknown;
  error?: string;
}

/**
 * Send commands and return their results, in order.
 *
 * An error from any command in a pipeline throws, rather than being returned
 * as a value the caller might use: a half-applied append is a corrupt log, and
 * the caller's fallback — keep the rows in memory and report the store as not
 * durable — is the honest response to not knowing whether a write landed.
 */
async function send(
  creds: { url: string; token: string },
  commands: Command[],
): Promise<unknown[]> {
  const single = commands.length === 1;
  const response = await fetch(single ? creds.url : `${creds.url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(single ? commands[0] : commands),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`redis returned ${response.status}`);
  }

  const body = (await response.json()) as Envelope | Envelope[];
  const envelopes = Array.isArray(body) ? body : [body];

  return envelopes.map((e) => {
    if (e.error) throw new Error(`redis: ${e.error}`);
    return e.result;
  });
}

const knownSlugs = new Set(ALGORITHMS.map((a) => a.slug));

/**
 * Rows as they come back: strings, each holding one session.
 *
 * They are validated on the way in as well as on the way out. The rows were
 * written by this site's own ingest route, which already refuses a malformed
 * one — but a shared store is shared, and a row that cannot be parsed is
 * skipped rather than guessed at, exactly as a corrupt line in the file is.
 */
function decode(raw: unknown): SessionSignal[] {
  if (!Array.isArray(raw)) return [];
  const out: SessionSignal[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    try {
      const parsed = parseSignal(JSON.parse(item), knownSlugs);
      if (parsed) out.push(parsed);
    } catch {
      /* a corrupt row is skipped, not repaired */
    }
  }
  return out;
}

export function redisStore(
  creds: { url: string; token: string },
  maxRows = configuredMaxRows(),
): SignalStore {
  /** Rows that could not be written, so a failed round trip is not a lost one. */
  const pending: SessionSignal[] = [];
  let reachable = true;

  return {
    async append(signal) {
      try {
        // One round trip: append, then drop anything past the cap. LTRIM with
        // a negative range keeps the last `maxRows`, which are the newest ones.
        await send(creds, [
          ['RPUSH', KEY, JSON.stringify(signal)],
          ['LTRIM', KEY, -maxRows, -1],
        ]);
        reachable = true;
      } catch {
        reachable = false;
        pending.push(signal);
        if (pending.length > 5000) pending.splice(0, pending.length - 5000);
      }
    },

    async read(limit) {
      try {
        const [rows] = await send(creds, [['LRANGE', KEY, -limit, -1]]);
        reachable = true;
        return [...decode(rows), ...pending].slice(-limit);
      } catch {
        reachable = false;
        return pending.slice(-limit);
      }
    },

    async status(): Promise<StoreStatus> {
      let rows = pending.length;
      let live = false;
      try {
        const [len] = await send(creds, [['LLEN', KEY]]);
        rows = (typeof len === 'number' ? len : 0) + pending.length;
        live = true;
        reachable = true;
      } catch {
        reachable = false;
      }
      return {
        durable: live && reachable,
        rows,
        // Redis will not tell us the size of a list cheaply, and a figure
        // estimated from the row count would be a number this site invented.
        bytes: null,
        where: `redis ${hostOf(creds.url)} · ${KEY}`,
        capped: rows >= maxRows,
        keeps: maxRows,
      };
    },
  };
}

/** The host alone: a REST URL carries no secret, but there is no reason to print more. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'configured endpoint';
  }
}
