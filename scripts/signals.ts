/**
 * The signal pipeline, checked end to end without a browser.
 *
 * Two things have to be true or the insights page is worse than nothing:
 * malformed input must be dropped rather than repaired, and a rate must never
 * appear until it is built on enough sessions to mean something.
 *
 * Run: npx tsx scripts/signals.ts
 */
import { ALGORITHMS } from '../src/lib/algorithms';
import { buildConfusionGraph, MIN_SESSIONS } from '../src/lib/signals/aggregate';
import { parseSignal, SessionSignal, SIGNAL_VERSION } from '../src/lib/signals/types';

let failures = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${msg}`);
  if (!cond) failures++;
};

const slugs = new Set(ALGORITHMS.map((a) => a.slug));
const SLUG = 'binary-search';

function signal(over: Partial<SessionSignal> = {}): SessionSignal {
  return {
    v: SIGNAL_VERSION,
    session: 'abcdef0123456789',
    slug: SLUG,
    lang: 'cpp',
    mutations: [],
    input: '1,2,3|3',
    steps: 10,
    visited: [{ i: 0, line: 5, visits: 1, dwell: 2 }],
    checkpoints: [],
    divergedAtLine: null,
    lastLine: 5,
    finished: false,
    duration: 30,
    ...over,
  };
}

console.log('\n=== the ingest validator refuses anything it cannot verify ===');
{
  ok(parseSignal(signal(), slugs) !== null, 'a well-formed signal is accepted');

  const bad: [string, unknown][] = [
    ['not an object', 'hello'],
    ['null', null],
    ['wrong version', signal({ v: 99 })],
    ['unknown algorithm', signal({ slug: 'not-an-algorithm' })],
    ['session id with punctuation', signal({ session: 'a;b--drop' })],
    ['language that is not a word', signal({ lang: 'c++/x' })],
    ['mutation id with punctuation', signal({ mutations: ['../../etc/passwd'] })],
    ['negative line number', signal({ visited: [{ i: 0, line: -1, visits: 1, dwell: 1 }] })],
    ['fractional visit count', signal({ visited: [{ i: 0, line: 5, visits: 1.5, dwell: 1 }] })],
    ['dwell beyond the cap', signal({ visited: [{ i: 0, line: 5, visits: 1, dwell: 99999 }] })],
    ['checkpoint without a verdict', signal({ checkpoints: [{ line: 5 }] as never })],
    ['finished is not a boolean', signal({ finished: 'yes' as never })],
    ['visited is not an array', signal({ visited: {} as never })],
  ];
  for (const [label, value] of bad) {
    ok(parseSignal(value, slugs) === null, `rejected: ${label}`);
  }

  // Truncation, not rejection, for things that are merely too many.
  const many = parseSignal(
    signal({
      visited: Array.from({ length: 900 }, (_, i) => ({ i, line: 5, visits: 1, dwell: 1 })),
    }),
    slugs,
  );
  ok(many !== null && many.visited.length === 400, 'an over-long visit list is capped, not refused');

  // A hostile string field must not survive into the store.
  const injected = parseSignal(signal({ input: 'x'.repeat(9000) }), slugs);
  ok(injected === null, 'rejected: an input key longer than the field allows');
}

console.log('\n=== a rate is not reported until it means something ===');
{
  const few = buildConfusionGraph(
    Array.from({ length: MIN_SESSIONS - 1 }, () =>
      signal({ visited: [{ i: 0, line: 8, visits: 4, dwell: 20 }] }),
    ),
  );
  const line8 = few.algorithms[0].lines.find((l) => l.line === 8)!;
  ok(line8.sessions === MIN_SESSIONS - 1, `line 8 was seen by ${MIN_SESSIONS - 1} sessions`);
  ok(line8.reread === null, 'with too few sessions the re-read rate is unknown, not a number');
  ok(line8.score === null, 'and no score is produced from it');

  const enough = buildConfusionGraph(
    Array.from({ length: MIN_SESSIONS }, () =>
      signal({ visited: [{ i: 0, line: 8, visits: 4, dwell: 20 }] }),
    ),
  );
  const l8 = enough.algorithms[0].lines.find((l) => l.line === 8)!;
  ok(l8.reread === 3, `one more session and the rate appears (${l8.reread} extra visits)`);
  ok(l8.dwell === 20, `median dwell is reported (${l8.dwell}s)`);
}

console.log('\n=== the counts mean what the page says they mean ===');
{
  // Ten sessions: all read line 8 once; six of them re-read line 12 heavily;
  // four abandon at line 12; a checkpoint at line 8 is missed by three of six.
  const rows: SessionSignal[] = [];
  for (let k = 0; k < 10; k++) {
    rows.push(
      signal({
        session: `s${k}`.padEnd(8, '0'),
        visited: [
          { i: 0, line: 8, visits: 1, dwell: 3 },
          { i: 1, line: 12, visits: k < 6 ? 5 : 1, dwell: k < 6 ? 30 : 4 },
        ],
        checkpoints: k < 6 ? [{ line: 8, correct: k >= 3 }] : [],
        lastLine: 12,
        finished: k >= 4,
      }),
    );
  }

  const g = buildConfusionGraph(rows);
  const a = g.algorithms[0];
  ok(a.sessions === 10, `ten sessions recorded (${a.sessions})`);
  ok(a.finished === 6, `six reached the end (${a.finished})`);

  const l8 = a.lines.find((l) => l.line === 8)!;
  const l12 = a.lines.find((l) => l.line === 12)!;

  ok(l8.reread === 0, 'line 8 was read once by everyone, so its re-read rate is 0');
  ok(
    l8.checkpointMiss === 0.5,
    `line 8's checkpoint was missed by half of its six answers (${l8.checkpointMiss})`,
  );
  ok(l8.checkpointAnswers === 6, `and the page can say it is out of six (${l8.checkpointAnswers})`);

  // 6 sessions × 4 extra visits + 4 sessions × 0, over 10 sessions.
  ok(l12.reread === 2.4, `line 12 averages 2.4 extra visits (${l12.reread})`);
  ok(l12.drop === 0.4, `four of ten stopped at line 12 (${l12.drop})`);
  ok(
    (l12.score ?? 0) > (l8.score ?? 0),
    `line 12 scores above line 8 (${l12.score?.toFixed(2)} vs ${l8.score?.toFixed(2)})`,
  );
  ok(a.lines[0].line === 12, 'and it is ranked first');
}

console.log('\n=== a loop body is not confusing merely because it loops ===');
{
  // The same line reached through twenty different steps, once each. If steps
  // were counted instead of lines this would look like the hardest line on the
  // page; it is just a loop.
  const rows = Array.from({ length: 10 }, () =>
    signal({
      visited: Array.from({ length: 20 }, (_, i) => ({ i, line: 7, visits: 1, dwell: 1 })),
      lastLine: 7,
      finished: true,
    }),
  );
  const l7 = buildConfusionGraph(rows).algorithms[0].lines.find((l) => l.line === 7)!;
  ok(l7.sessions === 10, `counted once per session, not once per step (${l7.sessions})`);
  ok(l7.reread === 0, `and no re-reads are invented from the repetition (${l7.reread})`);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
