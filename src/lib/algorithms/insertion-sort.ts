import { cell, ev, vr } from '../trace/tracer';
import { Tracer } from '../trace/tracer';
import { computed, conceptual } from './checkpoints';
import { permutationFlag, sortedFlag } from './claims';
import { AlgorithmDef, RunFn } from './types';

const CPP = `void insertionSort(vector<int>& arr) {
    int n = arr.size();

    for (int i = 1; i < n; i++) {
        int key = arr[i];
        int j = i - 1;

        while (j >= 0 && arr[j] > key) {
            arr[j + 1] = arr[j];
            j--;
        }

        arr[j + 1] = key;
    }
}`;

const C = `void insertionSort(int arr[], int size) {
    int n = size;

    for (int i = 1; i < n; i++) {
        int key = arr[i];
        int j = i - 1;

        while (j >= 0 && arr[j] > key) {
            arr[j + 1] = arr[j];
            j--;
        }

        arr[j + 1] = key;
    }
}`;

const JAVA = `void insertionSort(int[] arr) {
    int n = arr.length;

    for (int i = 1; i < n; i++) {
        int key = arr[i];
        int j = i - 1;

        while (j >= 0 && arr[j] > key) {
            arr[j + 1] = arr[j];
            j--;
        }

        arr[j + 1] = key;
    }
}`;

/**
 * The invariant belongs to the *outer* loop: at the top of pass i the first i
 * elements are in order among themselves. Halfway through the shifting loop
 * there is a duplicated slot, so the prefix is legitimately not sorted and the
 * check is marked inapplicable rather than failed.
 */
function derive(t: Tracer, arr: number[], i: number, settled: boolean) {
  if (!t.tracing) return;
  let ok = true;
  for (let k = 1; k < i; k++) if (arr[k - 1] > arr[k]) ok = false;
  t.derive({ prefixSorted: ok, settled: settled ? 1 : 0 });
}

interface Opts {
  /** Where the backward scan begins, relative to the value being inserted. */
  jStart: (i: number) => number;
  /** The buggy write puts the key back one slot too far left. */
  placeOffset: number;
}

function makeRun(opts: Opts): RunFn {
  return (input, t) => {
    const arr = (input.array ?? []).slice();
    // Kept so the result can be checked for having the same values it began
    // with — a sort that drops one is sorted and wrong.
    const original = arr.slice();
    t.array('arr', arr, 'arr');
    t.enter('insertionSort', 'insertionSort(arr)');

    const n = arr.length;
    let i: number | null = null;
    let j: number | null = null;
    let key: number | null = null;

    t.step(2, { n, i, j, key }, `The array has ${n} element${n === 1 ? '' : 's'}. A single element is already sorted, so the work starts at index 1.`);

    for (i = 1; i < n; i++) {
      derive(t, arr, i, true);
      t.step(4, { n, i, j, key }, () => `Pass ${i}: arr[0..${(i as number) - 1}] is already in order. Insert arr[${i}] into it.`);

      key = arr[i];
      t.step(5, { n, i, j, key }, () => `Hold ${key} in key. Its slot is now free to be overwritten, which is what makes room for the shift.`);

      j = opts.jStart(i);
      t.step(6, { n, i, j, key }, () => `Start comparing backwards from index ${j}.`);

      for (;;) {
        const inBounds = j >= 0;
        const bigger = inBounds && arr[j] > (key as number);
        derive(t, arr, i, false);
        t.step(
          8,
          { n, i, j, key },
          () =>
            !inBounds
              ? `j = ${j} — off the front of the array, so ${key} belongs at the very start.`
              : bigger
                ? `arr[${j}] = ${arr[j as number]} is larger than ${key}, so it must move right to make room.`
                : `arr[${j}] = ${arr[j as number]} is not larger than ${key}. This is where ${key} belongs.`,
          ev.cmp(cell('arr', Math.max(0, j)), '>', vr('key'), bigger),
        );
        if (!bigger) break;
        t.tick();

        arr[j + 1] = arr[j];
        derive(t, arr, i, false);
        t.step(9, { n, i, j, key }, () => `Copy ${arr[j as number]} one slot right, into index ${(j as number) + 1}.`, ev.write('arr', (j as number) + 1, arr[j as number]));

        j--;
        t.step(10, { n, i, j, key }, () => `Step back to index ${j}.`);
      }

      arr[j + opts.placeOffset] = key;
      derive(t, arr, i + 1, true);
      t.step(13, { n, i, j, key }, () => `Drop ${key} into index ${(j as number) + opts.placeOffset}. arr[0..${i}] is sorted again.`, ev.write('arr', (j as number) + opts.placeOffset, key as number));
    }

    t.derive({
      prefixSorted: null,
      settled: null,
      isSorted: sortedFlag(arr),
      kept: permutationFlag(arr, original),
    });
    t.step(15, { n, i, j, key }, () => `Sorted: [${arr.join(', ')}]`);
    t.exit();
    return arr.join(',');
  };
}

const run: RunFn = (input, t, mut) =>
  makeRun({
    jStart: mut.has('scan-from-self') ? (i: number) => i : (i: number) => i - 1,
    placeOffset: mut.has('place-left') ? 0 : 1,
  })(input, t, mut);

export const insertionSort: AlgorithmDef = {
  slug: 'insertion-sort',
  name: 'Insertion Sort',
  category: 'sorting',
  tagline: 'Grow a sorted prefix by sliding each new value back to where it belongs.',
  intuition: [
    'This is how people sort a hand of cards. The cards on the left are already in order; you pick up the next one and slide it left past everything larger than it until it lands in the right spot.',
    'The trick is that nothing gets swapped. The new value is lifted out into key, which frees its slot, and then larger values are simply copied one place to the right until a gap opens where the key belongs. One write per shift instead of the three a swap would cost.',
    'It is O(n²) in the worst case, but on nearly-sorted input the inner loop barely runs and it approaches O(n). That is why real sorting libraries switch to insertion sort for small or almost-ordered chunks.',
  ],
  code: { cpp: CPP, c: C, java: JAVA },
  lens: {
    primary: 'arr',
    pointers: [
      { var: 'i', on: 'arr', role: 'boundary', label: 'i', hint: 'The value being inserted this pass.' },
      { var: 'j', on: 'arr', role: 'cursor', label: 'j', hint: 'Scanning backwards for the insertion point.' },
    ],
    regions: [
      { on: 'arr', kind: 'sorted', from: 0, to: 'i - 1', label: 'sorted so far (not final)' },
      { on: 'arr', kind: 'active', from: 'i', to: 'n - 1', label: 'untouched' },
    ],
    invariant: {
      text: 'At the start of each pass, arr[0 .. i-1] is in sorted order.',
      check: 'prefixSorted',
      when: 'defined(settled) && settled === 1',
      why: 'This is the promise the outer loop maintains, and the reason the inner loop is allowed to stop at the first value that is not larger than the key: everything further left is already known to be smaller still. Mid-shift the prefix holds a duplicated slot, so the check only applies between passes — which is exactly what a loop invariant means.',
    },
    postcondition: {
      text: 'The whole array is in order, and holds exactly the values it started with.',
      check: 'isSorted === 1 && kept === 1',
      why: 'The loop invariant above is about progress: it says the part already settled is settled correctly. It is silent on whether the loop ran long enough, and a sort that stops one pass early satisfies it completely while returning an array that is not sorted. This is the claim the caller actually cares about, and it can only be judged once the function has finished.',
    },
  },
  run,
  defaultInput: { array: [12, 11, 13, 5, 6] },
  fields: [{ key: 'array', label: 'Array', kind: 'array', help: 'Try one that is nearly sorted.' }],
  makeInput: (n) => ({ array: Array.from({ length: n }, (_, k) => n - k) }),
  growthSizes: [8, 16, 32, 64, 128, 256, 512],
  projectTo: 100_000,
  complexity: {
    time: 'O(n²) worst, O(n) best',
    space: 'O(1)',
    note: 'Reverse-sorted input forces every pass to shift the whole prefix, giving about n²/2 moves. Already-sorted input fails the inner comparison immediately every time, so each pass costs one comparison and nothing else.',
  },
  userLane: {
    fnName: 'insertionSort',
    starters: {
      cpp: `void insertionSort(vector<int>& arr) {
    int n = arr.size();

    for (int i = 1; i < n; i++) {
        int key = arr[i];
        int j = i - 1;

        while (j >= 0 && arr[j] > key) {
            arr[j + 1] = arr[j];
            j--;
        }

        arr[j + 1] = key;
    }
}`,
      c: `void insertionSort(int arr[], int n) {
    for (int i = 1; i < n; i++) {
        int key = arr[i];
        int j = i - 1;

        while (j >= 0 && arr[j] > key) {
            arr[j + 1] = arr[j];
            j--;
        }

        arr[j + 1] = key;
    }
}`,
      java: `void insertionSort(int[] arr) {
    int n = arr.length;

    for (int i = 1; i < n; i++) {
        int key = arr[i];
        int j = i - 1;

        while (j >= 0 && arr[j] > key) {
            arr[j + 1] = arr[j];
            j--;
        }

        arr[j + 1] = key;
    }
}`,
      js: `function insertionSort(arr) {
  let n = arr.length;

  for (let i = 1; i < n; i++) {
    let key = arr[i];
    let j = i - 1;

    while (j >= 0 && arr[j] > key) {
      arr[j + 1] = arr[j];
      j--;
    }

    arr[j + 1] = key;
  }
  return arr;
}`,
    },
    compareBy: 'array',
  },
  mutations: [
    {
      id: 'scan-from-self',
      edits: [{ line: 6, from: 'int j = i - 1;', to: 'int j = i;' }],
      label: 'scan from i',
      note: 'Compares the key against itself, so the loop exits at once and the write lands a slot too far right.',
    },
    {
      id: 'place-left',
      edits: [{ line: 13, from: 'arr[j + 1] = key;', to: 'arr[j] = key;' }],
      label: 'place at j',
      note: 'Drops the key one slot left of where the scan stopped, overwriting a correctly placed value.',
    },
  ],
  variants: [
    {
      id: 'scan-from-self',
      label: 'int j = i',
      blurb: 'Destroys a value on the very first pass.',
      explanation:
        'The scan is supposed to start at the last element of the sorted prefix, which is i - 1. Starting at i compares the key against itself, so the loop exits immediately, and the final write lands at j + 1 = i + 1 — one slot past where the key came from. The key is duplicated forward and whatever lived there is gone. The scan never even had a chance to be wrong; the starting index alone did the damage.',
      mutations: ['scan-from-self'],
    },
    {
      id: 'place-left',
      label: 'arr[j] = key',
      blurb: 'Loses a value and duplicates another one.',
      explanation:
        'When the loop stops, j points at the element that is *not* larger than the key — so the key belongs immediately after it, at j + 1. Writing to j instead overwrites a value that was correctly placed and leaves the gap at j + 1 still holding its stale copy. Off-by-one in the write, not in the scan.',
      mutations: ['place-left'],
    },
  ],
  edgeCases: [
    { id: 'sorted', label: 'Already sorted', input: { array: [1, 2, 3, 4, 5] }, why: 'The best case. Every inner loop exits on its first comparison — this is the O(n) path.' },
    { id: 'reversed', label: 'Reverse sorted', input: { array: [5, 4, 3, 2, 1] }, why: 'The worst case. Every key travels all the way to the front, so the j >= 0 guard is what stops the scan every single pass.' },
    { id: 'nearly', label: 'Nearly sorted', input: { array: [1, 2, 4, 3, 5, 6] }, why: 'One value out of place. Watch how little work this costs compared with merge sort on the same array.' },
    { id: 'dupes', label: 'All equal', input: { array: [4, 4, 4, 4] }, why: 'Strict > means equal values never shift, which is what keeps insertion sort stable.' },
    { id: 'two', label: 'Two elements', input: { array: [2, 1] }, why: 'The smallest input that actually shifts anything.' },
    { id: 'single', label: 'One element', input: { array: [7] }, why: 'The loop starts at 1 and never runs.' },
  ],
  checkpoints: [
    conceptual({
      where: { line: 5, nth: 1 },
      question: 'Why is the value lifted into key before the shifting starts?',
      options: [
        'Because the shifting is about to overwrite the slot it was in',
        'To avoid comparing it with itself',
        'To make the code read better',
        'Because arr[i] may change for another reason',
      ],
      answer: 'Because the shifting is about to overwrite the slot it was in',
      because:
        'The first shift copies arr[j] into arr[j + 1], and when j is i − 1 that slot is where the value still lives. Lift it out first and the shifts have somewhere to go; forget to, and the value is destroyed by the very loop that is making room for it.',
    }),
    computed({
      where: { line: 8, nth: 1 },
      question: () => 'The inner loop is about to run. What is true of everything to the left of i?',
      answer: () => 'It is already sorted, but not necessarily in final position',
      options: (a) => [
        a,
        'It is already sorted and in final position',
        'It is unsorted',
        'It is all smaller than key',
      ],
      because:
        'The prefix is sorted among itself, which is what makes a single backwards scan enough to place the next value. It is not final: a later element smaller than everything seen so far will shift the whole prefix right. Merge sort and quick sort settle elements permanently; insertion sort keeps rearranging until the end.',
    }),
    conceptual({
      where: { line: 8, nth: 2 },
      question: 'On an already-sorted array, how many times does this inner loop body run in total?',
      options: [
        'Never — the condition fails immediately every time',
        'Once per element',
        'n² / 2 times',
        'It depends on the values',
      ],
      answer: 'Never — the condition fails immediately every time',
      because:
        'Each new value is already at least as large as its left neighbour, so the while test fails on its first check and nothing shifts. That makes insertion sort linear on sorted or nearly-sorted input — which is why real library sorts fall back to it for small or almost-ordered ranges, despite it being quadratic in the worst case.',
    }),
    {
      locate: (trace) => trace.steps.findIndex((s) => s.line === 9),
      question: (trace, at) => {
        const v = trace.steps[at].vars;
        return `arr[${v.j}] is about to be copied one slot right. What is currently sitting in the slot it is copied into?`;
      },
      options: () => [
        'The value that was lifted out into key',
        'A duplicate of some other value',
        'Nothing — the slot is empty',
        'The smallest value in the array',
      ],
      answer: () => 'The value that was lifted out into key',
      because: () =>
        'On the first shift of a pass, the destination is the slot the key came from — safe to overwrite precisely because key holds a copy. Every later shift overwrites the slot vacated by the previous shift. That is why the key has to be saved before the loop starts.',
    },
  ],
};
