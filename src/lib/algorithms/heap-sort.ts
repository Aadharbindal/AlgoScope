import { cell, ev, vr } from '../trace/tracer';

import { permutationFlag, sortedFlag } from './claims';
import { computed, conceptual } from './checkpoints';
import { AlgorithmDef, RunFn } from './types';

/**
 * Selection sort with a better way of selecting.
 *
 * That framing is the whole reason this algorithm is here. Selection sort
 * spends a linear scan to find the largest remaining value; a heap answers the
 * same question in logarithmic time, and answers it again after a change. The
 * sort is unchanged — take the largest, put it at the end, repeat — and the
 * quadratic becomes n log n purely because the question got cheaper.
 *
 * The heap is the array. No second structure is allocated: the tree is the
 * indexing convention that a node at i has children at 2i+1 and 2i+2, which is
 * why this sorts in place while merge sort does not.
 */

const CPP = `void siftDown(vector<int>& arr, int n, int i) {
    while (true) {
        int largest = i;
        int l = 2 * i + 1, r = 2 * i + 2;

        if (l < n && arr[l] > arr[largest]) largest = l;
        if (r < n && arr[r] > arr[largest]) largest = r;

        if (largest == i) return;

        swap(arr[i], arr[largest]);
        i = largest;
    }
}

void heapSort(vector<int>& arr) {
    int n = arr.size();

    for (int i = n / 2 - 1; i >= 0; i--)
        siftDown(arr, n, i);

    for (int end = n - 1; end > 0; end--) {
        swap(arr[0], arr[end]);
        siftDown(arr, end, 0);
    }
}`;

const C = `void siftDown(int arr[], int n, int i) {
    while (1) {
        int largest = i;
        int l = 2 * i + 1, r = 2 * i + 2;

        if (l < n && arr[l] > arr[largest]) largest = l;
        if (r < n && arr[r] > arr[largest]) largest = r;

        if (largest == i) return;

        int t = arr[i]; arr[i] = arr[largest]; arr[largest] = t;
        i = largest;
    }
}

void heapSort(int arr[], int n) {
    /* n is a parameter here */

    for (int i = n / 2 - 1; i >= 0; i--)
        siftDown(arr, n, i);

    for (int end = n - 1; end > 0; end--) {
        int t = arr[0]; arr[0] = arr[end]; arr[end] = t;
        siftDown(arr, end, 0);
    }
}`;

const JAVA = `void siftDown(int[] arr, int n, int i) {
    while (true) {
        int largest = i;
        int l = 2 * i + 1, r = 2 * i + 2;

        if (l < n && arr[l] > arr[largest]) largest = l;
        if (r < n && arr[r] > arr[largest]) largest = r;

        if (largest == i) return;

        int t = arr[i]; arr[i] = arr[largest]; arr[largest] = t;
        i = largest;
    }
}

void heapSort(int[] arr) {
    int n = arr.length;

    for (int i = n / 2 - 1; i >= 0; i--)
        siftDown(arr, n, i);

    for (int end = n - 1; end > 0; end--) {
        int t = arr[0]; arr[0] = arr[end]; arr[end] = t;
        siftDown(arr, end, 0);
    }
}`;

interface Opts {
  /** The buggy build starts at the leaves' level and never fixes the top. */
  buildFromLastParent: boolean;
  /** The buggy version sifts over the whole array, dragging sorted values back. */
  shrinkHeap: boolean;
}

/**
 * Whether `arr[0..n-1]` satisfies the heap property.
 *
 * Computed from the array itself: every parent is at least as large as either
 * child. This is the thing the whole algorithm rests on and the thing that is
 * invisible in the output, so it is worth checking directly rather than
 * inferring from the answer.
 */
function isHeap(arr: number[], n: number, from = 0): boolean {
  for (let i = from; i < n; i++) {
    const l = 2 * i + 1;
    const r = 2 * i + 2;
    if (l < n && arr[l] > arr[i]) return false;
    if (r < n && arr[r] > arr[i]) return false;
  }
  return true;
}

function makeRun(opts: Opts): RunFn {
  return (input, t) => {
    const arr = (input.array ?? []).slice();
    const original = arr.slice();
    const n = arr.length;

    t.array('arr', arr, 'arr');
    t.oracle({ answer: [...arr].sort((a, b) => a - b).join(',') });

    /** How far the heap reaches, and how far the sorted tail does. */
    let heapSize = n;
    /** Sift steps taken, against the depth each was allowed. */
    let siftSteps = 0;
    let siftAllowed = 0;
    /** Repairs started during the build. Only the nodes with children need one. */
    let buildCalls = 0;

    /**
     * Publish the accounting, and say when the heap claim is even in scope.
     *
     * A sift is the middle of a repair: the value being carried down is out of
     * place by construction, so checking the heap property mid-sift would
     * report a broken invariant on a run doing exactly the right thing. The
     * claim is made between repairs, and marked out of scope during one — the
     * same treatment cycle detection gives its two-to-one ratio.
     *
     * `from` is where the heap is claimed to start. During the build that is
     * one past the node being sifted, because everything after it has already
     * been made a heap and nothing before it has been touched yet.
     */
    const mark = (phase: string, from: number | null = 0) => {
      if (!t.tracing) return;
      t.derive({
        heapSize,
        heapOk: from === null ? null : isHeap(arr, heapSize, from) ? 1 : 0,
        tailSorted: sortedFlag(arr.slice(heapSize)),
        phase,
      });
    };

    /**
     * Push the value at `i` down until both its children are smaller.
     *
     * Bounded by the height of the tree, which is the entire reason this beats
     * a linear scan — and the bound is published so a cost claim can hold the
     * run to it.
     */
    const siftDown = (size: number, start: number) => {
      let i = start;
      siftAllowed += Math.floor(Math.log2(Math.max(1, size))) + 1;
      t.enter('siftDown', `siftDown(${size}, ${start})`, { i });

      for (;;) {
        siftSteps++;
        let largest = i;
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        t.step(3, { i, l, r, largest, end: heapSize - 1 }, `Children of ${i} are at ${l} and ${r}.`);

        const leftBigger = l < size && arr[l] > arr[largest];
        t.step(6, { i, l, r, largest, end: heapSize - 1 }, l >= size ? `There is no left child inside the heap.` : `arr[${l}] = ${arr[l]} against arr[${largest}] = ${arr[largest]}.`, l < size ? ev.cmp(cell('arr', l), '>', cell('arr', largest), leftBigger) : undefined);
        if (leftBigger) largest = l;

        const rightBigger = r < size && arr[r] > arr[largest];
        t.step(7, { i, l, r, largest, end: heapSize - 1 }, r >= size ? `There is no right child inside the heap.` : `arr[${r}] = ${arr[r]} against arr[${largest}] = ${arr[largest]}.`, r < size ? ev.cmp(cell('arr', r), '>', cell('arr', largest), rightBigger) : undefined);
        if (rightBigger) largest = r;

        const settled = largest === i;
        t.step(9, { i, l, r, largest, end: heapSize - 1 }, settled ? `arr[${i}] is already at least as large as both children. Nothing to do.` : `arr[${largest}] is larger, so it has to come up.`, ev.cmp(vr('largest'), '==', vr('i'), settled));
        if (settled) break;

        const a = arr[i];
        const b = arr[largest];
        arr[i] = b;
        arr[largest] = a;
        mark('sift', null);
        t.step(11, { i, l, r, largest, end: heapSize - 1 }, `Swap ${a} down and ${b} up.`, ev.swap('arr', i, largest));

        i = largest;
        t.step(12, { i, l, r, largest, end: heapSize - 1 }, `Carry on from ${i} — the subtree below it may now be wrong.`);
      }

      t.exit();
    };

    t.enter('heapSort', 'heapSort(arr)');
    mark('start', null);
    t.step(17, { i: null, l: null, r: null, largest: null, end: n - 1 }, `${n} element${n === 1 ? '' : 's'}. First turn the array into a heap, then take the largest out of it repeatedly.`, ev.call('heapSort', 'heapSort(arr)'));

    // Build. Start at the last node that has a child: everything after it is a
    // leaf, and a leaf is a heap of one already.
    const firstParent = opts.buildFromLastParent ? Math.floor(n / 2) - 1 : n - 1;
    for (let i = firstParent; i >= 0; i--) {
      mark('build', i + 1);
      buildCalls++;
      t.step(19, { i, l: null, r: null, largest: null, end: n - 1 }, `Sift down from ${i}. Everything below it is already a heap.`);
      siftDown(n, i);
      mark('build', i);
      t.step(20, { i, l: null, r: null, largest: null, end: n - 1 }, `arr[${i}..${n - 1}] is a heap now.`);
    }

    mark('built');
    t.step(20, { i: null, l: null, r: null, largest: null, end: n - 1 }, `The whole array is a heap: the largest value is at the front.`);

    for (let end = n - 1; end > 0; end--) {
      const a = arr[0];
      const b = arr[end];
      arr[0] = b;
      arr[end] = a;
      heapSize = opts.shrinkHeap ? end : n;
      mark('sort', null);
      t.step(23, { i: 0, l: null, r: null, largest: null, end }, `${a} is the largest left, so it belongs at index ${end}. Swap it there.`, ev.swap('arr', 0, end));

      t.step(24, { i: 0, l: null, r: null, largest: null, end }, opts.shrinkHeap ? `The heap is now arr[0..${end - 1}] — the tail is finished. Restore the heap from the top.` : `Sift from the top over the whole array, sorted tail included.`);
      siftDown(opts.shrinkHeap ? end : n, 0);
      mark('sort');
    }

    heapSize = 0;
    t.derive({
      heapSize: 0,
      heapOk: 1,
      tailSorted: sortedFlag(arr),
      phase: 'done',
      isSorted: sortedFlag(arr),
      kept: permutationFlag(arr, original),
      siftSteps,
      siftAllowed,
      buildCalls,
      buildAllowed: Math.max(0, Math.floor(n / 2)),
    });
    t.step(26, { i: null, l: null, r: null, largest: null, end: 0 }, `Sorted: [${arr.join(', ')}]`);
    t.exit();
    return arr.join(',');
  };
}

const run: RunFn = (input, t, mut) =>
  makeRun({
    buildFromLastParent: !mut.has('build-from-leaves'),
    shrinkHeap: !mut.has('no-shrink'),
  })(input, t, mut);

export const heapSort: AlgorithmDef = {
  slug: 'heap-sort',
  name: 'Heap Sort',
  category: 'sorting',
  tagline: 'Selection sort, with a structure that finds the largest value in log n instead of n.',
  intuition: [
    'Selection sort scans the whole unsorted part to find the largest value, which costs n every pass and n² in total. Everything else about it is fine. Heap sort keeps exactly the same plan and replaces only the scan.',
    'A heap is an array read as a tree: the node at i has children at 2i+1 and 2i+2, and every parent is at least as large as its children. That one rule means the largest value is always at index 0 — no searching at all — and that a change can be repaired by walking one value down the tree, which is log n steps rather than n.',
    'So the sort becomes: build the heap once, then repeatedly swap the front with the last unsorted slot and repair. The swapped-out value is the largest remaining, so it is in its final place, and the heap shrinks by one.',
    'No second array is allocated. The heap and the sorted tail share the same storage and the boundary between them just moves, which is why this is the O(n log n) sort you reach for when memory is the constraint rather than speed.',
  ],
  code: { cpp: CPP, c: C, java: JAVA },
  lens: {
    primary: 'arr',
    pointers: [
      { var: 'i', on: 'arr', role: 'cursor', label: 'i', hint: 'The value being sifted down.' },
      { var: 'largest', on: 'arr', role: 'probe', label: 'largest', hint: 'Largest of the parent and its two children.' },
      { var: 'end', on: 'arr', role: 'boundary', label: 'end', hint: 'Last slot still part of the heap.' },
    ],
    regions: [
      { on: 'arr', kind: 'active', from: 0, to: 'end', label: 'the heap' },
      { on: 'arr', kind: 'sorted', from: 'end + 1', to: 'n - 1', label: 'final position' },
    ],
    invariant: {
      text: 'The part still in play is a heap: no child is larger than its parent.',
      check: 'heapOk === 1',
      when: 'defined(heapOk)',
      why: 'Everything this sort does rests on the largest remaining value being at index 0, and that is true only while the heap property holds. It is checked here against the array directly rather than inferred from the output, because a run can break the property, repair it by accident on the next pass, and still finish sorted — which would leave the reader believing an argument that did not actually hold.',
    },
    postcondition: {
      text: 'The whole array is in order, and holds exactly the values it started with.',
      check: 'isSorted === 1 && kept === 1',
      why: 'The same promise every sort on this site makes, so that the five of them can be compared on what they cost rather than on what they return.',
    },
    cost: {
      text: 'Each repair walks one value down the tree, never further than the tree is tall — and the build only repairs the nodes that have children.',
      check: 'siftSteps <= siftAllowed && buildCalls <= buildAllowed',
      why: 'This is the only thing heap sort improves on selection sort, and it is invisible in the sorted array — both return the same thing. Selection sort pays n to find the largest; this pays the height of the tree. Break the shrinking boundary and the sort still finishes, still sorted, having sifted over values that were already final: the answer is right and the log is gone.',
    },
  },
  run,
  defaultInput: { array: [4, 10, 3, 5, 1, 8] },
  fields: [{ key: 'array', label: 'Array', kind: 'array' }],
  makeInput: (n) => ({ array: Array.from({ length: n }, (_, i) => ((i * 37) % n) + 1) }),
  growthSizes: [16, 32, 64, 128, 256, 512],
  projectTo: 1_000_000,
  complexity: {
    time: 'O(n log n)',
    space: 'O(1)',
    note: 'The one O(n log n) sort on this page that needs no extra array — the heap lives in the array being sorted. Merge sort matches its time and allocates a buffer to do it; quick sort matches its time on average and can be quadratic on an unlucky pivot. Heap sort is never quadratic and never allocates, and in exchange it is usually the slowest of the three in practice, because it jumps around memory rather than walking through it.',
  },
  mutations: [
    {
      id: 'build-from-leaves',
      edits: [
        { line: 19, from: 'for (int i = n / 2 - 1; i >= 0; i--)', to: 'for (int i = n - 1; i >= 0; i--)', langs: ['cpp', 'c', 'java'] },
      ],
      label: 'build starting from the leaves',
      note: 'Sifts from every index rather than only from the nodes that have children.',
    },
    {
      id: 'no-shrink',
      edits: [
        { line: 24, from: 'siftDown(arr, end, 0);', to: 'siftDown(arr, n, 0);', langs: ['cpp', 'c', 'java'] },
      ],
      label: 'never shrink the heap',
      note: 'Repairs over the whole array, so the sorted tail is dragged back into the heap.',
    },
  ],
  variants: [
    {
      id: 'no-shrink',
      label: 'The heap never shrinks',
      blurb: 'The largest value is put in place and then immediately pulled back out.',
      explanation:
        'Swapping the front to the back is only half the move; the other half is agreeing that the back is no longer part of the heap. Sift over the whole array instead and the value just placed is the largest thing in it, so the very next repair carries it straight back to the front — and the sort never finishes placing anything.',
      mutations: ['no-shrink'],
    },
    {
      id: 'build-from-leaves',
      label: 'The build starts at the leaves',
      blurb: 'More work than necessary, and the same answer.',
      explanation:
        'Sifting from a leaf does nothing: a leaf has no children, so the loop looks at nothing and returns. Starting at n − 1 instead of n/2 − 1 therefore costs a wasted call for every leaf — half the array — and produces exactly the same heap. It is the clearest case on this site of a bug that cannot be seen in the answer at all, only in the count.',
      mutations: ['build-from-leaves'],
    },
  ],
  edgeCases: [
    { id: 'default', label: 'The default array', input: { array: [4, 10, 3, 5, 1, 8] }, why: 'The build does real work: the root starts small and has to sink.' },
    { id: 'sorted', label: 'Already sorted', input: { array: [1, 2, 3, 4, 5, 6] }, why: 'The worst possible heap — every parent is smaller than its children, so the build has the most to fix. Unlike bubble sort, heap sort cannot notice that the input was sorted.' },
    { id: 'reverse', label: 'Reverse sorted', input: { array: [6, 5, 4, 3, 2, 1] }, why: 'Already a valid heap, so the build does nothing at all and the sort is pure extraction.' },
    { id: 'dupes', label: 'All equal', input: { array: [7, 7, 7, 7] }, why: 'Every comparison is false, so nothing ever sifts. The heap property holds trivially throughout.' },
    { id: 'two', label: 'Two elements', input: { array: [2, 1] }, why: 'One swap in the build, one in the extraction.' },
    { id: 'single', label: 'One element', input: { array: [5] }, why: 'The extraction loop never runs — a heap of one is a sorted array of one.' },
    { id: 'empty', label: 'Empty array', input: { array: [] }, why: 'Both loops are skipped. n/2 − 1 is negative, which is why the build loop counts downwards to zero rather than upwards.' },
  ],
  checkpoints: [
    conceptual({
      where: { line: 19, nth: 1 },
      question: 'The build starts at n/2 − 1 rather than at the last index. Why is that enough?',
      options: [
        'Everything past it is a leaf, and a leaf is already a heap of one',
        'Because the second half of the array is always sorted',
        'To save memory',
        'It is not enough — the top of the heap is left unfixed',
      ],
      answer: 'Everything past it is a leaf, and a leaf is already a heap of one',
      because:
        'A node at index i has children at 2i+1 and 2i+2, so any index at or past n/2 has no children inside the array. Sifting from there would look at nothing and return. Half the array is leaves, which is why this build is O(n) rather than O(n log n) — most nodes are near the bottom and have almost nowhere to sink to.',
    }),
    conceptual({
      where: { line: 23, nth: 1 },
      question: 'Why is the value swapped to the back guaranteed to be in its final position?',
      options: [
        'Because the heap property puts the largest remaining value at index 0',
        'Because the array was sorted during the build',
        'Because the back of the array is never touched again',
        'It is not guaranteed — later passes may move it',
      ],
      answer: 'Because the heap property puts the largest remaining value at index 0',
      because:
        'That is the whole payoff of maintaining the heap. Nothing is searched for: index 0 is the largest by construction, so the slot it belongs in is the last unsorted one. The same argument selection sort makes after a linear scan, made instead by a structure that already knew.',
    }),
    computed({
      where: { line: 11, nth: 2 },
      question: () => 'How far down has this value travelled so far?',
      answer: (step) => String(Number(step.vars.largest ?? 0)),
      options: (answer) => {
        const v = Number(answer);
        return [String(v), String(v + 1), '0', String(Math.max(0, v - 1))];
      },
      because:
        'A value sinks by one level per swap, and the tree is log n deep, so no repair can take more than a handful of swaps however large the array is. That bound is the entire difference between this and selection sort.',
    }),
  ],
};
