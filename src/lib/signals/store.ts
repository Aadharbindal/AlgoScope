import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseSignal, SessionSignal } from './types';
import { ALGORITHMS } from '../algorithms';

/**
 * Where signals are kept.
 *
 * A file of newline-delimited JSON, because that is honestly the right size
 * for this: it is append-only, it survives a restart, it is trivially
 * exportable, and it needs no service to be running. If this ever outgrows a
 * file, `SignalStore` is the seam to replace — nothing above this line knows
 * how the rows are stored.
 *
 * One thing to be clear-eyed about: on a serverless host the filesystem is
 * ephemeral, so rows written there do not survive the instance. `storeStatus`
 * reports that rather than letting the insights page imply a history it does
 * not have.
 */

export interface SignalStore {
  append(signal: SessionSignal): Promise<void>;
  read(limit: number): Promise<SessionSignal[]>;
  status(): Promise<{ durable: boolean; rows: number; bytes: number; where: string }>;
}

const DIR = process.env.ALGOSCOPE_DATA_DIR ?? path.join(process.cwd(), '.data');
const FILE = path.join(DIR, 'signals.jsonl');

/** Keep the file from growing without bound on a long-running host. */
const MAX_BYTES = 64 * 1024 * 1024;

const knownSlugs = new Set(ALGORITHMS.map((a) => a.slug));

/** A last resort so ingest never 500s: rows live only in this instance. */
const memory: SessionSignal[] = [];
let durable = true;

export const signalStore: SignalStore = {
  async append(signal) {
    try {
      await mkdir(DIR, { recursive: true });
      const info = await stat(FILE).catch(() => null);
      if (info && info.size > MAX_BYTES) {
        // Refuse rather than rotate silently: losing the older half of the
        // history without saying so would quietly change every rate on the
        // insights page.
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
    };
  },
};
