/**
 * Does the user lane actually catch a broken implementation?
 *
 * The smoke test proves a correct starter is accepted, in all four languages.
 * This proves the other direction — that a plausible off-by-one is found, with
 * the smallest input that proves it — and that the C-family lane's claim to
 * real 32-bit `int` arithmetic is true rather than decorative.
 *
 * Run: npx tsx scripts/usercheck.ts
 */
import { bySlug } from '../src/lib/algorithms';
import { describeInput } from '../src/lib/algorithms/input';
import { UserLang } from '../src/lib/algorithms/types';
import { checkUserCode } from '../src/lib/usercode/check';
import { runUserIn } from '../src/lib/usercode/dispatch';

interface Case {
  slug: string;
  lang: UserLang;
  label: string;
  source: string;
}

const cases: Case[] = [
  {
    slug: 'binary-search',
    lang: 'js',
    label: 'classic off-by-one in the loop bound',
    source: `function binarySearch(arr, target) {
  let low = 0;
  let high = arr.length - 1;
  while (low < high) {
    let mid = low + Math.floor((high - low) / 2);
    if (arr[mid] === target) return mid;
    if (arr[mid] < target) { low = mid + 1; } else { high = mid - 1; }
  }
  return -1;
}`,
  },
  {
    slug: 'binary-search',
    lang: 'cpp',
    label: 'C++ — the same off-by-one',
    source: `int binarySearch(vector<int>& arr, int target) {
    int low = 0;
    int high = arr.size() - 1;
    while (low < high) {
        int mid = low + (high - low) / 2;
        if (arr[mid] == target) return mid;
        if (arr[mid] < target) low = mid + 1;
        else high = mid - 1;
    }
    return -1;
}`,
  },
  {
    slug: 'bubble-sort',
    lang: 'java',
    label: 'Java — early exit without ever setting the flag',
    source: `void bubbleSort(int[] arr) {
    int n = arr.length;
    for (int i = 0; i < n - 1; i++) {
        boolean swapped = false;
        for (int j = 0; j < n - i - 1; j++) {
            if (arr[j] > arr[j + 1]) {
                int t = arr[j];
                arr[j] = arr[j + 1];
                arr[j + 1] = t;
            }
        }
        if (!swapped) break;
    }
}`,
  },
  {
    slug: 'linear-search',
    lang: 'c',
    label: 'C — loop starts at 1',
    source: `int linearSearch(int arr[], int n, int target) {
    for (int i = 1; i < n; i++) {
        if (arr[i] == target) return i;
    }
    return -1;
}`,
  },
  {
    slug: 'selection-sort',
    lang: 'cpp',
    label: 'C++ — inner loop starts at i, not i + 1',
    source: `void selectionSort(vector<int>& arr) {
    int n = arr.size();
    for (int i = 0; i < n - 1; i++) {
        int minIdx = i;
        for (int j = i + 1; j < n; j++) {
            if (arr[j] > arr[minIdx]) minIdx = j;
        }
        if (minIdx != i) swap(arr[i], arr[minIdx]);
    }
}`,
  },
  {
    slug: 'maximum-subarray',
    lang: 'java',
    label: 'Java — best seeded with zero',
    source: `int maxSubarraySum(int[] arr) {
    int best = 0;
    int current = arr[0];
    for (int i = 1; i < arr.length; i++) {
        if (current + arr[i] < arr[i]) current = arr[i];
        else current = current + arr[i];
        if (current > best) best = current;
    }
    return best;
}`,
  },
  {
    slug: 'merge-sort',
    lang: 'cpp',
    // Note it is the *left* drain that matters. Dropping the right one is a
    // no-op: when the left half empties first, the leftover right elements are
    // already sitting in the positions they belong in, so copying them through
    // tmp writes them back where they were. Dropping the left drain is not —
    // its leftovers are the largest values and are stranded mid-array.
    label: 'C++ recursive — the left half never drains',
    source: `void merge(vector<int>& arr, int lo, int mid, int hi) {
    vector<int> tmp;
    int i = lo, j = mid + 1;

    while (i <= mid && j <= hi) {
        if (arr[i] <= arr[j]) tmp.push_back(arr[i++]);
        else tmp.push_back(arr[j++]);
    }

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
  },
  {
    slug: 'quick-sort',
    lang: 'java',
    label: 'Java recursive — the pivot is never put in place',
    source: `int partition(int[] arr, int lo, int hi) {
    int pivot = arr[hi];
    int i = lo - 1;

    for (int j = lo; j < hi; j++) {
        if (arr[j] <= pivot) {
            i++;
            int t = arr[i]; arr[i] = arr[j]; arr[j] = t;
        }
    }

    return i + 1;
}

void quickSort(int[] arr, int lo, int hi) {
    if (lo >= hi) return;

    int p = partition(arr, lo, hi);
    quickSort(arr, lo, p - 1);
    quickSort(arr, p + 1, hi);
}`,
  },
  {
    slug: 'inorder-traversal',
    lang: 'cpp',
    label: 'C++ recursive — the node is recorded before the left subtree, which is preorder',
    source: `struct Node {
    int val;
    Node* left;
    Node* right;
};

void walk(Node* node, vector<int>& out) {
    if (node == nullptr)
        return;

    out.push_back(node->val);
    walk(node->left, out);
    walk(node->right, out);
}

vector<int> inorder(Node* root) {
    vector<int> out;
    walk(root, out);
    return out;
}`,
  },
  {
    slug: 'level-order',
    lang: 'cpp',
    // The container is the algorithm. Everything else about this function is
    // right, and taking from the back turns it into a depth-first walk.
    label: 'C++ — a stack instead of a queue',
    source: `struct Node {
    int val;
    Node* left;
    Node* right;
};

vector<int> levelOrder(Node* root) {
    vector<int> out;
    stack<Node*> q;

    if (root != nullptr)
        q.push(root);

    while (!q.empty()) {
        Node* node = q.top();
        q.pop();

        out.push_back(node->val);

        if (node->left != nullptr) q.push(node->left);
        if (node->right != nullptr) q.push(node->right);
    }

    return out;
}`,
  },
  {
    slug: 'grid-bfs',
    lang: 'java',
    label: 'Java — cells come off the back, so the search stops being breadth-first',
    source: `int shortestPath(int[][] g, int rows, int cols) {
    int[][] dist = new int[rows][cols];
    Deque<Integer> q = new ArrayDeque<>();

    for (int[] row : dist) Arrays.fill(row, -1);

    if (g[0][0] == 1) return -1;

    dist[0][0] = 0;
    q.addLast(0);

    int[] dr = {-1, 1, 0, 0};
    int[] dc = {0, 0, -1, 1};

    while (!q.isEmpty()) {
        int cell = q.peekLast();
        q.pollLast();

        int r = cell / cols, c = cell % cols;

        if (r == rows - 1 && c == cols - 1)
            return dist[r][c];

        for (int k = 0; k < 4; k++) {
            int nr = r + dr[k], nc = c + dc[k];

            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols)
                continue;

            if (g[nr][nc] == 1 || dist[nr][nc] != -1)
                continue;

            dist[nr][nc] = dist[r][c] + 1;
            q.addLast(nr * cols + nc);
        }
    }

    return -1;
}`,
  },
  {
    slug: 'graph-bfs',
    lang: 'c',
    label: 'C — the source is never given a distance of zero',
    source: `int* bfs(int adj[][32], int deg[], int n, int src) {
    int dist[n];
    int q[64];
    int head = 0, tail = 0;

    for (int i = 0; i < n; i++) dist[i] = -1;

    q[tail] = src;
    tail = tail + 1;

    while (head < tail) {
        int u = q[head];
        head = head + 1;

        for (int k = 0; k < deg[u]; k++) {
            int v = adj[u][k];

            if (dist[v] != -1)
                continue;

            dist[v] = dist[u] + 1;
            q[tail] = v;
            tail = tail + 1;
        }
    }

    return dist;
}`,
  },
  {
    slug: 'topological-sort',
    lang: 'js',
    label: 'JavaScript — a node is queued the first time it is reached, not when it is ready',
    source: `function topoSort(adj, n) {
  let waiting = new Array(n).fill(0);
  let out = [];
  let q = [];

  for (let u = 0; u < n; u++)
    for (let k = 0; k < adj[u].length; k++) waiting[adj[u][k]]++;

  for (let u = 0; u < n; u++) if (waiting[u] === 0) q.push(u);

  while (q.length > 0) {
    let u = q.shift();
    out.push(u);

    for (let k = 0; k < adj[u].length; k++) {
      let v = adj[u][k];
      waiting[v]--;
      q.push(v);
    }
  }

  return out;
}`,
  },
  {
    slug: 'dijkstra',
    lang: 'cpp',
    label: 'C++ — a settled node can be settled again, so a longer route overwrites a shorter one',
    source: `vector<int> dijkstra(vector<vector<int>>& adj, vector<vector<int>>& wt, int n, int src) {
    int INF = 1000000000;
    vector<int> dist(n, INF);
    vector<int> done(n, 0);

    dist[src] = 0;

    for (int round = 0; round < n; round++) {
        int u = -1;
        for (int i = 0; i < n; i++)
            if (done[i] == 0 && (u == -1 || dist[i] > dist[u])) u = i;

        if (u == -1 || dist[u] == INF) break;
        done[u] = 1;

        for (int k = 0; k < adj[u].size(); k++) {
            int v = adj[u][k], w = wt[u][k];

            if (dist[u] + w < dist[v])
                dist[v] = dist[u] + w;
        }
    }

    return dist;
}`,
  },
  {
    slug: 'edit-distance',
    lang: 'java',
    label: 'Java — the top row is left at zero instead of counting insertions',
    source: `int editDistance(String a, String b) {
    int n = a.length(), m = b.length();
    int[][] dp = new int[n + 1][m + 1];

    for (int i = 0; i <= n; i++) dp[i][0] = i;

    for (int i = 1; i <= n; i++) {
        for (int j = 1; j <= m; j++) {
            if (a.charAt(i - 1) == b.charAt(j - 1))
                dp[i][j] = dp[i - 1][j - 1];
            else
                dp[i][j] = 1 + Math.min(dp[i - 1][j - 1],
                               Math.min(dp[i - 1][j], dp[i][j - 1]));
        }
    }

    return dp[n][m];
}`,
  },
];

let failures = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${msg}`);
  if (!cond) failures++;
};

for (const c of cases) {
  const def = bySlug(c.slug);
  if (!def?.userLane) {
    ok(false, `${c.slug}: has a user lane`);
    continue;
  }
  console.log(`\n=== ${def.name} [${c.lang}] — ${c.label} ===`);

  const verdict = checkUserCode(def, c.source, def.userLane, c.lang);
  const ce = verdict.counterexample;
  if (ce) {
    console.log(
      `  input ${describeInput(def, ce.input)} → yours ${ce.yours}, correct ${ce.correct}  (${ce.label})`,
    );
  }
  if (verdict.error) console.log(`  threw: ${verdict.error.message}`);
  ok(ce !== null && !verdict.error, 'a counterexample is found for the broken version');

  if (ce) {
    const r = runUserIn(def, c.source, c.lang, ce.input, def.userLane);
    ok(r.ok, `the broken version still traces on that input${r.ok ? '' : ` — ${r.message}`}`);
    if (r.ok) console.log(`  traced ${r.trace.steps.length} statements`);
  }
}

/* ------------------------------------------------------------------ */
/* The C-family lane's two structural claims, checked rather than asserted. */

const def = bySlug('binary-search')!;
const lane = def.userLane!;
/** Binary search's lane, pointed at a throwaway function name. */
const probe = { ...lane, fnName: 'probe' };

console.log('\n=== 32-bit int semantics ===');
{
  // (low + high) overflows a 32-bit int long before the array does. This is
  // the bug JavaScript structurally cannot reproduce: in JS the sum is simply
  // a bigger number and the search works.
  const overflowing = `int probe(vector<int>& arr, int target) {
    int low = 2000000000;
    int high = 2000000001;
    int mid = (low + high) / 2;
    return mid;
}`;
  const r = runUserIn(def, overflowing, 'cpp', { array: [1], target: 1 }, probe);
  ok(r.ok, `the overflow probe runs${r.ok ? '' : ` — ${r.message}`}`);
  if (r.ok) {
    console.log(`  (2000000000 + 2000000001) / 2  =  ${r.returned}`);
    ok(
      r.returned === -147483647,
      `midpoint wraps negative, as it does in C++ (got ${r.returned})`,
    );
    const wrapped = r.trace.steps.find((s) => s.narration.includes('int overflow'));
    ok(wrapped !== undefined, 'the step where it wrapped says so in plain words');
    if (wrapped) console.log(`  step ${wrapped.i}: ${wrapped.narration}`);
  }

  // The safe form, which is why everyone is told to write it this way.
  const safe = `int probe(vector<int>& arr, int target) {
    int low = 2000000000;
    int high = 2000000001;
    int mid = low + (high - low) / 2;
    return mid;
}`;
  const s = runUserIn(def, safe, 'cpp', { array: [1], target: 1 }, probe);
  ok(s.ok && s.returned === 2000000000, `low + (high - low) / 2 does not overflow (got ${s.ok ? s.returned : '—'})`);
}

console.log('\n=== counters are measured, not estimated ===');
{
  const r = runUserIn(def, lane.starters.cpp!, 'cpp', def.defaultInput, lane);
  ok(r.ok, 'the C++ starter runs');
  if (r.ok) {
    const last = r.trace.steps[r.trace.steps.length - 1].counters;
    console.log(
      `  comparisons ${last.comparisons}   reads ${last.reads}   writes ${last.writes}`,
    );
    ok(last.comparisons > 0, 'comparisons are counted (the JavaScript lane leaves these at zero)');
    ok(last.reads > 0, 'array reads are counted');
  }

  const js = runUserIn(def, lane.starters.js!, 'js', def.defaultInput, lane);
  ok(
    js.ok && js.trace.steps[js.trace.steps.length - 1].counters.comparisons === 0,
    'the JavaScript lane still reports zero, rather than guessing',
  );
}

console.log('\n=== recursion is traced, not just its outermost call ===');
{
  // This is the whole reason merge sort has a lane at all. The JavaScript lane
  // instruments source and hands it to the browser's own engine, and that
  // instrumenter does not follow calls into helpers — so merge sort would
  // trace only its outermost call and quietly look wrong. It is not offered
  // there, and this asserts that rather than trusting it.
  const merge = bySlug('merge-sort')!;
  const mlane = merge.userLane!;
  ok(mlane.starters.js === undefined, 'merge sort is not offered in the JavaScript lane');

  const r = runUserIn(merge, mlane.starters.cpp!, 'cpp', merge.defaultInput, mlane);
  ok(r.ok, `the recursive C++ starter runs${r.ok ? '' : ` — ${r.message}`}`);
  if (r.ok) {
    const depth = Math.max(...r.trace.steps.map((s) => s.frames.length));
    const inner = r.trace.steps.filter((s) => s.frames.some((f) => f.fn === 'merge')).length;
    console.log(
      `  ${r.trace.steps.length} statements · deepest call stack ${depth} · ${inner} inside merge()`,
    );
    ok(depth > 1, `the call stack really nests (deepest ${depth})`);
    ok(inner > 0, 'statements inside the helper are traced too');
  }
}

console.log('\n=== out-of-range access stops instead of inventing a value ===');
{
  const bad = `int probe(vector<int>& arr, int target) {
    return arr[arr.size()];
}`;
  const r = runUserIn(def, bad, 'cpp', { array: [1, 2, 3], target: 1 }, probe);
  ok(!r.ok, 'reading past the end is refused');
  if (!r.ok) console.log(`  ${r.message}`);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
