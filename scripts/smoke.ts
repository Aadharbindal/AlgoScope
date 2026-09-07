/**
 * Engine smoke test.
 *
 * Every claim the UI makes is downstream of these four things being true:
 *   1. Each algorithm produces a trace whose lens invariant never breaks.
 *   2. Each buggy variant diverges from the reference at a locatable step.
 *   3. Growth measurement recovers the complexity we expect.
 *   4. Every emitted line number exists in the displayed source.
 *
 * Run: npx tsx scripts/smoke.ts
 */
import { ALGORITHMS } from '../src/lib/algorithms';
import { buildTrace, codeFor, countOps, countSpace, LANGS, laneLangs } from '../src/lib/algorithms/types';
import { analyseGrowth, MODELS } from '../src/lib/trace/complexity';
import { findCounterexample } from '../src/lib/trace/counterexample';
import { validateLens } from '../src/lib/trace/lens';
import { LADDERS, rungDefs } from '../src/lib/ladders';
import { candidateInputs } from '../src/lib/trace/counterexample';
import { checkUserCode } from '../src/lib/usercode/check';
import { runUserIn } from '../src/lib/usercode/dispatch';
import { parse } from '../src/lib/interp/parser';

let failures = 0;
// Across the catalogue, how load-bearing are the invariants?
let invariantsChecked = 0;
let invariantsCaught = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${msg}`);
  if (!cond) failures++;
};

for (const def of ALGORITHMS) {
  console.log(`\n=== ${def.name} ===`);

  const trace = buildTrace(def, def.defaultInput);
  console.log(`  steps: ${trace.steps.length}   result: ${trace.result}   truncated: ${trace.truncated}`);

  ok(trace.steps.length > 0, 'produces a non-empty trace');
  ok(!trace.truncated, 'terminates within the step cap');

  // 1. lens validation against a known-correct run
  ok(def.lens.invariant !== undefined, 'declares an invariant');
  const v = validateLens(trace, def.lens);
  ok(v.ok, `lens validates on the reference run${v.ok ? '' : ` — ${v.reason}`}`);

  // 1b. Which of this algorithm's own bugs does its invariant actually catch?
  //     Measured in the variants loop below, where the exposing input for each
  //     variant is already being computed — running the counterexample search
  //     twice per variant made this the slowest check in the suite.
  const invariantCatches: string[] = [];

  // 4. every line number is real
  const lineCount = def.code.cpp.split('\n').length;
  const bad = [...new Set(trace.steps.map((s) => s.line))].filter((l) => l < 1 || l > lineCount);
  ok(bad.length === 0, `all emitted lines are within 1..${lineCount}${bad.length ? ` (bad: ${bad.join(', ')})` : ''}`);

  // narration is never empty
  const blank = trace.steps.filter((s) => !s.narration || !s.narration.trim()).length;
  ok(blank === 0, `every step carries narration (${blank} blank)`);

  // 2. every variant must be exposable by some input we can find ourselves
  for (const variant of def.variants) {
    const active = new Set(variant.mutations);
    const ce = findCounterexample(def, active);
    if (ce) {
      console.log(`  · ${variant.id}: exposed by "${ce.label}" (${ce.source}), diverges at step ${ce.divergence.index}`);
      console.log(`      ${ce.divergence.summary}`);
    }
    ok(ce !== null, `variant "${variant.id}" has a discoverable counterexample`);

    // Does the invariant notice this particular bug? On the input the reader
    // is actually shown, which is the exposing one.
    if (def.lens.invariant) {
      const inputs = [def.defaultInput, ...(ce ? [ce.input] : [])];
      const breaks = inputs.some(
        (input) => !validateLens(buildTrace(def, input, active), def.lens).ok,
      );
      if (breaks) invariantCatches.push(variant.id);
    }
  }

  // Reported rather than asserted, and deliberately so. An invariant states one
  // true property; a bug that violates a different property slips past it, and
  // that is a fact about invariants rather than a defect in this one. Binary
  // search's window-containment invariant is perfectly true and says nothing
  // about a loop that exits one iteration early. Making this a failing check
  // would push every invariant towards being written to satisfy the test rather
  // than to be true — the opposite of the point. The catalogue-level assertion
  // further down is the real guard.
  if (def.lens.invariant && def.variants.length > 0) {
    invariantsChecked += def.variants.length;
    invariantsCaught += invariantCatches.length;
    console.log(
      `  claims catch ${invariantCatches.length}/${def.variants.length} of its own variants` +
        `${invariantCatches.length ? ` (${invariantCatches.join(', ')})` : ''}`,
    );
  }

  // 1c. The end-of-run claims have to hold on a correct run of *every* input
  //     the counterexample search can reach, not only the default one. The
  //     invariant is deliberately excluded: an algorithm may be handed an
  //     input it is not defined on — two sum's sorted precondition, broken on
  //     purpose by an edge case that exists to show what breaking it does —
  //     and an invariant failing there is the lesson rather than a defect.
  //     A postcondition or a cost claim has no such excuse.
  {
    // Inputs the algorithm itself rejects are excluded, and only those. Two
    // sum's `validate` says in so many words that the two-pointer argument
    // needs a sorted array — an edge case that breaks that precondition on
    // purpose is meant to break the promise, and is the lesson rather than a
    // defect. Anything the algorithm accepts, it has to keep its word about.
    const defined = candidateInputs(def).filter((c) => !def.validate?.(c.input));
    const wrong = defined.filter((c) => {
      const last = buildTrace(def, c.input).steps.at(-1);
      return last?.postconditionHolds === false || last?.costHolds === false;
    });
    ok(
      wrong.length === 0,
      `end-of-run claims hold on all ${defined.length} inputs the algorithm accepts${
        wrong.length ? ` — broken on ${wrong.slice(0, 3).map((w) => w.label).join(', ')}` : ''
      }`,
    );
  }

  // 4c. The listing on the page has to be something a reader can actually
  //     start from. They are invited to write in the same lane the code is
  //     displayed in, and the obvious first move is to copy what is on screen
  //     — so if the interpreter refuses it, the site has handed them a wall
  //     built out of its own example. Parsing is the bar here, not running:
  //     some listings name a constant the lane leaves to the reader.
  for (const l of LANGS) {
    const parsed = parse(def.code[l]);
    ok(
      parsed.ok,
      `the ${l} listing on the page parses in the lane that offers it${
        parsed.ok ? '' : ` — ${parsed.message} (line ${parsed.line})`
      }`,
    );
  }

  // 4b. C, C++ and Java are line-for-line transliterations of each other.
  //     If they ever drift, the code panel highlights the wrong statement in
  //     two of the three tabs, and nothing in the UI would say so.
  for (const l of LANGS) {
    const src = def.code[l];
    ok(typeof src === 'string' && src.length > 0, `has a ${l} source`);
    ok(
      src.split('\n').length === lineCount,
      `${l} source is line-aligned with C++ (${src.split('\n').length} vs ${lineCount})`,
    );
  }

  // 2b. every individual mutation must really edit the source and really
  //     change behaviour — a stale `from` string would silently do neither
  for (const m of def.mutations) {
    const one = new Set([m.id]);
    const mutated = codeFor(def, one);
    ok(mutated !== trace.code, `mutation "${m.id}" rewrites the displayed source`);
    const lineCountOf = (src: string) => src.split(/\r?\n/).length;
    ok(
      lineCountOf(mutated) === lineCountOf(trace.code),
      `mutation "${m.id}" keeps the line count stable`,
    );

    // …and it must land in every language. An edit whose `from` only matches
    // the C++ spelling would leave the C and Java tabs reading as correct code
    // while the trace beside them runs the broken version.
    for (const l of LANGS) {
      const before = def.code[l];
      const after = codeFor(def, one, l);
      ok(after !== before, `mutation "${m.id}" applies in ${l}`);
      ok(
        after.split('\n').length === before.split('\n').length,
        `mutation "${m.id}" keeps ${l}'s line count stable`,
      );
    }

    const ce = findCounterexample(def, one);
    ok(ce !== null, `mutation "${m.id}" changes what the algorithm does`);
  }

  // edge cases must not throw
  for (const ec of def.edgeCases) {
    const t = buildTrace(def, ec.input);
    const threw = typeof t.result === 'string' && t.result.startsWith('error:');
    ok(!threw, `edge case "${ec.label}" runs without throwing${threw ? ` — ${t.result}` : ''}`);
  }

  // checkpoints resolve
  for (const [k, cp] of def.checkpoints.entries()) {
    const at = cp.locate(trace);
    if (at < 1) {
      ok(false, `checkpoint ${k} locates a step`);
      continue;
    }
    const opts = cp.options(trace, at);
    const ans = cp.answer(trace, at);
    ok(opts.includes(ans), `checkpoint ${k}: answer "${ans}" is among options [${opts.join(' | ')}]`);
  }

  // 5. the user-code lane: the starter must actually run, and must agree with
  //    the reference everywhere the counterexample search looks
  if (def.userLane) {
    const lane = def.userLane;
    const offered = laneLangs(lane);
    ok(offered.length > 0, 'user lane: offers at least one language');
    for (const lang of offered) {
      const src = lane.starters[lang]!;
      const r = runUserIn(def, src, lang, def.defaultInput, lane);
      ok(r.ok, `user lane [${lang}]: starter runs${r.ok ? '' : ` — ${r.message}`}`);
      if (!r.ok) continue;
      ok(r.trace.steps.length > 0, `user lane [${lang}]: starter produces a trace (${r.trace.steps.length} steps)`);
      const v = checkUserCode(def, src, lane, lang);
      ok(
        v.counterexample === null && !v.error,
        `user lane [${lang}]: starter agrees with the reference on ${v.tried} inputs${
          v.counterexample ? ` — differs on ${v.counterexample.label}: got ${v.counterexample.yours}, want ${v.counterexample.correct}` : ''
        }${v.error ? ` — threw on ${v.error.label}: ${v.error.message}` : ''}`,
      );
    }
  }

  // 3b. space, measured the same way time is. Where the measurement is
  //     confident, the stated bound has to name what was recovered — the same
  //     rule time has always been held to.
  const spacePoints = def.growthSizes.map((n) => ({ n, ops: countSpace(def, def.makeInput(n)) }));
  const spaceReport = analyseGrowth(spacePoints, def.projectTo);
  const confident = spaceReport.best.r2 >= 0.9;
  console.log(
    `  space:  ${spaceReport.best.model.notation}  R²=${spaceReport.best.r2.toFixed(4)}  ${
      confident ? '' : '(inconclusive) '
    }(stated ${def.complexity.space})`,
  );
  ok(spacePoints.every((p) => p.ops >= 1), 'space is measured as at least one cell at every size');
  if (confident) {
    ok(
      def.complexity.space.includes(spaceReport.best.model.notation),
      `measured space ${spaceReport.best.model.notation} appears in the stated "${def.complexity.space}"`,
    );
  }

  // 3. growth
  const points = def.growthSizes.map((n) => ({ n, ops: countOps(def, def.makeInput(n)) }));
  const report = analyseGrowth(points, def.projectTo);
  console.log(`  growth: ${report.best.model.notation}  R²=${report.best.r2.toFixed(4)}  (declared ${def.complexity.time})`);
  ok(report.best.r2 > 0.9, `growth fit is convincing (R² = ${report.best.r2.toFixed(4)})`);
  ok(
    def.complexity.time.includes(report.best.model.notation),
    `measured ${report.best.model.notation} matches declared "${def.complexity.time}"`,
  );
}

console.log('\n=== how load-bearing are the claims ===');
console.log(`  ${invariantsCaught} of ${invariantsChecked} authored bugs break a claim`);
// Every one of them, and the bar is set there deliberately. It stood at 42 of
// 47 until there were three kinds of claim: an invariant judges every step, a
// postcondition judges the result, and a cost claim judges the work done. The
// five that escaped all escaped the same way — right answer, wrong route — and
// each needed the third kind rather than a weaker test.
//
// A new algorithm whose bug nothing catches will fail here, and that is the
// point: the fix is to write the claim that catches it, which is a question
// worth being made to answer. Never to lower this number.
ok(
  invariantsCaught === invariantsChecked,
  `every authored bug breaks an invariant, a postcondition or a cost claim (${invariantsCaught}/${invariantsChecked})`,
);

/* ------------------------------------------------------------------ *
 * Ladders. The premise of a ladder is that its rungs answer the same
 * question by different means, so that is exactly what has to be checked:
 * if two rungs ever disagree, the operation counts printed beside each
 * other are a comparison of two different problems.
 * ------------------------------------------------------------------ */

for (const ladder of LADDERS) {
  console.log(`\n=== ladder: ${ladder.name} ===`);
  const rungs = rungDefs(ladder);

  ok(
    rungs.length === ladder.rungs.length,
    `every rung resolves to an algorithm (${rungs.length}/${ladder.rungs.length})`,
  );
  ok(rungs.length >= 2, 'a ladder needs at least two rungs to compare');

  // The shared example first, because it is the one the page prints.
  const onExample = rungs.map(({ def }) => String(buildTrace(def, ladder.compareInput).result));
  console.log(`  on the example input: ${[...new Set(onExample)].join(' | ')}`);
  ok(new Set(onExample).size === 1, 'all rungs agree on the example input');

  // Then a spread, so agreement is not a property of one lucky array.
  const first = rungs[0].def;
  let tried = 0;
  let disagreed: string | null = null;
  for (const candidate of candidateInputs(first)) {
    if (rungs.some(({ def }) => def.validate?.(candidate.input))) continue;
    if (
      rungs.some(
        ({ def }) => def.userLane?.precondition && !def.userLane.precondition(candidate.input),
      )
    ) {
      continue;
    }
    tried++;
    const answers = rungs.map(({ def }) => String(buildTrace(def, candidate.input).result));
    if (new Set(answers).size !== 1) {
      disagreed = `${candidate.label}: ${rungs
        .map((r, i) => `${r.rung.label} -> ${answers[i]}`)
        .join(', ')}`;
      break;
    }
  }
  ok(disagreed === null, `all rungs agree across ${tried} inputs${disagreed ? ` - ${disagreed}` : ''}`);

  // And the rungs have to actually be a ladder: climbing must not make the
  // complexity worse. The claim is about the growth *class*, not about raw
  // operation counts — within a class the ordering is decided by other things
  // entirely. Insertion sort really does do more work than selection sort on
  // their respective worst cases, and quick sort more than merge sort; both are
  // true, both are quadratic-then-linearithmic all the same, and asserting on
  // counts would have demanded a reordering that misrepresents the subject.
  const measured = rungs.map(({ def }) => {
    const points = ladder.growthSizes.map((n) => ({ n, ops: countOps(def, def.makeInput(n)) }));
    const best = analyseGrowth(points, def.projectTo).best.model;
    // Space is measured the same way time is, because climbing a ladder does
    // not always mean going faster. Reversing a list recursively and
    // iteratively are the same work in the same order; the difference is a
    // stack frame per node, and a ladder that could only be justified on time
    // would have no way to say so.
    const spacePoints = ladder.growthSizes.map((n) => ({ n, ops: countSpace(def, def.makeInput(n)) }));
    const spaceBest = analyseGrowth(spacePoints, def.projectTo).best.model;
    return {
      label: def.name,
      ops: points[points.length - 1].ops,
      notation: best.notation,
      rank: MODELS.findIndex((m) => m.key === best.key),
      spaceNotation: spaceBest.notation,
      spaceRank: MODELS.findIndex((m) => m.key === spaceBest.key),
    };
  });
  const biggest = ladder.growthSizes[ladder.growthSizes.length - 1];
  for (const m of measured) {
    console.log(`  - ${m.label}: ${m.notation}, ${m.ops.toLocaleString()} ops at n=${biggest}`);
  }
  for (const m of measured) {
    console.log(`    space ${m.spaceNotation}`);
  }
  // Going up may never cost more, in either dimension.
  for (let i = 1; i < measured.length; i++) {
    ok(
      measured[i].rank <= measured[i - 1].rank,
      `rung ${i + 1} is in no worse a time class than rung ${i} (${measured[i].notation} vs ${measured[i - 1].notation})`,
    );
    // Space is reported rather than asserted, because buying time with space
    // is a real trade and the sorting ladder makes it: merge sort is a class
    // faster than insertion sort and a class hungrier. Failing on that would
    // be the suite refusing to believe the most famous trade in the subject.
    if (measured[i].spaceRank > measured[i - 1].spaceRank) {
      console.log(
        `    note: rung ${i + 1} buys its time with space (${measured[i].spaceNotation} vs ${measured[i - 1].spaceNotation})`,
      );
    }
  }
  // …and the climb has to be worth making in at least one of them. A ladder
  // whose top rung is no better than its bottom one anywhere is a list of
  // implementations, not a ladder.
  const top = measured[measured.length - 1];
  const bottom = measured[0];
  ok(
    top.rank < bottom.rank || top.spaceRank < bottom.spaceRank,
    `the top rung beats the bottom in time or in space (time ${top.notation} vs ${bottom.notation}, space ${top.spaceNotation} vs ${bottom.spaceNotation})`,
  );
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
