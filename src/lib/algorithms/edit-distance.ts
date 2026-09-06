import { ev } from '../trace/tracer';
import { conceptual } from './checkpoints';
import { AlgorithmDef, Input, RunFn } from './types';

const CPP = `int editDistance(string a, string b) {
    int n = a.size(), m = b.size();
    vector<vector<int>> dp(n + 1, vector<int>(m + 1, 0));

    for (int i = 0; i <= n; i++) dp[i][0] = i;
    for (int j = 0; j <= m; j++) dp[0][j] = j;

    for (int i = 1; i <= n; i++) {
        for (int j = 1; j <= m; j++) {
            if (a[i - 1] == b[j - 1])
                dp[i][j] = dp[i - 1][j - 1];
            else
                dp[i][j] = 1 + min(dp[i - 1][j - 1],
                               min(dp[i - 1][j], dp[i][j - 1]));
        }
    }

    return dp[n][m];
}`;

const C = `int editDistance(char* a, char* b) {
    int n = strlen(a), m = strlen(b);
    int dp[64][64];

    for (int i = 0; i <= n; i++) dp[i][0] = i;
    for (int j = 0; j <= m; j++) dp[0][j] = j;

    for (int i = 1; i <= n; i++) {
        for (int j = 1; j <= m; j++) {
            if (a[i - 1] == b[j - 1])
                dp[i][j] = dp[i - 1][j - 1];
            else
                dp[i][j] = 1 + min3(dp[i - 1][j - 1],
                               dp[i - 1][j], dp[i][j - 1]);
        }
    }

    return dp[n][m];
}`;

const JAVA = `int editDistance(String a, String b) {
    int n = a.length(), m = b.length();
    int[][] dp = new int[n + 1][m + 1];

    for (int i = 0; i <= n; i++) dp[i][0] = i;
    for (int j = 0; j <= m; j++) dp[0][j] = j;

    for (int i = 1; i <= n; i++) {
        for (int j = 1; j <= m; j++) {
            if (a.charAt(i - 1) == b.charAt(j - 1))
                dp[i][j] = dp[i - 1][j - 1];
            else
                dp[i][j] = 1 + Math.min(dp[i - 1][j - 1],
                               Math.min(dp[i - 1][j], dp[i][j - 1]));
        }
    }

    return dp[n][m];
}`;

const wordOf = (input: Input, key: string, fallback: string): string => {
  const v = input[key];
  return typeof v === 'string' ? v : fallback;
};

/**
 * The whole correct table, computed independently.
 *
 * Not just the final answer: the invariant is about every cell, so the checker
 * needs every cell. Computed here by a separate routine rather than by the
 * traced one, so a bug in the traced implementation cannot make itself look
 * right by also corrupting what it is checked against.
 */
function trueTable(a: string, b: string): number[][] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp;
}

const run: RunFn = (input, t, mut) => {
  const a = wordOf(input, 'word1', 'kitten');
  const b = wordOf(input, 'word2', 'sitting');
  const n = a.length;
  const m = b.length;

  const dp: (number | null)[][] = Array.from({ length: n + 1 }, () =>
    Array.from({ length: m + 1 }, () => null),
  );
  let cursor: { r: number; c: number } | null = null;
  let from: { r: number; c: number }[] = [];

  const rowLabels = ['·', ...a.split('')];
  const colLabels = ['·', ...b.split('')];

  t.table('dp', dp as number[][], rowLabels, colLabels, {
    cursor: () => cursor,
    from: () => from,
    label: 'dp',
  });
  // The whole table is held at once, which is what the "can be reduced to one
  // row" note in the complexity panel is contrasted against.
  t.aux('dp', () => (n + 1) * (m + 1));
  const truth = trueTable(a, b);
  t.oracle({ answer: truth[n][m], n, m });

  // Checked after every write: no cell is ever allowed to hold a value that is
  // not the real cost for its pair of prefixes. A dynamic program is only
  // sound if this holds for every cell it has filled — the final answer being
  // right is a consequence, not the property.
  let exact = 1;
  const verify = () => {
    for (let i = 0; i <= n && exact; i++) {
      for (let j = 0; j <= m; j++) {
        const v = dp[i][j];
        if (v !== null && v !== truth[i][j]) {
          exact = 0;
          break;
        }
      }
    }
    t.derive({ exact });
  };

  // Dropping the diagonal leaves only insert and delete, so a substitution
  // has to be paid for twice.
  const noSubstitute = mut.has('no-substitute');
  const zeroTopRow = mut.has('zero-top-row');

  t.enter('editDistance', `editDistance("${a}", "${b}")`);
  t.step(2, { i: null, j: null, n, m }, `Turning "${a}" (${n} letters) into "${b}" (${m} letters), one edit at a time.`);
  t.step(3, { i: null, j: null, n, m }, `dp[i][j] will hold the cost of turning the first i letters of "${a}" into the first j letters of "${b}".`);

  for (let i = 0; i <= n; i++) {
    cursor = { r: i, c: 0 };
    from = [];
    dp[i][0] = i;
    verify();
    t.step(5, { i, j: 0, n, m, cost: i }, `Turning the first ${i} letter${i === 1 ? '' : 's'} into nothing costs ${i} deletion${i === 1 ? '' : 's'}.`, ev.write('dp', i, i));
  }
  for (let j = 0; j <= m; j++) {
    cursor = { r: 0, c: j };
    from = [];
    dp[0][j] = zeroTopRow ? 0 : j;
    verify();
    t.step(6, { i: 0, j, n, m, cost: dp[0][j] }, zeroTopRow ? `Recorded as 0 — no edits needed.` : `Turning nothing into the first ${j} letter${j === 1 ? '' : 's'} costs ${j} insertion${j === 1 ? '' : 's'}.`, ev.write('dp', j, dp[0][j] as number));
  }

  for (let i = 1; i <= n; i++) {
    t.step(8, { i, j: null, n, m }, `Row ${i}: matching "${a.slice(0, i)}" against every prefix of "${b}".`);

    for (let j = 1; j <= m; j++) {
      cursor = { r: i, c: j };
      const same = a[i - 1] === b[j - 1];

      from = [];
      t.step(9, { i, j, n, m }, `Cell (${i}, ${j}): "${a.slice(0, i)}" against "${b.slice(0, j)}".`);
      t.step(
        10,
        { i, j, n, m },
        same
          ? `The last letters match — both are '${a[i - 1]}'.`
          : `The last letters differ: '${a[i - 1]}' against '${b[j - 1]}'.`,
        ev.cmp({ kind: 'literal', value: a[i - 1] }, '==', { kind: 'literal', value: b[j - 1] }, same),
      );

      if (same) {
        from = [{ r: i - 1, c: j - 1 }];
        const value = dp[i - 1][j - 1] as number;
        dp[i][j] = value;
        verify();
        t.step(11, { i, j, n, m, cost: value }, `Nothing to do for this letter, so the cost is whatever it took to align the prefixes before them: ${value}.`, ev.write('dp', i * (m + 1) + j, value));
      } else {
        const diag = dp[i - 1][j - 1] as number;
        const up = dp[i - 1][j] as number;
        const left = dp[i][j - 1] as number;
        from = noSubstitute
          ? [{ r: i - 1, c: j }, { r: i, c: j - 1 }]
          : [{ r: i - 1, c: j - 1 }, { r: i - 1, c: j }, { r: i, c: j - 1 }];

        const best = noSubstitute ? Math.min(up, left) : Math.min(diag, up, left);
        const value = 1 + best;
        dp[i][j] = value;
        verify();

        const why = noSubstitute
          ? `delete (${up}) or insert (${left})`
          : `substitute (${diag}), delete (${up}) or insert (${left})`;
        t.step(13, { i, j, n, m, diag, up, left }, `One edit is unavoidable here. The question is which one is cheapest to build on: ${why}.`);
        t.step(14, { i, j, n, m, cost: value }, `The cheapest is ${best}, so this cell costs ${value}.`, ev.write('dp', i * (m + 1) + j, value));
      }
    }
  }

  cursor = { r: n, c: m };
  from = [];
  const answer = dp[n][m] as number;
  t.exit();
  t.step(18, { i: n, j: m, n, m, cost: answer }, `The bottom-right cell is the whole problem: "${a}" becomes "${b}" in ${answer} edit${answer === 1 ? '' : 's'}.`, ev.found('dp', n * (m + 1) + m));
  return answer;
};

/** Two strings of length n that disagree often, for growth measurement. */
function pair(n: number): { word1: string; word2: string } {
  let w1 = '';
  let w2 = '';
  for (let i = 0; i < n; i++) {
    w1 += 'abcde'[i % 5];
    w2 += 'edcba'[(i * 3) % 5];
  }
  return { word1: w1, word2: w2 };
}

export const editDistance: AlgorithmDef = {
  slug: 'edit-distance',
  name: 'Edit Distance',
  category: 'dp',
  tagline: 'The fewest insertions, deletions and substitutions that turn one word into another.',
  intuition: [
    'The table is the algorithm. Every cell answers one small version of the question — "what does it cost to turn this prefix into that prefix?" — and every cell is built from three cells that were already answered.',
    'Those three are the three things you can do. Come from the cell up-and-left and you substituted a letter; from above, you deleted one; from the left, you inserted one. If the two letters already match, no edit is needed and the cost is simply carried across the diagonal for free.',
    'Watch which cells light up as each new one is filled. That is the part a formula on a slide cannot show you, and it is where the recurrence stops being three arbitrary terms and starts being three obvious choices.',
  ],
  code: { cpp: CPP, c: C, java: JAVA },
  lens: {
    primary: 'dp',
    pointers: [],
    regions: [],
    invariant: {
      text: 'Every cell filled in so far holds the true cost for its pair of prefixes.',
      check: 'exact === 1',
      when: 'defined(exact)',
      why: 'This is what makes a dynamic program work, and it is stronger than "the answer came out right". Each cell is built from three that were filled earlier, so one wrong cell is inherited by everything below and to the right of it — a table can therefore be wrong in a way that only shows up in the last cell, hundreds of steps after the mistake. Checking every cell as it is written turns that into an error at the step that caused it.',
    },
  },
  run,
  defaultInput: { word1: 'kitten', word2: 'sitting' },
  fields: [
    { key: 'word1', label: 'From', kind: 'text', help: 'The word being edited. Keep it short — the table is rows by columns.' },
    { key: 'word2', label: 'Into', kind: 'text', help: 'The word it has to become.' },
  ],
  validate: (input) => {
    const a = wordOf(input, 'word1', '');
    const b = wordOf(input, 'word2', '');
    if (a.length > 14 || b.length > 14) {
      return 'Both words are capped at 14 letters here, so the table stays readable. The algorithm itself has no such limit.';
    }
    return null;
  },
  makeInput: (n) => pair(n),
  growthSizes: [8, 16, 24, 32, 48, 64, 96],
  projectTo: 10_000,
  complexity: {
    time: 'O(n × m), which is O(n²) when both words are the same length',
    space: 'O(n × m), which is O(n²) when both words are the same length',
    note: 'One cell per pair of prefixes, and each cell costs a fixed amount of work — so the total is the area of the table. The measurement below uses equal-length words, so what it recovers is the O(n²) special case; feed it a short word and a long one and the cost is the product, not the square. Space can be reduced to a single row, since a cell only ever reads the row above it and the cell to its left.',
  },
  userLane: {
    fnName: 'editDistance',
    compareBy: 'return',
    binds: 'words',
    starters: {
      cpp: `int editDistance(string a, string b) {
    int n = a.size(), m = b.size();
    vector<vector<int>> dp(n + 1, vector<int>(m + 1, 0));

    for (int i = 0; i <= n; i++) dp[i][0] = i;
    for (int j = 0; j <= m; j++) dp[0][j] = j;

    for (int i = 1; i <= n; i++) {
        for (int j = 1; j <= m; j++) {
            if (a[i - 1] == b[j - 1])
                dp[i][j] = dp[i - 1][j - 1];
            else
                dp[i][j] = 1 + min(dp[i - 1][j - 1],
                               min(dp[i - 1][j], dp[i][j - 1]));
        }
    }

    return dp[n][m];
}`,
      c: `int editDistance(char* a, char* b, int n, int m) {
    int dp[n + 1][m + 1];

    for (int i = 0; i <= n; i++) dp[i][0] = i;
    for (int j = 0; j <= m; j++) dp[0][j] = j;

    for (int i = 1; i <= n; i++) {
        for (int j = 1; j <= m; j++) {
            if (a[i - 1] == b[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                int best = dp[i - 1][j - 1];
                if (dp[i - 1][j] < best) best = dp[i - 1][j];
                if (dp[i][j - 1] < best) best = dp[i][j - 1];
                dp[i][j] = 1 + best;
            }
        }
    }

    return dp[n][m];
}`,
      java: `int editDistance(String a, String b) {
    int n = a.length(), m = b.length();
    int[][] dp = new int[n + 1][m + 1];

    for (int i = 0; i <= n; i++) dp[i][0] = i;
    for (int j = 0; j <= m; j++) dp[0][j] = j;

    for (int i = 1; i <= n; i++) {
        for (int j = 1; j <= m; j++) {
            if (a.charAt(i - 1) == b.charAt(j - 1))
                dp[i][j] = dp[i - 1][j - 1];
            else
                dp[i][j] = 1 + Math.min(dp[i - 1][j - 1],
                               Math.min(dp[i - 1][j], dp[i][j - 1]));
        }
    }

    return dp[n][m];
}`,
      js: `function editDistance(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = [];

  for (let i = 0; i <= n; i++) {
    dp.push(new Array(m + 1).fill(0));
    dp[i][0] = i;
  }
  for (let j = 0; j <= m; j++) dp[0][j] = j;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1];
      else dp[i][j] = 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }

  return dp[n][m];
}`,
    },
  },
  mutations: [
    {
      id: 'no-substitute',
      edits: [
        { line: 13, from: 'min(dp[i - 1][j - 1],', to: 'min(dp[i - 1][j],', langs: ['cpp'] },
        { line: 14, from: 'min(dp[i - 1][j], dp[i][j - 1]));', to: 'dp[i][j - 1]);', langs: ['cpp'] },
        { line: 13, from: 'min3(dp[i - 1][j - 1],', to: 'min3(dp[i - 1][j],', langs: ['c'] },
        { line: 14, from: 'dp[i - 1][j], dp[i][j - 1]);', to: 'dp[i][j - 1], dp[i][j - 1]);', langs: ['c'] },
        { line: 13, from: 'Math.min(dp[i - 1][j - 1],', to: 'Math.min(dp[i - 1][j],', langs: ['java'] },
        { line: 14, from: 'Math.min(dp[i - 1][j], dp[i][j - 1]));', to: 'dp[i][j - 1]);', langs: ['java'] },
      ],
      label: 'drop the diagonal',
      note: 'Removes substitution from the choices, leaving only insert and delete.',
    },
    {
      id: 'zero-top-row',
      edits: [{ line: 6, from: 'dp[0][j] = j;', to: 'dp[0][j] = 0;' }],
      label: 'top row all zeroes',
      note: 'Claims that turning nothing into a prefix of the second word is free.',
    },
  ],
  variants: [
    {
      id: 'no-substitute',
      label: 'No substitution',
      blurb: 'Answers are too high, and only for words that need a substitution.',
      explanation:
        'Without the diagonal term, changing a letter has to be paid for as a delete plus an insert — two edits where one would do. The answer is never too small, only too large, and only on inputs where substituting actually wins. That is what makes it survive a casual test: words that differ only by insertions still come out exactly right. Watch which cells light up as sources — there are two instead of three.',
      mutations: ['no-substitute'],
    },
    {
      id: 'zero-top-row',
      label: 'Top row seeded with zero',
      blurb: 'Reports a cost lower than any real sequence of edits.',
      explanation:
        'dp[0][j] means "turn the empty string into the first j letters of the second word", which costs j insertions, not nothing. Seeding it with zero tells the rest of the table that an arbitrary prefix of the target can be conjured for free, and every cell built on top of it inherits the discount. The base case is not setup before the algorithm — it is part of the algorithm.',
      mutations: ['zero-top-row'],
    },
  ],
  edgeCases: [
    { id: 'classic', label: 'kitten → sitting', input: { word1: 'kitten', word2: 'sitting' }, why: 'The textbook case: two substitutions and one insertion.' },
    { id: 'identical', label: 'Identical words', input: { word1: 'algorithm', word2: 'algorithm' }, why: 'Every letter matches, so the answer runs straight down the diagonal and stays zero.' },
    { id: 'empty-from', label: 'From nothing', input: { word1: '', word2: 'hello' }, why: 'Only the base row exists. The answer is the length of the target — and this is the case the zeroed top row gets wrong.' },
    { id: 'empty-to', label: 'Into nothing', input: { word1: 'hello', word2: '' }, why: 'Only the base column. Every letter has to be deleted.' },
    { id: 'insert-only', label: 'Insertions only', input: { word1: 'ace', word2: 'abcde' }, why: 'No substitution is ever the cheapest choice, so dropping the diagonal is invisible here.' },
    { id: 'reversed', label: 'Reversed', input: { word1: 'abcd', word2: 'dcba' }, why: 'Almost nothing lines up, so nearly every cell takes the expensive branch.' },
    { id: 'both-empty', label: 'Both empty', input: { word1: '', word2: '' }, why: 'A one-by-one table. The answer is the single base cell.' },
  ],
  checkpoints: [
    conceptual({
      where: { line: 11, nth: 1 },
      question: 'The letters match, so the cost is copied from the diagonal with no + 1. What does that represent?',
      options: [
        'Aligning two identical letters, which needs no edit',
        'Deleting a letter for free',
        'A shortcut that only works on identical words',
        'The base case of the recursion',
      ],
      answer: 'Aligning two identical letters, which needs no edit',
      because:
        'The diagonal is the substitution move, and substituting a letter for itself costs nothing — so the cost of the shorter prefixes carries straight across. Every one of the three moves has a meaning like this, and the recurrence stops looking like three arbitrary terms once each one is named.',
    }),
    conceptual({
      where: { line: 6, nth: 2 },
      question: 'The top row is filled with j rather than 0. What is it saying?',
      options: [
        'Turning nothing into a prefix of j letters costs j insertions',
        'That the second word has j letters',
        'That nothing has been computed yet',
        'It is a sentinel value and is never read',
      ],
      answer: 'Turning nothing into a prefix of j letters costs j insertions',
      because:
        'The base row is not setup that happens before the algorithm — it is part of the algorithm, and it is read by every cell in the row beneath it. Fill it with zeroes and you have told the table that an arbitrary prefix of the target can be conjured for free, and every answer built on top inherits the discount.',
    }),
    {
      locate: (trace) => trace.steps.findIndex((s) => s.line === 13),
      question: (trace, at) => {
        const v = trace.steps[at].vars;
        return `Three earlier answers are on offer: substitute (${v.diag}), delete (${v.up}), insert (${v.left}). What does this cell become?`;
      },
      options: (trace, at) => {
        const v = trace.steps[at].vars;
        const diag = Number(v.diag);
        const up = Number(v.up);
        const left = Number(v.left);
        return [...new Set([1 + Math.min(diag, up, left), Math.min(diag, up, left), 1 + diag, 1 + Math.max(diag, up, left)])].map(String);
      },
      answer: (trace, at) => {
        const v = trace.steps[at].vars;
        return String(1 + Math.min(Number(v.diag), Number(v.up), Number(v.left)));
      },
      because: () =>
        'The letters differ, so one edit has to happen here no matter which route you take — that is the + 1, and it is not optional. What is optional is which already-solved subproblem to build on, and there the cheapest wins. Take the minimum first and forget the + 1 and the table fills with numbers that are each one edit too optimistic.',
    },
  ],
};
