import { ev, vr } from '../trace/tracer';
import { Scalar } from '../trace/types';
import { computed, conceptual } from './checkpoints';
import { AlgorithmDef, RunFn } from './types';

/**
 * Backtracking, on the problem where the shape is clearest.
 *
 * Every backtracking algorithm is the same three lines around a recursive
 * call: choose, explore, un-choose. What varies is only what "choose" means
 * and when a branch is abandoned. Subsets has no abandoning at all — every
 * branch runs to the end — which strips the technique down to the part people
 * actually get wrong: putting the choice back.
 *
 * The un-choose line is not tidying up. The list is shared by every branch, so
 * a choice left in it is a choice the *sibling* branch inherits, and the bug
 * that produces is one of the least obvious in the subject.
 */

const CPP = `void build(vector<int>& arr, int i, vector<int>& cur,
           vector<vector<int>>& out) {
    if (i == arr.size()) {
        out.push_back(cur);
        return;
    }

    build(arr, i + 1, cur, out);

    cur.push_back(arr[i]);
    build(arr, i + 1, cur, out);
    cur.pop_back();
}`;

const C = `void build(int arr[], int n, int i, int cur[], int k,
           int out[][8], int* count) {
    if (i == n) {
        for (int j = 0; j < k; j++) out[*count][j] = cur[j];
        (*count)++;
        return;
    }

    build(arr, n, i + 1, cur, k, out, count);

    cur[k] = arr[i];
    build(arr, n, i + 1, cur, k + 1, out, count);
}`;

const JAVA = `void build(int[] arr, int i, List<Integer> cur,
           List<List<Integer>> out) {
    if (i == arr.length) {
        out.add(new ArrayList<>(cur));
        return;
    }

    build(arr, i + 1, cur, out);

    cur.add(arr[i]);
    build(arr, i + 1, cur, out);
    cur.remove(cur.size() - 1);
}`;

interface Opts {
  /** The buggy version never puts the choice back. */
  unchoose: boolean;
  /** The buggy version stores the shared list rather than a copy of it. */
  copyOut: boolean;
}

function makeRun(opts: Opts): RunFn {
  return (input, t) => {
    const arr = (input.array ?? []).slice();
    const n = arr.length;

    const cur: Scalar[] = [];
    const out: string[] = [];
    /** Every result as it was at the moment it was recorded. */
    const recorded: number[][] = [];
    /** Calls made, against the size of a full binary decision tree. */
    let calls = 0;

    t.array('arr', arr, 'arr');
    t.seq('cur', cur, 'stack', 'cur — the subset being built');
    t.seq('out', out as unknown as Scalar[], 'flow', 'subsets found');
    t.aux('cur', () => cur.length);
    t.oracle({ expected: 2 ** n });

    /**
     * Whether every element in the working subset was taken from an index the
     * recursion has already passed.
     *
     * The choices are made in order and never revisited, so at depth i the
     * subset can only hold elements of arr[0..i-1]. A choice left behind by a
     * finished branch violates this immediately — which is why it is checked
     * here rather than inferred from the list of results.
     */
    const mark = (i: number) => {
      if (!t.tracing) return;
      const allowed = arr.slice(0, i);
      const pool = [...allowed];
      let inOrder = 1;
      for (const v of cur) {
        const at = pool.indexOf(v as number);
        if (at === -1) inOrder = 0;
        else pool.splice(at, 1);
      }
      t.derive({ inOrder, held: cur.length, found: out.length });
    };

    const build = (i: number) => {
      calls++;
      t.enter('build', `build(${i})`, { i });
      mark(i);
      t.step(1, { i, held: cur.length, found: out.length }, `Decide about index ${i}${i < n ? ` — the value ${arr[i]}` : ''}.`, ev.call('build', `build(${i})`));

      const done = i === n;
      t.step(3, { i, held: cur.length, found: out.length }, done ? 'Every element has been decided, so this branch has produced a subset.' : `${n - i} element${n - i === 1 ? '' : 's'} still to decide.`, ev.cmp(vr('i'), '==', vr('n'), done));

      if (done) {
        // Storing the shared list rather than a copy of it is the other classic
        // bug: every result ends up being the same object.
        const snapshot = opts.copyOut ? cur.slice() : cur;
        recorded.push(snapshot as number[]);
        // `out` is only the running display. The answer is read off `recorded`
        // at the end, which is the only place storing a reference instead of a
        // copy can be seen — by then the shared list has changed underneath it.
        out.push(`{${cur.join(',')}}`);
        mark(i);
        t.step(4, { i, held: cur.length, found: out.length }, `Record {${cur.join(', ')}}.`, ev.push('out', `{${cur.join(',')}}`));
        t.exit();
        return;
      }

      t.step(8, { i, held: cur.length, found: out.length }, `First, the branch that leaves ${arr[i]} out.`);
      build(i + 1);

      cur.push(arr[i]);
      mark(i + 1);
      t.step(10, { i, held: cur.length, found: out.length }, `Now take ${arr[i]}.`, ev.push('cur', arr[i]));

      t.step(11, { i, held: cur.length, found: out.length }, `Explore everything after it with ${arr[i]} included.`);
      build(i + 1);

      if (opts.unchoose) {
        cur.pop();
        mark(i);
        t.step(12, { i, held: cur.length, found: out.length }, `Put ${arr[i]} back. The list is shared, so leaving it in would hand it to whatever runs next.`, ev.pop('cur', arr[i]));
      } else {
        mark(i);
        t.step(12, { i, held: cur.length, found: out.length }, `Leave ${arr[i]} in the list and return.`);
      }

      t.exit();
    };

    t.enter('subsets', `subsets(arr)`);
    build(0);

    // The real power set, built by index rather than by value: with a repeated
    // input value {2} genuinely appears twice, once for each 2, and a check
    // that demanded distinctness would call the correct answer wrong.
    const expected: string[] = [];
    for (let mask = 0; mask < 2 ** n; mask++) {
      const picked: number[] = [];
      for (let bit = n - 1; bit >= 0; bit--) if (mask & (1 << bit)) picked.push(arr[n - 1 - bit]);
      expected.push(`{${picked.join(',')}}`);
    }
    const asText = recorded.map((r) => `{${r.join(',')}}`);
    const sameMultiset =
      asText.length === expected.length &&
      [...asText].sort().join('|') === [...expected].sort().join('|');
    t.derive({
      inOrder: 1,
      held: 0,
      found: asText.length,
      complete: sameMultiset ? 1 : 0,
      calls,
      allowed: 2 ** (n + 1) - 1,
    });
    t.step(4, { i: n, held: 0, found: out.length }, `${asText.length} subset${asText.length === 1 ? '' : 's'}: ${asText.join(' ')}`);
    t.exit();
    return asText.join(' ');
  };
}

const run: RunFn = (input, t, mut) =>
  makeRun({ unchoose: !mut.has('no-unchoose'), copyOut: !mut.has('share-list') })(input, t, mut);

export const subsets: AlgorithmDef = {
  slug: 'subsets',
  name: 'All Subsets (Backtracking)',
  category: 'dp',
  tagline: 'For each element: the branch without it, then the branch with it.',
  intuition: [
    'Every subset is a series of yes-or-no answers, one per element. So walk the elements in order and, at each one, do both: explore everything that follows without it, then explore everything that follows with it.',
    'That is the whole of backtracking — choose, explore, un-choose — and this problem strips it to the bone because no branch is ever abandoned. Nothing is pruned; every path runs to the end. What is left is the part people get wrong.',
    'The un-choose line is not tidying up after yourself. The working list is shared by every branch, so an element left in it after a branch finishes is an element the *next* branch starts with. The results stay plausible — they are still subsets, still in order — and half of them are wrong.',
    'The number of calls is fixed by the shape and not by the data: a full binary tree of decisions, 2ⁿ leaves, one per subset. That is why this is exponential and cannot be made otherwise: there are that many answers to produce.',
  ],
  code: { cpp: CPP, c: C, java: JAVA },
  lens: {
    primary: 'arr',
    pointers: [{ var: 'i', on: 'arr', role: 'cursor', label: 'i', hint: 'The element being decided about.' }],
    regions: [
      { on: 'arr', kind: 'eliminated', from: 0, to: 'i - 1', label: 'already decided' },
      { on: 'arr', kind: 'active', from: 'i', to: 'n - 1', label: 'still to decide' },
    ],
    invariant: {
      text: 'The working subset only holds elements the recursion has already passed.',
      check: 'inOrder === 1',
      when: 'defined(inOrder)',
      why: 'Choices are made in order and never revisited, so at depth i the list can only contain elements of arr[0..i−1]. A branch that finishes without putting its choice back breaks this at the moment control returns — long before the results look wrong, and while every subset produced is still a perfectly plausible subset.',
    },
    postcondition: {
      text: 'The results are exactly the 2ⁿ subsets of the input, counted with repeats where the input repeats.',
      check: 'complete === 1',
      why: 'Compared against the power set built by index rather than by value, which matters: an input with a repeated value genuinely produces the same subset twice, and a check that demanded distinctness would call the correct answer wrong. Both bugs on this page keep the count at 2ⁿ — a missing un-choose reshuffles which subsets appear, and storing the shared list makes every result the same one — so counting alone would notice neither.',
    },
    cost: {
      text: 'The recursion is a full binary decision tree: one call per node, and no branch is ever visited twice.',
      check: 'calls <= allowed',
      why: 'This algorithm is exponential and cannot be otherwise — it has 2ⁿ answers to produce, so it must do at least that much work. The claim worth making is therefore not that it is fast but that it wastes nothing: exactly one call per decision node, 2ⁿ⁺¹ − 1 in total, with no path explored twice. That is the difference between an exponential algorithm and a badly written one, and the result cannot tell them apart.',
    },
  },
  run,
  defaultInput: { array: [1, 2, 3] },
  fields: [
    {
      key: 'array',
      label: 'Elements',
      kind: 'array',
      help: 'Keep it short — the number of subsets doubles with every element added.',
    },
  ],
  makeInput: (n) => ({ array: Array.from({ length: Math.min(n, 14) }, (_, i) => i + 1) }),
  growthSizes: [4, 6, 8, 10, 12, 14],
  projectTo: 20,
  complexity: {
    time: 'O(2ⁿ) — one leaf per subset, and there are 2ⁿ subsets',
    space: 'O(n) for the working list and the recursion, plus the results themselves',
    note: 'The only algorithm on this site whose cost is a property of the question rather than of the answer: there are 2ⁿ subsets, so producing all of them cannot take less than 2ⁿ steps however cleverly it is written. Note what the projection does to a modest input — this is the shape that makes "just try everything" stop being an option, and it is worth seeing measured rather than asserted.',
  },
  mutations: [
    {
      id: 'no-unchoose',
      edits: [
        { line: 12, from: '    cur.pop_back();', to: '', langs: ['cpp'] },
        { line: 12, from: '    cur.remove(cur.size() - 1);', to: '', langs: ['java'] },
        { line: 12, from: '', to: '    /* nothing to undo */', langs: ['c'] },
      ],
      label: 'never put the choice back',
      note: 'Leaves the element in the shared list when the branch returns.',
    },
    {
      id: 'share-list',
      edits: [
        { line: 4, from: '        out.push_back(cur);', to: '        out.push_back(cur);  // shared', langs: ['cpp'] },
        { line: 4, from: '        out.add(new ArrayList<>(cur));', to: '        out.add(cur);', langs: ['java'] },
        { line: 4, from: '        for (int j = 0; j < k; j++) out[*count][j] = cur[j];', to: '        out[*count] = cur;', langs: ['c'] },
      ],
      label: 'store the list, not a copy',
      note: 'Every recorded subset is the same object, and it keeps changing.',
    },
  ],
  variants: [
    {
      id: 'no-unchoose',
      label: 'The choice is never put back',
      blurb: 'The right number of subsets, and the wrong subsets.',
      explanation:
        'Because the list is shared, an element left in it when a branch returns is inherited by the branch that runs next. The count is untouched — the recursion still reaches 2ⁿ leaves — and the contents drift: subsets appear twice, others never appear at all, and every one of them still looks like a plausible subset of the input. The invariant catches it at the moment control returns.',
      mutations: ['no-unchoose'],
    },
    {
      id: 'share-list',
      label: 'The shared list is stored instead of a copy',
      blurb: 'Every result is the same subset.',
      explanation:
        'Recording the working list rather than a snapshot of it stores a reference that keeps changing. All 2ⁿ results end up being the same object, so whatever it holds at the end is what every one of them says — usually the empty subset, since the last thing the recursion does is unwind. It is the bug that looks like a language detail and is really about when a value is a value.',
      mutations: ['share-list'],
    },
  ],
  edgeCases: [
    { id: 'three', label: 'Three elements', input: { array: [1, 2, 3] }, why: 'Eight subsets, small enough to read the whole recursion tree.' },
    { id: 'two', label: 'Two elements', input: { array: [1, 2] }, why: 'Four subsets. The smallest input where the un-choose actually matters.' },
    { id: 'one', label: 'One element', input: { array: [7] }, why: 'Two subsets: with and without. The base case fires twice.' },
    { id: 'empty', label: 'Nothing at all', input: { array: [] }, why: 'One subset — the empty one. The recursion is a single call that immediately records.' },
    { id: 'dupes', label: 'Repeated values', input: { array: [2, 2] }, why: 'Nothing here deduplicates, so {2} appears twice — from taking the first and from taking the second. That is the correct answer to "all subsets" and the wrong answer to "all distinct subsets", which is a different problem.' },
    { id: 'four', label: 'Four elements', input: { array: [1, 2, 3, 4] }, why: 'Sixteen subsets. Watch how quickly the output outgrows the input.' },
  ],
  checkpoints: [
    conceptual({
      where: { line: 12, nth: 0 },
      question: 'Why does the element have to be removed before this call returns?',
      options: [
        'Because the list is shared, so anything left in it is inherited by the next branch',
        'To free memory',
        'Because the element has already been recorded',
        'It does not — the removal is optional tidying',
      ],
      answer: 'Because the list is shared, so anything left in it is inherited by the next branch',
      because:
        'There is one list, not one per branch. Returning without undoing the choice hands it to whatever runs next, which quietly explores the wrong part of the space. This is the single line that makes backtracking backtracking, and it is the one people leave out.',
    }),
    conceptual({
      where: { line: 8, nth: 0 },
      question: 'The branch that leaves this element out runs first. What difference does that ordering make?',
      options: [
        'Only the order the subsets come out in — every one is still produced',
        'It halves the number of subsets',
        'It is required for the un-choose to work',
        'It avoids duplicates',
      ],
      answer: 'Only the order the subsets come out in — every one is still produced',
      because:
        'Both branches always run, so the tree explored is the same either way. This is worth knowing because it means the output order of a backtracking algorithm is a consequence of the traversal and not of the problem — if you need a particular order, that is a separate thing to arrange.',
    }),
    computed({
      where: { line: 4, nth: 2 },
      question: () => 'How many subsets have been recorded so far?',
      answer: (step) => String(step.vars.found ?? 0),
      options: (answer) => {
        const f = Number(answer);
        return [String(f), String(f + 1), String(Math.max(0, f - 1)), '1'];
      },
      because:
        'One per leaf of the decision tree, and the leaves are reached left to right. The total will be 2ⁿ, which is why the elements box asks you to keep the input short.',
    }),
  ],
};
