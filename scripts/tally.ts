/** A count of what the catalogue actually holds, for the record. */
import { ALGORITHMS } from '../src/lib/algorithms';
import { laneLangs } from '../src/lib/algorithms/types';

let lanes = 0;
let full = 0;
const missing: string[] = [];
for (const def of ALGORITHMS) {
  if (!def.userLane) { missing.push(def.slug); continue; }
  lanes++;
  if (laneLangs(def.userLane).length === 4) full++;
}
console.log(`${ALGORITHMS.length} algorithms`);
console.log(`${lanes} with a lane, ${full} of them in all four languages`);
console.log(`without a lane: ${missing.length ? missing.join(', ') : 'none'}`);
console.log(`${ALGORITHMS.reduce((n, d) => n + d.checkpoints.length, 0)} checkpoints`);
console.log(`${ALGORITHMS.reduce((n, d) => n + d.mutations.length, 0)} mutations`);
console.log(`${ALGORITHMS.reduce((n, d) => n + d.edgeCases.length, 0)} edge cases`);
