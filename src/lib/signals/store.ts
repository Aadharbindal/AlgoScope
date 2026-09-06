import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseSignal, SessionSignal } from './types';
import { ALGORITHMS } from '../algorithms';
import { redisCredentials, redisStore } from './redis';

/**
 * Where signals are kept.
 *
 * Two stores, chosen by what the environment provides rather than by a flag:
 *
 *   - **A file of newline-delimited JSON**, the default. Append-only, survives
 *     a restart, trivially exportable, and needs no service to be running —
 *     which is the right answer for a machine that owns its own disk, and for
 *     anyone cloning this repository to read it.
 *   - **Redis over HTTP**, when credentials are present. A serverless host's
 *     filesystem does not survive the instance, so the file store there is a
 *     store in name only. See `redis.ts`.
 *
 * `SignalStore` is the whole of the seam: nothing above this line knows where
 * a row is kept, and `status()` is how the insights page finds out — because
 * a confusion map drawn from rows that quietly vanished would be worse than no
 * map at all.
 */

export interface StoreStatus {
  /** Whether rows written now will still be here later. */
  durable: boolean;
  rows: number;
  /** Bytes held, where the store can say. `null` means it cannot. */
  bytes: number | null;
  where: string;
  /** True when the store is at its cap, so the oldest sessions have been dropped. */
  capped: boolean;
  /** How many sessions this store will keep. */
  keeps: number;
}

export interface SignalStore {
  append(signal: SessionSignal): Promise<void>;
  read(limit: number): Promise<SessionSignal[]>;
  status(): Promise<StoreStatus>;
}

const DIR = process.env.ALGOSCOPE_DATA_DIR ?? path.join(process.cwd(), '.data');
const FILE = path.join(DIR, 'signals.jsonl');

/** Keep the file from growing without bound on a long-running host. */
const MAX_BYTES = 64 * 1024 * 1024;

const knownSlugs = new Set(ALGORITHMS.map((a) => a.slug));

export function fileStore(): SignalStore {
  /** A last resort so ingest never 500s: rows live only in this instance. */
  const memory: SessionSignal[] = [];
  let durable = true;

  return {
    async append(signal) {
      try {
        await mkdir(DIR, { recursive: true });
        const info = await stat(FILE).catch(() => null);
        if (info && info.size > MAX_BYTES) {
          // Refuse rather than rotate silently: losing the older half of the
          // history without saying so would quietly change every rate on the
          // insights page. The Redis store does drop old rows, and says it has.
          throw new Error('signal log is full');
        }
        await appendFile(FILE, JSON.stringify(signal) + '\n', 'utf8');
        durable = true;
      } catch {
        durable = false;
        memory.push(signal);
        if (memory.length > 5000) memory.splice(0, memory.length - 5000);
      }
    },

    async read(limit) {
      let rows: SessionSignal[] = [];
      try {
        const text = await readFile(FILE, 'utf8');
        const lines = text.split('\n');
        // Newest last in the file, so read the tail.
        for (const line of lines.slice(-limit)) {
          if (!line.trim()) continue;
          try {
            const parsed = parseSignal(JSON.parse(line), knownSlugs);
            if (parsed) rows.push(parsed);
          } catch {
            /* a corrupt line is skipped, not guessed at */
          }
        }
      } catch {
        rows = [];
      }
      return [...rows, ...memory].slice(-limit);
    },

    async status() {
      const info = await stat(FILE).catch(() => null);
      let rows = memory.length;
      if (info) {
        try {
          const text = await readFile(FILE, 'utf8');
          rows += text.split('\n').filter((l) => l.trim()).length;
        } catch {
          /* size is still worth reporting even if the read fails */
        }
      }
      return {
        durable: durable && info !== null,
        rows,
        bytes: info?.size ?? 0,
        where: FILE,
        // The file refuses rather than rotates, so nothing has been dropped.
        capped: false,
        keeps: Infinity,
      };
    },
  };
}

/**
 * The store this instance uses.
 *
 * Resolved once, and by what is configured rather than by a mode flag —
 * a deployment that has attached a database should not also have to remember
 * to say so.
 */
function chooseStore(): SignalStore {
  const creds = redisCredentials();
  if (creds) return redisStore(creds);
  return fileStore();
}

export const signalStore: SignalStore = chooseStore();
