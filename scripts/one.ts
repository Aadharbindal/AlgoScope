/**
 * Everything smoke asks, pointed at one algorithm.
 *
 * The suite checks all of them, which is what you want before a commit and
 * not what you want while writing the twentieth line of a new definition.
 * This is the same questions against a single slug, so the loop between
 * writing a step and finding out that a checkpoint cannot locate it is
 * seconds rather than minutes. Nothing here is authoritative — verify is.
 *
 * Run: npx tsx scripts/one.ts <slug>
 */
import { bySlug } from '../src/lib/algorithms';
import { buildTrace, codeFor, LANGS } from '../src/lib/algorithms/types';
import { findCounterexample } from '../src/lib/trace/counterexample';
import { validateLens } from '../src/lib/trace/lens';
import { candidateInputs } from '../src/lib/trace/counterexample';
import { parse } from '../src/lib/interp/parser';

const def = bySlug(process.argv[2])!;
const t = buildTrace(def, def.defaultInput);
console.log(`steps ${t.steps.length} result "${t.result}" truncated ${t.truncated}`);
const v = validateLens(t, def.lens);
console.log(`lens: ${v.ok ? 'ok' : 'FAIL ' + v.reason}`);
const lines = def.code.cpp.split('\n').length;
const bad = [...new Set(t.steps.map(s=>s.line))].filter(l=>l<1||l>lines);
console.log(`lines 1..${lines}: ${bad.length ? 'BAD ' + bad.join(',') : 'ok'}`);
for (const l of LANGS) {
  const p = parse(def.code[l]);
  console.log(`  ${l}: ${def.code[l].split('\n').length} lines, parse ${p.ok ? 'ok' : 'FAIL ' + p.message}`);
}
for (const m of def.mutations) {
  const ce = findCounterexample(def, new Set([m.id]));
  const mutated = codeFor(def, new Set([m.id]));
  console.log(`  mutation ${m.id}: rewrites=${mutated !== t.code} ce=${ce ? `"${ce.label}" ${ce.yours} vs ${ce.correct}` : 'NONE'}`);
}
const wrong = candidateInputs(def).filter(c=>{const s=buildTrace(def,c.input).steps.at(-1); return s?.postconditionHolds===false||s?.costHolds===false;});
console.log(`claims on ${candidateInputs(def).length} inputs: ${wrong.length?'BROKEN '+wrong.map(w=>w.label).join(','):'ok'}`);
for (const [k,cp] of def.checkpoints.entries()) {
  const at = cp.locate(t);
  console.log(`  checkpoint ${k}: step ${at} ${at<1?'NOT FOUND':`answer "${cp.answer(t,at)}" in [${cp.options(t,at).join('|')}]`}`);
}
