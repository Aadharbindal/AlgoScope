import { ev } from '../trace/tracer';
import { CELL_STATE, Scalar } from '../trace/types';
import { computed, conceptual } from './checkpoints';
import { AlgorithmDef, Input, RunFn } from './types';

const CPP = `int shortestPath(vector<vector<int>>& g) {
    int rows = g.size(), cols = g[0].size();
    vector<vector<int>> dist(rows, vector<int>(cols, -1));
    queue<pair<int, int>> q;

    dist[0][0] = 0;
    q.push({0, 0});

    int dr[] = {-1, 1, 0, 0};
    int dc[] = {0, 0, -1, 1};

    while (!q.empty()) {
        auto [r, c] = q.front();
        q.pop();

        if (r == rows - 1 && c == cols - 1)
            return dist[r][c];

        for (int k = 0; k < 4; k++) {
            int nr = r + dr[k], nc = c + dc[k];

            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols)
                continue;

            if (g[nr][nc] == 1 || dist[nr][nc] != -1)
                continue;

            dist[nr][nc] = dist[r][c] + 1;
            q.push({nr, nc});
        }
    }

    return -1;
}`;

const C = `int shortestPath(int g[][32], int rows, int cols) {
    int dist[32][32];
    for (int i = 0; i < rows * cols; i++) dist[i / cols][i % cols] = -1;
    int qr[1024], qc[1024], head = 0, tail = 0;

    dist[0][0] = 0;
    qr[tail] = 0; qc[tail] = 0; tail++;

    int dr[] = {-1, 1, 0, 0};
    int dc[] = {0, 0, -1, 1};

    while (head < tail) {
        int r = qr[head], c = qc[head];
        head++;

        if (r == rows - 1 && c == cols - 1)
            return dist[r][c];

        for (int k = 0; k < 4; k++) {
            int nr = r + dr[k], nc = c + dc[k];

            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols)
                continue;

            if (g[nr][nc] == 1 || dist[nr][nc] != -1)
                continue;

            dist[nr][nc] = dist[r][c] + 1;
            qr[tail] = nr; qc[tail] = nc; tail++;
        }
    }

    return -1;
}`;

const JAVA = `int shortestPath(int[][] g) {
    int rows = g.length, cols = g[0].length;
    int[][] dist = new int[rows][cols];
    Deque<int[]> q = new ArrayDeque<>();

    for (int[] row : dist) Arrays.fill(row, -1); dist[0][0] = 0;
    q.addLast(new int[] {0, 0});

    int[] dr = {-1, 1, 0, 0};
    int[] dc = {0, 0, -1, 1};

    while (!q.isEmpty()) {
        int[] cur = q.peekFirst(); int r = cur[0], c = cur[1];
        q.pollFirst();

        if (r == rows - 1 && c == cols - 1)
            return dist[r][c];

        for (int k = 0; k < 4; k++) {
            int nr = r + dr[k], nc = c + dc[k];

            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols)
                continue;

            if (g[nr][nc] == 1 || dist[nr][nc] != -1)
                continue;

            dist[nr][nc] = dist[r][c] + 1;
            q.addLast(new int[] {nr, nc});
        }
    }

    return -1;
}`;

const DR = [-1, 1, 0, 0];
const DC = [0, 0, -1, 1];
const SIDE = ['up', 'down', 'left', 'right'];

const gridOf = (input: Input): number[][] => {
  const g = input.grid;
  if (!Array.isArray(g) || g.length === 0) return [[0]];
  return (g as number[][]).map((row) => row.map((v) => (v ? 1 : 0)));
};

/** The true shortest distance, computed independently for the oracle. */
function bfsDistance(g: number[][]): number {
  const rows = g.length;
  const cols = g[0].length;
  const dist = g.map((row) => row.map(() => -1));
  if (g[0][0] === 1) return -1;
  dist[0][0] = 0;
  const q: [number, number][] = [[0, 0]];
  for (let head = 0; head < q.length; head++) {
    const [r, c] = q[head];
    if (r === rows - 1 && c === cols - 1) return dist[r][c];
    for (let k = 0; k < 4; k++) {
      const nr = r + DR[k];
      const nc = c + DC[k];
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      if (g[nr][nc] === 1 || dist[nr][nc] !== -1) continue;
      dist[nr][nc] = dist[r][c] + 1;
      q.push([nr, nc]);
    }
  }
  return -1;
}

const run: RunFn = (input, t, mut) => {
  const g = gridOf(input);
  const rows = g.length;
  const cols = g[0].length;

  const dist: number[][] = g.map((row) => row.map(() => -1));
  const state: number[][] = g.map((row) => row.map(() => CELL_STATE.unseen));
  const queue: Scalar[] = [];
  const cells: [number, number][] = [];
  let cursor: { r: number; c: number } | null = null;

  // The maze, the search state and the distances are three separate layers,
  // and the view keeps them separate: terrain in the cell value, progress in
  // the colour, computed distance in the number.
  t.grid('grid', g, state, {
    cursor: () => cursor,
    overlay: () => dist.map((row) => row.map((d) => (d < 0 ? null : d))),
    wall: 1,
    label: 'grid',
  });
  t.seq('queue', queue, 'queue', 'queue (front on the left)');
  // One distance per cell, plus whatever is queued. The distances dominate:
  // they are allocated up front and never released.
  t.aux('dist', () => rows * cols);
  t.aux('queue', () => queue.length);
  t.oracle({ answer: bfsDistance(g), cells: rows * cols });

  // Taking from the back makes this depth-first. It still reaches the goal, so
  // it still returns a number — just not the shortest one.
  const fromBack = mut.has('take-from-back');
  const noSeenCheck = mut.has('no-seen-check');

  /** Cells put on the queue. A cell is queued at most once. */
  let queued = 0;

  t.enter('shortestPath', `shortestPath(${rows}x${cols})`);
  t.step(2, { rows, cols, queued: 0, seen: 0 }, `A ${rows} by ${cols} grid. The goal is the bottom-right cell.`);

  if (g[0][0] === 1) {
    // This exit is as real as the others, so it publishes what the others do.
    // A claim derived on only some paths reads as broken on the rest.
    t.derive({ answerOk: bfsDistance(g) === -1 ? 1 : 0, queued });
    t.step(33, { rows, cols, queued: 0, seen: 0 }, 'The start itself is blocked, so nothing is reachable.', ev.fail('start is a wall'));
    t.exit();
    return -1;
  }

  dist[0][0] = 0;
  state[0][0] = CELL_STATE.frontier;
  cells.push([0, 0]);
  queued++;
  queue.push('0,0');
  t.step(6, { rows, cols, queued: 0, seen: 1 }, 'The start is zero steps from itself.');
  t.step(7, { rows, cols, queued: 1, seen: 1 }, 'Put the start in the queue. Everything else follows from it.', ev.push('queue', '0,0'));

  let answer = -1;
  let guard = 0;
  // The one thing breadth-first search promises, written so it can be checked:
  // cells come off the queue in non-decreasing order of distance. Every other
  // claim — that the first arrival is the shortest route, that the seen-check
  // is safe — is downstream of this one.
  let lastPopped = -1;
  let ordered = 1;

  while (cells.length > 0 && guard++ < 200_000) {
    t.step(12, { rows, cols, queued: cells.length, seen: countSeen(dist) }, `${cells.length} cell${cells.length === 1 ? '' : 's'} waiting to be expanded.`, ev.cmp({ kind: 'var', name: 'queued' }, '>', { kind: 'literal', value: 0 }, true));

    const at = fromBack ? cells.length - 1 : 0;
    const [r, c] = cells.splice(at, 1)[0];
    queue.splice(at, 1);
    cursor = { r, c };
    state[r][c] = CELL_STATE.visited;
    if (dist[r][c] < lastPopped) ordered = 0;
    lastPopped = dist[r][c];
    t.derive({ ordered });

    t.step(13, { rows, cols, r, c, d: dist[r][c], queued: cells.length + 1, seen: countSeen(dist) }, `Take (${r}, ${c}) off the ${fromBack ? 'back' : 'front'}. It is ${dist[r][c]} step${dist[r][c] === 1 ? '' : 's'} from the start.`);
    t.step(14, { rows, cols, r, c, d: dist[r][c], queued: cells.length, seen: countSeen(dist) }, 'Remove it from the queue so it is not expanded twice.', ev.pop('queue', `${r},${c}`));

    const atGoal = r === rows - 1 && c === cols - 1;
    t.step(16, { rows, cols, r, c, d: dist[r][c], queued: cells.length, seen: countSeen(dist) }, atGoal ? 'This is the goal.' : 'Not the goal yet.', ev.cmp({ kind: 'var', name: 'c' }, '==', { kind: 'literal', value: cols - 1 }, atGoal));

    if (atGoal) {
      answer = dist[r][c];
      // The claim the caller was given, against a distance computed separately.
      t.derive({ answerOk: answer === bfsDistance(g) ? 1 : 0 });
      t.step(17, { rows, cols, r, c, d: answer, queued: cells.length, seen: countSeen(dist) }, `Reached the goal in ${answer} steps.`, ev.found('grid', r * cols + c));
      break;
    }

    for (let k = 0; k < 4; k++) {
      const nr = r + DR[k];
      const nc = c + DC[k];
      t.step(20, { rows, cols, r, c, k, nr, nc, queued: cells.length, seen: countSeen(dist) }, `Look ${SIDE[k]} from (${r}, ${c}) — that would be (${nr}, ${nc}).`);

      const outside = nr < 0 || nr >= rows || nc < 0 || nc >= cols;
      t.step(22, { rows, cols, r, c, k, nr, nc, queued: cells.length, seen: countSeen(dist) }, outside ? 'That is off the edge of the grid.' : 'That is inside the grid.', ev.cmp({ kind: 'var', name: 'nr' }, '<', { kind: 'literal', value: 0 }, outside));
      if (outside) {
        t.step(23, { rows, cols, r, c, k, nr, nc, queued: cells.length, seen: countSeen(dist) }, 'Skip it.');
        continue;
      }

      const blocked = g[nr][nc] === 1;
      const already = dist[nr][nc] !== -1;
      const skip = blocked || (noSeenCheck ? false : already);
      t.step(
        25,
        { rows, cols, r, c, k, nr, nc, queued: cells.length, seen: countSeen(dist) },
        blocked
          ? `(${nr}, ${nc}) is a wall.`
          : already
            ? `(${nr}, ${nc}) already has a distance — it was reached earlier, by a route no longer than this one.`
            : `(${nr}, ${nc}) is open and has not been reached yet.`,
        ev.cmp({ kind: 'literal', value: 'g[nr][nc]' }, '==', { kind: 'literal', value: 1 }, blocked),
      );
      if (skip) {
        t.step(26, { rows, cols, r, c, k, nr, nc, queued: cells.length, seen: countSeen(dist) }, 'Skip it.');
        continue;
      }

      dist[nr][nc] = dist[r][c] + 1;
      if (state[nr][nc] !== CELL_STATE.visited) state[nr][nc] = CELL_STATE.frontier;
      t.step(28, { rows, cols, r, c, k, nr, nc, d: dist[nr][nc], queued: cells.length, seen: countSeen(dist) }, `(${nr}, ${nc}) is ${dist[nr][nc]} steps from the start — one more than (${r}, ${c}).`, ev.write('grid', nr * cols + nc, dist[nr][nc]));

      cells.push([nr, nc]);
      queued++;
      queue.push(`${nr},${nc}`);
      t.step(29, { rows, cols, r, c, k, nr, nc, d: dist[nr][nc], queued: cells.length, seen: countSeen(dist) }, 'Queue it behind everything already waiting.', ev.push('queue', `${nr},${nc}`));
    }
  }

  cursor = null;
  t.derive({ answerOk: answer === bfsDistance(g) ? 1 : 0, queued });
  if (answer === -1) {
    t.step(33, { rows, cols, queued: 0, seen: countSeen(dist) }, 'The queue emptied without ever reaching the goal — there is no route.', ev.fail('goal unreachable'));
  }
  t.exit();
  return answer;
};

const countSeen = (dist: number[][]) =>
  dist.reduce((total, row) => total + row.filter((d) => d >= 0).length, 0);

/** An open square grid of roughly `n` cells, for growth measurement. */
function openSquare(n: number): number[][] {
  const side = Math.max(2, Math.round(Math.sqrt(n)));
  return Array.from({ length: side }, () => Array.from({ length: side }, () => 0));
}

const MAZE = [
  [0, 0, 0, 0, 1, 0, 0, 0],
  [0, 1, 1, 0, 1, 0, 1, 0],
  [0, 0, 1, 0, 0, 0, 1, 0],
  [1, 0, 1, 1, 1, 0, 1, 0],
  [0, 0, 0, 0, 0, 0, 1, 0],
  [0, 1, 1, 1, 1, 0, 0, 0],
];

export const gridBfs: AlgorithmDef = {
  slug: 'grid-bfs',
  name: 'Shortest Path in a Grid (BFS)',
  category: 'graphs',
  tagline: 'Spread out one step at a time, and the first arrival is the shortest route.',
  intuition: [
    'A maze is a graph in disguise: every open cell is a node and every shared edge is a link. Once you see that, no maze-specific algorithm is needed — breadth-first search on a grid is breadth-first search.',
    'The whole guarantee rests on one thing: cells are expanded in the order they were queued, so everything one step away is finished before anything two steps away begins. The first time the goal is taken off the queue, no shorter route can still be waiting — because a shorter route would have been queued earlier.',
    'That is why the "already reached" check is not an optimisation. Reaching a cell a second time always costs at least as much as the first time, so keeping the first distance is not just faster, it is what makes the answer correct.',
  ],
  code: { cpp: CPP, c: C, java: JAVA },
  lens: {
    primary: 'grid',
    pointers: [],
    regions: [],
    invariant: {
      text: 'Cells come off the queue in non-decreasing order of distance.',
      check: 'ordered === 1',
      when: 'defined(ordered)',
      why: 'This is the property the queue exists to provide, and everything else rests on it. Because a cell is never expanded before a nearer one, the first time the goal is taken off the queue no shorter route can still be waiting — and reaching a cell a second time can only ever cost more, which is what makes the already-reached check safe rather than merely fast. Change one word so the search takes from the back and this fails immediately, while the code still looks like breadth-first search.',
    },
    postcondition: {
      text: 'The distance returned is the true length of a shortest route, or -1 when there is none.',
      check: 'answerOk === 1',
      why: 'The invariant is about the order nodes leave the queue, and a search that revisits nodes can still pop them in non-decreasing order while overwriting a correct distance with a longer one. This is the claim the caller was actually given, checked against distances computed separately from the run being judged.',
    },
    cost: {
      text: 'Every cell is queued at most once, so the search costs the size of the grid and not the number of routes through it.',
      check: 'queued <= n',
      why: 'The number of paths through an open grid grows exponentially with its size; the number of cells does not. Breadth-first search costs the second because a cell entered once is never entered again — and that is the entire reason this is tractable at all. A version that requeued cells returns the same distance on small mazes and is a different algorithm.',
    },
  },
  run,
  defaultInput: { grid: MAZE },
  fields: [
    {
      key: 'grid',
      label: 'Maze — click a cell to wall it off',
      kind: 'grid',
      help: 'S is the start and G is the goal; they cannot be walled. Block the short route and watch the search take the long one.',
    },
  ],
  validate: (input) => {
    const g = input.grid as number[][] | undefined;
    if (!Array.isArray(g) || g.length === 0) return 'The grid is empty.';
    const w = g[0]?.length ?? 0;
    if (w === 0) return 'The grid has no columns.';
    if (g.some((row) => row.length !== w)) return 'Every row must be the same length.';
    return null;
  },
  makeInput: (n) => ({ grid: openSquare(n) }),
  growthSizes: [64, 144, 256, 576, 1024, 2304, 4096],
  projectTo: 1_000_000,
  complexity: {
    time: 'O(n), where n is the number of cells',
    space: 'O(n)',
    note: 'Every cell is queued at most once, and each one looks at four neighbours — a constant. Measured on open square grids, where the goal is the farthest cell and the search has to cover almost everything. Walls make it cheaper, never dearer.',
  },
  userLane: {
    fnName: 'shortestPath',
    compareBy: 'return',
    binds: 'grid',
    starters: {
      cpp: `int shortestPath(vector<vector<int>>& g, int rows, int cols) {
    vector<vector<int>> dist(rows, vector<int>(cols, -1));
    queue<int> q;

    if (g[0][0] == 1) return -1;

    dist[0][0] = 0;
    q.push(0);

    int dr[] = {-1, 1, 0, 0};
    int dc[] = {0, 0, -1, 1};

    while (!q.empty()) {
        int cell = q.front();
        q.pop();

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
            q.push(nr * cols + nc);
        }
    }

    return -1;
}`,
      c: `int shortestPath(int g[][32], int rows, int cols) {
    int dist[rows][cols];
    int q[1024];
    int head = 0, tail = 0;

    for (int r = 0; r < rows; r++)
        for (int c = 0; c < cols; c++) dist[r][c] = -1;

    if (g[0][0] == 1) return -1;

    dist[0][0] = 0;
    q[tail] = 0;
    tail = tail + 1;

    int dr[] = {-1, 1, 0, 0};
    int dc[] = {0, 0, -1, 1};

    while (head < tail) {
        int cell = q[head];
        head = head + 1;

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
            q[tail] = nr * cols + nc;
            tail = tail + 1;
        }
    }

    return -1;
}`,
      java: `int shortestPath(int[][] g, int rows, int cols) {
    int[][] dist = new int[rows][cols];
    Deque<Integer> q = new ArrayDeque<>();

    for (int[] row : dist) Arrays.fill(row, -1);

    if (g[0][0] == 1) return -1;

    dist[0][0] = 0;
    q.addLast(0);

    int[] dr = {-1, 1, 0, 0};
    int[] dc = {0, 0, -1, 1};

    while (!q.isEmpty()) {
        int cell = q.peekFirst();
        q.pollFirst();

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
      js: `function shortestPath(g, rows, cols) {
  let dist = [];
  for (let r = 0; r < rows; r++) dist.push(new Array(cols).fill(-1));

  if (g[0][0] === 1) return -1;

  dist[0][0] = 0;
  let q = [0];

  const dr = [-1, 1, 0, 0];
  const dc = [0, 0, -1, 1];

  while (q.length > 0) {
    let cell = q.shift();
    let r = Math.floor(cell / cols);
    let c = cell % cols;

    if (r === rows - 1 && c === cols - 1) return dist[r][c];

    for (let k = 0; k < 4; k++) {
      let nr = r + dr[k];
      let nc = c + dc[k];

      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      if (g[nr][nc] === 1 || dist[nr][nc] !== -1) continue;

      dist[nr][nc] = dist[r][c] + 1;
      q.push(nr * cols + nc);
    }
  }

  return -1;
}`,
    },
  },
  mutations: [
    {
      id: 'take-from-back',
      edits: [
        { line: 13, from: 'q.front()', to: 'q.back()', langs: ['cpp'] },
        { line: 14, from: 'q.pop();', to: 'q.pop_back();', langs: ['cpp'] },
        { line: 13, from: 'qr[head], c = qc[head]', to: 'qr[tail - 1], c = qc[tail - 1]', langs: ['c'] },
        { line: 14, from: 'head++;', to: 'tail--;', langs: ['c'] },
        { line: 13, from: 'q.peekFirst()', to: 'q.peekLast()', langs: ['java'] },
        { line: 14, from: 'q.pollFirst();', to: 'q.pollLast();', langs: ['java'] },
      ],
      label: 'take from the back',
      note: 'Turns the queue into a stack, so the search dives instead of spreading.',
    },
    {
      id: 'no-seen-check',
      edits: [
        { line: 25, from: 'if (g[nr][nc] == 1 || dist[nr][nc] != -1)', to: 'if (g[nr][nc] == 1)' },
      ],
      label: 'drop the already-reached check',
      note: 'Lets a cell be reached again and overwritten with a longer distance.',
    },
  ],
  variants: [
    {
      id: 'take-from-back',
      label: 'Takes from the back of the queue',
      blurb: 'Still finds the goal. Reports a route that is longer than the shortest.',
      explanation:
        'This is depth-first search wearing breadth-first search’s clothes — one word changed, and the container is now a stack. It still reaches the goal, so it still returns a number, and on many mazes that number is even correct. The guarantee is what is gone: DFS commits to the first direction it tries and only backtracks when stuck, so the distance it records for the goal is whatever the first route it stumbled onto happened to cost. Watch the colours: the search dives down one corridor instead of spreading in a ring.',
      mutations: ['take-from-back'],
    },
    {
      id: 'no-seen-check',
      label: 'No already-reached check',
      blurb: 'Overwrites distances that were already correct.',
      explanation:
        'Without the check, a cell reached at distance 2 can be reached again from a neighbour at distance 5 and rewritten to 6. The first arrival was already the shortest — that is the property the queue gives you — so every later overwrite can only make it worse. The cost is real too: cells go back into the queue repeatedly, and the search stops being linear in the number of cells.',
      mutations: ['no-seen-check'],
    },
  ],
  edgeCases: [
    { id: 'maze', label: 'The default maze', input: { grid: MAZE }, why: 'One winding route. The search fills most of the grid before finding it.' },
    { id: 'open', label: 'No walls at all', input: { grid: Array.from({ length: 6 }, () => Array.from({ length: 8 }, () => 0)) }, why: 'The distances form clean diagonal bands — the ring of the frontier made visible.' },
    { id: 'wall', label: 'Sealed off', input: { grid: [[0, 0, 1, 0], [0, 0, 1, 0], [1, 1, 1, 0], [0, 0, 0, 0]] }, why: 'A wall cuts the grid in two, so the queue empties and the answer is -1.' },
    { id: 'corridor', label: 'One corridor', input: { grid: [[0, 1, 0, 0, 0], [0, 1, 0, 1, 0], [0, 0, 0, 1, 0], [1, 1, 1, 1, 0], [0, 0, 0, 0, 0]] }, why: 'Only one route exists, so breadth-first and depth-first agree — and the DFS bug becomes invisible.' },
    { id: 'tiny', label: 'One cell', input: { grid: [[0]] }, why: 'The start is the goal. The answer is 0 before any neighbour is examined.' },
    { id: 'blocked-start', label: 'Start is walled', input: { grid: [[1, 0], [0, 0]] }, why: 'Nothing is reachable, and the loop never runs. Only possible because this input bypasses the click editor.' },
  ],
  checkpoints: [
    conceptual({
      where: { line: 13, nth: 2 },
      question: 'Cells are taken from the front of the queue. What does that guarantee about the order they come out in?',
      options: [
        'Never farther from the start than the one before',
        'They are in row order',
        'The closest to the goal comes first',
        'Nothing in particular',
      ],
      answer: 'Never farther from the start than the one before',
      because:
        'This is the only property breadth-first search has, and everything else follows from it: the first time the goal is taken off the queue, no shorter route can still be waiting. Take from the back and every cell is still reached, the answer is still a number, and the guarantee is gone.',
    }),
    computed({
      where: { line: 28, nth: 1 },
      question: (step) => `Cell (${step.vars.nr}, ${step.vars.nc}) is being given a distance. Can it ever be given a different one later?`,
      answer: () => 'No — the first distance written is the shortest',
      options: (a) => [
        a,
        'Yes, if a shorter route is found',
        'Yes, if it is reached from a different direction',
        'Only if the grid has no walls',
      ],
      because:
        'Whoever writes a cell first came from a cell no farther from the start than anyone who arrives later, so no later route can be shorter. That is why the already-reached check is not a speed-up: overwriting could only ever make the answer worse.',
    }),
    conceptual({
      where: { line: 16, nth: 3 },
      question: 'The goal check happens when a cell is taken off the queue, not when it is first reached. Does that matter here?',
      options: [
        'Not for correctness, since the first arrival is already the shortest',
        'Yes — checking on arrival would give a wrong answer',
        'Yes — checking on arrival would loop forever',
        'It is required to be here for the queue to work',
      ],
      answer: 'Not for correctness, since the first arrival is already the shortest',
      because:
        'For unweighted breadth-first search either place gives the same distance, and checking on arrival even finishes slightly sooner. It stops being true the moment edges have weights: with Dijkstra a node can be reached long before its distance is final, and testing on arrival is then a real bug.',
    }),
    {
      locate: (trace) => trace.steps.findIndex((s) => s.line === 25 && s.narration.includes('already has a distance')),
      question: () =>
        'This neighbour already has a distance, so it is skipped. What would happen if it were updated instead?',
      options: () => [
        'The distance could only get larger, never smaller',
        'The distance would become more accurate',
        'Nothing — the value would be the same either way',
        'The search would finish sooner',
      ],
      answer: () => 'The distance could only get larger, never smaller',
      because: () =>
        'Cells come off the queue in non-decreasing order of distance, so whoever reached this cell first did so from a cell no farther from the start than the one asking now. Overwriting therefore replaces a correct answer with a worse one. The check is not a speed-up bolted on afterwards — it is where the correctness lives.',
    },
  ],
};
