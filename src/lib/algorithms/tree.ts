import { TreeNode } from '../trace/types';

/**
 * Build a binary search tree by inserting values in the order given.
 *
 * Insertion order is part of the input, not an implementation detail: the same
 * set of values inserted sorted gives a chain of depth n, and inserted
 * middle-out gives a balanced tree of depth log n. Both are legitimate trees
 * and the traversal is the same code — which is exactly the point a reader
 * should be able to discover by typing a sorted array into the box and watching
 * the picture become a diagonal line.
 */
export function buildBst(values: number[]): {
  nodes: Map<string, TreeNode>;
  root: string | null;
  /** Values actually in the tree, in sorted order. Duplicates are dropped. */
  sorted: number[];
} {
  const nodes = new Map<string, TreeNode>();
  let root: string | null = null;
  let next = 0;

  for (const value of values) {
    if (root === null) {
      const id = `n${next++}`;
      nodes.set(id, { id, value, left: null, right: null });
      root = id;
      continue;
    }

    let cursor = root;
    for (;;) {
      const node = nodes.get(cursor)!;
      // A repeated value is not inserted twice: a BST that holds duplicates
      // needs a rule for which side they go on, and inventing one here would
      // make the tree disagree with the sorted order an in-order walk claims.
      if (value === node.value) break;

      const side = value < node.value ? 'left' : 'right';
      const child = node[side];
      if (child === null) {
        const id = `n${next++}`;
        nodes.set(id, { id, value, left: null, right: null });
        nodes.set(cursor, { ...node, [side]: id });
        break;
      }
      cursor = child;
    }
  }

  const sorted = [...new Set(values)].sort((a, b) => a - b);
  return { nodes, root, sorted };
}

/**
 * An insertion order that produces a balanced tree from 1..n.
 *
 * Used for growth measurement. A sorted insertion would give a chain, and the
 * recursion depth alone would dominate what is supposed to be a measurement of
 * traversal cost — so the shape is stated here rather than left to chance.
 */
export function balancedOrder(n: number): number[] {
  const out: number[] = [];
  const walk = (lo: number, hi: number) => {
    if (lo > hi) return;
    const mid = lo + ((hi - lo) >> 1);
    out.push(mid);
    walk(lo, mid - 1);
    walk(mid + 1, hi);
  };
  walk(1, n);
  return out;
}
