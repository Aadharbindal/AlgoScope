import { cell, ev, vr } from '../trace/tracer';
import { Tracer } from '../trace/tracer';
import { conceptual } from './checkpoints';
import { permutationFlag, sortedFlag } from './claims';
import { AlgorithmDef, RunFn } from './types';

const CPP = `void mergeSort(vector<int>& arr, int lo, int hi) {
    if (lo >= hi)
        return;

    int mid = lo + (hi - lo) / 2;

    mergeSort(arr, lo, mid);
    mergeSort(arr, mid + 1, hi);

    merge(arr, lo, mid, hi);
}

void merge(vector<int>& arr, int lo, int mid, int hi) {
    vector<int> tmp;
    int i = lo, j = mid + 1;

    while (i <= mid && j <= hi) {
        if (arr[i] <= arr[j])
            tmp.push_back(arr[i++]);
        else
            tmp.push_back(arr[j++]);
    }

    while (i <= mid) tmp.push_back(arr[i++]);
    while (j <= hi)  tmp.push_back(arr[j++]);

    for (int k = 0; k < tmp.size(); k++)
        arr[lo + k] = tmp[k];
}`;

const C = `void mergeSort(int arr[], int lo, int hi) {
    if (lo >= hi)
        return;

    int mid = lo + (hi - lo) / 2;

    mergeSort(arr, lo, mid);
    mergeSort(arr, mid + 1, hi);

    merge(arr, lo, mid, hi);
}

void merge(int arr[], int lo, int mid, int hi) {
    int tmp[256]; int t = 0;
    int i = lo, j = mid + 1;

    while (i <= mid && j <= hi) {
        if (arr[i] <= arr[j])
            tmp[t++] = arr[i++];
        else
            tmp[t++] = arr[j++];
    }

    while (i <= mid) tmp[t++] = arr[i++];
    while (j <= hi)  tmp[t++] = arr[j++];

    for (int k = 0; k < t; k++)
        arr[lo + k] = tmp[k];
}`;

const JAVA = `void mergeSort(int[] arr, int lo, int hi) {
    if (lo >= hi)
        return;

    int mid = lo + (hi - lo) / 2;

    mergeSort(arr, lo, mid);
    mergeSort(arr, mid + 1, hi);

    merge(arr, lo, mid, hi);
}

void merge(int[] arr, int lo, int mid, int hi) {
    int[] tmp = new int[hi - lo + 1]; int t = 0;
    int i = lo, j = mid + 1;

    while (i <= mid && j <= hi) {
        if (arr[i] <= arr[j])
            tmp[t++] = arr[i++];
        else
            tmp[t++] = arr[j++];
    }

    while (i <= mid) tmp[t++] = arr[i++];
    while (j <= hi)  tmp[t++] = arr[j++];

    for (int k = 0; k < t; k++)
        arr[lo + k] = tmp[k];
}`;

function markTmp(t: Tracer, tmp: number[]) {
  if (!t.tracing) return;
  let sorted = true;
  for (let k = 1; k < tmp.length; k++) if (tmp[k - 1] > tmp[k]) sorted = false;
  t.derive({ tmpSorted: sorted, tmpLen: tmp.length });
}

interface Opts {
  rightStart: (mid: number) => number;
  drainRight: boolean;
}

function makeRun(opts: Opts): RunFn {
  return (input, t) => {
    const arr = (input.array ?? []).slice();
    // Kept so the result can be checked for having the same values it began
    // with — a sort that drops one is sorted and wrong.
    const original = arr.slice();
    t.array('arr', arr, 'arr');

    /** Cells the merges were responsible for, and cells they wrote. */
    let covered = 0;
    let writtenBack = 0;

    const tmp: number[] = [];
    t.seq('tmp', tmp, 'flow', 'tmp — the merged output being built');
    // The scratch array a merge writes into is the entire space cost. The
    // recursion adds its own frames, which the tracer counts separately.
    t.aux('tmp', () => tmp.length);

    const merge = (lo: number, mid: number, hi: number) => {
      // How many cells the merges between them are responsible for, and how
      // many they actually wrote. A merge that returns without emptying both
      // halves leaves part of its own range untouched, and these two numbers
      // are where that shows.
      covered += hi - lo + 1;
      t.enter('merge', `merge(${lo}, ${mid}, ${hi})`, { lo, mid, hi });
      tmp.length = 0;
      markTmp(t, tmp);
      t.step(14, { lo, mid, hi, i: null, j: null, k: null }, () => `Merging the sorted halves arr[${lo}..${mid}] and arr[${mid + 1}..${hi}] into a fresh buffer.`, ev.call('merge', `merge(${lo}, ${mid}, ${hi})`));

      let i = lo;
      let j = opts.rightStart(mid);
      t.step(15, { lo, mid, hi, i, j, k: null }, () => `i reads the left half from ${i}; j reads the right half from ${j}.`);

      for (;;) {
        const cont = i <= mid && j <= hi;
        t.step(17, { lo, mid, hi, i, j, k: null }, () => (cont ? 'Both halves still have values to offer.' : 'One half is exhausted — the rest of the other half can be copied straight across.'), ev.cmp(vr('i'), '<=', vr('mid'), cont));
        if (!cont) break;
        t.tick();

        const takeLeft = arr[i] <= arr[j];
        t.step(18, { lo, mid, hi, i, j, k: null }, () => `Compare the two front values: left arr[${i}] = ${arr[i]} against right arr[${j}] = ${arr[j]}. ${takeLeft ? 'The left one is smaller or equal, so it goes first — taking the left on a tie is what keeps merge sort stable.' : 'The right one is smaller, so it goes first.'}`, ev.cmp(cell('arr', i), '<=', cell('arr', j), takeLeft));

        if (takeLeft) {
          const v = arr[i];
          tmp.push(v);
          i++;
          markTmp(t, tmp);
          t.step(19, { lo, mid, hi, i, j, k: null }, () => `Take ${v} from the left half. i advances to ${i}.`, ev.push('tmp', v));
        } else {
          const v = arr[j];
          tmp.push(v);
          j++;
          markTmp(t, tmp);
          t.step(21, { lo, mid, hi, i, j, k: null }, () => `Take ${v} from the right half. j advances to ${j}.`, ev.push('tmp', v));
        }
      }

      while (i <= mid) {
        const v = arr[i];
        tmp.push(v);
        i++;
        markTmp(t, tmp);
        t.step(24, { lo, mid, hi, i, j, k: null }, () => `The right half ran out. Copy the remaining left value ${v} across — it is already larger than everything in the buffer.`, ev.push('tmp', v));
      }

      if (opts.drainRight) {
        while (j <= hi) {
          const v = arr[j];
          tmp.push(v);
          j++;
          markTmp(t, tmp);
          t.step(25, { lo, mid, hi, i, j, k: null }, () => `The left half ran out. Copy the remaining right value ${v} across.`, ev.push('tmp', v));
        }
      }

      for (let k = 0; k < tmp.length; k++) {
        writtenBack++;
        arr[lo + k] = tmp[k];
        t.step(28, { lo, mid, hi, i, j, k }, () => `Write ${tmp[k]} back into arr[${lo + k}].`, ev.write('arr', lo + k, tmp[k]));
      }

      t.derive({ tmpSorted: null, tmpLen: null });
      t.exit();
    };

    const mergeSort = (lo: number, hi: number) => {
      t.enter('mergeSort', `mergeSort(${lo}, ${hi})`, { lo, hi });
      t.step(1, { lo, hi, mid: null, i: null, j: null, k: null }, () => `Sort arr[${lo}..${hi}] — a region of ${Math.max(0, hi - lo + 1)} element${hi - lo === 0 ? '' : 's'}.`, ev.call('mergeSort', `mergeSort(${lo}, ${hi})`));

      const base = lo >= hi;
      t.step(2, { lo, hi, mid: null, i: null, j: null, k: null }, () => (base ? `A region of ${Math.max(0, hi - lo + 1)} element${hi === lo ? '' : 's'} is already sorted by definition. Nothing to do.` : 'More than one element, so this region must be split.'));

      if (base) {
        t.step(3, { lo, hi, mid: null, i: null, j: null, k: null }, 'Return to the caller.', ev.ret('mergeSort', null));
        t.exit();
        return;
      }

      const mid = lo + Math.floor((hi - lo) / 2);
      t.step(5, { lo, hi, mid, i: null, j: null, k: null }, () => `Split at ${mid}: left is arr[${lo}..${mid}], right is arr[${mid + 1}..${hi}].`);

      t.step(7, { lo, hi, mid, i: null, j: null, k: null }, () => `Sort the left half first. Everything below this line waits until that call and all of its own calls have finished.`);
      mergeSort(lo, mid);

      t.step(8, { lo, hi, mid, i: null, j: null, k: null }, () => `Left half arr[${lo}..${mid}] is sorted. Now the right half.`);
      mergeSort(mid + 1, hi);

      t.step(10, { lo, hi, mid, i: null, j: null, k: null }, () => `Both halves are sorted. Merging them is the only real work this call does.`);
      merge(lo, mid, hi);

      t.step(11, { lo, hi, mid, i: null, j: null, k: null }, () => `arr[${lo}..${hi}] is now sorted. Returning.`, ev.ret('mergeSort', null));
      t.exit();
    };

    if (arr.length > 0) mergeSort(0, arr.length - 1);

    // A closing step, so the promise the function makes has somewhere to be
    // judged. Everything above is about one range at a time; this is the only
    // moment at which "the array is sorted" is a statement about the array.
    t.derive({ isSorted: sortedFlag(arr), kept: permutationFlag(arr, original), covered, writtenBack });
    t.step(29, { lo: 0, hi: arr.length - 1, mid: null, i: null, j: null, k: null }, () => `Sorted: [${arr.join(', ')}]`);
    return arr.join(',');
  };
}

const run: RunFn = (input, t, mut) =>
  makeRun({
    rightStart: mut.has('overlap') ? (mid: number) => mid : (mid: number) => mid + 1,
    drainRight: !mut.has('no-drain'),
  })(input, t, mut);

export const mergeSort: AlgorithmDef = {
  slug: 'merge-sort',
  name: 'Merge Sort',
  category: 'sorting',
  tagline: 'Split until sorting is trivial, then merge sorted pieces back together.',
  intuition: [
    'Sorting a big array is hard. Sorting an array of one element is free. Merge sort takes that seriously: it splits the array in half, and half again, until every piece is a single element and therefore already sorted.',
    'All the real work happens on the way back up. Merging two sorted lists is easy — look at the front of each, take the smaller, repeat. Because both inputs are sorted, you never need to look further than the front.',
    'Watch the call stack rather than the array. The array barely changes for a long time while the recursion drills down to single elements; then it changes a lot, from the bottom up. That shape is what "divide and conquer" actually looks like.',
  ],
  code: { cpp: CPP, c: C, java: JAVA },
  lens: {
    primary: 'arr',
    pointers: [
      { var: 'i', on: 'arr', role: 'cursor', label: 'i', hint: 'Front of the unmerged left half.' },
      { var: 'j', on: 'arr', role: 'runner', label: 'j', hint: 'Front of the unmerged right half.' },
    ],
    regions: [
      { on: 'arr', kind: 'considering', from: 'lo', to: 'hi', label: 'this call’s region' },
      { on: 'arr', kind: 'active', from: 'lo', to: 'mid', label: 'left half' },
    ],
    invariant: {
      text: 'The merge buffer is sorted at every point while it is being filled.',
      check: 'tmpSorted',
      when: 'defined(tmpSorted)',
      why: 'Merge only works because it never has to reconsider a value it has already placed. If the buffer can go out of order, the "take the smaller front" rule is wrong somewhere — usually a comparison or an index bound.',
    },
    postcondition: {
      text: 'The whole array is in order, and holds exactly the values it started with.',
      check: 'isSorted === 1 && kept === 1',
      why: 'The loop invariant above is about progress: it says the part already settled is settled correctly. It is silent on whether the loop ran long enough, and a sort that stops one pass early satisfies it completely while returning an array that is not sorted. This is the claim the caller actually cares about, and it can only be judged once the function has finished.',
    },
    cost: {
      text: 'Every merge writes back every cell of the range it was given — as many cells out as the range holds.',
      check: 'writtenBack === covered',
      why: 'Dropping the drain of one half is the rare bug that is usually harmless and occasionally fatal, and which half decides which. Leftovers from the right half are already sitting in their final positions, so skipping them sorts correctly and passes every claim above; leftovers from the left half are the largest values and get stranded. A merge that returns without emptying both halves has left part of its own range untouched either way, and that is true whether or not the answer happened to survive it. Same values, same order, fewer writes — and the writes are what a merge is.',
    },
  },
  run,
  defaultInput: { array: [38, 27, 43, 3, 9, 82, 10] },
  fields: [{ key: 'array', label: 'Array', kind: 'array' }],
  makeInput: (n) => ({ array: Array.from({ length: n }, (_, k) => ((k * 7919) % n) + 1) }),
  growthSizes: [8, 16, 32, 64, 128, 256, 512, 1024, 2048],
  projectTo: 1_000_000,
  complexity: {
    time: 'O(n log n) in all cases',
    space: 'O(n)',
    note: 'The recursion has log n levels, and every level touches all n elements once during merging. Unlike quick sort there is no bad input — the split is always exactly in half.',
  },
  userLane: {
    fnName: 'mergeSort',
    compareBy: 'array',
    starters: {
      cpp: `void merge(vector<int>& arr, int lo, int mid, int hi) {
    vector<int> tmp;
    int i = lo, j = mid + 1;

    while (i <= mid && j <= hi) {
        if (arr[i] <= arr[j]) tmp.push_back(arr[i++]);
        else tmp.push_back(arr[j++]);
    }

    while (i <= mid) tmp.push_back(arr[i++]);
    while (j <= hi) tmp.push_back(arr[j++]);

    for (int k = 0; k < tmp.size(); k++) arr[lo + k] = tmp[k];
}

void mergeSort(vector<int>& arr, int lo, int hi) {
    if (lo >= hi) return;

    int mid = lo + (hi - lo) / 2;
    mergeSort(arr, lo, mid);
    mergeSort(arr, mid + 1, hi);
    merge(arr, lo, mid, hi);
}`,
      c: `void merge(int arr[], int lo, int mid, int hi) {
    int tmp[64];
    int t = 0;
    int i = lo, j = mid + 1;

    while (i <= mid && j <= hi) {
        if (arr[i] <= arr[j]) tmp[t++] = arr[i++];
        else tmp[t++] = arr[j++];
    }

    while (i <= mid) tmp[t++] = arr[i++];
    while (j <= hi) tmp[t++] = arr[j++];

    for (int k = 0; k < t; k++) arr[lo + k] = tmp[k];
}

void mergeSort(int arr[], int lo, int hi) {
    if (lo >= hi) return;

    int mid = lo + (hi - lo) / 2;
    mergeSort(arr, lo, mid);
    mergeSort(arr, mid + 1, hi);
    merge(arr, lo, mid, hi);
}`,
      java: `void merge(int[] arr, int lo, int mid, int hi) {
    int[] tmp = new int[hi - lo + 1];
    int t = 0;
    int i = lo, j = mid + 1;

    while (i <= mid && j <= hi) {
        if (arr[i] <= arr[j]) tmp[t++] = arr[i++];
        else tmp[t++] = arr[j++];
    }

    while (i <= mid) tmp[t++] = arr[i++];
    while (j <= hi) tmp[t++] = arr[j++];

    for (int k = 0; k < t; k++) arr[lo + k] = tmp[k];
}

void mergeSort(int[] arr, int lo, int hi) {
    if (lo >= hi) return;

    int mid = lo + (hi - lo) / 2;
    mergeSort(arr, lo, mid);
    mergeSort(arr, mid + 1, hi);
    merge(arr, lo, mid, hi);
}`,
    },
  },
  mutations: [
    {
      id: 'overlap',
      edits: [{ line: 15, from: 'int i = lo, j = mid + 1;', to: 'int i = lo, j = mid;' }],
      label: 'j starts at mid',
      note: 'Both halves claim arr[mid], so it is merged twice and something else is lost.',
    },
    {
      id: 'no-drain',
      edits: [
        {
          line: 25,
          from: 'while (j <= hi)  tmp.push_back(arr[j++]);',
          to: '// while (j <= hi) tmp.push_back(arr[j++]);',
          langs: ['cpp'],
        },
        {
          line: 25,
          from: 'while (j <= hi)  tmp[t++] = arr[j++];',
          to: '// while (j <= hi) tmp[t++] = arr[j++];',
          langs: ['c', 'java'],
        },
      ],
      label: 'drop the right drain',
      note: 'Leftovers in the right half never reach the buffer when the left half empties first.',
    },
  ],
  variants: [
    {
      id: 'overlap',
      label: 'int j = mid',
      blurb: 'Output has a value duplicated and another missing.',
      explanation:
        'The left half is arr[lo..mid], so mid belongs to the left. Starting j at mid makes both halves claim that element: it gets merged in twice, and whatever should have been at the end of the range gets overwritten. The two halves must partition the range exactly — no gap, no overlap.',
      mutations: ['overlap'],
    },
    {
      id: 'no-drain',
      label: 'missing right-hand drain',
      blurb: 'Works on some arrays, silently corrupts others.',
      explanation:
        'When the left half is exhausted first, the right half still has values waiting. Without the second drain loop the buffer is shorter than the range, so the write-back leaves stale values at the end of the region. It only shows up when the left half runs out first — which is why this bug survives casual testing.',
      mutations: ['no-drain'],
    },
  ],
  edgeCases: [
    { id: 'sorted', label: 'Already sorted', input: { array: [1, 2, 3, 4, 5, 6, 7, 8] }, why: 'Merge sort does not care. Same number of comparisons as any other order — no early exit exists.' },
    { id: 'reversed', label: 'Reverse sorted', input: { array: [8, 7, 6, 5, 4, 3, 2, 1] }, why: 'Every merge drains the right half first. Watch the second drain loop do all the work.' },
    { id: 'dupes', label: 'All equal', input: { array: [4, 4, 4, 4] }, why: 'Every comparison takes the left branch, which is what makes merge sort stable.' },
    { id: 'odd', label: 'Odd length', input: { array: [5, 2, 9] }, why: 'The split is uneven. Check that mid still partitions the range with no overlap.' },
    { id: 'single', label: 'One element', input: { array: [7] }, why: 'The base case fires immediately and nothing merges.' },
  ],
  checkpoints: [
    conceptual({
      where: { line: 2, nth: 1 },
      question: 'What does this base case actually assert about a range of one element?',
      options: [
        'That it is already sorted',
        'That it can be ignored',
        'That it is empty',
        'That it will be handled by the merge',
      ],
      answer: 'That it is already sorted',
      because:
        'A single element is trivially in order, and that unremarkable fact is the whole foundation of the recursion. Everything above it is built by merging two things already known to be sorted — so if this base case were wrong, nothing above would mean anything.',
    }),
    conceptual({
      where: { line: 18, nth: 1 },
      question: 'The merge compares only the front of each half. Why is that enough?',
      options: [
        'Both halves are sorted, so the overall smallest must be at one front or the other',
        'Because the halves are the same length',
        'Because everything has been compared already',
        'It is not enough — the loop below fixes it',
      ],
      answer: 'Both halves are sorted, so the overall smallest must be at one front or the other',
      because:
        'This is the payoff for having sorted the halves. Nothing behind a front can be smaller than the front itself, so one comparison decides the next output element out of the whole range. Without the sortedness, choosing the next element would mean scanning everything — and the merge would be quadratic instead of linear.',
    }),
    conceptual({
      where: { line: 24 },
      question: 'One half has run out. Why can the rest of the other be copied without any comparisons?',
      options: [
        'Everything left is already larger than everything emitted, and in order',
        'Because it is the larger half',
        'Because the comparisons were done earlier',
        'It cannot — this is why merge sort needs the extra array',
      ],
      answer: 'Everything left is already larger than everything emitted, and in order',
      because:
        'The loop above only stopped because one side was exhausted, which means every remaining element already lost no comparison — each is at least as large as everything written out — and they are in order among themselves. Both facts are needed, and dropping this drain is a bug that leaves stale values behind.',
    }),
    {
      locate: (trace) => trace.steps.findIndex((s) => s.line === 18),
      question: (trace, at) => {
        const v = trace.steps[at].vars;
        return `The left half offers arr[${v.i}] and the right offers arr[${v.j}]. Which value lands in the merge buffer next?`;
      },
      options: (trace, at) => {
        const s = trace.steps[at];
        const arr = s.structs.arr;
        if (arr.kind !== 'array') return [];
        const left = arr.values[Number(s.vars.i)];
        const right = arr.values[Number(s.vars.j)];
        return [...new Set([String(left), String(right), String(Math.max(left, right) + 1)])].slice(0, 3);
      },
      answer: (trace, at) => {
        const s = trace.steps[at];
        const arr = s.structs.arr;
        if (arr.kind !== 'array') return '';
        const left = arr.values[Number(s.vars.i)];
        const right = arr.values[Number(s.vars.j)];
        return String(left <= right ? left : right);
      },
      because: () =>
        'Both halves are already sorted, so the smallest value not yet merged has to be at the front of one of them. Comparing just those two fronts is enough — that is the entire trick of merging.',
    },
  ],
};
