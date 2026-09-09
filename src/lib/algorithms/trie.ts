import { ev } from '../trace/tracer';
import { CELL_STATE, GraphEdge, GraphNode } from '../trace/types';
import { computed, conceptual } from './checkpoints';
import { AlgorithmDef, Input, RunFn } from './types';

/**
 * A structure whose cost does not depend on how much is in it.
 *
 * Looking a word up in a list of words costs the length of the list. Looking
 * it up in a trie costs the length of the *word* — the same number of steps
 * whether ten words are stored or ten million, because the walk only ever
 * follows the characters it was given.
 *
 * That is the claim worth making and the one the answer cannot show: a linear
 * scan over the same words returns exactly the same verdict.
 */

const CPP = `struct Node { Node* next[26]; bool word; };

void insert(Node* root, string s) {
    Node* node = root;
    for (char c : s) {
        int k = c - 'a';
        if (node->next[k] == nullptr) node->next[k] = new Node();
        node = node->next[k];
    }
    node->word = true;
}

bool contains(Node* root, string s) {
    Node* node = root;
    for (char c : s) {
        int k = c - 'a';
        if (node->next[k] == nullptr) return false;
        node = node->next[k];
    }
    return node->word;
}`;

const C = `struct Node { struct Node* next[26]; int word; };

void insert(struct Node* root, char* s, int n) {
    struct Node* node = root;
    for (int i = 0; i < n; i++) {
        int k = s[i] - 'a';
        if (node->next[k] == NULL) node->next[k] = newNode();
        node = node->next[k];
    }
    node->word = 1;
}

int contains(struct Node* root, char* s, int n) {
    struct Node* node = root;
    for (int i = 0; i < n; i++) {
        int k = s[i] - 'a';
        if (node->next[k] == NULL) return 0;
        node = node->next[k];
    }
    return node->word;
}`;

const JAVA = `class Node { Node[] next = new Node[26]; boolean word; }

void insert(Node root, String s) {
    Node node = root;
    for (int i = 0; i < s.length(); i++) {
        int k = s.charAt(i) - 'a';
        if (node.next[k] == null) node.next[k] = new Node();
        node = node.next[k];
    }
    node.word = true;
}

boolean contains(Node root, String s) {
    Node node = root;
    for (int i = 0; i < s.length(); i++) {
        int k = s.charAt(i) - 'a';
        if (node.next[k] == null) return false;
        node = node.next[k];
    }
    return node.word;
}`;

const textOf = (input: Input, key: string, fallback: string): string => {
  const v = input[key];
  return typeof v === 'string' && v.trim() ? v : fallback;
};

const DEFAULT_WORDS = 'car,cart,cat,dog';
const DEFAULT_QUERY = 'cart';

interface Opts {
  /** The buggy version never marks the end of a word. */
  markWord: boolean;
  /** The buggy version follows any existing child rather than the right one. */
  matchChar: boolean;
}

interface TrieNode {
  id: string;
  /** The character that leads here. Empty at the root. */
  ch: string;
  /** The whole prefix spelled by the path from the root. */
  prefix: string;
  kids: Map<string, string>;
  word: boolean;
}

function makeRun(opts: Opts): RunFn {
  return (input, t) => {
    const words = textOf(input, 'words', DEFAULT_WORDS)
      .split(',')
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);
    const query = textOf(input, 'query', DEFAULT_QUERY).trim().toLowerCase();

    const trie = new Map<string, TrieNode>();
    let next = 0;
    const make = (ch: string, prefix: string): string => {
      const id = `n${next++}`;
      trie.set(id, { id, ch, prefix, kids: new Map(), word: false });
      return id;
    };
    const root = make('', '');

    const state: Record<string, number> = {};
    let cursor: string | null = root;
    /** Steps taken while looking the query up, against its length. */
    let walked = 0;

    const nodes = (): GraphNode[] =>
      [...trie.values()].map((n) => ({
        id: n.id,
        label: n.id === root ? '·' : n.word ? `${n.ch}●` : n.ch,
      }));
    const edges = (): GraphEdge[] =>
      [...trie.values()].flatMap((n) => [...n.kids.values()].map((to) => ({ from: n.id, to })));

    /**
     * Whether every node's prefix really is spelled by the path to it.
     *
     * The one promise a trie makes. It is checked by walking down from the
     * root rather than by trusting what each node recorded, because a walk
     * that followed the wrong child is exactly what would put a node where its
     * prefix says it does not belong.
     */
    const mark = () => {
      if (!t.tracing) return;
      let sound = 1;
      const visit = (id: string, spelled: string) => {
        const node = trie.get(id)!;
        if (node.prefix !== spelled) sound = 0;
        for (const [ch, kid] of node.kids) visit(kid, spelled + ch);
      };
      visit(root, '');
      t.derive({ spelled: sound, size: trie.size });
    };

    t.graph('t', nodes(), edges(), {
      directed: true,
      layout: 'layered',
      state: () => state,
      cursor: () => cursor,
      label: 'trie',
    });
    t.aux('trie', () => trie.size);
    t.oracle({ present: words.includes(query) ? 1 : 0 });

    t.enter('build', 'insert every word');
    mark();
    t.step(3, { words: words.length, i: null, node: '·', walked: 0 }, `Storing ${words.length} word${words.length === 1 ? '' : 's'}: ${words.join(', ') || 'none'}.`);

    for (const w of words) {
      let at = root;
      cursor = at;
      t.step(4, { words: words.length, i: null, node: '·', walked: 0 }, `Insert "${w}", starting at the root.`);

      for (const ch of w) {
        t.tick();
        const existing = opts.matchChar ? trie.get(at)!.kids.get(ch) : [...trie.get(at)!.kids.values()][0];
        const fresh = existing === undefined;
        t.step(7, { words: words.length, i: null, node: trie.get(at)!.ch || '·', walked: 0 }, fresh ? `Nothing leads out of here for "${ch}", so make a node for it.` : `There is already a node for "${ch}" — share it rather than making a second one.`, ev.cmp({ kind: 'literal', value: ch }, '==', { kind: 'literal', value: existing ? trie.get(existing)!.ch : '—' }, !fresh));

        const to = existing ?? make(ch, trie.get(at)!.prefix + ch);
        if (fresh) trie.get(at)!.kids.set(ch, to);
        at = to;
        cursor = at;
        state[at] = CELL_STATE.frontier;
        mark();
        t.step(8, { words: words.length, i: null, node: ch, walked: 0 }, `Now at the node for "${trie.get(at)!.prefix}".`, ev.link(trie.get(at)!.id, to));
      }

      if (opts.markWord) {
        trie.get(at)!.word = true;
        mark();
        t.step(10, { words: words.length, i: null, node: trie.get(at)!.ch, walked: 0 }, `Mark this node: "${w}" ends here. Without the mark it is only a prefix of something.`);
      } else {
        mark();
        t.step(10, { words: words.length, i: null, node: trie.get(at)!.ch, walked: 0 }, `Do not mark the end of "${w}".`);
      }
    }

    t.exit();
    for (const id of Object.keys(state)) state[id] = CELL_STATE.unseen;

    t.enter('contains', `contains(root, "${query}")`);
    cursor = root;
    mark();
    t.step(14, { words: words.length, i: 0, node: '·', walked }, `Now look up "${query}". The walk costs one step per character, whatever else is stored.`, ev.call('contains', `contains(root, "${query}")`));

    let here = root;
    for (let i = 0; i < query.length; i++) {
      const ch = query[i];
      walked++;
      t.tick();
      const step: string | undefined = opts.matchChar
        ? trie.get(here)!.kids.get(ch)
        : [...trie.get(here)!.kids.values()][0];
      t.step(17, { words: words.length, i, node: trie.get(here)!.ch || '·', walked }, step === undefined ? `Nothing leads out of here for "${ch}".` : `Follow "${ch}".`, ev.cmp({ kind: 'literal', value: ch }, '==', { kind: 'literal', value: step ? trie.get(step)!.ch : '—' }, step !== undefined));

      if (step === undefined) {
        t.derive({ spelled: 1, size: trie.size, verdict: words.includes(query) ? 0 : 1, walked, allowed: query.length });
        t.step(17, { words: words.length, i, node: trie.get(here)!.ch || '·', walked }, `"${query}" is not stored — the path runs out at "${query.slice(0, i)}".`, ev.fail('no such child'));
        t.exit();
        return 'false';
      }

      here = step;
      cursor = here;
      state[here] = CELL_STATE.path;
      mark();
      t.step(18, { words: words.length, i, node: ch, walked }, `At "${trie.get(here)!.prefix}".`, ev.visit('t', here));
    }

    const isWord = trie.get(here)!.word;
    t.derive({
      spelled: 1,
      size: trie.size,
      verdict: isWord === words.includes(query) ? 1 : 0,
      walked,
      allowed: query.length,
    });
    t.step(20, { words: words.length, i: query.length, node: trie.get(here)!.ch, walked }, isWord ? `The path exists and this node is marked, so "${query}" is stored.` : `The path exists, but nothing is marked here — "${query}" is only a prefix of something longer.`, ev.ret('contains', isWord));
    t.exit();
    return isWord ? 'true' : 'false';
  };
}

const run: RunFn = (input, t, mut) =>
  makeRun({ markWord: !mut.has('no-end-mark'), matchChar: !mut.has('any-child') })(input, t, mut);

export const trie: AlgorithmDef = {
  slug: 'trie',
  name: 'Trie (Prefix Tree)',
  category: 'strings',
  tagline: 'One node per character, shared by every word that starts the same way.',
  intuition: [
    'Words that begin the same way share a path. "car", "cart" and "cat" all start at the same "c", and only split where they actually differ — which is what makes this a tree of characters rather than a list of words.',
    'Looking a word up is then a walk: follow the character you are holding, and if there is nowhere to go, the word is not there. The number of steps is the length of the word, and it does not change when more words are added. That is the whole point, and it is what a linear scan over a list cannot match.',
    'The subtlety is that arriving somewhere is not the same as arriving at a word. "car" is a real word and also a prefix of "cart", so a node has to say which it is. Without that mark, every prefix of every stored word reports as stored.',
    'This is also the structure that makes "all the words starting with car" cheap, which is why autocomplete is built on it and a hash map is not: a hash tells you whether a word is present and nothing about what is near it.',
  ],
  code: { cpp: CPP, c: C, java: JAVA },
  lens: {
    primary: 't',
    pointers: [],
    regions: [],
    invariant: {
      text: 'Every node is reached by spelling out exactly the prefix it stands for.',
      check: 'spelled === 1',
      when: 'defined(spelled)',
      why: 'This is the only promise a trie makes, and everything else follows from it — the walk works because the path to a node *is* the prefix. It is checked by walking down from the root rather than by trusting what each node recorded, because following the wrong child is precisely what would put a node somewhere its own prefix says it does not belong.',
    },
    postcondition: {
      text: 'The verdict matches whether the query was one of the words stored.',
      check: 'verdict === 1',
      why: 'Checked against the list of words that went in, which is the linear scan this structure exists to replace. It is the claim that separates the two failure modes: a walk that ends nowhere says "no" for the right reason, and a walk that ends on an unmarked node says "no" for a completely different one.',
    },
    cost: {
      text: 'The lookup takes one step per character of the query, however many words are stored.',
      check: 'walked <= allowed',
      why: 'A linear scan over the same words returns the same verdict, so the answer can never show which was used. What separates them is that this number depends on the length of the *query* and not on the size of the collection — add a million more words and the walk is the same length. That is the reason the structure exists, and the count is the only place it is visible.',
    },
  },
  run,
  defaultInput: { words: DEFAULT_WORDS, query: DEFAULT_QUERY },
  fields: [
    { key: 'words', label: 'Words to store', kind: 'text', help: 'Comma-separated, lower-case letters. Words that share a beginning share a path.' },
    { key: 'query', label: 'Look for', kind: 'text', help: 'Try a prefix of a stored word — "car" is both a word and the start of "cart".' },
  ],
  makeInput: (n) => {
    const words: string[] = [];
    for (let i = 0; i < n; i++) {
      let w = '';
      let k = i;
      do {
        w += 'abcdefgh'[k % 8];
        k = Math.floor(k / 8);
      } while (k > 0);
      words.push(w);
    }
    return { words: words.join(','), query: words[words.length - 1] };
  },
  growthSizes: [16, 32, 64, 128, 256, 512],
  projectTo: 100_000,
  complexity: {
    time: 'O(n log n) to build the trie measured here — and O(len) per lookup, which is the number that matters and does not grow with n',
    space: 'O(n) nodes on the words measured here — one per distinct prefix, so shared beginnings cost nothing extra',
    note: 'Read the chart carefully, because it measures the wrong half on purpose: what grows is *building* the trie, one step per character of every word inserted. The lookup is the interesting number and it does not grow at all: the cost claim on this page holds the walk to the length of the query, and adding words does not change it. That is the whole trade — space spent once, so that every later question is free of the collection’s size.',
  },
  mutations: [
    {
      id: 'no-end-mark',
      edits: [
        { line: 10, from: '    node->word = true;', to: '    // node->word = true;', langs: ['cpp'] },
        { line: 10, from: '    node->word = 1;', to: '    /* node->word = 1; */', langs: ['c'] },
        { line: 10, from: '    node.word = true;', to: '    // node.word = true;', langs: ['java'] },
      ],
      label: 'never mark the end of a word',
      note: 'Stores the path but never records that a word finishes there.',
    },
    {
      id: 'any-child',
      edits: [
        { line: 17, from: '        if (node->next[k] == nullptr) return false;', to: '        if (node->next[0] == nullptr) return false;', langs: ['cpp'] },
        { line: 17, from: '        if (node->next[k] == NULL) return 0;', to: '        if (node->next[0] == NULL) return 0;', langs: ['c'] },
        { line: 17, from: '        if (node.next[k] == null) return false;', to: '        if (node.next[0] == null) return false;', langs: ['java'] },
      ],
      label: 'follow any child, not the right one',
      note: 'Takes whichever child exists rather than the one for this character.',
    },
  ],
  variants: [
    {
      id: 'no-end-mark',
      label: 'The end of a word is never marked',
      blurb: 'Every stored word reports as missing, and so does everything else.',
      explanation:
        'The path is built correctly and nothing records that a word finishes on it. Since a node can be both a word and a prefix — "car" inside "cart" — the mark is the only thing that distinguishes them, and without it the walk always arrives somewhere real and always says no. The structure is right; the answer it can give is empty.',
      mutations: ['no-end-mark'],
    },
    {
      id: 'any-child',
      label: 'The walk follows the wrong child',
      blurb: 'The path exists, and it spells a different word.',
      explanation:
        'Following whichever child happens to be there rather than the one for this character means the walk arrives at a node whose prefix is not the query. It still terminates, still ends on a real node, and still gives a verdict — about a word nobody asked about. The invariant is what says so, because the answer looks entirely reasonable.',
      mutations: ['any-child'],
    },
  ],
  edgeCases: [
    { id: 'default', label: 'A word and a prefix', input: { words: DEFAULT_WORDS, query: DEFAULT_QUERY }, why: 'Four words sharing two paths, and the query is a word that another word is built on.' },
    { id: 'prefix-only', label: 'A prefix that is not a word', input: { words: 'cart,cat', query: 'car' }, why: 'The path exists all the way and nothing is marked at the end. This is the case the end-of-word flag exists for, and the only one that tells the two "no" answers apart.' },
    { id: 'is-a-word', label: 'A word inside a longer one', input: { words: 'car,cart', query: 'car' }, why: 'The same path as above, and this time it is marked. Same walk, different verdict.' },
    { id: 'missing', label: 'Runs out early', input: { words: 'car,cat', query: 'dog' }, why: 'The walk fails at the very first character, which is the cheapest possible no.' },
    { id: 'longer', label: 'Longer than anything stored', input: { words: 'car', query: 'carts' }, why: 'The path runs out partway. Absence is proved by there being nowhere to go.' },
    { id: 'one', label: 'A single word', input: { words: 'a', query: 'a' }, why: 'One node below the root, and the smallest trie there is.' },
    { id: 'nothing', label: 'Nothing stored', input: { words: '', query: 'a' }, why: 'A trie of just the root. Every lookup fails at the first step.' },
  ],
  checkpoints: [
    conceptual({
      where: { line: 10, nth: 0 },
      question: 'Why does a node need to record that a word ends there?',
      options: [
        'Because arriving somewhere real does not mean a word finished there — it may only be a prefix',
        'To know how many words are stored',
        'To make deletion possible',
        'It does not — reaching the end of the query is enough',
      ],
      answer: 'Because arriving somewhere real does not mean a word finished there — it may only be a prefix',
      because:
        '"car" is a word and also the first three characters of "cart". The path to it exists either way, so the path alone cannot answer the question. That one boolean is the entire difference between "this is stored" and "something starting like this is stored".',
    }),
    conceptual({
      where: { line: 7, nth: 1 },
      question: 'This character already has a node, so no new one is made. What is being shared?',
      options: [
        'The prefix — every word starting this way walks the same path',
        'The memory only, as an optimisation',
        'The end-of-word flag',
        'Nothing is shared; the node is copied',
      ],
      answer: 'The prefix — every word starting this way walks the same path',
      because:
        'Sharing is not a space optimisation bolted on afterwards; it is what makes the structure a trie. Because words that begin alike are literally the same path, a question about a prefix is a question about one node, which is what makes autocomplete cheap here and impossible in a hash map.',
    }),
    computed({
      where: { line: 18, nth: 1 },
      question: () => 'How many steps has the lookup taken so far?',
      answer: (step) => String(step.vars.walked ?? 0),
      options: (answer) => {
        const w = Number(answer);
        return [String(w), String(w + 1), String(Math.max(0, w - 1)), '1'];
      },
      because:
        'One step per character of the query, and that is the number the whole structure exists to keep small. Nothing about it depends on how many words are stored — which is exactly what a scan through a list cannot say.',
    }),
  ],
};
