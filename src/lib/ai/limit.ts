/**
 * How much of the tutor endpoint one visitor, and one instance, may use.
 *
 * The tutor is the only route on this site that costs money to answer, so it
 * is the only one worth defending. Two limits, and they defend against
 * different things:
 *
 *   - **Per client.** A visitor asking questions while reading is a handful of
 *     requests in a few minutes. A script is not. This keeps one person from
 *     being expensive.
 *   - **Per instance.** The client key comes from `x-forwarded-for`, which a
 *     hosting platform rewrites and therefore can be trusted *there* — but a
 *     self-hosted instance behind no proxy receives whatever the caller typed.
 *     So the per-client limit is not load-bearing on its own. The instance
 *     ceiling is the one that cannot be spoofed: however many keys a caller
 *     invents, the process still answers a bounded number of questions an
 *     hour. That is the number that bounds the bill.
 *
 * Both are honestly bounded rather than exact. Counters live in this process,
 * so a host running several instances multiplies the effective limits by the
 * number of instances. That is a real gap and it is stated rather than papered
 * over: for a hard cap the counters have to be shared, and `RateLimiter` is
 * the seam to replace — nothing above this line knows where a count is kept.
 */

export interface Decision {
  ok: boolean;
  /** Seconds until the caller may retry. Only meaningful when `ok` is false. */
  retryAfter: number;
  /** Which limit refused, for the message the caller sees. */
  scope: 'client' | 'instance' | null;
}

export interface RateLimiter {
  take(key: string): Decision;
}

const ALLOWED = { ok: true, retryAfter: 0, scope: null } as const;

/** A positive integer from the environment, or the default when unset or junk. */
function envCount(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  // A misconfigured limit is worse than no configuration, because it looks
  // deliberate. Refuse the value rather than rounding it into something valid.
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** Requests one client may make in `CLIENT_WINDOW`. */
const CLIENT_LIMIT = envCount('ALGOSCOPE_TUTOR_PER_CLIENT', 10);
const CLIENT_WINDOW = 5 * 60 * 1000;

/** Requests this instance will answer in an hour, whoever asks. */
const INSTANCE_LIMIT = envCount('ALGOSCOPE_TUTOR_PER_HOUR', 200);
const INSTANCE_WINDOW = 60 * 60 * 1000;

/**
 * The most client keys held at once.
 *
 * A table keyed by something the caller controls is itself a way to exhaust
 * memory, so it is bounded. When it is full the oldest windows are dropped —
 * they are the ones closest to expiring anyway, and the instance ceiling still
 * applies to everything the dropped keys go on to do.
 */
const MAX_KEYS = 10_000;

interface Window {
  count: number;
  /** When this window opened. */
  since: number;
}

/** A fixed-window counter, which is the right shape for "n per m minutes". */
class Windowed {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly ms: number,
  ) {}

  /** Records one use and says whether it was allowed. */
  take(key: string, now: number): { ok: boolean; retryAfter: number } {
    const open = this.windows.get(key);

    if (!open || now - open.since >= this.ms) {
      if (this.windows.size >= MAX_KEYS) this.evict(now);
      this.windows.set(key, { count: 1, since: now });
      return { ok: true, retryAfter: 0 };
    }

    if (open.count >= this.limit) {
      const wait = Math.ceil((open.since + this.ms - now) / 1000);
      return { ok: false, retryAfter: Math.max(1, wait) };
    }

    open.count++;
    return { ok: true, retryAfter: 0 };
  }

  /** Drop expired windows, and if that was not enough, the oldest ones. */
  private evict(now: number) {
    for (const [key, w] of this.windows) {
      if (now - w.since >= this.ms) this.windows.delete(key);
    }
    if (this.windows.size < MAX_KEYS) return;

    const byAge = [...this.windows.entries()].sort((a, b) => a[1].since - b[1].since);
    for (const [key] of byAge.slice(0, Math.ceil(MAX_KEYS / 4))) this.windows.delete(key);
  }
}

/** Counts kept in this process. Bounded, not shared — see the note above. */
export function memoryLimiter(): RateLimiter {
  const clients = new Windowed(CLIENT_LIMIT, CLIENT_WINDOW);
  const instance = new Windowed(INSTANCE_LIMIT, INSTANCE_WINDOW);

  return {
    take(key) {
      const now = Date.now();

      // The instance ceiling is charged first and only once, so a client that
      // is about to be refused anyway does not consume the shared budget.
      const mine = clients.take(key, now);
      if (!mine.ok) return { ok: false, retryAfter: mine.retryAfter, scope: 'client' };

      const ours = instance.take('instance', now);
      if (!ours.ok) return { ok: false, retryAfter: ours.retryAfter, scope: 'instance' };

      return { ...ALLOWED };
    },
  };
}

export const tutorLimiter = memoryLimiter();

/**
 * Who is asking.
 *
 * The first entry of `x-forwarded-for` is the client as the platform saw it.
 * A direct caller can put anything there, which is why this key is only ever
 * half the defence. Requests with no forwarding header at all share one key —
 * that is the local-development case, and treating them as one caller is the
 * conservative reading rather than the generous one.
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const real = headers.get('x-real-ip');
  return real ? real.slice(0, 64) : 'unattributed';
}

/** The limits in force, so the route and its tests can name them. */
export const LIMITS = {
  perClient: CLIENT_LIMIT,
  clientWindowMinutes: CLIENT_WINDOW / 60_000,
  perHour: INSTANCE_LIMIT,
};
