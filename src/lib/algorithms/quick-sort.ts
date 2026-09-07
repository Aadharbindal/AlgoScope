import { cell, ev, vr } from '../trace/tracer';
import { Tracer } from '../trace/tracer';
import { computed, conceptual, num } from './checkpoints';
import { permutationFlag, sortedFlag } from './claims';
import { AlgorithmDef, RunFn } from './types';

const CPP = `int partition(vector<int>& arr, int lo, int hi) {
    int pivot = arr[hi];
    int i = lo - 1;

    for (int j = lo; j < hi; j++) {
        if (arr[j] <= pivot) {
            i++;
            swap(arr[i], arr[j]);
        }
    }

    swap(arr[i + 1], arr[hi]);
    return i + 1;
}

void quickSort(vector<int>& arr, int lo, int hi) {
    if (lo >= hi)
        return;

    int p = partition(arr, lo, hi);

    quickSort(arr, lo, p - 1);
    quickSort(arr, p + 1, hi);
}`;

const C = `int partition(int arr[], int lo, int hi) {
    int pivot = arr[hi];
    int i = lo - 1;

    for (int j = lo; j < hi; j++) {
        if (arr[j] <= pivot) {
            i++;
            { int t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
        }
    }

    { int t = arr[i + 1]; arr[i + 1] = arr[hi]; arr[hi] = t; }
    return i + 1;
}

void quickSort(int arr[], int lo, int hi) {
    if (lo >= hi)
        return;

    int p = partition(arr, lo, hi);

    quickSort(arr, lo, p - 1);
    quickSort(arr, p + 1, hi);
}`;

const JAVA = `int partition(int[] arr, int lo, int hi) {
    int pivot = arr[hi];
    int i = lo - 1;

    for (int j = lo; j < hi; j++) {
        if (arr[j] <= pivot) {
            i++;
            { int t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
        }
    }

    { int t = arr[i + 1]; arr[i + 1] = arr[hi]; arr[hi] = t; }
    return i + 1;
}

void quickSort(int[] arr, int lo, int hi) {
    if (lo >= hi)
        return;

    int p = partition(arr, lo, hi);

    quickSort(arr, lo, p - 1);
    quickSort(arr, p + 1, hi);
}`;

/**
 * The partition invariant, made checkable: everything in arr[lo..i] is at most
 * the pivot, and everything in arr[i+1..j-1] is greater than it.
 */
function derive(t: Tracer, arr: number[], lo: number, i: number, j: number, pivot: number) {
  if (!t.tracing) return;
  let ok = true;
  for (let k = lo; k <= i; k++) if (arr[k] > pivot) ok = false;
  for (let k = i + 1; k < j; k++) if (arr[k] <= pivot) ok = false;
  t.derive({ partOk: ok, inPartition: 1 });
}

interface Opts {
  /** Where the "≤ pivot" boundary starts, relative to lo. */
  iStart: (lo: number) => number;
  /** The buggy version never moves the pivot into its final slot. */
  placePivot: boolean;
}

function makeRun(opts: Opts): RunFn {
  return (input, t) => {
    const arr = (input.array ?? []).slice();
    // Kept so the result can be checked for having the same values it began
    // with — a sort that drops one is sorted and wrong.
    const original = arr.slice();
    t.array('arr', arr, 'arr');

    const partition = (lo: number, hi: number): number => {
      t.enter('partition', `partition(${lo}, ${hi})`, { lo, hi });

      const pivot = arr[hi];
      let i = opts.iStart(lo);
      let j: number | null = null;
      derive(t, arr, lo, i, lo, pivot);
      t.step(1, { lo, hi, i, j, pivot, p: null, pivotAt: hi }, () => `Partition arr[${lo}..${hi}] around a pivot.`, ev.call('partition', `partition(${lo}, ${hi})`));
      t.step(2, { lo, hi, i, j, pivot, p: null, pivotAt: hi }, () => `Take the last element, ${pivot}, as the pivot. Everything smaller must end up left of it.`);
      t.step(3, { lo, hi, i, j, pivot, p: null, pivotAt: hi }, () => `i marks the end of the "≤ pivot" zone. It starts at ${i}, before the range, because that zone is empty.`);

      for (j = lo; j < hi; j++) {
        t.tick();
        const fits = arr[j] <= pivot;
        derive(t, arr, lo, i, j, pivot);
        t.step(
          6,
          { lo, hi, i, j, pivot, p: null, pivotAt: hi },
          () => `arr[${j}] = ${arr[j as number]} against pivot ${pivot}. ${fits ? 'It belongs in the left zone.' : 'It is bigger — leave it where it is.'}`,
          ev.cmp(cell('arr', j), '<=', vr('pivot'), fits),
        );

        if (fits) {
          i++;
          t.step(7, { lo, hi, i, j, pivot, p: null, pivotAt: hi }, () => `Grow the "≤ pivot" zone by one: i becomes ${i}.`);

          const a = arr[i];
          const b = arr[j];
          arr[i] = b;
          arr[j] = a;
          derive(t, arr, lo, i, j + 1, pivot);
          t.step(8, { lo, hi, i, j, pivot, p: null, pivotAt: hi }, () => (i === j ? `arr[${i}] is already in the right zone — the swap is a no-op.` : `Swap ${a} and ${b} so the small value moves into the left zone.`), ev.swap('arr', i, j as number));
        }
      }

      const p = i + 1;
      if (opts.placePivot) {
        const a = arr[i + 1];
        const b = arr[hi];
        arr[i + 1] = b;
        arr[hi] = a;
        t.derive({ partOk: null, inPartition: 0 });
        t.step(12, { lo, hi, i, j, pivot, p, pivotAt: i + 1 }, () => `Drop the pivot into index ${i + 1}, between the two zones. That index is now final — nothing will ever move it again.`, ev.swap('arr', i + 1, hi));
      } else {
        t.derive({ partOk: null, inPartition: 0 });
        t.step(13, { lo, hi, i, j, pivot, p, pivotAt: hi }, () => `Returning ${p} as the split point.`);
      }

      t.step(13, { lo, hi, i, j, pivot, p, pivotAt: null }, () => `Split point is ${p}.`, ev.ret('partition', p));
      t.exit();
      return p;
    };

    const quickSort = (lo: number, hi: number) => {
      t.enter('quickSort', `quickSort(${lo}, ${hi})`, { lo, hi });
      t.step(16, { lo, hi, i: null, j: null, pivot: null, p: null, pivotAt: null }, () => `Sort arr[${lo}..${hi}] — ${Math.max(0, hi - lo + 1)} element${hi - lo === 0 ? '' : 's'}.`, ev.call('quickSort', `quickSort(${lo}, ${hi})`));

      const base = lo >= hi;
      t.step(17, { lo, hi, i: null, j: null, pivot: null, p: null, pivotAt: null }, () => (base ? 'Nothing to sort — a range of one element or less is already in order.' : 'More than one element, so this range needs partitioning.'));
      if (base) {
        t.step(18, { lo, hi, i: null, j: null, pivot: null, p: null, pivotAt: null }, 'Return to the caller.', ev.ret('quickSort', null));
        t.exit();
        return;
      }

      const p = partition(lo, hi);
      t.step(20, { lo, hi, i: null, j: null, pivot: null, p, pivotAt: p }, () => `arr[${p}] holds the pivot and is now in its final place. Everything left of it is smaller, everything right is larger.`);

      t.step(22, { lo, hi, i: null, j: null, pivot: null, p, pivotAt: p }, () => `Sort the left side, arr[${lo}..${p - 1}].`);
      quickSort(lo, p - 1);

      t.step(23, { lo, hi, i: null, j: null, pivot: null, p, pivotAt: p }, () => `Sort the right side, arr[${p + 1}..${hi}].`);
      quickSort(p + 1, hi);

      t.exit();
    };

    if (arr.length > 0) quickSort(0, arr.length - 1);

    // A closing step, so the promise the function makes has somewhere to be
    // judged. Everything above is about one range at a time; this is the only
    // moment at which "the array is sorted" is a statement about the array.
    t.derive({ isSorted: sortedFlag(arr), kept: permutationFlag(arr, original) });
    t.step(24, { lo: 0, hi: arr.length - 1, mid: null, i: null, j: null, k: null }, () => `Sorted: [${arr.join(', ')}]`);
    return arr.join(',');
  };
}

const run: RunFn = (input, t, mut) =>
  makeRun({
    iStart: mut.has('i-start-lo') ? (lo: number) => lo : (lo: number) => lo - 1,
    placePivot: !mut.has('no-place'),
  })(input, t, mut);

export const quickSort: AlgorithmDef = {
  slug: 'quick-sort',
  name: 'Quick Sort',
  category: 'sorting',
  tagline: 'Put one element where it belongs, then sort the two sides it created.',
  intuition: [
    'Pick one value — the pivot — and rearrange the range so that everything smaller sits to its left and everything larger to its right. You have not sorted anything yet, but you have put exactly one element in its permanent home.',
    'Now the two sides are independent problems, and neither will ever need to look at the other again. Recurse into both and the array falls into place.',
    'This is the opposite shape from merge sort. Merge sort does no work on the way down and all of it on the way back up; quick sort does all its work on the way down and nothing on the way back. And unlike merge sort it needs no extra array — the partition happens in place, which is why it is usually the faster of the two in practice.',
  ],
  code: { cpp: CPP, c: C, java: JAVA },
  lens: {
    primary: 'arr',
    pointers: [
      { var: 'i', on: 'arr', role: 'boundary', label: 'i', hint: 'End of the "≤ pivot" zone.' },
      { var: 'j', on: 'arr', role: 'cursor', label: 'j', hint: 'The value being examined.' },
      { var: 'pivotAt', on: 'arr', role: 'probe', label: 'pivot', hint: 'Where the pivot value currently sits.' },
    ],
    regions: [
      { on: 'arr', kind: 'considering', from: 'lo', to: 'hi', label: 'this call’s range' },
      { on: 'arr', kind: 'active', from: 'lo', to: 'i', label: '≤ pivot' },
    ],
    invariant: {
      text: 'Everything in the left zone is ≤ the pivot, and everything scanned past it is greater.',
      check: 'partOk',
      when: 'defined(inPartition) && inPartition === 1',
      why: 'Partition is the only place quick sort does real work, and this is the promise it maintains one element at a time. If it ever breaks, a value ends up on the wrong side of the pivot — and since the two sides are then sorted independently and never compared again, that value can never get back to where it belongs.',
    },
    postcondition: {
      text: 'The whole array is in order, and holds exactly the values it started with.',
      check: 'isSorted === 1 && kept === 1',
      why: 'The loop invariant above is about progress: it says the part already settled is settled correctly. It is silent on whether the loop ran long enough, and a sort that stops one pass early satisfies it completely while returning an array that is not sorted. This is the claim the caller actually cares about, and it can only be judged once the function has finished.',
    },
    cost: {
      text: 'Each partition compares every element of its own range once, so the comparisons never exceed n(n-1)/2 in total.',
      check: 'ops_comparisons <= n * (n - 1) / 2',
      why: 'The bound is the worst case, and it is worth stating precisely because quick sort is the algorithm whose reputation rests on the case that is not the worst one. A partition that walked past the end of its range, or revisited an element it had already placed, still sorts — and quietly costs more than the algorithm is allowed to.',
    },
  },
  run,
  defaultInput: { array: [7, 2, 9, 4, 1, 6, 3] },
  fields: [{ key: 'array', label: 'Array', kind: 'array', help: 'Try one that is already sorted — that is quick sort’s worst case.' }],
  makeInput: (n) => ({ array: Array.from({ length: n }, (_, k) => ((k * 7919) % n) + 1) }),
  growthSizes: [8, 16, 32, 64, 128, 256, 512, 1024],
  projectTo: 1_000_000,
  complexity: {
    time: 'O(n log n) average, O(n²) worst',
    space: 'O(log n) for the call stack',
    note: 'A pivot that lands near the middle halves the range and gives log n levels. A pivot that lands at one end removes a single element per level instead — which is exactly what happens on already-sorted input when the pivot is always the last element.',
  },
  userLane: {
    fnName: 'quickSort',
    compareBy: 'array',
    starters: {
      cpp: `int partition(vector<int>& arr, int lo, int hi) {
    int pivot = arr[hi];
    int i = lo - 1;

    for (int j = lo; j < hi; j++) {
        if (arr[j] <= pivot) {
            i++;
            swap(arr[i], arr[j]);
        }
    }

    swap(arr[i + 1], arr[hi]);
    return i + 1;
}

void quickSort(vector<int>& arr, int lo, int hi) {
    if (lo >= hi) return;

    int p = partition(arr, lo, hi);
    quickSort(arr, lo, p - 1);
    quickSort(arr, p + 1, hi);
}`,
      c: `int partition(int arr[], int lo, int hi) {
    int pivot = arr[hi];
    int i = lo - 1;

    for (int j = lo; j < hi; j++) {
        if (arr[j] <= pivot) {
            i++;
            int t = arr[i]; arr[i] = arr[j]; arr[j] = t;
        }
    }

    int t = arr[i + 1]; arr[i + 1] = arr[hi]; arr[hi] = t;
    return i + 1;
}

void quickSort(int arr[], int lo, int hi) {
    if (lo >= hi) return;

    int p = partition(arr, lo, hi);
    quickSort(arr, lo, p - 1);
    quickSort(arr, p + 1, hi);
}`,
      java: `int partition(int[] arr, int lo, int hi) {
    int pivot = arr[hi];
    int i = lo - 1;

    for (int j = lo; j < hi; j++) {
        if (arr[j] <= pivot) {
            i++;
            int t = arr[i]; arr[i] = arr[j]; arr[j] = t;
        }
    }

    int t = arr[i + 1]; arr[i + 1] = arr[hi]; arr[hi] = t;
    return i + 1;
}

void quickSort(int[] arr, int lo, int hi) {
    if (lo >= hi) return;

    int p = partition(arr, lo, hi);
    quickSort(arr, lo, p - 1);
    quickSort(arr, p + 1, hi);
}`,
    },
  },
  mutations: [
    {
      id: 'no-place',
      edits: [
        {
          line: 12,
          from: 'swap(arr[i + 1], arr[hi]);',
          to: '// swap(arr[i + 1], arr[hi]);',
          langs: ['cpp'],
        },
        {
          line: 12,
          from: '{ int t = arr[i + 1]; arr[i + 1] = arr[hi]; arr[hi] = t; }',
          to: '// { int t = arr[i + 1]; arr[i + 1] = arr[hi]; arr[hi] = t; }',
          langs: ['c', 'java'],
        },
      ],
      label: 'never place the pivot',
      note: 'The pivot stays where it started, so the index partition reports is not final at all.',
    },
    {
      id: 'i-start-lo',
      edits: [{ line: 3, from: 'int i = lo - 1;', to: 'int i = lo;' }],
      label: 'i starts at lo',
      note: 'Claims one element is already in the "≤ pivot" zone before anything has been compared.',
    },
  ],
  variants: [
    {
      id: 'no-place',
      label: 'pivot is never swapped in',
      blurb: 'Leaves the array visibly unsorted.',
      explanation:
        'The scan sorts values into two zones but leaves the pivot sitting at the far right where it started. partition still reports i + 1 as the split point, so the recursion trusts that arr[i + 1] holds the pivot and is final — when in fact it holds whatever the scan left there. One missing swap invalidates the one guarantee partition exists to provide.',
      mutations: ['no-place'],
    },
    {
      id: 'i-start-lo',
      label: 'int i = lo',
      blurb: 'Sorts most of the range but leaves values stranded.',
      explanation:
        'i marks the last index of the "≤ pivot" zone, and that zone starts out empty — so i has to begin *before* the range, at lo - 1. Starting at lo claims one element is already in the zone before anything has been compared, and every subsequent i++ and swap is shifted one slot too far right.',
      mutations: ['i-start-lo'],
    },
  ],
  edgeCases: [
    { id: 'sorted', label: 'Already sorted', input: { array: [1, 2, 3, 4, 5, 6] }, why: 'The worst case for this pivot choice. Every partition splits off a single element, so the recursion goes n levels deep instead of log n. Watch the call stack.' },
    { id: 'reversed', label: 'Reverse sorted', input: { array: [6, 5, 4, 3, 2, 1] }, why: 'Also degenerate — the pivot is always the smallest value, so the left zone stays empty.' },
    { id: 'dupes', label: 'All equal', input: { array: [4, 4, 4, 4, 4] }, why: 'Every value satisfies ≤ pivot, so the split lands at the far end every time. This is why real implementations use a three-way partition.' },
    { id: 'two', label: 'Two elements', input: { array: [2, 1] }, why: 'One partition, one swap, then two base cases.' },
    { id: 'single', label: 'One element', input: { array: [5] }, why: 'lo >= hi is true immediately.' },
    { id: 'empty', label: 'Empty', input: { array: [] }, why: 'The top-level call never happens.' },
  ],
  checkpoints: [
    conceptual({
      where: { line: 12 },
      question: 'After the loop, the pivot is swapped into position i + 1. What is true of it from then on?',
      options: [
        'It is in its final sorted position and never moves again',
        'It is roughly in the right place',
        'It is the median of the range',
        'It will move once more, during the merge',
      ],
      answer: 'It is in its final sorted position and never moves again',
      because:
        'Everything to its left is smaller and everything to its right is larger, which is the definition of being in the right place. That is the difference between quick sort and merge sort: quick sort settles one element permanently per partition and then never touches it, so there is nothing to merge afterwards.',
    }),
    conceptual({
      where: { line: 6, nth: 2 },
      question: 'This comparison uses <=. What would happen on an array of all-equal values if it were < instead?',
      options: [
        'Every partition would be maximally unbalanced, giving O(n²)',
        'Nothing — equal values sort the same either way',
        'It would fail to terminate',
        'It would be faster',
      ],
      answer: 'Every partition would be maximally unbalanced, giving O(n²)',
      because:
        'With <, nothing equal to the pivot moves left, so the pivot lands at one end and one side of the recursion gets everything. An array of identical values is the worst possible input for a version that looks like it differs by one character. Quick sort has several such cliffs, and this is the easiest one to fall off.',
    }),
    computed({
      where: { line: 20, nth: 1 },
      question: (step) => `The partition returned p = ${step.vars.p}. How many elements are handed to each side?`,
      answer: (step) => `${num(step, 'p') - num(step, 'lo')} left, ${num(step, 'hi') - num(step, 'p')} right`,
      options: (a, step) => [
        a,
        `${num(step, 'hi') - num(step, 'lo') + 1} left, 0 right`,
        'Half each, always',
        `${num(step, 'p')} left, ${num(step, 'p')} right`,
      ],
      because:
        'The pivot itself goes to neither side — that is the one element removed from the problem each time, and it is why the recursion terminates. How evenly the rest divides is entirely up to which value the pivot happened to be, which is the whole reason quick sort has an average case and a worst case rather than a single cost.',
    }),
    {
      locate: (trace) => trace.steps.findIndex((s) => s.line === 12),
      question: (trace, at) => {
        const v = trace.steps[at].vars;
        return `The scan has finished and i is ${v.i}. Which index will hold the pivot — and be final — after this swap?`;
      },
      options: (trace, at) => {
        const v = trace.steps[at].vars;
        const i = Number(v.i);
        const hi = Number(v.hi);
        return [...new Set([i + 1, i, hi, Number(v.lo)])]
          .filter((x) => Number.isFinite(x) && x >= 0)
          .sort((a, b) => a - b)
          .map((x) => `index ${x}`);
      },
      answer: (trace, at) => `index ${Number(trace.steps[at].vars.i) + 1}`,
      because: () =>
        'Indices lo through i now hold everything ≤ pivot, so the first slot after that zone is exactly where the pivot belongs. Every value to its left is smaller and every value to its right is larger — which is the definition of being in its final position.',
    },
  ],
};
