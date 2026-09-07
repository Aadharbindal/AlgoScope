import { ev, vr } from '../trace/tracer';
import { computed, conceptual } from './checkpoints';
import { AlgorithmDef, Input, RunFn } from './types';

/**
 * Two pointers, on the smallest problem that needs them.
 *
 * The sorted two-sum on this site moves two pointers towards each other and
 * has to argue about why the one it moves is the right one. Here there is no
 * such argument: the two ends either match or they do not, and the pointers
 * step inwards regardless. That makes it the cleanest place to see what the
 * technique actually is — one pass, constant memory, from both ends at once —
 * before meeting a version where the choice of which pointer to move carries
 * the whole proof.
 */

const CPP = `bool isPalindrome(string s) {
    int left = 0;
    int right = s.size() - 1;

    while (left < right) {
        if (s[left] != s[right])
            return false;

        left++;
        right--;
    }

    return true;
}`;

const C = `int isPalindrome(char* s, int n) {
    int left = 0;
    int right = n - 1;

    while (left < right) {
        if (s[left] != s[right])
            return 0;

        left++;
        right--;
    }

    return 1;
}`;

const JAVA = `boolean isPalindrome(String s) {
    int left = 0;
    int right = s.length() - 1;

    while (left < right) {
        if (s.charAt(left) != s.charAt(right))
            return false;

        left++;
        right--;
    }

    return true;
}`;

const wordOf = (input: Input): string => {
  const v = input.word;
  return typeof v === 'string' ? v : '';
};

/** The definition, written the obvious way — a postcondition may be expensive. */
const reallyPalindrome = (s: string) => s === [...s].reverse().join('');

interface Opts {
  /** The buggy version stops when the pointers meet, not before they cross. */
  strictLess: boolean;
  /** The buggy version only advances one of the two pointers. */
  moveBoth: boolean;
}

function makeRun(opts: Opts): RunFn {
  return (input, t) => {
    const s = wordOf(input);
    const n = s.length;

    let left = 0;
    let right = n - 1;
    /** Character pairs actually compared, and the most that could be needed. */
    let compared = 0;

    t.text('word', () => s, 'word');
    t.oracle({ truly: reallyPalindrome(s) ? 1 : 0 });

    const mark = () => {
      if (!t.tracing) return;
      t.derive({
        // Everything already stepped over matched, which is the promise the
        // shrinking window carries. Checked against the string itself.
        outerMatch: [...Array(Math.max(0, left))].every((_, k) => s[k] === s[n - 1 - k]) ? 1 : 0,
      });
    };

    t.enter('isPalindrome', `isPalindrome("${s}")`);
    mark();
    t.step(1, { left: null, right: null, n }, `A ${n}-character word. A palindrome reads the same from either end, so compare the ends and work inwards.`, ev.call('isPalindrome', `isPalindrome("${s}")`));

    left = 0;
    mark();
    t.step(2, { left, right: null, n }, 'left starts at the first character.');

    right = n - 1;
    mark();
    t.step(3, { left, right, n }, `right starts at the last, index ${right}.`);

    let guard = 0;
    for (;;) {
      const keepGoing = opts.strictLess ? left < right : left <= right;
      t.step(
        5,
        { left, right, n },
        keepGoing
          ? `left is at ${left} and right at ${right}. There is still a pair to check.`
          : opts.strictLess
            ? left === right
              ? `left and right have met at ${left}. A single middle character is its own mirror, so there is nothing left to check.`
              : 'The pointers have crossed. Every pair matched.'
            : 'The pointers have crossed.',
        ev.cmp(vr('left'), opts.strictLess ? '<' : '<=', vr('right'), keepGoing),
      );
      if (!keepGoing || guard++ > 100_000) break;
      t.tick();

      compared++;
      const same = s[left] === s[right];
      t.step(6, { left, right, n }, `Compare "${s[left]}" at ${left} with "${s[right]}" at ${right}. ${same ? 'They match.' : 'They differ.'}`, ev.cmp(vr('left'), '==', vr('right'), same));

      if (!same) {
        t.derive({ verdict: reallyPalindrome(s) === false ? 1 : 0, compared, allowed: Math.floor(n / 2) });
        t.step(7, { left, right, n }, `"${s[left]}" is not "${s[right]}", so this is not a palindrome.`, ev.ret('isPalindrome', false));
        t.exit();
        return 'false';
      }

      left++;
      mark();
      t.step(9, { left, right, n }, `left moves in to ${left}.`);

      if (opts.moveBoth) {
        right--;
        mark();
        t.step(10, { left, right, n }, `right moves in to ${right}.`);
      } else {
        t.step(10, { left, right, n }, 'right stays where it is.');
      }
    }

    t.derive({ verdict: reallyPalindrome(s) === true ? 1 : 0, compared, allowed: Math.floor(n / 2) });
    t.step(13, { left, right, n }, 'Every pair matched, so it reads the same both ways.', ev.ret('isPalindrome', true));
    t.exit();
    return 'true';
  };
}

const run: RunFn = (input, t, mut) =>
  makeRun({ strictLess: !mut.has('meet-included'), moveBoth: !mut.has('left-only') })(input, t, mut);

export const palindrome: AlgorithmDef = {
  slug: 'palindrome',
  name: 'Palindrome Check',
  category: 'strings',
  tagline: 'Compare the two ends, then step both inwards.',
  intuition: [
    'A palindrome reads the same from either end. So put one finger on each end and compare: if those two characters differ, you are done — no palindrome, and you knew after one comparison.',
    'If they match, that pair is settled forever and you can forget it. Step both fingers inwards and ask the same question about a shorter word.',
    'That is the whole technique, and it is why this costs one pass and no extra memory. The obvious alternative — reverse the string and compare — gives the same answer and allocates a whole second string to do it.',
    'The one thing worth being careful about is when to stop. The pointers must stop before they cross; a word of odd length has a middle character with nothing to compare it to, and comparing it with itself is a wasted comparison rather than a wrong one.',
  ],
  code: { cpp: CPP, c: C, java: JAVA },
  lens: {
    primary: 'word',
    pointers: [
      { var: 'left', on: 'word', role: 'window-start', label: 'left', hint: 'Working inwards from the front.' },
      { var: 'right', on: 'word', role: 'window-end', label: 'right', hint: 'Working inwards from the back.' },
    ],
    regions: [
      { on: 'word', kind: 'eliminated', from: 0, to: 'left - 1', label: 'matched, and finished with' },
      { on: 'word', kind: 'active', from: 'left', to: 'right', label: 'still to check' },
      { on: 'word', kind: 'eliminated', from: 'right + 1', to: 'n - 1', label: 'matched, and finished with' },
    ],
    invariant: {
      text: 'Every pair already stepped over was a matching pair.',
      check: 'outerMatch === 1',
      when: 'defined(outerMatch) && defined(left)',
      why: 'The pointers only move inwards after a match, so the part outside them is settled — and that is what lets the function forget it entirely. If the outside were ever allowed to contain a mismatch, the shrinking window would no longer be a smaller instance of the same question, and the whole technique would be unsound rather than merely wrong.',
    },
    postcondition: {
      text: 'The answer matches whether the word really does read the same backwards.',
      check: 'verdict === 1',
      why: 'Checked by reversing the string and comparing — slow, allocating, and exactly the implementation this algorithm exists to avoid. That is what makes it a good postcondition: it states what the answer means in the most obvious possible way, and is not a second attempt at being clever.',
    },
    cost: {
      text: 'At most one comparison per pair, so half the word’s length in total — and no second string is ever built.',
      check: 'compared <= allowed',
      why: 'Reversing the string and comparing returns the same answer for every input, and this page would look identical. The difference is that it allocates a copy as long as the input, and this does not. Move only one pointer and the answer is often still right while every pair is compared twice against the wrong partner — same verdict, and the technique gone.',
    },
  },
  run,
  defaultInput: { word: 'racecar' },
  fields: [
    { key: 'word', label: 'Word', kind: 'text', help: 'Compared exactly as typed — case and spaces included.' },
  ],
  makeInput: (n) => {
    const half = Array.from({ length: Math.floor(n / 2) }, (_, i) => 'abcdefghij'[i % 10]).join('');
    return { word: half + (n % 2 ? 'x' : '') + [...half].reverse().join('') };
  },
  growthSizes: [16, 32, 64, 128, 256, 512, 1024],
  projectTo: 1_000_000,
  complexity: {
    time: 'O(n)',
    space: 'O(1)',
    note: 'One pass and two integers. The measurement here uses palindromes, which is the worst case: a word that fails does so as soon as it finds a mismatch, and a random word usually fails on the very first comparison. Growth measured on inputs that never fail early is the honest way to see the linear shape.',
  },
  userLane: {
    fnName: 'isPalindrome',
    compareBy: 'return',
    binds: 'word',
    // C has no bool, so its natural spelling of the answer is 1 and 0. That is
    // the same answer in a different alphabet, and the displayed C listing on
    // this page returns it — a reader who copies what is on screen should not
    // be told they are wrong about the language they are writing in.
    normalise: (returned) => (returned === '1' ? 'true' : returned === '0' ? 'false' : returned),
    starters: {
      cpp: `bool isPalindrome(string s) {
    int left = 0;
    int right = s.size() - 1;

    while (left < right) {
        if (s[left] != s[right])
            return false;

        left++;
        right--;
    }

    return true;
}`,
      c: `int isPalindrome(char* s, int n) {
    int left = 0;
    int right = n - 1;

    while (left < right) {
        if (s[left] != s[right])
            return 0;

        left++;
        right--;
    }

    return 1;
}`,
      java: `boolean isPalindrome(String s) {
    int left = 0;
    int right = s.length() - 1;

    while (left < right) {
        if (s.charAt(left) != s.charAt(right))
            return false;

        left++;
        right--;
    }

    return true;
}`,
      js: `function isPalindrome(s) {
  let left = 0;
  let right = s.length - 1;

  while (left < right) {
    if (s[left] !== s[right]) return false;

    left++;
    right--;
  }

  return true;
}`,
    },
  },
  mutations: [
    {
      id: 'meet-included',
      edits: [{ line: 5, from: 'while (left < right) {', to: 'while (left <= right) {', langs: ['cpp', 'c', 'java'] }],
      label: 'let the pointers meet',
      note: 'Keeps looping while left equals right, comparing the middle character with itself.',
    },
    {
      id: 'left-only',
      edits: [
        { line: 10, from: '        right--;', to: '        // right--;', langs: ['cpp', 'java'] },
        { line: 10, from: '        right--;', to: '        /* right-- */;', langs: ['c'] },
      ],
      label: 'only move left',
      note: 'left walks the whole word while right stays on the last character.',
    },
  ],
  variants: [
    {
      id: 'left-only',
      label: 'Only one pointer moves',
      blurb: 'The verdict is right surprisingly often, and for the wrong reason.',
      explanation:
        'With right pinned to the last character, the loop compares every character against that one until left passes it. On "racecar" the first comparison matches and the second does not, so it answers correctly by accident; on a word of one repeated letter it answers correctly for a different wrong reason. The technique depends on both ends closing in, and half of it is missing.',
      mutations: ['left-only'],
    },
    {
      id: 'meet-included',
      label: 'The pointers are allowed to meet',
      blurb: 'Every answer is correct, and odd-length words cost one comparison more than they should.',
      explanation:
        'When left and right land on the same character the loop compares it with itself, which always matches. The verdict is never affected — this is a bug that cannot produce a wrong answer on any input. What it produces is a comparison that the algorithm had already proved unnecessary, and the count is the only place it exists.',
      mutations: ['meet-included'],
    },
  ],
  edgeCases: [
    { id: 'yes', label: 'A palindrome', input: { word: 'racecar' }, why: 'Odd length, so the middle character is the one with no partner.' },
    { id: 'even', label: 'Even length', input: { word: 'abba' }, why: 'The pointers cross without ever meeting — the other way the loop can end.' },
    { id: 'no', label: 'Not a palindrome', input: { word: 'hello' }, why: 'Fails on the first comparison, which is the cheapest possible answer and the reason this is not always a full pass.' },
    { id: 'late', label: 'Fails in the middle', input: { word: 'abcxcda' }, why: 'The ends match twice before the mismatch, so the window really does shrink before failing.' },
    { id: 'single', label: 'One character', input: { word: 'a' }, why: 'left and right start on the same index, so the loop never runs. A single character is its own mirror.' },
    { id: 'empty', label: 'Empty string', input: { word: '' }, why: 'right starts at −1, which is behind left. The empty word is a palindrome, and the loop guard is what says so.' },
    { id: 'spaces', label: 'With a space', input: { word: 'ab ba' }, why: 'Nothing here strips spaces or punctuation. The middle character is a space, and it is compared exactly like any other.' },
  ],
  checkpoints: [
    conceptual({
      where: { line: 5, nth: 1 },
      question: 'The loop runs while left is strictly less than right. What would change if it ran while they were equal too?',
      options: [
        'Nothing to the answer — one wasted comparison of the middle character with itself',
        'Odd-length palindromes would be rejected',
        'The loop would never terminate',
        'Even-length words would be read wrongly',
      ],
      answer: 'Nothing to the answer — one wasted comparison of the middle character with itself',
      because:
        'A character always equals itself, so the extra comparison always passes. That makes it one of the rare bugs with no wrong answer anywhere — it exists only in the count, which is exactly the kind this page measures.',
    }),
    conceptual({
      where: { line: 9, nth: 1 },
      question: 'Both pointers move after a match. Why is it safe to forget the pair they just left?',
      options: [
        'Because a matching pair can never make the word fail later',
        'Because those characters are removed from the string',
        'Because the remaining part is always shorter',
        'It is not safe — they may need re-checking',
      ],
      answer: 'Because a matching pair can never make the word fail later',
      because:
        'Being a palindrome is a claim about every mirrored pair independently. Once a pair matches, nothing that happens further in can unmatch it, so the question that remains is the same question about a shorter word — which is what makes this a single pass rather than a search.',
    }),
    computed({
      where: { line: 6, nth: 2 },
      question: (step) => `left is at ${step.vars.left} and right at ${step.vars.right}. How many pairs are still unchecked, including this one?`,
      answer: (step) => {
        const l = Number(step.vars.left);
        const r = Number(step.vars.right);
        return String(Math.ceil((r - l + 1) / 2));
      },
      options: (answer) => {
        const v = Number(answer);
        return [String(v), String(v + 1), String(Math.max(0, v - 1)), String(v * 2)];
      },
      because:
        'The window between the pointers holds everything still in question, and it loses two characters per round — so the number of comparisons left is half its width, rounded up. That is the whole cost of the algorithm, visible at any moment as the size of the gap.',
    }),
  ],
};
