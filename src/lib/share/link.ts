import { AlgorithmDef, Input, InputField, Lang, LANGS } from '../algorithms/types';

/**
 * The deep-link codec.
 *
 * One definition, used by four things that must agree: the workbench (which
 * writes the URL), the preview-image route (which renders a card from it), the
 * embed page (which restores it inside someone else's article), and the input
 * editor (which reads the same fields). If they ever disagreed, a shared link
 * would open on a different step than the card showed — the card would be a
 * picture of something that never happened.
 *
 * It is driven by each algorithm's declared `fields`, so adding an input to an
 * algorithm makes it shareable without touching this file.
 *
 * Safe to import on the server: no React, no browser globals.
 */

export interface ShareState {
  input: Input;
  step: number;
  mutations: string[];
  lang: Lang;
}

/** Bounds on anything arriving from a URL, which is to say from anyone. */
const MAX_ARRAY = 512;
const MAX_ABS = 1_000_000_000;
const MAX_TEXT = 64;
const MAX_GRID_SIDE = 40;

/**
 * The query parameter a field travels under.
 *
 * `array` and `target` keep their original short names so links shared before
 * the codec became field-driven still open on the step they named.
 */
export const paramFor = (field: InputField): string =>
  field.key === 'array' ? 'a' : field.key === 'target' ? 't' : field.key;

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

const first = (p: Params, key: string): string | null => {
  if (p instanceof URLSearchParams) return p.get(key);
  const v = p[key];
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
};

/* ------------------------------------------------------------------ *
 * Encoding
 * ------------------------------------------------------------------ */

export const encodeGrid = (grid: number[][]): string =>
  grid.map((row) => row.map((v) => (v ? 1 : 0)).join('')).join(',');

export function encodeShare(
  state: Partial<ShareState> & { input: Input },
  fields?: InputField[],
): URLSearchParams {
  const p = new URLSearchParams();
  const input = state.input;

  // Without a field list, fall back to the two universal ones. Callers that
  // have the def should pass its fields so every input round-trips.
  const list: InputField[] =
    fields ??
    ([
      input.array !== undefined ? { key: 'array', label: 'Array', kind: 'array' as const } : null,
      input.target !== undefined ? { key: 'target', label: 'Target', kind: 'number' as const } : null,
    ].filter(Boolean) as InputField[]);

  for (const f of list) {
    const v = input[f.key];
    if (v === undefined || v === null) continue;
    const name = paramFor(f);
    if (f.kind === 'array' && Array.isArray(v)) p.set(name, (v as number[]).join(','));
    else if (f.kind === 'grid' && Array.isArray(v)) p.set(name, encodeGrid(v as number[][]));
    else if (f.kind === 'number' || f.kind === 'text') p.set(name, String(v));
  }

  if (state.step && state.step > 0) p.set('step', String(state.step));
  if (state.mutations?.length) p.set('bug', state.mutations.join(','));
  if (state.lang && state.lang !== 'cpp') p.set('lang', state.lang);
  return p;
}

/* ------------------------------------------------------------------ *
 * Decoding
 * ------------------------------------------------------------------ */

const readArray = (raw: string): number[] =>
  raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && Math.abs(n) <= MAX_ABS)
    .slice(0, MAX_ARRAY);

/** Rows of `0`/`1`, comma-separated. Ragged rows are refused, not padded. */
function readGrid(raw: string): number[][] | null {
  const rows = raw.split(',').filter(Boolean);
  if (rows.length === 0 || rows.length > MAX_GRID_SIDE) return null;
  const width = rows[0].length;
  if (width === 0 || width > MAX_GRID_SIDE) return null;
  const out: number[][] = [];
  for (const row of rows) {
    if (row.length !== width || !/^[01]+$/.test(row)) return null;
    out.push([...row].map(Number));
  }
  return out;
}

/**
 * Read a link back into state the app can trust.
 *
 * Every field is validated against the algorithm it claims to belong to — a
 * mutation id that does not exist is dropped rather than carried into the
 * player, where it would silently do nothing and leave the reader looking at a
 * "buggy" run that is not buggy. A field that fails validation falls back to
 * the default rather than being repaired into something nobody asked for.
 */
export function decodeShare(def: AlgorithmDef, params: Params): ShareState {
  let input: Input = { ...def.defaultInput };

  for (const f of def.fields) {
    const raw = first(params, paramFor(f));
    if (raw === null) continue;

    if (f.kind === 'array') {
      input[f.key] = readArray(raw);
    } else if (f.kind === 'number') {
      const n = Number(raw);
      if (Number.isFinite(n) && Math.abs(n) <= MAX_ABS) input[f.key] = n;
    } else if (f.kind === 'text') {
      if (raw.length <= MAX_TEXT) input[f.key] = raw;
    } else if (f.kind === 'grid') {
      const g = readGrid(raw);
      if (g) input[f.key] = g;
    }
  }

  // An input the algorithm rejects is not shown as if it ran; fall back whole
  // rather than keeping the half of it that happened to parse.
  if (def.validate?.(input)) input = { ...def.defaultInput };

  const known = new Set(def.mutations.map((m) => m.id));
  const mutations = (first(params, 'bug') ?? '')
    .split(',')
    .filter((id) => id && known.has(id));

  const rawStep = Number(first(params, 'step') ?? 0);
  const step = Number.isFinite(rawStep) && rawStep > 0 ? Math.floor(rawStep) : 0;

  const rawLang = first(params, 'lang');
  const lang = (LANGS as string[]).includes(rawLang ?? '') ? (rawLang as Lang) : 'cpp';

  return { input, step, mutations, lang };
}

/** A stable short key for one input, so two runs can be compared. */
export function inputKey(input: Input): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    if (Array.isArray(v)) {
      parts.push(`${k}=${Array.isArray(v[0]) ? encodeGrid(v as number[][]) : (v as number[]).join(',')}`);
    } else if (v !== undefined && v !== null) {
      parts.push(`${k}=${String(v)}`);
    }
  }
  return parts.sort().join('|');
}
