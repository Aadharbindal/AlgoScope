import { cell, ev, vr } from '../trace/tracer';
import { Scalar } from '../trace/types';
import { conceptual } from './checkpoints';
import { AlgorithmDef, RunFn } from './types';

const CPP = `vector<int> twoSum(vector<int>& arr, int target) {
    unordered_map<int, int> seen;
    int n = arr.size();
    for (int i = 0; i < n; i++) {
        int need = target - arr[i];

        if (seen.count(need)) {
            return {seen[need], i};
        }

        seen[arr[i]] = i;
    }

    return {-1, -1};
}`;

const C = `int* twoSum(int arr[], int n, int target) {
    static int out[2];
    int seen[4096];  for (int k = 0; k < 4096; k++) seen[k] = -1;
    for (int i = 0; i < n; i++) {
        int need = target - arr[i];

        if (need >= 0 && need < 4096 && seen[need] >= 0) {
            out[0] = seen[need]; out[1] = i; return out;
        }

        if (arr[i] >= 0 && arr[i] < 4096) seen[arr[i]] = i;
    }

    out[0] = -1; out[1] = -1; return out;
}`;

const JAVA = `int[] twoSum(int[] arr, int target) {
    HashMap<Integer, Integer> seen = new HashMap<>();
    int n = arr.length;
    for (int i = 0; i < n; i++) {
        int need = target - arr[i];

        if (seen.containsKey(need)) {
            return new int[] {seen.get(need), i};
        }

        seen.put(arr[i], i);
    }

    return new int[] {-1, -1};
}`;

/** The answer, found independently so the trace has something to be checked against. */
function truePair(arr: number[], target: number): string {
  const seen = new Map<number, number>();
  for (let i = 0; i < arr.length; i++) {
    const need = target - arr[i];
    if (seen.has(need)) return `${seen.get(need)},${i}`;
    if (!seen.has(arr[i])) seen.set(arr[i], i);
  }
  return '-1,-1';
}

const run: RunFn = (input, t, mut) => {
  const arr = (input.array ?? []).slice();
  const target = Number(input.target ?? 0);
  const n = arr.length;

  const seen = new Map<number, number>();
  const keys: Scalar[] = [];

  t.array('arr', arr, 'arr');
  t.seq('seen', keys, 'flow', 'values already recorded');
  t.aux('seen', () => seen.size);
  t.oracle({ answer: truePair(arr, target), target });

  const flipSign = mut.has('flip-sign');
  const swapKeyValue = mut.has('swap-key-value');

  // What the map is supposed to contain: every value already passed, keyed by
  // the value and not by the index. Checked after every insert.
  const recheck = (upto: number) => {
    const want = new Set(arr.slice(0, upto));
    const got = new Set(seen.keys());
    const same = want.size === got.size && [...want].every((v) => got.has(v));
    t.derive({ mapped: same ? 1 : 0 });
  };

  /** One pass over the array, and one lookup inside it, per element. */
  let passes = 0;
  let lookups = 0;

  t.enter('twoSum', `twoSum(arr, ${target})`);
  t.step(2, { n, i: null, need: null, target, held: 0 }, 'The map starts empty. It will hold every value already passed, and where it was.');
  recheck(0);
  t.step(3, { n, i: null, need: null, target, held: 0 }, `${n} element${n === 1 ? '' : 's'} to walk, once.`);

  for (let i = 0; i < n; i++) {
    // One pass, one lookup. Both halves of that are the claim.
    passes++;
    t.step(4, { n, i, need: null, target, held: seen.size }, `At index ${i}, holding ${arr[i]}.`, ev.cmp(vr('i'), '<', vr('n'), true));

    const need = flipSign ? target + arr[i] : target - arr[i];
    t.step(5, { n, i, need, target, held: seen.size }, flipSign ? `Computed ${target} + ${arr[i]} = ${need} as the partner to look for.` : `To reach ${target}, this element needs a partner of ${need}.`, ev.read('arr', i));

    lookups++;
    const found = seen.has(need);
    t.step(7, { n, i, need, target, held: seen.size }, found ? `${need} is already in the map — it was at index ${seen.get(need)}.` : `${need} has not been seen yet.`, ev.cmp(cell('arr', i), '==', vr('need'), found));

    if (found) {
      const answer = `${seen.get(need)},${i}`;
      const at = Number(seen.get(need));
      // Two distinct indices whose values really add up — the whole promise.
      t.derive({ pairOk: at !== i && arr[at] + arr[i] === target ? 1 : 0, passes, lookups });
      t.step(8, { n, i, need, target, held: seen.size }, `Indices ${seen.get(need)} and ${i} hold ${need} and ${arr[i]}, which sum to ${target}.`, ev.found('arr', i));
      t.exit();
      return answer;
    }

    // Storing the index against the value is the whole idea; storing it the
    // other way round makes the map answer a question nobody asked.
    if (swapKeyValue) {
      seen.set(i, arr[i]);
      keys.push(i);
    } else if (!seen.has(arr[i])) {
      seen.set(arr[i], i);
      keys.push(arr[i]);
    }
    recheck(i + 1);
    t.step(11, { n, i, need, target, held: seen.size }, swapKeyValue ? `Recorded index ${i} as the key and ${arr[i]} as the value — the wrong way round.` : `Record that ${arr[i]} was seen at index ${i}.`, ev.write('arr', i, arr[i]));
  }

  t.exit();
  t.derive({ pairOk: truePair(arr, target) === '-1,-1' ? 1 : 0, passes, lookups });
  t.step(14, { n, i: null, need: null, target, held: seen.size }, 'Every element has been passed and no partner was ever waiting. There is no pair.', ev.fail('no pair sums to the target'));
  return '-1,-1';
};

/** Distinct values with no pair reaching the target — the full-scan case. */
function noPair(n: number): { array: number[]; target: number } {
  return { array: Array.from({ length: n }, (_, i) => i * 2), target: 1 };
}

export const twoSumHash: AlgorithmDef = {
  slug: 'two-sum-hash',
  name: 'Two Sum (unsorted, with a map)',
  category: 'searching',
  tagline: 'One pass over unsorted data, remembering everything already seen.',
  intuition: [
    'The two-pointer version needs a sorted array, and sorting costs more than the search does. A hash map buys the same linear scan without that precondition — it trades memory for the assumption.',
    'The idea is to stop asking "is there a pair" and start asking "have I already seen the partner this element needs". That question has a one-line answer if every value passed so far is written down, and writing them down is the only extra work.',
    'Watch the map fill rather than the array. Each element asks its question and then joins the record, so by the time a pair exists, the second half of it does the finding — the first half has been sitting there waiting since it went in.',
  ],
  code: { cpp: CPP, c: C, java: JAVA },
  lens: {
    primary: 'arr',
    pointers: [{ var: 'i', on: 'arr', role: 'cursor', label: 'i', hint: 'The element asking the question.' }],
    regions: [
      { on: 'arr', kind: 'eliminated', from: 0, to: 'i - 1', label: 'recorded in the map' },
      { on: 'arr', kind: 'active', from: 'i', to: 'n - 1', label: 'not yet reached' },
    ],
    invariant: {
      text: 'The map holds exactly the values already passed, keyed by value.',
      check: 'mapped === 1',
      when: 'defined(mapped)',
      why: 'The lookup is only meaningful if the thing being looked up is what the map is keyed by. Key it by index instead and every operation still works — the map fills, the lookups run, the loop finishes — while the question being answered has quietly become "is there an index equal to the partner I need", which is a question about nothing.',
    },
    postcondition: {
      text: 'The two indices are different, and the values at them sum to the target — or there is no such pair.',
      check: 'pairOk === 1',
      why: 'A pair of indices is only an answer if it is a pair: two distinct positions whose values add up. Stating it this way catches the whole family of near-misses at once — an index paired with itself, a partner computed with the wrong sign, a lookup keyed by the wrong thing — none of which any loop invariant about the search notices, because each of them searches perfectly well for the wrong thing.',
    },
    cost: {
      text: 'One pass and one lookup per element: the array is never scanned a second time to find a partner.',
      check: 'lookups <= n && passes <= n',
      why: 'This is the only thing the map buys, and the sorted two-pointer version beside it returns exactly the same pair. What the map replaces is the inner loop — the partner is asked for once instead of searched for — and no property of the answer records whether that happened. A version that fell back to scanning would still find the pair and would no longer be this algorithm.',
    },
  },
  run,
  defaultInput: { array: [11, 15, 2, 7, 1, 8], target: 9 },
  fields: [
    { key: 'array', label: 'Array', kind: 'array', help: 'No order required — that is the point of this version.' },
    { key: 'target', label: 'Target', kind: 'number' },
  ],
  makeInput: (n) => noPair(n),
  growthSizes: [64, 128, 256, 512, 1024, 2048],
  projectTo: 1_000_000,
  complexity: {
    time: 'O(n)',
    space: 'O(n)',
    note: 'One pass, and one map lookup and insert per element — both constant on average. The space is the trade: the two-pointer version uses none but demands sorted input, and sorting costs O(n log n). Which is better depends entirely on whether the data arrives sorted.',
  },
  userLane: {
    fnName: 'twoSum',
    compareBy: 'return',
    starters: {
      cpp: `vector<int> twoSum(vector<int>& arr, int target) {
    unordered_map<int, int> seen;

    for (int i = 0; i < arr.size(); i++) {
        int need = target - arr[i];
        if (seen.count(need)) return {seen[need], i};
        seen[arr[i]] = i;
    }
    return {-1, -1};
}`,
      c: `int* twoSum(int arr[], int n, int target) {
    static int out[2];
    int seen[4096];
    for (int k = 0; k < 4096; k++) seen[k] = -1;

    for (int i = 0; i < n; i++) {
        int need = target - arr[i];
        if (need >= 0 && need < 4096 && seen[need] >= 0) {
            out[0] = seen[need]; out[1] = i; return out;
        }
        if (arr[i] >= 0 && arr[i] < 4096) seen[arr[i]] = i;
    }
    out[0] = -1; out[1] = -1; return out;
}`,
      java: `int[] twoSum(int[] arr, int target) {
    HashMap<Integer, Integer> seen = new HashMap<>();

    for (int i = 0; i < arr.length; i++) {
        int need = target - arr[i];
        if (seen.containsKey(need)) return new int[] {seen.get(need), i};
        seen.put(arr[i], i);
    }
    return new int[] {-1, -1};
}`,
      js: `function twoSum(arr, target) {
  const seen = new Map();
  for (let i = 0; i < arr.length; i++) {
    const need = target - arr[i];
    if (seen.has(need)) return seen.get(need) + ',' + i;
    if (!seen.has(arr[i])) seen.set(arr[i], i);
  }
  return '-1,-1';
}`,
    },
  },
  mutations: [
    {
      id: 'flip-sign',
      edits: [{ line: 5, from: 'int need = target - arr[i];', to: 'int need = target + arr[i];' }],
      label: 'target + arr[i]',
      note: 'Looks for a partner that would overshoot rather than complete the sum.',
    },
    {
      id: 'swap-key-value',
      edits: [
        { line: 11, from: 'seen[arr[i]] = i;', to: 'seen[i] = arr[i];', langs: ['cpp'] },
        { line: 11, from: 'if (arr[i] >= 0 && arr[i] < 4096) seen[arr[i]] = i;', to: 'if (i >= 0 && i < 4096) seen[i] = arr[i];', langs: ['c'] },
        { line: 11, from: 'seen.put(arr[i], i);', to: 'seen.put(i, arr[i]);', langs: ['java'] },
      ],
      label: 'key by index, not value',
      note: 'Records the index as the key, so the lookup asks about the wrong thing.',
    },
  ],
  variants: [
    {
      id: 'flip-sign',
      label: 'The partner is computed with a plus',
      blurb: 'Finds nothing, unless the array happens to contain the overshoot.',
      explanation:
        'One character, and the question changes from "what completes this sum" to "what is this far past the target". The loop runs to the end and returns not-found on almost every input — which reads as "there is no pair" rather than as a bug, and is the reason this survives a test that only checks the negative case.',
      mutations: ['flip-sign'],
    },
    {
      id: 'swap-key-value',
      label: 'The map is keyed by index',
      blurb: 'Fills a map, does the lookups, and answers a different question.',
      explanation:
        'Every mechanical part still works. The map fills, `count` is called once per element, the loop terminates, and on a small array it can even give the right answer by coincidence — indices and values overlap. What is gone is the correspondence between what is stored and what is asked for, which is the entire reason a map is the right structure here.',
      mutations: ['swap-key-value'],
    },
  ],
  edgeCases: [
    { id: 'default', label: 'The default input', input: { array: [11, 15, 2, 7, 1, 8], target: 9 }, why: 'The pair is 2 and 7, at indices 2 and 3 — found the moment 7 asks its question.' },
    { id: 'adjacent', label: 'The pair is first', input: { array: [4, 5, 9, 1], target: 9 }, why: 'Found on the second element, before the map has grown at all.' },
    { id: 'last', label: 'The pair is last', input: { array: [1, 2, 3, 4, 5], target: 9 }, why: 'The whole array is recorded before the answer appears. Worst case for both time and memory.' },
    { id: 'none', label: 'No pair exists', input: { array: [1, 2, 3], target: 100 }, why: 'The full scan, and the answer is that there is no answer.' },
    { id: 'duplicates', label: 'Duplicate values', input: { array: [3, 3, 4], target: 6 }, why: 'The two 3s are the pair. Only the first is recorded, which is exactly what lets the second find it.' },
    { id: 'self', label: 'Half the target appears once', input: { array: [4, 1, 9], target: 8 }, why: 'A single 4 must not pair with itself. Asking before recording is what prevents it.' },
    { id: 'negatives', label: 'Negative values', input: { array: [-3, 8, 5, -1], target: 4 }, why: 'A map has no trouble with negative keys. The C version, using an array as a table, does — which is the honest cost of not having a hash map.' },
  ],
  checkpoints: [
    conceptual({
      where: { line: 7, nth: 1 },
      question: 'The lookup happens before this element is recorded. Why does the order matter?',
      options: [
        'Otherwise an element could pair with itself',
        'Otherwise the map would be too large',
        'It does not matter — the answer is the same',
        'Otherwise the loop would not terminate',
      ],
      answer: 'Otherwise an element could pair with itself',
      because:
        'Record first and an element whose value is exactly half the target finds itself and returns the same index twice. Ask first and the map only contains things genuinely before it. Two lines whose order is the whole correctness argument — try swapping them on the input where half the target appears once.',
    }),
    conceptual({
      where: { line: 11, nth: 2 },
      question: 'The map is keyed by the value and stores the index. Why not the other way round?',
      options: [
        'Because the question being asked is about a value, not a position',
        'Because values are smaller than indices',
        'Because indices are not unique',
        'It works either way',
      ],
      answer: 'Because the question being asked is about a value, not a position',
      because:
        'A map answers lookups on its keys, so the key has to be the thing you have and the value the thing you want. Here you have a needed value and you want where it is. Getting this round the wrong way is a bug that runs perfectly and answers a question nobody asked.',
    }),
    conceptual({
      where: { line: 4, nth: 3 },
      question: 'The sorted two-pointer version of this problem uses no extra memory. What does this one buy with it?',
      options: [
        'The right to work on unsorted data in one pass',
        'A faster inner loop',
        'Fewer comparisons',
        'Nothing — it is strictly better',
      ],
      answer: 'The right to work on unsorted data in one pass',
      because:
        'Two pointers are cheaper in space and demand sorted input; sorting costs O(n log n), which is more than either search. So on data that arrives unsorted this wins, and on data that is already sorted — or that will be searched many times — the other one does. Neither is the better algorithm in the abstract.',
    }),
  ],
};
