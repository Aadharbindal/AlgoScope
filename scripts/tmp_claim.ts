/** Does the cost claim hold on the reference for every candidate input? */
import { ALGORITHMS, bySlug } from '../src/lib/algorithms';
import { buildTrace } from '../src/lib/algorithms/types';
import { candidateInputs } from '../src/lib/trace/counterexample';

const only = process.argv[2];
const defs = only ? [bySlug(only)!] : ALGORITHMS.filter((d) => d.lens.cost);
let bad = 0;
for (const def of defs) {
  if (!def.lens.cost) { console.log(`--   ${def.slug}: no cost claim`); continue; }
  const fails = candidateInputs(def).filter(
    (c) => buildTrace(def, c.input).steps.at(-1)?.costHolds === false,
  );
  if (fails.length) {
    bad++;
    console.log(`FAIL ${def.slug} — breaks on ${fails.length}: ${fails.slice(0, 3).map((f) => f.label).join(', ')}`);
  } else {
    console.log(`ok   ${def.slug}`);
  }
}
console.log(bad === 0 ? 'every cost claim holds on its reference' : `${bad} cost claim(s) fail on a correct run`);
