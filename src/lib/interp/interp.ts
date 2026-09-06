import { Expr, FuncDecl, Program, Stmt } from './ast';

/**
 * A small C / C++ / Java interpreter, written so the reader can *write* in the
 * language they are learning rather than translating into JavaScript first.
 *
 * Two things it does that running their code in the browser's own engine
 * cannot:
 *
 *   1. **Real `int` semantics.** Arithmetic on two integers is 32-bit and
 *      truncating, so `(low + high) / 2` overflows exactly where it does in
 *      C++ — the most famous bug in binary search, and one JavaScript is
 *      structurally unable to reproduce.
 *   2. **Honest counters.** Every comparison, every array read and every array
 *      write passes through here, so the operation counts shown beside the
 *      trace are measured rather than estimated. The JavaScript lane cannot do
 *      this: it only sees statement boundaries.
 *
 * The subset is deliberately narrow, and anything outside it is refused by
 * name. A parser or interpreter that guessed would produce a trace of code the
 * reader did not write.
 */

/* -------------------------------- values -------------------------------- */

/**
 * What container a value was declared as.
 *
 * Every one of these is an array underneath, but they do not agree on what
 * `pop` means: `queue::pop` takes from the front and `stack::pop` from the
 * back, and a website that quietly picked one would show a breadth-first
 * search behaving like a depth-first one while the code on screen said queue.
 * A `Deque` is its own case — Java's `push` and `pop` work on the *front*,
 * the opposite end from C++'s — so those two names are refused on it by name
 * rather than guessed at.
 */
export type ContainerKind = 'vector' | 'queue' | 'stack' | 'deque';

export interface ArrVal {
  __arr: true;
  v: Val[];
  kind?: ContainerKind;
}

/**
 * A struct or class instance — a `Node`, most often.
 *
 * Reference semantics, like every object in C++, Java and C-with-pointers:
 * assigning one to a variable copies the reference, so `curr->next = prev`
 * rewires the list rather than making a copy of it. That is the whole reason
 * linked-list code is worth stepping through, and modelling it any other way
 * would make every pointer bug disappear.
 */
export interface ObjVal {
  __obj: true;
  /** The type it was made from, for error messages and display. */
  type: string;
  fields: Map<string, Val>;
  /** Stable identity, so the view can tell two equal nodes apart. */
  id: string;
}

/**
 * A hash map, and a hash set — which is a map whose values are all true.
 *
 * Keys are stringified, which is exactly what a `Map<string, Val>` gives and is
 * faithful for the integer and character keys this subset admits. Insertion
 * order is preserved, and that is a real departure from `unordered_map`, whose
 * iteration order is unspecified: relying on it in real C++ is a bug this
 * interpreter cannot reproduce. Anything that iterates a map here should be
 * treated as showing one legal order, not the order.
 */
export interface MapVal {
  __map: true;
  /** A set prints and behaves as keys only. */
  isSet: boolean;
  m: Map<string, Val>;
}

/**
 * A pointer to somewhere a value is kept.
 *
 * Only what C actually needs here: `&x` makes one, `*p` reads or writes
 * through it. It holds the storage itself rather than an address, because
 * there are no addresses to hold — and arithmetic on one is refused, since
 * `p + 1` in C means the next element of an array this interpreter has no
 * layout for, and a made-up answer there would be worse than none.
 */
export interface PtrVal {
  __ptr: true;
  to: LValue;
  /** For the variables panel: what it points at, named. */
  label: string;
}

export type Val = number | boolean | string | ArrVal | ObjVal | MapVal | PtrVal | null;

export const isArr = (v: Val): v is ArrVal =>
  typeof v === 'object' && v !== null && (v as ArrVal).__arr === true;

export const isObj = (v: Val): v is ObjVal =>
  typeof v === 'object' && v !== null && (v as ObjVal).__obj === true;

export const isMap = (v: Val): v is MapVal =>
  typeof v === 'object' && v !== null && (v as MapVal).__map === true;

export const isPtr = (v: Val): v is PtrVal =>
  typeof v === 'object' && v !== null && (v as PtrVal).__ptr === true;

export const arr = (v: Val[]): ArrVal => ({ __arr: true, v });

let nextObjId = 0;
export const obj = (type: string, fields: Record<string, Val> = {}): ObjVal => ({
  __obj: true,
  type,
  fields: new Map(Object.entries(fields)),
  id: `o${nextObjId++}`,
});

export const mapVal = (isSet = false): MapVal => ({ __map: true, isSet, m: new Map() });

/** Keys are compared by their printed form, which is right for ints and chars. */
/**
 * A value as a container fill: arrays are copied, everything else is shared.
 *
 * Structs are deliberately *not* copied — a vector of node pointers filled with
 * one node is a vector of pointers to that one node, in C++ and here alike.
 */
const copyOf = (v: Val): Val => (isArr(v) ? arr(v.v.map(copyOf)) : v);

export const keyOf = (v: Val): string => (v === null ? 'null' : String(stringify(v)));

/* ------------------------------- 32-bit int ------------------------------ */

const INT_MIN = -2147483648;
const INT_MAX = 2147483647;

/**
 * Named limits, under the spellings each language uses.
 *
 * Not a convenience: a shortest-path or minimum-finding algorithm needs a
 * sentinel before it has anything to compare against, and every textbook
 * reaches for one of these names. Refusing them meant the reader had to
 * invent a magic number and then wonder whether it was large enough.
 *
 * They are the genuine 32-bit bounds, which matters — `INT_MAX + 1` wraps
 * negative here just as it does in C++, and that is a bug worth being able
 * to make.
 */
const CONSTANTS: Record<string, Val> = {
  INT_MAX,
  INT_MIN,
  'Integer.MAX_VALUE': INT_MAX,
  'Integer.MIN_VALUE': INT_MIN,
};

const isInt = (v: Val): v is number => typeof v === 'number' && Number.isInteger(v);

/** True when `n` does not fit in a 32-bit signed int — i.e. it wrapped. */
const overflows = (n: number) => n < INT_MIN || n > INT_MAX;

/* ------------------------------ control flow ----------------------------- */

class BreakSig {}
class ContinueSig {}
class ReturnSig {
  constructor(readonly value: Val) {}
}

export class RuntimeError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
  }
}

/* --------------------------------- scopes -------------------------------- */

class Scope {
  readonly vars = new Map<string, Val>();
  constructor(readonly parent: Scope | null) {}

  lookup(name: string): Scope | null {
    let s: Scope | null = this as Scope;
    while (s) {
      if (s.vars.has(name)) return s;
      s = s.parent;
    }
    return null;
  }
}

/** Whether two lvalues name the same storage, for the aliasing check. */
function sameSlot(a: LValue, b: LValue): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'var' && b.kind === 'var') return a.scope === b.scope && a.name === b.name;
  if (a.kind === 'slot' && b.kind === 'slot') return a.target === b.target && a.index === b.index;
  if (a.kind === 'field' && b.kind === 'field') return a.target === b.target && a.name === b.name;
  if (a.kind === 'entry' && b.kind === 'entry') return a.target === b.target && a.key === b.key;
  return false;
}

/** Somewhere a value can be stored: a variable, or a slot in an array. */
type LValue =
  | { kind: 'var'; scope: Scope; name: string }
  | { kind: 'slot'; target: ArrVal; index: number }
  | { kind: 'field'; target: ObjVal; name: string }
  | { kind: 'entry'; target: MapVal; key: string };

/* -------------------------------- observer ------------------------------- */

/**
 * What the runner wants to know. Kept as a callback interface rather than
 * baked in, so the interpreter has no opinion about Trace, React or the DOM.
 */
export interface Observer {
  /** About to run the statement on this line. Throw to stop the run. */
  step(line: number, scopes: Scope[], stack: string[], note: string | null): void;
  compare(): void;
  read(): void;
  write(): void;
  call(depth: number): void;
}

export interface RunOptions {
  observer: Observer;
  /** Hard cap on statements executed, so an infinite loop is survivable. */
  maxSteps: number;
  maxDepth?: number;
}

/* ------------------------------ the machine ------------------------------ */

export class Interpreter {
  private readonly funcs = new Map<string, FuncDecl>();
  /** Struct name → field names, from the source's own declarations. */
  private readonly structs = new Map<string, string[]>();
  private readonly stack: string[] = [];
  private scope: Scope;
  private readonly scopes: Scope[] = [];
  private steps = 0;
  /** Set when the current statement overflowed, so the step can say so. */
  private note: string | null = null;

  constructor(
    program: Program,
    private readonly opts: RunOptions,
  ) {
    for (const f of program.functions) this.funcs.set(f.name, f);
    for (const st of program.structs) this.structs.set(st.name, st.fields);
    this.scope = new Scope(null);
    this.scopes.push(this.scope);
  }

  has(name: string): boolean {
    return this.funcs.has(name);
  }

  /** Parameter names of a top-level function, for binding the input. */
  paramsOf(name: string): string[] {
    return this.funcs.get(name)?.params.map((p) => p.name) ?? [];
  }

  callFunction(name: string, args: Val[]): Val {
    const fn = this.funcs.get(name);
    if (!fn) throw new RuntimeError(`No function named "${name}"`, 1);
    return this.invoke(fn, args, fn.line);
  }

  /* ------------------------------- helpers ------------------------------- */

  private tick(line: number) {
    if (++this.steps > this.opts.maxSteps) {
      throw new RuntimeError('__cap__', line);
    }
    this.opts.observer.step(line, this.scopes, this.stack, this.note);
    this.note = null;
  }

  private push(): Scope {
    this.scope = new Scope(this.scope);
    this.scopes.push(this.scope);
    return this.scope;
  }

  private pop() {
    this.scopes.pop();
    this.scope = this.scope.parent!;
  }

  private truthy(v: Val, line: number): boolean {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (v === null) return false; // `while (curr != null)` written as `while (curr)`
    if (isObj(v)) return true; // a non-null pointer
    if (isMap(v)) return v.m.size > 0;
    if (isArr(v)) return v.v.length > 0;
    throw new RuntimeError('This value is not a condition', line);
  }

  private num(v: Val, line: number, what: string): number {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    throw new RuntimeError(`${what} needs a number, got ${describe(v)}`, line);
  }

  private array(v: Val, line: number): ArrVal {
    if (isArr(v)) return v;
    throw new RuntimeError(`Expected an array here, got ${describe(v)}`, line);
  }

  /* ------------------------------ statements ----------------------------- */

  private exec(s: Stmt) {
    switch (s.k) {
      case 'block': {
        this.push();
        try {
          for (const st of s.body) this.exec(st);
        } finally {
          this.pop();
        }
        return;
      }

      case 'empty':
        return;

      case 'expr':
        this.tick(s.line);
        this.eval(s.expr);
        return;

      case 'decl': {
        this.tick(s.line);
        for (const d of s.decls) {
          let value: Val = d.isArray ? arr([]) : 0;
          if (d.init) value = this.eval(d.init);
          else if (MAP_TYPES.has(s.type.base)) value = mapVal(false);
          else if (SET_TYPES.has(s.type.base)) value = mapVal(true);
          else if (s.type.base === 'bool' || s.type.base === 'boolean') value = false;
          // A pointer or a class reference with no initialiser is null, which is
          // the value every linked-list walk starts and ends on.
          else if (this.structs.has(s.type.base) || s.type.isRef || s.type.base === 'struct') {
            value = null;
          }
          // A container remembers what it was declared as, so `pop` can mean
          // what it means in the language on screen.
          if (isArr(value) && value.kind === undefined) value.kind = kindOf(s.type.base);
          this.scope.vars.set(d.name, value);
        }
        return;
      }

      case 'if': {
        this.tick(s.line);
        if (this.truthy(this.eval(s.test), s.line)) this.exec(s.yes);
        else if (s.no) this.exec(s.no);
        return;
      }

      case 'while': {
        for (;;) {
          this.tick(s.line);
          if (!this.truthy(this.eval(s.test), s.line)) return;
          try {
            this.exec(s.body);
          } catch (e) {
            if (e instanceof BreakSig) return;
            if (!(e instanceof ContinueSig)) throw e;
          }
        }
      }

      case 'do': {
        for (;;) {
          try {
            this.exec(s.body);
          } catch (e) {
            if (e instanceof BreakSig) return;
            if (!(e instanceof ContinueSig)) throw e;
          }
          this.tick(s.line);
          if (!this.truthy(this.eval(s.test), s.line)) return;
        }
      }

      case 'for': {
        this.push();
        try {
          if (s.init) this.exec(s.init);
          for (;;) {
            this.tick(s.line);
            if (s.test && !this.truthy(this.eval(s.test), s.line)) return;
            try {
              this.exec(s.body);
            } catch (e) {
              if (e instanceof BreakSig) return;
              if (!(e instanceof ContinueSig)) throw e;
            }
            for (const u of s.update) this.eval(u);
          }
        } finally {
          this.pop();
        }
      }

      case 'destructure': {
        this.tick(s.line);
        this.bind(s.names, this.eval(s.value), s.line);
        return;
      }

      case 'forEach': {
        const src = this.array(this.eval(s.iterable), s.line);
        this.push();
        try {
          for (const item of [...src.v]) {
            this.tick(s.line);
            this.bind(s.names, item, s.line);
            try {
              this.exec(s.body);
            } catch (e) {
              if (e instanceof BreakSig) return;
              if (!(e instanceof ContinueSig)) throw e;
            }
          }
        } finally {
          this.pop();
        }
        return;
      }

      case 'return': {
        this.tick(s.line);
        throw new ReturnSig(s.value ? this.eval(s.value) : null);
      }

      case 'break':
        this.tick(s.line);
        throw new BreakSig();

      case 'continue':
        this.tick(s.line);
        throw new ContinueSig();
    }
  }

  /* ------------------------------ expressions ---------------------------- */

  private eval(e: Expr): Val {
    switch (e.k) {
      case 'num':
        return e.v;
      case 'str':
        return e.v;
      case 'bool':
        return e.v;
      case 'null':
        return null;

      case 'name': {
        const s = this.scope.lookup(e.name);
        if (!s) {
          // The named limits, which half the algorithms that need a sentinel
          // reach for first. They are the real 32-bit values, so `INT_MAX + 1`
          // wraps here exactly as it does in C++ rather than sailing past.
          const constant = CONSTANTS[e.name];
          if (constant !== undefined) return constant;
          throw new RuntimeError(`"${e.name}" is not defined here`, e.line);
        }
        return s.vars.get(e.name)!;
      }

      case 'arrayLit':
        return arr(e.items.map((x) => this.eval(x)));

      case 'construct': {
        if (MAP_TYPES.has(e.type)) return mapVal(false);
        if (SET_TYPES.has(e.type)) return mapVal(true);
        if (LIST_TYPES.has(e.type)) return arr([]);

        const fields = this.structs.get(e.type);
        if (!fields) {
          throw new RuntimeError(
            `"${e.type}" is not a type I know how to build. Declare it with struct or class first.`,
            e.line,
          );
        }
        // Positional arguments fill the fields in declaration order, which is
        // what a constructor like `Node(int v) : val(v), next(nullptr) {}` does
        // and what `new Node(5)` means to a reader.
        const made = obj(e.type);
        for (const name of fields) made.fields.set(name, null);
        e.args.forEach((argExpr, i) => {
          if (i < fields.length) made.fields.set(fields[i], this.eval(argExpr));
        });
        this.opts.observer.write();
        return made;
      }

      case 'newArray': {
        const n = this.num(this.eval(e.size), e.line, 'An array size');
        if (n < 0 || n > 5_000_000) {
          throw new RuntimeError(`Array size ${n} is out of range`, e.line);
        }
        const fill = e.fill ? this.eval(e.fill) : 0;
        // Every slot gets its own copy of a container fill. `vector<vector<int>>
        // dp(n, vector<int>(m, 0))` in C++ copies the row n times; sharing one
        // row by reference would make dp[0][j] = 1 appear in every row, and the
        // table on screen would be telling the reader something untrue.
        return arr(Array.from({ length: n }, () => copyOf(fill)));
      }

      case 'index': {
        const container = this.eval(e.target);
        if (isMap(container)) return this.load(this.lvalue(e));
        if (typeof container === 'string') {
          return this.charAt(container, this.eval(e.index), e.line);
        }
        const target = this.array(container, e.line);
        const i = this.num(this.eval(e.index), e.line, 'An array index');
        this.opts.observer.read();
        if (i < 0 || i >= target.v.length) {
          throw new RuntimeError(
            `Index ${i} is outside the array, which has ${target.v.length} element${
              target.v.length === 1 ? '' : 's'
            }. In real C or C++ this would read whatever happened to be in memory; here it stops, because a made-up value would make the trace a lie.`,
            e.line,
          );
        }
        return target.v[i];
      }

      case 'member':
        return this.member(e.target, e.name, e.line);

      case 'call':
        return this.call(e);

      case 'unary': {
        if (e.op === 'addr') {
          const to = this.lvalue(e.arg);
          return { __ptr: true, to, label: describeLValue(to) };
        }
        if (e.op === 'deref') return this.load(this.pointer(this.eval(e.arg), e.line));
        if (e.op.startsWith('cast:')) {
          const v = this.eval(e.arg);
          const to = e.op.slice(5);
          const n = this.num(v, e.line, 'A cast');
          if (to === 'double' || to === 'float') return n;
          return Math.trunc(n) | 0;
        }
        const v = this.eval(e.arg);
        if (e.op === '!') return !this.truthy(v, e.line);
        if (e.op === '-') return this.wrap(-this.num(v, e.line, 'Negation'));
        if (e.op === '+') return this.num(v, e.line, 'Unary plus');
        if (e.op === '~') return ~this.num(v, e.line, 'Bitwise not');
        throw new RuntimeError(`Operator "${e.op}" is not supported`, e.line);
      }

      case 'update': {
        const lv = this.lvalue(e.arg);
        const before = this.num(this.load(lv), e.line, `"${e.op}"`);
        const after = this.wrap(e.op === '++' ? before + 1 : before - 1);
        this.store(lv, after);
        return e.prefix ? after : before;
      }

      case 'logical': {
        const a = this.truthy(this.eval(e.a), e.line);
        if (e.op === '&&') return a ? this.truthy(this.eval(e.b), e.line) : false;
        return a ? true : this.truthy(this.eval(e.b), e.line);
      }

      case 'cond':
        return this.truthy(this.eval(e.test), e.line) ? this.eval(e.yes) : this.eval(e.no);

      case 'bin':
        return this.binary(e.op, this.eval(e.a), this.eval(e.b), e.line);

      case 'assign': {
        const lv = this.lvalue(e.target);
        const rhs = this.eval(e.value);
        const value =
          e.op === '='
            ? rhs
            : this.binary(e.op.slice(0, -1), this.load(lv), rhs, e.line);
        this.store(lv, value);
        return value;
      }
    }
  }

  /** 32-bit signed wrap, noting the first overflow of each statement. */
  private wrap(n: number): number {
    if (!Number.isInteger(n)) return n;
    if (!overflows(n)) return n;
    const wrapped = n | 0;
    if (this.note === null) {
      this.note = `int overflow: ${n} does not fit in a 32-bit int, so it wrapped to ${wrapped}.`;
    }
    return wrapped;
  }

  private binary(op: string, a: Val, b: Val, line: number): Val {
    switch (op) {
      case '==':
      case '!=':
      case '<':
      case '<=':
      case '>':
      case '>=': {
        this.opts.observer.compare();
        // Pointer identity for the linked-list algorithms; value equality
        // everywhere else. `==` on two arrays compares the reference, which is
        // what `slow == fast` means in every one of the three languages.
        if (op === '==' || op === '!=') {
          const same = isArr(a) || isArr(b) || a === null || b === null ? a === b : a === b;
          return op === '==' ? same : !same;
        }
        const x = this.num(a, line, 'A comparison');
        const y = this.num(b, line, 'A comparison');
        if (op === '<') return x < y;
        if (op === '<=') return x <= y;
        if (op === '>') return x > y;
        return x >= y;
      }
    }

    if (op === '+' && (typeof a === 'string' || typeof b === 'string')) {
      return `${stringify(a)}${stringify(b)}`;
    }

    const x = this.num(a, line, `Operator "${op}"`);
    const y = this.num(b, line, `Operator "${op}"`);
    const both = isInt(x) && isInt(y);

    switch (op) {
      case '+':
        return this.wrap(x + y);
      case '-':
        return this.wrap(x - y);
      case '*':
        // Math.imul is the exact 32-bit product; plain `*` loses low bits
        // above 2^53 and would report the wrong wrapped value.
        return both ? Math.imul(x, y) : x * y;
      case '/':
        if (y === 0) throw new RuntimeError('Division by zero', line);
        // Integer division truncates toward zero in all three languages —
        // this is why `(hi - lo) / 2` is a midpoint and not a fraction.
        return both ? Math.trunc(x / y) | 0 : x / y;
      case '%':
        if (y === 0) throw new RuntimeError('Remainder by zero', line);
        return both ? x % y : x % y;
      case '&':
        return x & y;
      case '|':
        return x | y;
      case '^':
        return x ^ y;
      case '<<':
        return x << y;
      case '>>':
        return x >> y;
    }
    throw new RuntimeError(`Operator "${op}" is not supported`, line);
  }

  /* -------------------------------- lvalues ------------------------------ */

  private lvalue(e: Expr): LValue {
    if (e.k === 'name') {
      const scope = this.scope.lookup(e.name);
      if (!scope) throw new RuntimeError(`"${e.name}" is not defined here`, e.line);
      return { kind: 'var', scope, name: e.name };
    }
    if (e.k === 'member') {
      const target = this.eval(e.target);
      if (isObj(target)) return { kind: 'field', target, name: e.name };
      throw new RuntimeError(
        target === null
          ? `Cannot write "${e.name}" through a null reference — check the guard above.`
          : `Cannot assign to "${e.name}" on ${describe(target)}`,
        e.line,
      );
    }
    if (e.k === 'unary' && e.op === 'deref') {
      return this.pointer(this.eval(e.arg), e.line);
    }
    if (e.k === 'index') {
      const container = this.eval(e.target);
      // `m[k]` on a map both reads and creates, which is exactly what C++ does
      // and exactly why `if (m[k])` quietly inserts a zero.
      if (isMap(container)) {
        return { kind: 'entry', target: container, key: keyOf(this.eval(e.index)) };
      }
      if (typeof container === 'string') {
        throw new RuntimeError(
          'Strings are read-only here — you can read s[i] but not assign to it.',
          e.line,
        );
      }
      const target = this.array(container, e.line);
      const index = this.num(this.eval(e.index), e.line, 'An array index');
      if (index < 0 || index >= target.v.length) {
        throw new RuntimeError(
          `Index ${index} is outside the array, which has ${target.v.length} element${
            target.v.length === 1 ? '' : 's'
          }. In real C or C++ this would overwrite unrelated memory; here it stops.`,
          e.line,
        );
      }
      return { kind: 'slot', target, index };
    }
    throw new RuntimeError('This is not something you can assign to', e.line);
  }

  private load(lv: LValue): Val {
    if (lv.kind === 'var') return lv.scope.vars.get(lv.name)!;
    this.opts.observer.read();
    if (lv.kind === 'slot') return lv.target.v[lv.index];
    if (lv.kind === 'field') return lv.target.fields.get(lv.name) ?? null;
    // Reading a missing key inserts a zero, which is the C++ behaviour and the
    // source of a whole genre of bug. Modelled rather than smoothed over.
    if (!lv.target.m.has(lv.key)) lv.target.m.set(lv.key, 0);
    return lv.target.m.get(lv.key)!;
  }

  private store(lv: LValue, v: Val) {
    if (lv.kind === 'var') {
      lv.scope.vars.set(lv.name, v);
      return;
    }
    this.opts.observer.write();
    if (lv.kind === 'slot') lv.target.v[lv.index] = v;
    else if (lv.kind === 'field') lv.target.fields.set(lv.name, v);
    else lv.target.m.set(lv.key, v);
  }

  /**
   * Bind one name to a value, or several to the parts of a pair.
   *
   * A pair here is a two-element container, which is what `{r, c}` and
   * `{node, weight}` build. Binding a different number of names than the
   * value holds is refused rather than filled with nulls: the reader has
   * written down a shape, and being wrong about it should say so.
   */
  private bind(names: string[], value: Val, line: number) {
    if (names.length === 1) {
      this.scope.vars.set(names[0], value);
      return;
    }
    const parts = this.array(value, line);
    if (parts.v.length !== names.length) {
      throw new RuntimeError(
        `${names.length} names were given for a value holding ${parts.v.length}.`,
        line,
      );
    }
    names.forEach((n, i) => this.scope.vars.set(n, parts.v[i]));
  }

  /** The storage a pointer names, or a refusal saying what it actually was. */
  private pointer(v: Val, line: number): LValue {
    if (isPtr(v)) return v.to;
    if (v === null) {
      throw new RuntimeError(
        'Followed a null pointer. Check the guard on the line above.',
        line,
      );
    }
    throw new RuntimeError(`Only a pointer can be followed with *, and this is ${describe(v)}`, line);
  }

  /* -------------------------------- strings ------------------------------ */

  /**
   * One character of a string, as its code.
   *
   * A code rather than a one-character string, because that is what `char` is
   * in C and C++ — and because `'a'` is already lexed as a number here, so
   * `s[i] == 'a'` has to compare two numbers or it would silently be false.
   * Strings are read-only in this subset: there is no `s[i] = 'x'`, and an
   * attempt to write one is refused rather than quietly ignored.
   */
  private charAt(s: string, index: Val, line: number): number {
    const i = this.num(index, line, 'A string index');
    if (i < 0 || i >= s.length) {
      throw new RuntimeError(
        `Character ${i} is outside "${s}", which has ${s.length} character${s.length === 1 ? '' : 's'}.`,
        line,
      );
    }
    this.opts.observer.read();
    return s.charCodeAt(i);
  }

  /* -------------------------------- members ------------------------------ */

  /** A field on a struct, or a container's length. */
  private member(targetExpr: Expr, name: string, line: number): Val {
    // `Integer.MAX_VALUE` is a member of a name that is not a variable and
    // never will be, so it is resolved before anything tries to evaluate it.
    if (targetExpr.k === 'name' && !this.scope.lookup(targetExpr.name)) {
      const constant = CONSTANTS[`${targetExpr.name}.${name}`];
      if (constant !== undefined) return constant;
    }

    // `Math.abs` / `Arrays.fill` reach here as a member of a bare name that is
    // not a variable; those are handled at the call site.
    const target = this.eval(targetExpr);
    if (isArr(target)) {
      if (name === 'length' || name === 'size') return target.v.length;
      // A pair is a two-element container here, so `.first` and `.second` are
      // its two elements. Offered only at that length: asking for `.second` of
      // a six-element vector is a mistake, and answering it would hide one.
      if ((name === 'first' || name === 'second') && target.v.length === 2) {
        this.opts.observer.read();
        return target.v[name === 'first' ? 0 : 1];
      }
      throw new RuntimeError(`Arrays have no member "${name}" here`, line);
    }
    if (isObj(target)) {
      this.opts.observer.read();
      if (!target.fields.has(name)) {
        throw new RuntimeError(
          `A ${target.type} has no field called "${name}". It has ${[...target.fields.keys()].join(', ') || 'none'}.`,
          line,
        );
      }
      return target.fields.get(name)!;
    }
    if (typeof target === 'string') {
      if (name === 'length' || name === 'size') return target.length;
      throw new RuntimeError(`Strings have no member "${name}" here`, line);
    }
    if (isMap(target)) {
      if (name === 'size') return target.m.size;
      throw new RuntimeError(`Use a method here — a map has no field "${name}"`, line);
    }
    if (target === null) {
      throw new RuntimeError(
        `Followed a null reference to reach "${name}" — check the guard on the loop above.`,
        line,
      );
    }
    throw new RuntimeError(`"${name}" is not a member I know about`, line);
  }

  /* --------------------------------- calls ------------------------------- */

  private call(e: Expr & { k: 'call' }): Val {
    const callee = e.callee;

    // swap(a, b) — takes its arguments by reference, so it needs lvalues.
    if (callee.k === 'name' && callee.name === 'swap' && e.args.length === 2) {
      const a = this.lvalue(e.args[0]);
      const b = this.lvalue(e.args[1]);
      const av = this.load(a);
      const bv = this.load(b);
      this.store(a, bv);
      this.store(b, av);
      return null;
    }

    if (callee.k === 'name') {
      const builtin = this.freeBuiltin(callee.name, e, e.line);
      if (builtin !== NOT_A_BUILTIN) return builtin;

      const fn = this.funcs.get(callee.name);
      if (!fn) {
        throw new RuntimeError(
          `"${callee.name}" is not a function you have defined, and not one I provide.`,
          e.line,
        );
      }
      return this.invoke(fn, e.args.map((a) => this.eval(a)), e.line, this.refBindings(fn, e));
    }

    if (callee.k === 'member') {
      // A static helper: Math.abs, Arrays.fill, Collections.swap …
      if (callee.target.k === 'name' && !this.scope.lookup(callee.target.name)) {
        const r = this.staticBuiltin(callee.target.name, callee.name, e);
        if (r !== NOT_A_BUILTIN) return r;
      }
      return this.methodCall(callee.target, callee.name, e);
    }

    throw new RuntimeError('This is not something you can call', e.line);
  }

  /**
   * Where a scalar reference parameter has to write back to.
   *
   * `void bump(int& x)` means the caller's variable, not a copy of it. Arrays,
   * objects and maps are already references here, so this is only about the
   * scalars — and until it existed, `int&` parsed, ran, and silently threw the
   * callee's writes away. A wrong answer with no error is the worst thing this
   * interpreter can do, so it is worth the care.
   *
   * Modelled as copy-in, copy-out: the argument is evaluated normally and the
   * final value is stored back when the call returns. That is indistinguishable
   * from a real reference except when two reference parameters are bound to the
   * same variable, where the order of the copies back would decide the answer.
   * That case is refused rather than resolved, because either resolution would
   * be this interpreter inventing a rule C++ does not have.
   */
  private refBindings(
    fn: FuncDecl,
    e: Expr & { k: 'call' },
  ): { name: string; to: LValue }[] | undefined {
    let bindings: { name: string; to: LValue }[] | undefined;

    fn.params.forEach((p, i) => {
      if (!p.type.isRef || p.type.isArray) return;
      const argExpr = e.args[i];
      if (argExpr === undefined) return;
      // Only an lvalue can be written back to; `bump(3)` would not compile in
      // C++ either, and is left to fail on its own terms if it appears.
      if (argExpr.k !== 'name' && argExpr.k !== 'index' && argExpr.k !== 'member') return;

      const to = this.lvalue(argExpr);
      if (isArr(this.load(to)) || isObj(this.load(to)) || isMap(this.load(to))) return;

      bindings ??= [];
      if (bindings.some((b) => sameSlot(b.to, to))) {
        throw new RuntimeError(
          `"${fn.name}" was given the same variable for two reference parameters. Which copy back wins would decide the answer, so this is refused rather than guessed at.`,
          e.line,
        );
      }
      bindings.push({ name: p.name, to });
    });

    return bindings;
  }

  private invoke(
    fn: FuncDecl,
    args: Val[],
    line: number,
    writeBack?: { name: string; to: LValue }[],
  ): Val {
    const maxDepth = this.opts.maxDepth ?? 400;
    if (this.stack.length >= maxDepth) {
      throw new RuntimeError(
        `Recursion went ${maxDepth} calls deep — this usually means the base case is never reached.`,
        line,
      );
    }
    if (args.length !== fn.params.length) {
      throw new RuntimeError(
        `"${fn.name}" takes ${fn.params.length} argument${fn.params.length === 1 ? '' : 's'}, got ${args.length}`,
        line,
      );
    }

    const saved = this.scope;
    const frame = new Scope(null); // functions do not see their caller's locals
    this.scope = frame;
    this.scopes.push(frame);
    this.stack.push(fn.name);
    this.opts.observer.call(this.stack.length);

    fn.params.forEach((p, i) => frame.vars.set(p.name, args[i]));

    try {
      this.exec(fn.body);
      return null; // fell off the end of a void function
    } catch (err) {
      if (err instanceof ReturnSig) return err.value;
      throw err;
    } finally {
      // A scalar reference parameter is copied back to what the caller passed.
      // Arrays and objects need none of this — they are already references —
      // but an `int&` is the one case where the callee's writes have to reach
      // the caller, and until this existed they silently did not.
      for (const back of writeBack ?? []) {
        this.store(back.to, frame.vars.get(back.name) ?? null);
      }
      this.stack.pop();
      this.scopes.pop();
      this.scope = saved;
    }
  }

  private mapMethod(target: MapVal, name: string, e: Expr & { k: 'call' }): Val {
    const ln = e.line;
    const a = e.args.map((x) => this.eval(x));
    const key = a.length > 0 ? keyOf(a[0]) : '';

    switch (name) {
      case 'size':
      case 'length':
        return target.m.size;
      case 'empty':
      case 'isEmpty':
        return target.m.size === 0;

      // Presence. `count` returns 0 or 1 in C++ on these containers.
      case 'count':
      case 'contains':
      case 'containsKey':
        this.opts.observer.read();
        this.opts.observer.compare();
        return name === 'count' ? (target.m.has(key) ? 1 : 0) : target.m.has(key);

      case 'insert':
      case 'add':
        this.opts.observer.write();
        target.m.set(key, target.isSet ? true : (a[1] ?? true));
        return null;

      case 'put':
        this.opts.observer.write();
        target.m.set(key, a[1] ?? null);
        return null;

      case 'get':
        this.opts.observer.read();
        if (!target.m.has(key)) {
          // Java returns null here rather than inserting, and the difference
          // from C++'s `[]` is worth preserving rather than papering over.
          return null;
        }
        return target.m.get(key)!;

      case 'getOrDefault':
        this.opts.observer.read();
        return target.m.has(key) ? target.m.get(key)! : (a[1] ?? null);

      case 'erase':
      case 'remove':
        this.opts.observer.write();
        target.m.delete(key);
        return null;

      case 'clear':
        target.m.clear();
        return null;

      default:
        throw new RuntimeError(
          `A ${target.isSet ? 'set' : 'map'} here has no method "${name}"`,
          ln,
        );
    }
  }

  /* ------------------------------- builtins ------------------------------ */

  /** `min(a, b)`, `abs(x)`, `printf(...)` — free functions. */
  private freeBuiltin(name: string, e: Expr & { k: 'call' }, ln: number): Val | typeof NOT_A_BUILTIN {
    const argv = () => e.args.map((a) => this.num(this.eval(a), ln, `"${name}"`));
    switch (name) {
      case 'min': {
        const [a, b] = argv();
        this.opts.observer.compare();
        return Math.min(a, b);
      }
      case 'max': {
        const [a, b] = argv();
        this.opts.observer.compare();
        return Math.max(a, b);
      }
      case 'abs':
      case 'fabs':
        return Math.abs(argv()[0]);
      case 'floor':
        return Math.floor(argv()[0]);
      case 'ceil':
        return Math.ceil(argv()[0]);
      case 'sqrt':
        return Math.sqrt(argv()[0]);
      case 'pow': {
        const [a, b] = argv();
        return Math.pow(a, b);
      }
      // Output has nowhere to go here; the trace is the output.
      case 'printf':
      case 'cout':
      case 'puts':
      case 'println':
        return null;
      default:
        return NOT_A_BUILTIN;
    }
  }

  /** `Math.abs(x)`, `Arrays.fill(a, v)`, `std::swap(a, b)`. */
  private staticBuiltin(
    owner: string,
    name: string,
    e: Expr & { k: 'call' },
  ): Val | typeof NOT_A_BUILTIN {
    if (owner === 'Math') {
      const free = this.freeBuiltin(name, e, e.line);
      if (free !== NOT_A_BUILTIN) return free;
    }
    if (owner === 'Arrays' && name === 'fill') {
      const target = this.array(this.eval(e.args[0]), e.line);
      const value = this.eval(e.args[1]);
      for (let i = 0; i < target.v.length; i++) {
        this.opts.observer.write();
        target.v[i] = value;
      }
      return null;
    }
    if (owner === 'Arrays' && name === 'sort') {
      const target = this.array(this.eval(e.args[0]), e.line);
      target.v.sort((a, b) => this.num(a, e.line, 'sort') - this.num(b, e.line, 'sort'));
      return null;
    }
    if (name === 'swap' && e.args.length === 2) {
      return this.call({ ...e, callee: { k: 'name', name: 'swap', line: e.line } });
    }
    return NOT_A_BUILTIN;
  }

  /**
   * Methods on the one container type this subset has.
   *
   * `vector`, `stack`, `queue`, `Deque` and Java's `ArrayList` are one growable
   * array here, because that is the only structure the algorithms on this site
   * need. What is *not* flattened is which end each of them works from: a
   * declared container remembers its kind, so `queue::pop` drops the front and
   * `stack::pop` drops the back, and the two are never quietly the same.
   */
  private methodCall(targetExpr: Expr, name: string, e: Expr & { k: 'call' }): Val {
    const ln = e.line;
    const target = this.eval(targetExpr);
    if (isMap(target)) return this.mapMethod(target, name, e);
    if (typeof target === 'string') {
      switch (name) {
        case 'size':
        case 'length':
          return target.length;
        case 'empty':
        case 'isEmpty':
          return target.length === 0;
        case 'charAt':
        case 'at':
          return this.charAt(target, this.eval(e.args[0]), ln);
        default:
          throw new RuntimeError(`Strings here have no method "${name}"`, ln);
      }
    }
    if (!isArr(target)) {
      throw new RuntimeError(`"${name}" is not something I can call on ${describe(target)}`, ln);
    }
    const a = e.args.map((x) => this.eval(x));
    const top = () => {
      if (target.v.length === 0) {
        throw new RuntimeError(
          `"${name}" on an empty container — the guard above let an empty case through.`,
          ln,
        );
      }
      return target.v.length - 1;
    };

    const kind = target.kind ?? 'vector';
    // Java's Deque puts `push` and `pop` on the *front*, the opposite end from
    // C++'s. Rather than pick one and be silently wrong for readers of the
    // other language, both names are refused here by name.
    if (kind === 'deque' && (name === 'push' || name === 'pop')) {
      throw new RuntimeError(
        `"${name}" on a Deque works on the front in Java and the back in C++, so it is not accepted here. Say which end you mean: addFirst / addLast, pollFirst / pollLast.`,
        ln,
      );
    }
    /** The front element, with the same empty-container refusal as the back. */
    const head = () => {
      top();
      this.opts.observer.read();
      return target.v[0];
    };
    const first = () => {
      top(); // the same empty-container refusal, worded once
      this.opts.observer.write();
      return target.v.shift()!;
    };
    const last = () => {
      const i = top();
      this.opts.observer.write();
      return target.v.splice(i, 1)[0];
    };

    switch (name) {
      case 'size':
      case 'length':
        return target.v.length;
      case 'empty':
      case 'isEmpty':
        return target.v.length === 0;
      case 'push_back':
      case 'push':
      case 'add':
      case 'addLast':
      case 'offer':
      case 'offerLast':
        this.opts.observer.write();
        target.v.push(a[0]);
        return null;
      case 'addFirst':
      case 'offerFirst':
        this.opts.observer.write();
        target.v.unshift(a[0]);
        return null;
      // `pop` is the one name that genuinely differs: a queue drops the front,
      // a stack and a vector drop the back.
      case 'pop':
        return kind === 'queue' ? first() : last();
      case 'pop_back':
      case 'removeLast':
      case 'pollLast':
        return last();
      case 'poll':
      case 'pop_front':
      case 'pollFirst':
      case 'removeFirst':
        return first();
      case 'back':
      case 'top':
      case 'peekLast':
      case 'getLast':
        this.opts.observer.read();
        return target.v[top()];
      // Java's `peek` is the top of a Stack and the head of a Queue, which is
      // the same rule as `pop` and is applied the same way.
      case 'peek':
        return kind === 'stack' ? target.v[top()] : head();
      case 'front':
      case 'peekFirst':
      case 'getFirst':
        return head();
      case 'get': {
        const i = this.num(a[0], ln, '"get"');
        this.opts.observer.read();
        if (i < 0 || i >= target.v.length) {
          throw new RuntimeError(`Index ${i} is outside the container`, ln);
        }
        return target.v[i];
      }
      case 'set': {
        const i = this.num(a[0], ln, '"set"');
        this.opts.observer.write();
        if (i < 0 || i >= target.v.length) {
          throw new RuntimeError(`Index ${i} is outside the container`, ln);
        }
        const old = target.v[i];
        target.v[i] = a[1];
        return old;
      }
      case 'clear':
        target.v.length = 0;
        return null;
      case 'assign': {
        const n = this.num(a[0], ln, '"assign"');
        target.v = new Array(n).fill(a[1] ?? 0);
        return null;
      }
      default:
        throw new RuntimeError(`Containers here have no method "${name}"`, ln);
    }
  }
}

/**
 * Methods on a hash map or a hash set.
 *
 * The C++ and Java spellings both land here, because they are the same
 * operations under different names and a reader switching tabs should not have
 * to learn a second set of ideas. What is deliberately *not* smoothed over is
 * the difference between `[]` and `count`/`containsKey`: reading a missing key
 * with `[]` inserts it, in this interpreter as in C++, because that is a real
 * behaviour that surprises people and it should surprise them here first.
 */
const LIST_TYPES = new Set([
  'vector', 'ArrayList', 'LinkedList', 'List', 'ArrayDeque', 'Deque', 'Stack', 'stack', 'queue',
]);

/** What `queue<int> q;` or `Deque<Integer> q` means for the ends of the container. */
const CONTAINER_KINDS: Record<string, ContainerKind> = {
  queue: 'queue',
  stack: 'stack',
  Stack: 'stack',
  deque: 'deque',
  Deque: 'deque',
  ArrayDeque: 'deque',
  LinkedList: 'deque',
};

const kindOf = (base: string): ContainerKind => CONTAINER_KINDS[base] ?? 'vector';

const MAP_TYPES = new Set(['unordered_map', 'map', 'HashMap', 'TreeMap', 'Map']);
const SET_TYPES = new Set(['unordered_set', 'set', 'HashSet', 'TreeSet', 'Set']);

const NOT_A_BUILTIN = Symbol('not-a-builtin');

/** What a pointer points at, for display. */
function describeLValue(lv: LValue): string {
  if (lv.kind === 'var') return lv.name;
  if (lv.kind === 'slot') return `[${lv.index}]`;
  if (lv.kind === 'field') return `.${lv.name}`;
  return `[${lv.key}]`;
}

export function describe(v: Val): string {
  if (v === null) return 'null';
  if (isPtr(v)) return `a pointer to ${v.label}`;
  if (isArr(v)) return 'an array';
  if (isMap(v)) return v.isSet ? 'a set' : 'a map';
  if (isObj(v)) return `a ${v.type}`;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

export function stringify(v: Val): string {
  if (v === null) return 'null';
  // A pointer prints as what it points at, never as an address: there are no
  // addresses here, and inventing one would be a number the reader could
  // reason about wrongly.
  if (isPtr(v)) return `&${v.label}`;
  if (isArr(v)) return v.v.map(stringify).join(',');
  if (isMap(v)) {
    return v.isSet
      ? [...v.m.keys()].join(',')
      : [...v.m.entries()].map(([k, val]) => `${k}:${stringify(val)}`).join(',');
  }
  // A struct prints as the chain it heads, which is what a linked list is and
  // what the reader is comparing against. Bounded, because a list with a cycle
  // in it is a thing this subset can very easily produce.
  if (isObj(v)) return chainOf(v).join(',');
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

/** Values along `next` from a node, stopping at a repeat or at 10,000. */
export function chainOf(head: ObjVal): Val[] {
  const out: Val[] = [];
  const seen = new Set<string>();
  let at: Val = head;
  while (isObj(at) && !seen.has(at.id) && out.length < 10_000) {
    seen.add(at.id);
    out.push(at.fields.get('val') ?? at.fields.get('value') ?? null);
    at = at.fields.get('next') ?? null;
  }
  return out;
}

export { Scope };
