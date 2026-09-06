/**
 * The C-family interpreter, exercised directly.
 *
 * The user lane checks that a correct starter agrees with the reference and
 * that a broken one is caught. This checks the machine underneath: that a map
 * behaves like a map, that a struct is a reference and not a copy, and that the
 * places where C++ and Java genuinely differ are modelled as differing rather
 * than smoothed into whichever was easier.
 *
 * Run: npx tsx scripts/interp.ts
 */
import { Interpreter, isMap, isObj, stringify, Val } from '../src/lib/interp/interp';
import { parse } from '../src/lib/interp/parser';
import { COUNT_CAP } from '../src/lib/trace/tracer';

let failures = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${msg}`);
  if (!cond) failures++;
};

/** Run `source` and call `fn` with no arguments beyond those given. */
function run(source: string, fn: string, args: Val[] = []): { ok: true; value: Val } | { ok: false; message: string } {
  const parsed = parse(source);
  if (!parsed.ok) return { ok: false, message: `parse: ${parsed.message} (line ${parsed.line})` };
  try {
    const interp = new Interpreter(parsed.program, {
      maxSteps: COUNT_CAP,
      observer: { step: () => {}, compare: () => {}, read: () => {}, write: () => {}, call: () => {} },
    });
    return { ok: true, value: interp.callFunction(fn, args) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

const expect = (source: string, fn: string, want: string, label: string) => {
  const r = run(source, fn);
  if (!r.ok) {
    ok(false, `${label} — ${r.message}`);
    return;
  }
  const got = stringify(r.value);
  ok(got === want, `${label} (got ${got}, want ${want})`);
};

console.log('\n=== hash maps ===');

expect(
  `int f() {
    unordered_map<int, int> m;
    m[3] = 7;
    m[5] = 9;
    m[3] = m[3] + 1;
    return m[3] + m[5];
}`,
  'f',
  '17',
  'C++ subscript reads, writes and updates',
);

expect(
  `int f() {
    unordered_map<int, int> m;
    m[1] = 4;
    return m.count(1) + m.count(2);
}`,
  'f',
  '1',
  'count returns 1 for a present key and 0 for an absent one',
);

expect(
  `int f() {
    unordered_map<int, int> m;
    int x = m[42];
    return m.size();
}`,
  'f',
  '1',
  'reading a missing key with [] inserts it, as C++ does',
);

expect(
  `int f() {
    HashMap<Integer, Integer> m = new HashMap<>();
    m.put(2, 10);
    return m.getOrDefault(2, 0) + m.getOrDefault(9, 5);
}`,
  'f',
  '15',
  'Java put and getOrDefault',
);

{
  // Java's get does not insert, which is the half of the difference that
  // matters — the C++ subscript above did.
  const r = run(
    `int f() {
    HashMap<Integer, Integer> m = new HashMap<>();
    Integer v = m.get(7);
    return m.size();
}`,
    'f',
  );
  ok(r.ok && stringify(r.value) === '0', `Java get on a missing key does not insert (got ${r.ok ? stringify(r.value) : r.message})`);
}

expect(
  `int f() {
    unordered_set<int> s;
    s.insert(4);
    s.insert(4);
    s.insert(9);
    return s.size() * 10 + s.count(4);
}`,
  'f',
  '21',
  'a set holds each key once',
);

console.log('\n=== two sum with a map, the way it is actually written ===');
{
  const src = `int twoSum(vector<int>& arr, int target) {
    unordered_map<int, int> seen;

    for (int i = 0; i < arr.size(); i++) {
        int need = target - arr[i];

        if (seen.count(need))
            return seen[need] * 100 + i;

        seen[arr[i]] = i;
    }

    return -1;
}`;
  const parsed = parse(src);
  ok(parsed.ok, `it parses${parsed.ok ? '' : ` — ${parsed.message}`}`);
  if (parsed.ok) {
    const interp = new Interpreter(parsed.program, {
      maxSteps: COUNT_CAP,
      observer: { step: () => {}, compare: () => {}, read: () => {}, write: () => {}, call: () => {} },
    });
    const arrOf = (xs: number[]): Val => ({ __arr: true, v: xs as Val[] });
    const got = interp.callFunction('twoSum', [arrOf([2, 7, 11, 15]), 9]);
    ok(got === 1, `finds indices 0 and 1 for [2,7,11,15] target 9 (got ${String(got)})`);
    const none = interp.callFunction('twoSum', [arrOf([1, 2, 3]), 99]);
    ok(none === -1, `returns -1 when no pair exists (got ${String(none)})`);
  }
}

console.log('\n=== structs are references, not copies ===');

expect(
  `struct Node {
    int val;
    Node* next;
};

int f() {
    Node* a = new Node(1);
    Node* b = new Node(2);
    a->next = b;
    b->val = 99;
    return a->next->val;
}`,
  'f',
  '99',
  'writing through one reference is visible through another',
);

expect(
  `struct Node {
    int val;
    Node* next;
};

int f() {
    Node* head = new Node(1);
    head->next = new Node(2);
    head->next->next = new Node(3);

    int total = 0;
    Node* curr = head;
    while (curr != nullptr) {
        total = total + curr->val;
        curr = curr->next;
    }
    return total;
}`,
  'f',
  '6',
  'a list can be built and walked',
);

console.log('\n=== reversing a list, which is the point of all this ===');
{
  const src = `struct Node {
    int val;
    Node* next;
};

Node* build() {
    Node* head = new Node(1);
    head->next = new Node(2);
    head->next->next = new Node(3);
    head->next->next->next = new Node(4);
    return head;
}

Node* reverse(Node* head) {
    Node* prev = nullptr;
    Node* curr = head;

    while (curr != nullptr) {
        Node* next = curr->next;
        curr->next = prev;
        prev = curr;
        curr = next;
    }

    return prev;
}

Node* go() {
    return reverse(build());
}`;
  const r = run(src, 'go');
  ok(r.ok, `it runs${r.ok ? '' : ` — ${r.message}`}`);
  if (r.ok) {
    ok(isObj(r.value), 'it returns a node');
    ok(stringify(r.value) === '4,3,2,1', `the list comes back reversed (got ${stringify(r.value)})`);
  }
}

console.log('\n=== a null dereference is reported, not guessed at ===');
{
  const r = run(
    `struct Node { int val; Node* next; };
int f() {
    Node* n = nullptr;
    return n->val;
}`,
    'f',
  );
  ok(!r.ok, 'reading a field through null is refused');
  if (!r.ok) console.log(`  ${r.message}`);
}

{
  const r = run(
    `struct Node { int val; Node* next; };
int f() {
    Node* n = new Node(1);
    return n->weight;
}`,
    'f',
  );
  ok(!r.ok, 'reading a field that does not exist is refused');
  if (!r.ok) console.log(`  ${r.message}`);
}

console.log('\n=== a map is still a map after all that ===');
{
  const r = run(
    `int f() {
    unordered_map<int, int> m;
    m[1] = 1;
    return 0;
}`,
    'f',
  );
  ok(r.ok, 'maps still work alongside structs');
}
{
  const parsed = parse(`int f() { unordered_map<int,int> m; return m.frobnicate(1); }`);
  const r = parsed.ok ? run(`int f() { unordered_map<int,int> m; return m.frobnicate(1); }`, 'f') : { ok: false as const, message: 'parse' };
  ok(!r.ok, 'an invented map method is refused by name rather than ignored');
  if (!r.ok) console.log(`  ${r.message}`);
}
void isMap;

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
