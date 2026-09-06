import { cell, ev } from '../trace/tracer';
import { computed, conceptual, num } from './checkpoints';
import { permutationFlag, sortedFlag } from './claims';
import { AlgorithmDef, RunFn } from './types';

const CPP = `void bubbleSort(vector<int>& arr) {
    int n = arr.size();

    for (int i = 0; i < n - 1; i++) {
        bool swapped = false;

        for (int j = 0; j < n - i - 1; j++) {
            if (arr[j] > arr[j + 1]) {
                swap(arr[j], arr[j + 1]);
                swapped = true;
            }
        }

        if (!swapped)
            break;
    }
}`;

const C = `void bubbleSort(int arr[], int size) {
    int n = size;

    for (int i = 0; i < n - 1; i++) {
        int swapped = 0;

        for (int j = 0; j < n - i - 1; j++) {
            if (arr[j] > arr[j + 1]) {
                int t = arr[j]; arr[j] = arr[j + 1]; arr[j + 1] = t;
                swapped = 1;
            }
        }

        if (!swapped)
            break;
    }
}`;

const JAVA = `void bubbleSort(int[] arr) {
    int n = arr.length;

    for (int i = 0; i < n - 1; i++) {
        boolean swapped = false;

        for (int j = 0; j < n - i - 1; j++) {
            if (arr[j] > arr[j + 1]) {
                int t = arr[j]; arr[j] = arr[j + 1]; arr[j + 1] = t;
                swapped = true;
            }
        }

        if (!swapped)
            break;
    }
}`;

/** Publish the two numbers that make the pass invariant checkable. */
function derive(t: Parameters<RunFn>[1], arr: number[], i: number) {
  if (!t.tracing) return;
  const n = arr.length;
  const boundary = n - i;
  let maxActive = -Infinity;
  for (let k = 0; k < boundary; k++) maxActive = Math.max(maxActive, arr[k]);
  let minSorted = Infinity;
  for (let k = boundary; k < n; k++) minSorted = Math.min(minSorted, arr[k]);
  t.derive({ maxActive, minSorted, boundary });
}

interface Opts {
  /** The buggy version never records that a swap happened. */
  setFlag: boolean;
  /** The buggy bound walks one index past the end of the unsorted region. */
  overrun: boolean;
}

function makeRun(opts: Opts): RunFn {
  return (input, t) => {
    const arr = (input.array ?? []).slice();
    // Kept so the result can be checked for having the same values it began
    // with — a sort that drops one is sorted and wrong.
    const original = arr.slice();
    t.array('arr', arr, 'arr');
    t.enter('bubbleSort', 'bubbleSort(arr)');

    const n = arr.length;
    let i: number | null = null;
    let j: number | null = null;
    let swapped: boolean | null = null;

    t.step(2, { n, i, j, swapped }, `The array has ${n} element${n === 1 ? '' : 's'}.`);

    for (i = 0; i < n - 1; i++) {
      derive(t, arr, i);
      t.step(4, { n, i, j, swapped }, () => `Pass ${(i as number) + 1}. The last ${i} element${i === 1 ? '' : 's'} ${i === 1 ? 'is' : 'are'} already final, so this pass only walks indices 0 to ${n - (i as number) - 1}.`);

      swapped = false;
      t.step(5, { n, i, j, swapped }, 'Assume nothing needs moving until proven otherwise.');

      const bound = n - i - (opts.overrun ? 0 : 1);
      for (j = 0; j < bound; j++) {
        t.tick();
        const right = arr[j + 1];
        const bigger = right === undefined ? false : arr[j] > right;
        t.step(
          8,
          { n, i, j, swapped },
          () =>
            right === undefined
              ? `Reading arr[${(j as number) + 1}] — one past the end of a ${n}-element array. In C++ that is undefined behaviour; here it simply yields nothing to compare against.`
              : `Compare arr[${j}] = ${arr[j as number]} against arr[${(j as number) + 1}] = ${right}. ${bigger ? 'Out of order — they need swapping.' : 'Already in order, leave them.'}`,
          ev.cmp(cell('arr', j), '>', cell('arr', j + 1), bigger),
        );

        if (bigger) {
          const a = arr[j];
          const b = arr[j + 1];
          arr[j] = b;
          arr[j + 1] = a;
          derive(t, arr, i);
          t.step(9, { n, i, j, swapped }, () => `Swap ${a} and ${b}. The larger value moves one place right — this is how the biggest value "bubbles" to the end.`, ev.swap('arr', j as number, (j as number) + 1));

          if (opts.setFlag) {
            swapped = true;
            t.step(10, { n, i, j, swapped }, 'Something moved, so this pass was not wasted.');
          }
        }
      }

      derive(t, arr, i + 1);
      t.step(14, { n, i, j, swapped }, () => (swapped ? `Pass ${(i as number) + 1} moved something, so another pass is needed. arr[${n - (i as number) - 1}] = ${arr[n - (i as number) - 1]} is now final.` : 'No swap was recorded during that pass, so the array is taken to be sorted. Stop early.'));

      if (!swapped) {
        t.step(15, { n, i, j, swapped }, 'Breaking out — no further passes can change anything.');
        break;
      }
    }

    t.derive({
      maxActive: null,
      minSorted: null,
      boundary: 0,
      // Two claims, because a sort that loses an element is also wrong:
      // the result must be in order *and* hold the same values it started
      // with. Checking only the first would pass an empty array.
      isSorted: sortedFlag(arr),
      kept: permutationFlag(arr, original),
    });
    t.step(17, { n, i, j, swapped }, () => `Result: [${arr.join(', ')}]`);
    t.exit();
    return arr.join(',');
  };
}

const run: RunFn = (input, t, mut) =>
  makeRun({
    setFlag: !mut.has('no-flag'),
    overrun: mut.has('overrun'),
  })(input, t, mut);

export const bubbleSort: AlgorithmDef = {
  slug: 'bubble-sort',
  name: 'Bubble Sort',
  category: 'sorting',
  tagline: 'Repeatedly swap neighbours until the largest values have floated to the end.',
  intuition: [
    'Walk the array comparing each pair of neighbours. Whenever a pair is out of order, swap them. One full pass does not sort the array — but it does guarantee one thing: the single largest value ends up at the far right, because nothing can stop it moving right on every comparison it wins.',
    'That guarantee is the algorithm. Each pass locks one more value into its final position, so the unsorted region shrinks by one every time.',
    'It is slow, and you will not use it in an interview. It is here because the sorted-tail invariant is the clearest introduction to the idea that a loop maintains a promise — the idea every later sorting algorithm depends on.',
  ],
  code: { cpp: CPP, c: C, java: JAVA },
  lens: {
    primary: 'arr',
    pointers: [{ var: 'j', on: 'arr', role: 'cursor', label: 'j', hint: 'Left element of the pair being compared.' }],
    regions: [
      { on: 'arr', kind: 'sorted', from: 'n - i', to: 'n - 1', label: 'final position' },
      { on: 'arr', kind: 'active', from: 0, to: 'n - i - 1', label: 'still unsorted' },
      { on: 'arr', kind: 'considering', from: 'j', to: 'j + 1', label: 'comparing' },
    ],
    invariant: {
      text: 'Every value in the sorted tail is at least as large as every value still unsorted.',
      check: 'i === 0 || maxActive <= minSorted',
      when: 'defined(maxActive) && defined(minSorted) && defined(i)',
      why: 'This is the promise each pass buys you. Once it holds for the last i slots, those slots never need to be touched again — which is exactly why the inner loop is allowed to stop early at n - i - 1.',
    },
    postcondition: {
      text: 'The whole array is in order, and holds exactly the values it started with.',
      check: 'isSorted === 1 && kept === 1',
      why: 'The loop invariant above is about progress: it says the part already settled is settled correctly. It is silent on whether the loop ran long enough, and a sort that stops one pass early satisfies it completely while returning an array that is not sorted. This is the claim the caller actually cares about, and it can only be judged once the function has finished.',
    },
  },
  run,
  defaultInput: { array: [5, 1, 4, 2, 8] },
  fields: [{ key: 'array', label: 'Array', kind: 'array', help: 'Any order. Try one that is already sorted.' }],
  makeInput: (n) => ({ array: Array.from({ length: n }, (_, k) => n - k) }),
  growthSizes: [8, 16, 32, 64, 128, 256, 512],
  projectTo: 100_000,
  complexity: {
    time: 'O(n²) worst and average, O(n) best',
    space: 'O(1)',
    note: 'Pass i does about n − i comparisons, and summing that over all passes gives roughly n²/2. The early-exit flag is what makes an already-sorted array cost only one pass.',
  },
  userLane: {
    fnName: 'bubbleSort',
    starters: {
      cpp: `void bubbleSort(vector<int>& arr) {
    int n = arr.size();

    for (int i = 0; i < n - 1; i++) {
        bool swapped = false;

        for (int j = 0; j < n - i - 1; j++) {
            if (arr[j] > arr[j + 1]) {
                swap(arr[j], arr[j + 1]);
                swapped = true;
            }
        }

        if (!swapped) break;
    }
}`,
      c: `void bubbleSort(int arr[], int n) {
    for (int i = 0; i < n - 1; i++) {
        int swapped = 0;

        for (int j = 0; j < n - i - 1; j++) {
            if (arr[j] > arr[j + 1]) {
                int tmp = arr[j];
                arr[j] = arr[j + 1];
                arr[j + 1] = tmp;
                swapped = 1;
            }
        }

        if (!swapped) break;
    }
}`,
      java: `void bubbleSort(int[] arr) {
    int n = arr.length;

    for (int i = 0; i < n - 1; i++) {
        boolean swapped = false;

        for (int j = 0; j < n - i - 1; j++) {
            if (arr[j] > arr[j + 1]) {
                int tmp = arr[j];
                arr[j] = arr[j + 1];
                arr[j + 1] = tmp;
                swapped = true;
            }
        }

        if (!swapped) break;
    }
}`,
      js: `function bubbleSort(arr) {
  let n = arr.length;

  for (let i = 0; i < n - 1; i++) {
    let swapped = false;

    for (let j = 0; j < n - i - 1; j++) {
      if (arr[j] > arr[j + 1]) {
        let tmp = arr[j];
        arr[j] = arr[j + 1];
        arr[j + 1] = tmp;
        swapped = true;
      }
    }

    if (!swapped) break;
  }
  return arr;
}`,
    },
    compareBy: 'array',
  },
  mutations: [
    {
      id: 'no-flag',
      edits: [
        { line: 10, from: 'swapped = true;', to: '// swapped = true;', langs: ['cpp', 'java'] },
        { line: 10, from: 'swapped = 1;', to: '// swapped = 1;', langs: ['c'] },
      ],
      label: 'never set swapped',
      note: 'The early-exit flag stays false, so the loop breaks after a single pass.',
    },
    {
      id: 'overrun',
      edits: [{ line: 7, from: 'j < n - i - 1;', to: 'j < n - i;' }],
      label: 'j < n - i',
      note: 'Reads arr[j + 1] one past the end on the first pass.',
    },
  ],
  variants: [
    {
      id: 'no-flag',
      label: 'swapped is never set',
      blurb: 'Returns an array that is still visibly out of order.',
      explanation:
        'The early-exit flag is only safe if something sets it when work happens. With the assignment missing, swapped is false at the end of the very first pass, the break fires, and the algorithm stops after moving only the single largest element into place. The optimisation silently became a correctness bug.',
      mutations: ['no-flag'],
    },
    {
      id: 'overrun',
      label: 'j < n - i',
      blurb: 'Sorts correctly, but reads one element past the end of the array.',
      explanation:
        'On the first pass j reaches n − 1, so arr[j + 1] reads index n — one past the last element. Here that read yields nothing and the output still looks right, which is precisely what makes this bug dangerous: in C++ it is undefined behaviour that will pass your tests and crash in production. The divergence in j is the only visible trace of it.',
      mutations: ['overrun'],
    },
  ],
  edgeCases: [
    { id: 'sorted', label: 'Already sorted', input: { array: [1, 2, 3, 4, 5] }, why: 'The best case. One pass, no swaps, early exit — this is the only reason bubble sort is ever O(n).' },
    { id: 'reversed', label: 'Reverse sorted', input: { array: [5, 4, 3, 2, 1] }, why: 'The worst case. Every pair is out of order on every pass.' },
    { id: 'dupes', label: 'All equal', input: { array: [3, 3, 3, 3] }, why: 'No swaps, because > is strict. Using >= here would swap equal elements and destroy stability.' },
    { id: 'single', label: 'One element', input: { array: [42] }, why: 'The outer loop condition i < n - 1 is never true. Nothing runs at all.' },
    { id: 'empty', label: 'Empty', input: { array: [] }, why: 'n - 1 is -1. Check that your loop bound does not go negative in a way that wraps.' },
  ],
  checkpoints: [
    computed({
      // Line 7 is the inner `for` header, which the trace does not step on;
      // line 5 is where a pass actually begins.
      where: { line: 5, nth: 1 },
      question: (step) => `Pass ${num(step, 'i') + 1} is starting. How many elements are already in their final position?`,
      answer: (step) => String(num(step, 'i')),
      options: (a, step) => [a, '0', String(num(step, 'i') + 1), String(num(step, 'n'))],
      because:
        'Each pass carries the largest remaining value all the way to the right, so after i passes the last i slots are settled and never touched again. That is why the inner loop stops earlier every time — it is not an optimisation bolted on, it is the shape of what the algorithm has already proved.',
    }),
    conceptual({
      where: { line: 14 },
      question: 'The flag says no swap happened in this whole pass. Why is it safe to stop entirely?',
      options: [
        'No swap means no neighbours are out of order, which means the array is sorted',
        'It means the largest element is in place',
        'It means only one pass remains',
        'It is a heuristic — it can stop too early',
      ],
      answer: 'No swap means no neighbours are out of order, which means the array is sorted',
      because:
        'Sortedness is exactly the statement that every adjacent pair is in order, and a pass with no swaps has just checked every adjacent pair. So the early exit is not a guess, it is a proof — which is why bubble sort is linear on already-sorted input while selection sort is not.',
    }),
    conceptual({
      where: { line: 8, nth: 2 },
      question: 'This comparison uses > rather than >=. What would change if it were >=?',
      options: [
        'Equal neighbours would be swapped, making the sort unstable',
        'Nothing — the result is identical',
        'It would fail to sort',
        'It would run faster',
      ],
      answer: 'Equal neighbours would be swapped, making the sort unstable',
      because:
        'The array still comes out sorted either way, so a test on numbers would never notice. Stability — equal items keeping their original relative order — only matters once the values carry something else along with them, and by then the swap has already thrown that order away.',
    }),
    {
      locate: (trace) => trace.steps.findIndex((s) => s.line === 14),
      question: () => 'This pass has just finished. Which array position is now guaranteed to hold its final value?',
      options: (trace, at) => {
        const v = trace.steps[at].vars;
        const n = Number(v.n);
        const i = Number(v.i);
        const correct = n - i - 1;
        const set = new Set<number>([correct, 0, correct - 1, n - 1]);
        return [...set].filter((x) => x >= 0).slice(0, 4).sort((a, b) => a - b).map((x) => `index ${x}`);
      },
      answer: (trace, at) => {
        const v = trace.steps[at].vars;
        return `index ${Number(v.n) - Number(v.i) - 1}`;
      },
      because: () =>
        'After pass i, the largest value among the first n − i elements has been carried all the way to the right end of that region. That is the last index the inner loop touched.',
    },
  ],
};
