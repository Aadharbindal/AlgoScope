import { AlgorithmDef, Input } from '../algorithms/types';
import { bySlug } from '../algorithms';

/**
 * Approach ladders.
 *
 * One problem, several implementations, in the order a person actually arrives
 * at them. The point is not the fastest one — that is on its own page already.
 * The point is that the rungs are *the same problem*, so the difference between
 * them is a difference in technique and nothing else, and each step up can be
 * pinned to one idea.
 *
 * That claim is checked rather than asserted: the smoke test runs every rung
 * against every other on a spread of inputs and fails if any two disagree. A
 * ladder whose rungs answered different questions would be a comparison of
 * nothing.
 */

export interface Rung {
  /** An algorithm that already exists in the catalogue. */
  slug: string;
  /** The approach in two or three words. */
  label: string;
  /** The one idea this rung adds to the one below it. */
  idea: string;
  /** What it costs, or what it still assumes. Every rung has something. */
  tradeoff: string;
}

export interface LadderDef {
  slug: string;
  name: string;
  /** The problem, stated once and independently of any approach. */
  problem: string;
  /** Why this particular climb is worth a reader's time. */
  why: string;
  rungs: Rung[];
  /**
   * One concrete input every rung is run on, so the operation counts beside
   * each other are counts of the same work.
   */
  compareInput: Input;
  /** Sizes the shared growth chart is measured at. */
  growthSizes: number[];
}

export const LADDERS: LadderDef[] = [
  {
    slug: 'maximum-subarray',
    name: 'Maximum Subarray',
    problem:
      'Given an array that may contain negative numbers, find the largest sum obtainable from any contiguous run of one or more elements.',
    why: 'This is the cleanest ladder in the subject, because the three rungs are three genuinely different kinds of thinking. The first is the definition written out. The second is the same search with the arithmetic tidied up — faster, but no new understanding. The third stops searching altogether and asks a different question, and that is the step worth studying. Notice that the middle rung is a thousand times faster than the first on an array of a thousand, and still loses to the third by another factor of a thousand.',
    rungs: [
      {
        slug: 'max-subarray-brute',
        label: 'Brute force',
        idea: 'Try every pair of endpoints, and add up what lies between them.',
        tradeoff: 'Unusable past a few hundred elements — but it is the definition of the problem, so it is what everything else is checked against.',
      },
      {
        slug: 'max-subarray-prefix',
        label: 'Running total',
        idea: 'Extending a subarray by one element costs one addition, not a whole re-sum.',
        tradeoff: 'A factor of n for free, with no new insight. Still considers every subarray, so still quadratic.',
      },
      {
        slug: 'maximum-subarray',
        label: "Kadane's",
        idea: 'A run that has gone negative can never help what follows, so abandon it and start fresh.',
        tradeoff: 'One pass, constant memory — but it reports the sum, and recovering the actual endpoints takes a little more bookkeeping.',
      },
    ],
    compareInput: { array: [-2, 1, -3, 4, -1, 2, 1, -5, 4, -2, 6, -3, 2, 8, -9, 1] },
    growthSizes: [8, 16, 32, 64, 128, 256],
  },

  {
    slug: 'search',
    name: 'Finding a Value',
    problem: 'Given an array and a target, return the index where the target sits, or -1 if it is absent.',
    why: 'Two rungs, and the whole lesson is in the gap between them. Binary search is not simply better — it buys its speed with an assumption, and if nothing has sorted the array first, that assumption is a bug rather than a precondition. Sorting costs O(n log n), so a single search on unsorted data is still linear search’s job; it is the second, hundredth and millionth search that pays the sort back.',
    rungs: [
      {
        slug: 'linear-search',
        label: 'Linear search',
        idea: 'Look at each element in turn until one matches.',
        tradeoff: 'Assumes nothing at all about the data, which is exactly why it cannot do better than looking at all of it.',
      },
      {
        slug: 'binary-search',
        label: 'Binary search',
        idea: 'On sorted data, one comparison rules out half of what is left.',
        tradeoff: 'Requires the array to be sorted. Getting it sorted costs more than a single linear search, so this only wins when you search repeatedly.',
      },
    ],
    compareInput: { array: [2, 5, 8, 12, 16, 23, 38, 45, 56, 72, 91, 99], target: 91 },
    growthSizes: [64, 256, 1024, 4096, 16384, 65536],
  },

  {
    slug: 'sorting',
    name: 'Sorting an Array',
    problem: 'Given an array, rearrange it so every element is less than or equal to the one after it.',
    why: 'Five rungs, and the first three are all quadratic — which is the useful surprise. Bubble, selection and insertion sort differ in how they move data and in what they cost on already-sorted input, but none of them escapes the n² barrier, because all three compare elements that are far apart only by walking past everything between them. Merge and quick sort break out by dividing the array first, and the jump in the chart is where the whole subject of algorithm design starts. Watch insertion sort on nearly-sorted input before dismissing the quadratic rungs, though: on that shape it beats both of the fast ones.',
    rungs: [
      {
        slug: 'bubble-sort',
        label: 'Bubble sort',
        idea: 'Repeatedly swap neighbours that are out of order until a pass changes nothing.',
        tradeoff: 'The most swaps of any rung here. Its one virtue is that it stops early on sorted input.',
      },
      {
        slug: 'selection-sort',
        label: 'Selection sort',
        idea: 'Find the smallest remaining element and put it where it belongs.',
        tradeoff: 'Exactly n − 1 swaps, the fewest of any rung — but it always makes every comparison, even on sorted input.',
      },
      {
        slug: 'insertion-sort',
        label: 'Insertion sort',
        idea: 'Keep a sorted prefix and slide each new element back into it.',
        tradeoff: 'Quadratic in the worst case, but linear on nearly-sorted input — which is why real sorts fall back to it for small ranges.',
      },
      {
        slug: 'merge-sort',
        label: 'Merge sort',
        idea: 'Sort each half, then walk the two sorted halves together in one pass.',
        tradeoff: 'O(n log n) on every input without exception, at the cost of a second array to merge into.',
      },
      {
        slug: 'quick-sort',
        label: 'Quick sort',
        idea: 'Partition around a pivot, then sort the two sides independently.',
        tradeoff: 'Sorts in place and is usually the fastest here, but a bad pivot makes it quadratic — the guarantee merge sort gives, it does not.',
      },
    ],
    compareInput: { array: [38, 27, 43, 3, 9, 82, 10, 55, 1, 74, 20, 66] },
    growthSizes: [16, 32, 64, 128, 256, 512],
  },
];

export const ladderBySlug = (slug: string): LadderDef | undefined =>
  LADDERS.find((l) => l.slug === slug);

/** Resolved rungs, skipping any whose algorithm has been removed. */
export function rungDefs(ladder: LadderDef): { rung: Rung; def: AlgorithmDef }[] {
  return ladder.rungs
    .map((rung) => ({ rung, def: bySlug(rung.slug) }))
    .filter((r): r is { rung: Rung; def: AlgorithmDef } => r.def !== undefined);
}

/** Ladders an algorithm appears on, so its own page can point at them. */
export function laddersFor(slug: string): LadderDef[] {
  return LADDERS.filter((l) => l.rungs.some((r) => r.slug === slug));
}
