import { AlgorithmDef, Input } from './types';

/**
 * An input written out the way the page's own fields describe it.
 *
 * Every algorithm used to take an array and a target, and the one place that
 * showed a counterexample printed exactly that. Now an input can be a maze, an
 * edge list or a pair of words, and printing `[]` for those said the input was
 * empty — which was not a formatting flaw so much as a false statement about
 * what broke the reader's code. The fields are the definition of what an input
 * is, so they are what this reads.
 */
export function describeInput(def: AlgorithmDef, input: Input): string {
  const parts: string[] = [];

  for (const field of def.fields) {
    const value = input[field.key];
    if (value === undefined || value === null) continue;

    if (field.kind === 'grid' && Array.isArray(value)) {
      const rows = value as number[][];
      const walls = rows.reduce((n, row) => n + row.filter(Boolean).length, 0);
      parts.push(
        `${rows.length}×${rows[0]?.length ?? 0} grid, ${walls} wall${walls === 1 ? '' : 's'}`,
      );
      continue;
    }
    if (field.kind === 'array' && Array.isArray(value)) {
      parts.push(`[${(value as number[]).join(', ')}]`);
      continue;
    }
    if (field.kind === 'text') {
      parts.push(`${field.key} "${String(value)}"`);
      continue;
    }
    parts.push(`${field.key} ${String(value)}`);
  }

  // Some pages read `target` without declaring a field for it — the index a
  // linked list loops back to, for one.
  if (input.target !== undefined && !def.fields.some((f) => f.key === 'target')) {
    parts.push(`target ${String(input.target)}`);
  }

  return parts.join(' · ') || 'no input';
}
