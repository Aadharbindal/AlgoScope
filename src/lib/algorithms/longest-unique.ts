import { ev, vr } from '../trace/tracer';
import { computed, conceptual } from './checkpoints';
import { AlgorithmDef, Input, RunFn } from './types';

/**
 * A sliding window, and the reason the technique exists.
 *
 * The brute force asks the same question about every substring and re-reads
 * each one from its start. A window asks it once and then *repairs* the answer
 * as the ends move — which works only because the property in question
 * survives shrinking: a run of distinct characters stays distinct when you
 * drop the front of it. That is the condition a reader should learn to look
 * for, and it is stated here rather than left as a trick that happens to work.
 */

const CPP = `int longestUnique(string s) {
    unordered_map<char, int> seen;
    int best = 0, left = 0;

    for (int right = 0; right < s.size(); right++) {
        char c = s[right];

        if (seen.count(c) && seen[c] >= left)
            left = seen[c] + 1;

        seen[c] = right;

        if (right - left + 1 > best)
            best = right - left + 1;
    }

    return best;
}`;

const C = `int longestUnique(char* s, int n) {
    int seen[128]; for (int i = 0; i < 128; i++) seen[i] = -1;
    int best = 0, left = 0;

    for (int right = 0; right < n; right++) {
        int c = s[right];

        if (seen[c] >= left)
            left = seen[c] + 1;

        seen[c] = right;

        if (right - left + 1 > best)
            best = right - left + 1;
    }

    return best;
}`;

const JAVA = `int longestUnique(String s) {
    HashMap<Integer, Integer> seen = new HashMap<>();
    int best = 0, left = 0;

    for (int right = 0; right < s.length(); right++) {
        int c = s.charAt(right);

        if (seen.containsKey(c) && seen.get(c) >= left)
            left = seen.get(c) + 1;

        seen.put(c, right);

        if (right - left + 1 > best)
            best = right - left + 1;
    }

    return best;
}`;

const wordOf = (input: Input): string => {
  const v = input.word;
  return typeof v === 'string' ? v : '';
};

/** The definition, checked the slow way: every substring, tested for repeats. */
function reallyLongest(s: string): number {
  let best = 0;
  for (let i = 0; i < s.length; i++) {
    const seen = new Set<string>();
    for (let j = i; j < s.length; j++) {
      if (seen.has(s[j])) break;
      seen.add(s[j]);
      best = Math.max(best, j - i + 1);
    }
  }
  return best;
}

interface Opts {
  /** The buggy version moves left even for a repeat that is outside the window. */
  checkInWindow: boolean;
  /** The buggy version puts left on the repeat rather than past it. */
  pastRepeat: boolean;
}

function makeRun(opts: Opts): RunFn {
  return (input, t) => {
    const s = wordOf(input);
    const n = s.length;

    const seen = new Map<string, number>();
    let best = 0;
    let left = 0;
    let right = -1;
    /** Characters entering the window, and leaving it. Each may do so once. */
    let entered = 0;
    let leftMoves = 0;

    t.text('word', () => s, 'word');
    t.oracle({ truly: reallyLongest(s) });

    const distinct = () => {
      const inside = s.slice(left, right + 1);
      return new Set(inside).size === inside.length;
    };
    /**
     * Publish the window, and say when its promise is even in scope.
     *
     * Between the right edge advancing and the left edge catching up, the
     * window holds a character that has not been reacted to yet — so it may
     * legitimately contain a repeat for those two steps. Claiming otherwise
     * would report a correct run as broken, which is the one failure this
     * site cannot afford. The claim resumes the moment the left edge is
     * settled, which is also the moment the width becomes an answer.
     */
    const mark = (settled = true) => {
      if (!t.tracing) return;
      t.derive({
        width: right < left ? 0 : right - left + 1,
        allDistinct: settled ? (distinct() ? 1 : 0) : null,
        held: seen.size,
      });
    };

    t.enter('longestUnique', `longestUnique("${s}")`);
    mark();
    t.step(3, { left, right: null, best, n }, `A ${n}-character word. Grow a window on the right, and pull its left edge in whenever a character repeats.`, ev.call('longestUnique', `longestUnique("${s}")`));

    for (right = 0; right < n; right++) {
      mark(false);
      t.step(5, { left, right, best, n }, `The window's right edge moves to ${right}.`, ev.cmp(vr('right'), '<', vr('n'), true));
      t.tick();
      entered++;

      const c = s[right];
      mark(false);
      t.step(6, { left, right, best, n }, `The character there is "${c}".`);

      const at = seen.get(c);
      const repeatInside = at !== undefined && (opts.checkInWindow ? at >= left : true);
      mark(false);
      t.step(
        8,
        { left, right, best, n },
        at === undefined
          ? `"${c}" has not been seen at all, so the window is still free of repeats.`
          : repeatInside
            ? `"${c}" was last at ${at}, which is inside the window. The window has to give up everything up to and including it.`
            : `"${c}" was last at ${at}, which is behind the window's left edge — so it is not a repeat of anything currently inside.`,
        ev.cmp(vr('left'), '<=', vr('right'), repeatInside),
      );

      if (repeatInside) {
        left = opts.pastRepeat ? (at as number) + 1 : (at as number);
        leftMoves++;
        mark();
        t.step(9, { left, right, best, n }, `Move the left edge to ${left}.`);
      }

      seen.set(c, right);
      mark();
      t.step(11, { left, right, best, n }, `Record that "${c}" was last seen at ${right}.`, ev.write('word', right, c));

      const width = right - left + 1;
      const better = width > best;
      t.step(13, { left, right, best, n }, better ? `The window is ${width} wide, which beats ${best}.` : `The window is ${width} wide, which does not beat ${best}.`, ev.cmp(vr('right'), '>', vr('best'), better));

      if (better) {
        best = width;
        mark();
        t.step(14, { left, right, best, n }, `New best: ${best}.`);
      }
    }

    right = n - 1;
    t.derive({
      width: 0,
      allDistinct: 1,
      held: seen.size,
      answerOk: best === reallyLongest(s) ? 1 : 0,
      entered,
      leftMoves,
    });
    t.step(17, { left, right: null, best, n }, `The longest run of distinct characters is ${best} long.`, ev.ret('longestUnique', best));
    t.exit();
    return best;
  };
}

const run: RunFn = (input, t, mut) =>
  makeRun({
    checkInWindow: !mut.has('ignore-window'),
    pastRepeat: !mut.has('land-on-repeat'),
  })(input, t, mut);

export const longestUnique: AlgorithmDef = {
  slug: 'longest-unique',
  name: 'Longest Substring Without Repeats',
  category: 'strings',
  tagline: 'Grow a window on the right; pull its left edge past any repeat.',
  intuition: [
    'The question is: how long can a run of characters be before one of them appears twice? The obvious approach is to try every starting point and walk forward until a repeat — which re-reads the same characters over and over.',
    'A sliding window does not restart. It keeps one range in hand, extends it to the right one character at a time, and when the new character is already inside the range, it drags the left edge forward to just past the earlier copy. Everything between the old and new left edge is discarded in one move rather than re-examined.',
    'That works because of a property worth naming: a range with no repeats stays a range with no repeats when you cut characters off the front. Shrinking can never introduce a duplicate. Techniques like this are only valid when that is true, and it is the first thing to check before reaching for a window.',
    'The map remembers where each character was last seen, which is what lets the left edge jump straight to the right place instead of creeping forward one character at a time.',
  ],
  code: { cpp: CPP, c: C, java: JAVA },
  lens: {
    primary: 'word',
    pointers: [
      { var: 'left', on: 'word', role: 'window-start', label: 'left', hint: 'First character still inside the window.' },
      { var: 'right', on: 'word', role: 'window-end', label: 'right', hint: 'Newest character in the window.' },
    ],
    regions: [
      { on: 'word', kind: 'eliminated', from: 0, to: 'left - 1', label: 'dropped out of the window' },
      { on: 'word', kind: 'active', from: 'left', to: 'right', label: 'the window' },
    ],
    invariant: {
      text: 'The characters inside the window are all different.',
      check: 'allDistinct === 1',
      when: 'defined(allDistinct)',
      why: 'This is the only reason the width of the window is worth reporting: it is an answer to the question only while the property holds. It is checked against the string directly rather than trusted from the map, because the map is exactly the thing a bug would have got wrong — and a window that quietly contains a repeat still has a width, still beats the previous best, and still returns a number.',
    },
    postcondition: {
      text: 'The answer is the length of the longest run of distinct characters in the word.',
      check: 'answerOk === 1',
      why: 'Checked by trying every substring and testing it for repeats — the quadratic version this algorithm exists to replace. That is what a postcondition is for: it states what the answer means using the most obvious method available, and is not a cleverer second attempt at the same optimisation.',
    },
    cost: {
      text: 'Each character enters the window once, and the left edge only ever moves forward.',
      check: 'entered <= n && leftMoves <= n',
      why: 'A sliding window is worth using because both edges only travel in one direction, so the total work is one pass however often the window shrinks. That is invisible in the answer — the quadratic version returns the same number. A left edge that could move backwards, or a window that re-read what it had already dropped, would still be correct and would have thrown away the entire reason for the technique.',
    },
  },
  run,
  defaultInput: { word: 'abcabcbb' },
  fields: [
    { key: 'word', label: 'Word', kind: 'text', help: 'Compared exactly as typed. Try one with a repeat far from the front.' },
  ],
  makeInput: (n) => ({
    word: Array.from({ length: n }, (_, i) => 'abcdefghijklmnop'[i % 16]).join(''),
  }),
  growthSizes: [16, 32, 64, 128, 256, 512],
  projectTo: 1_000_000,
  complexity: {
    time: 'O(n)',
    space: 'O(1) for a fixed alphabet — one map entry per distinct character, of which there are at most as many as the alphabet holds',
    note: 'One pass, because neither edge ever moves backwards — the right edge advances n times and the left edge advances at most n times in total, however many separate jumps that takes. The space measures flat, and that is the honest reading rather than a convenient one: the map holds one entry per *distinct* character, so it is bounded by the alphabet and not by the length of the input. Feed it a longer word from the same letters and the map does not grow.',
  },
  userLane: {
    fnName: 'longestUnique',
    compareBy: 'return',
    binds: 'word',
    starters: {
      cpp: `int longestUnique(string s) {
    unordered_map<int, int> seen;
    int best = 0, left = 0;

    for (int right = 0; right < s.size(); right++) {
        int c = s[right];

        if (seen.count(c) && seen[c] >= left)
            left = seen[c] + 1;

        seen[c] = right;

        if (right - left + 1 > best)
            best = right - left + 1;
    }

    return best;
}`,
      c: `int longestUnique(char* s, int n) {
    int seen[128]; for (int i = 0; i < 128; i++) seen[i] = -1;
    int best = 0, left = 0;

    for (int right = 0; right < n; right++) {
        int c = s[right];

        if (seen[c] >= left)
            left = seen[c] + 1;

        seen[c] = right;

        if (right - left + 1 > best)
            best = right - left + 1;
    }

    return best;
}`,
      java: `int longestUnique(String s) {
    HashMap<Integer, Integer> seen = new HashMap<>();
    int best = 0, left = 0;

    for (int right = 0; right < s.length(); right++) {
        int c = s.charAt(right);

        if (seen.containsKey(c) && seen.get(c) >= left)
            left = seen.get(c) + 1;

        seen.put(c, right);

        if (right - left + 1 > best)
            best = right - left + 1;
    }

    return best;
}`,
      js: `function longestUnique(s) {
  const seen = new Map();
  let best = 0;
  let left = 0;

  for (let right = 0; right < s.length; right++) {
    const c = s[right];

    if (seen.has(c) && seen.get(c) >= left) left = seen.get(c) + 1;

    seen.set(c, right);

    if (right - left + 1 > best) best = right - left + 1;
  }

  return best;
}`,
    },
  },
  mutations: [
    {
      id: 'ignore-window',
      edits: [
        { line: 8, from: 'if (seen.count(c) && seen[c] >= left)', to: 'if (seen.count(c))', langs: ['cpp'] },
        { line: 8, from: 'if (seen[c] >= left)', to: 'if (seen[c] >= 0)', langs: ['c'] },
        { line: 8, from: 'if (seen.containsKey(c) && seen.get(c) >= left)', to: 'if (seen.containsKey(c))', langs: ['java'] },
      ],
      label: 'ignore where the repeat was',
      note: 'Moves the left edge for any earlier copy, even one already outside the window.',
    },
    {
      id: 'land-on-repeat',
      edits: [
        { line: 9, from: 'left = seen[c] + 1;', to: 'left = seen[c];', langs: ['cpp', 'c'] },
        { line: 9, from: 'left = seen.get(c) + 1;', to: 'left = seen.get(c);', langs: ['java'] },
      ],
      label: 'land on the repeat, not past it',
      note: 'Leaves the earlier copy inside the window, so the window still contains a duplicate.',
    },
  ],
  variants: [
    {
      id: 'land-on-repeat',
      label: 'The left edge stops on the repeat',
      blurb: 'The window still contains a duplicate, and its width is reported as an answer.',
      explanation:
        'Moving left to the earlier copy leaves that copy inside the window rather than behind it — so the window has a repeat in it and is no longer an answer to the question. The invariant catches this at the step it happens, which is the point of having one: the returned number is often only one too large, and would be very easy to accept.',
      mutations: ['land-on-repeat'],
    },
    {
      id: 'ignore-window',
      label: 'Any earlier copy moves the left edge',
      blurb: 'The window shrinks for repeats that are not in it.',
      explanation:
        'The map remembers every character ever seen, not only those currently inside the window. A copy that sits behind the left edge is not a repeat of anything in the window, and reacting to it drags the left edge backwards past characters that were perfectly fine — which makes the answer too small and, worse, makes the left edge move in both directions.',
      mutations: ['ignore-window'],
    },
  ],
  edgeCases: [
    { id: 'default', label: 'abcabcbb', input: { word: 'abcabcbb' }, why: 'The textbook case: the window grows to three, then repeats force it forward repeatedly.' },
    { id: 'far-repeat', label: 'A repeat left behind', input: { word: 'abba' }, why: 'The exact case that separates the two bugs. When the second "a" arrives, the first is already outside the window — reacting to it is wrong.' },
    { id: 'all-same', label: 'All the same', input: { word: 'bbbb' }, why: 'The window never gets past one character. Every step is a repeat.' },
    { id: 'all-distinct', label: 'No repeats at all', input: { word: 'abcdef' }, why: 'The left edge never moves and the window is the whole word.' },
    { id: 'single', label: 'One character', input: { word: 'z' }, why: 'One step, and the answer is one.' },
    { id: 'empty', label: 'Empty string', input: { word: '' }, why: 'The loop never runs. The longest run of distinct characters in nothing is zero, which is what best is initialised to.' },
    { id: 'spaces', label: 'With spaces', input: { word: 'a bb a' }, why: 'A space is a character like any other, and here it is the one that repeats.' },
  ],
  checkpoints: [
    conceptual({
      where: { line: 8, nth: 2 },
      question: 'Why is it not enough to know that this character has been seen before?',
      options: [
        'Because it may have been seen outside the window, where it is not a repeat',
        'Because the map may be stale',
        'Because characters can only repeat once',
        'It is enough — the extra test is redundant',
      ],
      answer: 'Because it may have been seen outside the window, where it is not a repeat',
      because:
        'The map remembers everything the whole pass has seen; the window is only the part still in play. A character last seen behind the left edge is not inside the window, so it repeats nothing — and reacting to it would drag the left edge backwards over characters that were fine.',
    }),
    conceptual({
      where: { line: 9, nth: 1 },
      question: 'Everything between the old left edge and the repeat is dropped in one move. Why is that safe?',
      options: [
        'Because any window containing both copies has a repeat, so none of them can be the answer',
        'Because those characters are all duplicates',
        'Because the answer is always found later',
        'It is not safe — they should be re-examined',
      ],
      answer: 'Because any window containing both copies has a repeat, so none of them can be the answer',
      because:
        'Every range that starts before the earlier copy and reaches the current character contains that character twice, so all of them are disqualified at once. That is what makes this one move instead of a re-scan, and it is the same shape of argument binary search makes when it discards half a range.',
    }),
    computed({
      where: { line: 13, nth: 3 },
      question: (step) => `The window runs from ${step.vars.left} to ${step.vars.right}. How wide is it?`,
      answer: (step) => String(Number(step.vars.right) - Number(step.vars.left) + 1),
      options: (answer) => {
        const w = Number(answer);
        return [String(w), String(w + 1), String(Math.max(0, w - 1)), String(w + 2)];
      },
      because:
        'The width is right − left + 1, and it is the only quantity this algorithm ever compares against the best so far. Off by one here and the reported answer is off by one, on every input, in a way no example would obviously reveal.',
    }),
  ],
};
