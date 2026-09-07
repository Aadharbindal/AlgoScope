import { binarySearch } from './binary-search';
import { cycleDetection } from './cycle-detection';
import { dijkstra } from './dijkstra';
import { editDistance } from './edit-distance';
import { graphBfs } from './graph-bfs';
import { graphDfs } from './graph-dfs';
import { topologicalSort } from './topological-sort';
import { gridBfs } from './grid-bfs';
import { inorderTraversal } from './inorder-traversal';
import { insertionSort } from './insertion-sort';
import { kadane } from './kadane';
import { levelOrder } from './level-order';
import { linearSearch } from './linear-search';
import { quickSort } from './quick-sort';
import { selectionSort } from './selection-sort';
import { twoSumHash } from './two-sum-hash';
import { twoSumSorted } from './two-sum-sorted';
import { bubbleSort } from './bubble-sort';
import { maxSubarrayBrute } from './max-subarray-brute';
import { maxSubarrayPrefix } from './max-subarray-prefix';
import { mergeSort } from './merge-sort';
import { nextGreaterElement } from './next-greater-element';
import { reverseLinkedList } from './reverse-linked-list';
import { reverseLinkedListRecursive } from './reverse-linked-list-recursive';
import { AlgorithmDef, Category } from './types';

export const ALGORITHMS: AlgorithmDef[] = [
  linearSearch,
  binarySearch,
  twoSumSorted,
  twoSumHash,
  nextGreaterElement,
  bubbleSort,
  selectionSort,
  insertionSort,
  mergeSort,
  quickSort,
  reverseLinkedList,
  reverseLinkedListRecursive,
  cycleDetection,
  maxSubarrayBrute,
  maxSubarrayPrefix,
  kadane,
  inorderTraversal,
  levelOrder,
  gridBfs,
  graphBfs,
  graphDfs,
  topologicalSort,
  dijkstra,
  editDistance,
];

export const bySlug = (slug: string): AlgorithmDef | undefined =>
  ALGORITHMS.find((a) => a.slug === slug);

export const CATEGORY_LABEL: Record<Category, string> = {
  searching: 'Searching',
  sorting: 'Sorting',
  'linked-list': 'Linked lists',
  trees: 'Trees',
  graphs: 'Graphs',
  dp: 'Dynamic programming',
};

export const CATEGORY_ORDER: Category[] = [
  'searching',
  'sorting',
  'linked-list',
  'trees',
  'graphs',
  'dp',
];

export function grouped(): { category: Category; label: string; items: AlgorithmDef[] }[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    label: CATEGORY_LABEL[category],
    items: ALGORITHMS.filter((a) => a.category === category),
  })).filter((g) => g.items.length > 0);
}

export * from './types';
