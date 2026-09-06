import { Declarator, Expr, FuncDecl, Param, Program, Stmt, StructDecl, TypeNode } from './ast';
import { lex, SyntaxError_, Tok } from './lexer';

/**
 * Recursive-descent parser for the C-family subset.
 *
 * The subset is chosen by what the algorithms on this site actually need:
 * ints, booleans, arrays, functions, and the four control-flow statements.
 * Anything outside it is refused with a message naming the construct rather
 * than silently mis-parsed — a parser that guesses would produce a trace of
 * code the reader did not write, which is the one thing that must never
 * happen here.
 */

/**
 * Type-name spellings that unambiguously begin a declaration.
 *
 * Grows as the source is read: a `struct Node { … }` adds `Node`, so the
 * declarations below it parse as declarations rather than as expressions. That
 * is the classic reason C cannot be parsed without a symbol table, and this is
 * the smallest version of the fix.
 */
const TYPE_WORDS = new Set([
  'int', 'long', 'short', 'char', 'bool', 'boolean', 'float', 'double', 'void',
  'unsigned', 'signed', 'auto', 'var', 'size_t', 'Integer', 'Long', 'Double',
  'Boolean', 'String', 'string', 'vector', 'stack', 'queue', 'deque', 'array',
  'Node', 'struct',
]);

/** Container types that can be written with a size, as `vector<int>(n, 0)`. */
const SIZED_TYPES = new Set(['vector', 'array']);

/** Modifiers to swallow and ignore — they change nothing we model. */
const MODIFIERS = new Set([
  'const', 'static', 'public', 'private', 'protected', 'final', 'inline', 'constexpr',
]);

class Parser {
  private i = 0;

  constructor(private readonly toks: Tok[]) {}

  private get tok(): Tok {
    return this.toks[this.i];
  }

  /** A method, not a `kind` comparison: control-flow narrowing on the `tok`
   *  getter would otherwise convince the checker that eof is unreachable. */
  private atEof(): boolean {
    return this.toks[this.i].kind === 'eof';
  }

  private at(text: string, ahead = 0): boolean {
    const t = this.toks[this.i + ahead];
    return t !== undefined && t.text === text && t.kind !== 'str' && t.kind !== 'char';
  }

  private eat(text: string): boolean {
    if (this.at(text)) {
      this.i++;
      return true;
    }
    return false;
  }

  /**
   * `vector<vector<int>>` ends in a single `>>` token, because the lexer has
   * no way to know a shift operator from two closing brackets. Split it in
   * place when a `>` is what we are looking for — which is the same thing C++
   * compilers had to be taught to do, and for the same reason.
   */
  private splitGt() {
    const t = this.toks[this.i];
    if (t && t.kind === 'punct' && (t.text === '>>' || t.text === '>>=')) {
      this.toks[this.i] = { ...t, text: '>' };
      this.toks.splice(this.i + 1, 0, { ...t, text: t.text.slice(1), col: t.col + 1 });
    }
  }

  private expect(text: string, why?: string): Tok {
    if (!this.at(text)) {
      this.fail(`Expected "${text}"${why ? ` ${why}` : ''}, found "${this.tok.text || 'end of file'}"`);
    }
    return this.toks[this.i++];
  }

  private fail(message: string): never {
    throw new SyntaxError_(message, this.tok.line);
  }

  private ident(why: string): string {
    if (this.tok.kind !== 'id') this.fail(`Expected ${why}, found "${this.tok.text || 'end of file'}"`);
    return this.toks[this.i++].text;
  }

  /* ------------------------------- program ------------------------------- */

  parse(): Program {
    const functions: FuncDecl[] = [];
    const structs: StructDecl[] = [];
    while (!this.atEof()) {
      if (this.eat(';')) continue;
      // `using namespace std;`, `using std::vector;` — the first two lines of
      // most pasted C++, and meaningless here because there are no namespaces
      // to bring anything in from. Skipped rather than refused: a reader whose
      // file will not even parse learns nothing about their algorithm.
      if (this.at('using')) {
        while (!this.at(';') && !this.atEof()) this.i++;
        this.eat(';');
        continue;
      }
      // A `class Foo { … }` or `struct Node { … }` wrapper: read through it,
      // keeping the methods so a Java file pasted whole still works, and the
      // field names so `node->next` means something.
      if (this.at('class') || (this.at('struct') && this.isTypeDeclBlock())) {
        this.typeBlock(functions, structs);
        continue;
      }
      functions.push(this.funcDecl());
    }
    if (functions.length === 0) this.fail('No function found. Write one function for this problem.');
    return { functions, structs };
  }

  /**
   * The names a loop or declaration binds: one, or several in brackets.
   *
   * `auto [v, w] : adj[u]` is how the weighted-graph listing on this site is
   * written, so a reader copying what is on the page needs it to parse. Each
   * name takes one element of the pair the container holds.
   */
  private bindingNames(): string[] {
    if (!this.eat('[')) return [this.ident('a loop variable')];
    const names: string[] = [];
    do {
      names.push(this.ident('a name to bind'));
    } while (this.eat(','));
    this.expect(']', 'to close the binding list');
    return names;
  }

  /** `struct Node { … };` — a type, not a variable of type struct. */
  private isTypeDeclBlock(): boolean {
    return this.toks[this.i + 1]?.kind === 'id' && this.at('{', 2);
  }

  private typeBlock(into: FuncDecl[], structs: StructDecl[]) {
    this.i++; // class / struct
    const name = this.tok.kind === 'id' ? this.toks[this.i++].text : 'anonymous';
    const fields: string[] = [];

    // `class Solution extends X implements Y` / `struct Node : Base`
    while (!this.at('{') && !this.atEof()) this.i++;
    this.expect('{');
    while (!this.at('}')) {
      if (this.atEof()) this.fail('Unclosed class or struct body');
      if (this.eat(';')) continue;
      // A constructor: the type's own name, then `(`. Refused by name rather
      // than skipped, and deliberately. Skipping it would leave `new Node(7)`
      // filling the fields positionally, which is right for the usual
      // `Node(int v) : val(v), next(nullptr) {}` and silently wrong for a
      // constructor that computes anything — and a silently wrong answer is
      // the one thing this interpreter must not produce.
      if (this.at(name) && this.at('(', 1)) {
        this.fail(
          `"${name}" has a constructor, which is not modelled here. Remove it — "new ${name}(…)" fills the fields in the order they are declared.`,
        );
      }

      const save = this.i;
      if (this.looksLikeFunction()) {
        into.push(this.funcDecl());
        continue;
      }
      // A field declaration. Its name is the last identifier before the
      // semicolon, which handles `int val;`, `struct Node* next;` and
      // `Node next;` without needing to resolve the type.
      this.i = save;
      let last: string | null = null;
      while (!this.at(';') && !this.atEof()) {
        if (this.tok.kind === 'id') last = this.tok.text;
        this.i++;
      }
      this.eat(';');
      if (last) fields.push(last);
    }
    this.expect('}');
    this.eat(';');

    structs.push({ name, fields });
    TYPE_WORDS.add(name);
  }

  /** Type, name, `(` — the only shape a definition takes in this subset. */
  private looksLikeFunction(): boolean {
    const save = this.i;
    try {
      this.type();
      if (this.tok.kind !== 'id') return false;
      this.i++;
      return this.at('(');
    } catch {
      return false;
    } finally {
      this.i = save;
    }
  }

  private funcDecl(): FuncDecl {
    const line = this.tok.line;
    const ret = this.type();
    const name = this.ident('a function name');
    this.expect('(', 'after the function name');

    const params: Param[] = [];
    if (!this.at(')')) {
      do {
        const type = this.type();
        const pname = this.ident('a parameter name');
        // `int arr[]` — the brackets trail the name in C, and a second pair
        // (`int g[][32]`) means a two-dimensional one. The sizes are ignored:
        // the array handed in already has the length it has.
        while (this.at('[')) {
          this.i++;
          if (!this.at(']')) this.expression();
          this.expect(']');
          type.isArray = true;
        }
        params.push({ name: pname, type });
      } while (this.eat(','));
    }
    this.expect(')', 'to close the parameter list');

    // `const` / `noexcept` / `throws IOException` before the body
    while (!this.at('{') && !this.atEof()) this.i++;
    if (this.atEof()) this.fail(`Function "${name}" has no body`);

    return { name, params, ret, body: this.block(), line };
  }

  /* -------------------------------- types -------------------------------- */

  private type(): TypeNode {
    while (this.tok.kind === 'id' && MODIFIERS.has(this.tok.text)) this.i++;
    if (this.tok.kind !== 'id') this.fail(`Expected a type, found "${this.tok.text || 'end of file'}"`);

    let base = this.toks[this.i++].text;
    // `unsigned int`, `long long`, `struct Node`
    while (
      this.tok.kind === 'id' &&
      (TYPE_WORDS.has(this.tok.text) || MODIFIERS.has(this.tok.text)) &&
      !this.at('(', 1)
    ) {
      base = this.toks[this.i++].text;
    }

    const node: TypeNode = { base, isArray: false, isRef: false };

    if (this.eat('<')) {
      // `vector<int>`, `Deque<Integer>`, `ArrayDeque<>` — and the two-argument
      // forms, `unordered_map<int, int>` and `HashMap<Integer, Integer>`. Only
      // the first is kept: nothing in this subset varies its behaviour by the
      // value type, and pretending to model it would be pretending.
      this.splitGt();
      if (!this.at('>')) {
        node.arg = this.type();
        while (this.eat(',')) this.type();
      }
      this.splitGt();
      this.expect('>', 'to close the type argument');
      if (base === 'vector' || base === 'array' || base === 'stack' || base === 'deque' ||
          base === 'queue' || base === 'Deque' || base === 'Stack' || base === 'List' ||
          base === 'ArrayList' || base === 'ArrayDeque') {
        node.isArray = true;
      }
    }

    while (this.at('*') || this.at('&')) {
      if (this.eat('&')) node.isRef = true;
      else {
        this.i++;
        node.isArray = true; // `int*` is only ever used as an array here
      }
    }
    // `int[] a` — Java's brackets sit on the type
    while (this.at('[') && this.at(']', 1)) {
      this.i += 2;
      node.isArray = true;
    }

    return node;
  }

  /**
   * Is the statement at the cursor a declaration?
   *
   * Ambiguity here is the classic C parsing problem, but the subset is small:
   * a declaration starts with a known type word, or reads `Ident Ident`,
   * `Ident* Ident`, `Ident& Ident` or `Ident[] Ident`.
   */
  private isDecl(): boolean {
    const t = this.tok;
    if (t.kind !== 'id') return false;
    if (MODIFIERS.has(t.text)) return true;
    if (TYPE_WORDS.has(t.text)) return true;

    const save = this.i;
    try {
      this.type();
      return this.tok.kind === 'id' && !this.at('(', 1);
    } catch {
      return false;
    } finally {
      this.i = save;
    }
  }

  /* ------------------------------ statements ----------------------------- */

  private block(): Stmt {
    const line = this.tok.line;
    this.expect('{');
    const body: Stmt[] = [];
    while (!this.at('}')) {
      if (this.atEof()) this.fail('Unclosed "{"');
      body.push(this.statement());
    }
    this.expect('}');
    return { k: 'block', body, line };
  }

  private statement(): Stmt {
    const line = this.tok.line;

    if (this.at('{')) return this.block();
    if (this.eat(';')) return { k: 'empty', line };

    if (this.at('if')) {
      this.i++;
      this.expect('(', 'after "if"');
      const test = this.expression();
      this.expect(')');
      const yes = this.statement();
      const no = this.eat('else') ? this.statement() : null;
      return { k: 'if', test, yes, no, line };
    }

    if (this.at('while')) {
      this.i++;
      this.expect('(', 'after "while"');
      const test = this.expression();
      this.expect(')');
      return { k: 'while', test, body: this.statement(), line };
    }

    if (this.at('do')) {
      this.i++;
      const body = this.statement();
      this.expect('while', 'after the "do" body');
      this.expect('(');
      const test = this.expression();
      this.expect(')');
      this.expect(';');
      return { k: 'do', test, body, line };
    }

    if (this.at('for')) {
      this.i++;
      this.expect('(', 'after "for"');

      // `for (int x : arr)` — decide by scanning for a `:` before the `;`
      const save = this.i;
      if (this.isRangeFor()) {
        this.type();
        const names = this.bindingNames();
        this.expect(':');
        const iterable = this.expression();
        this.expect(')');
        return { k: 'forEach', names, iterable, body: this.statement(), line };
      }
      this.i = save;

      let init: Stmt | null = null;
      if (!this.eat(';')) {
        init = this.isDecl() ? this.declaration() : this.exprStatement();
      }
      const test = this.at(';') ? null : this.expression();
      this.expect(';', 'after the loop condition');
      const update: Expr[] = [];
      if (!this.at(')')) {
        do {
          update.push(this.expression());
        } while (this.eat(','));
      }
      this.expect(')');
      return { k: 'for', init, test, update, body: this.statement(), line };
    }

    if (this.at('return')) {
      this.i++;
      // `return {left, right};` — C++ braced-init for a vector return.
      const value = this.at(';') ? null : this.at('{') ? this.arrayLiteral() : this.expression();
      this.expect(';', 'after "return"');
      return { k: 'return', value, line };
    }

    if (this.at('break')) {
      this.i++;
      this.expect(';');
      return { k: 'break', line };
    }
    if (this.at('continue')) {
      this.i++;
      this.expect(';');
      return { k: 'continue', line };
    }
    if (this.at('switch') || this.at('goto') || this.at('try') || this.at('throw')) {
      this.fail(`"${this.tok.text}" is not supported here — use if / while / for.`);
    }

    if (this.isDecl()) return this.declaration();
    return this.exprStatement();
  }

  private isRangeFor(): boolean {
    let depth = 0;
    for (let k = this.i; k < this.toks.length; k++) {
      const t = this.toks[k];
      if (t.kind !== 'punct') continue;
      if (t.text === '(' || t.text === '[') depth++;
      else if (t.text === ')' || t.text === ']') {
        if (depth === 0) return false;
        depth--;
      } else if (depth === 0 && t.text === ';') return false;
      else if (depth === 0 && t.text === ':') return true;
    }
    return false;
  }

  private declaration(): Stmt {
    const line = this.tok.line;

    // `auto [r, c] = q.front();` — one value taken apart into names.
    if ((this.at('auto') || this.at('var')) && this.at('[', 1)) {
      this.i++;
      const names = this.bindingNames();
      this.expect('=', 'after a destructuring declaration');
      const value = this.expression();
      this.expect(';', 'after the declaration');
      return { k: 'destructure', names, value, line };
    }

    const type = this.type();
    const decls: Declarator[] = [];

    do {
      const name = this.ident('a variable name');
      let isArray = type.isArray;
      let arraySize: Expr | null = null;

      // `int arr[10]` / `int arr[]` / `int dist[rows][cols]`
      const dims: (Expr | null)[] = [];
      while (this.at('[')) {
        this.i++;
        isArray = true;
        dims.push(this.at(']') ? null : this.expression());
        this.expect(']');
      }
      arraySize = dims.length ? dims[0] : null;

      let init: Expr | null = null;
      if (this.eat('=')) {
        init = this.at('{') ? this.arrayLiteral() : this.expression();
      } else if (this.at('(') && type.isArray) {
        // `vector<int> ans(n, -1);`
        this.i++;
        const size = this.expression();
        const fill = this.eat(',') ? this.expression() : null;
        this.expect(')');
        init = { k: 'newArray', size, fill, line };
      } else if (this.at('(') ) {
        // `stack<int> st();` or a constructor call we do not model
        this.i++;
        while (!this.at(')') && !this.atEof()) this.i++;
        this.expect(')');
      }

      if (init === null && isArray && arraySize) {
        // `int dist[rows][cols]` is rows arrays of cols ints, and each row has
        // to be its own array — one row shared by reference would make every
        // write to dist[0][j] appear in every other row.
        init = dims.reduceRight<Expr | null>(
          (fill, size) => (size === null ? fill : { k: 'newArray', size, fill, line }),
          null,
        );
      }
      decls.push({ name, isArray, arraySize, init });
    } while (this.eat(','));

    this.expect(';', 'after the declaration');
    return { k: 'decl', type, decls, line };
  }

  private arrayLiteral(): Expr {
    const line = this.tok.line;
    this.expect('{');
    const items: Expr[] = [];
    if (!this.at('}')) {
      do {
        if (this.at('}')) break; // trailing comma
        items.push(this.expression());
      } while (this.eat(','));
    }
    this.expect('}');
    return { k: 'arrayLit', items, line };
  }

  private exprStatement(): Stmt {
    const line = this.tok.line;
    const expr = this.expression();
    this.expect(';', 'after the expression');
    return { k: 'expr', expr, line };
  }

  /* ----------------------------- expressions ----------------------------- */

  expression(): Expr {
    return this.assignment();
  }

  private assignment(): Expr {
    const left = this.conditional();
    const ops = ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>='];
    const op = ops.find((o) => this.at(o));
    if (op) {
      const line = this.tok.line;
      this.i++;
      const value = this.at('{') ? this.arrayLiteral() : this.assignment();
      return { k: 'assign', op, target: left, value, line };
    }
    return left;
  }

  private conditional(): Expr {
    const test = this.binary(0);
    if (this.at('?')) {
      const line = this.tok.line;
      this.i++;
      const yes = this.assignment();
      this.expect(':', 'in the ?: expression');
      const no = this.assignment();
      return { k: 'cond', test, yes, no, line };
    }
    return test;
  }

  /** Lowest binding first; index 0 is `||`. */
  private static readonly LEVELS: string[][] = [
    ['||'],
    ['&&'],
    ['|'],
    ['^'],
    ['&'],
    ['==', '!='],
    ['<', '<=', '>', '>='],
    ['<<', '>>'],
    ['+', '-'],
    ['*', '/', '%'],
  ];

  private binary(level: number): Expr {
    if (level >= Parser.LEVELS.length) return this.unary();
    let left = this.binary(level + 1);
    for (;;) {
      const op = Parser.LEVELS[level].find((o) => this.at(o));
      if (!op) return left;
      const line = this.tok.line;
      this.i++;
      const right = this.binary(level + 1);
      left =
        op === '&&' || op === '||'
          ? { k: 'logical', op, a: left, b: right, line }
          : { k: 'bin', op, a: left, b: right, line };
    }
  }

  private unary(): Expr {
    const line = this.tok.line;
    if (this.at('++') || this.at('--')) {
      const op = this.toks[this.i++].text as '++' | '--';
      return { k: 'update', op, arg: this.unary(), prefix: true, line };
    }
    if (this.at('!') || this.at('-') || this.at('+') || this.at('~')) {
      const op = this.toks[this.i++].text;
      return { k: 'unary', op, arg: this.unary(), line };
    }
    // `*p` and `&x`. C's way of giving a function something to write through,
    // and the shape the C listings on this site are written in — so a reader
    // who copies what is on the page has to be able to run it.
    if (this.at('*') || this.at('&')) {
      const op = this.toks[this.i++].text;
      return { k: 'unary', op: op === '*' ? 'deref' : 'addr', arg: this.unary(), line };
    }
    // `(int)(a + b)` — a cast, which we honour by truncating.
    if (this.at('(') && this.toks[this.i + 1]?.kind === 'id' &&
        TYPE_WORDS.has(this.toks[this.i + 1].text) && this.at(')', 2)) {
      const to = this.toks[this.i + 1].text;
      this.i += 3;
      return { k: 'unary', op: `cast:${to}`, arg: this.unary(), line };
    }
    if (this.at('new')) {
      this.i++;
      const type = this.type(); // `int[]` in `new int[]{…}` — brackets go with the type
      if (this.at('{')) return this.arrayLiteral();
      if (this.eat('[')) {
        if (this.at(']')) {
          this.i++;
          return this.arrayLiteral(); // new int[]{1, 2, 3}
        }
        // `new int[n]`, and `new int[n][m]` — the second dimension becomes the
        // fill, which the interpreter builds afresh for every row.
        const sizes: Expr[] = [this.expression()];
        this.expect(']');
        while (this.eat('[')) {
          sizes.push(this.expression());
          this.expect(']');
        }
        return sizes.reduceRight<Expr | null>(
          (fill, size) => ({ k: 'newArray', size, fill, line }),
          null,
        )!;
      }
      // `new Node(1)`, `new ArrayDeque<>()`, `new HashMap<>()` — the arguments
      // are kept, and what gets built is decided by the interpreter, which is
      // the only part that knows which names are structs.
      const args: Expr[] = [];
      if (this.eat('(')) {
        if (!this.at(')')) {
          do {
            args.push(this.expression());
          } while (this.eat(','));
        }
        this.expect(')');
      }
      return { k: 'construct', type: type.base, args, line };
    }
    return this.postfix();
  }

  private postfix(): Expr {
    let e = this.primary();
    for (;;) {
      const line = this.tok.line;
      if (this.eat('[')) {
        const index = this.expression();
        this.expect(']', 'to close the index');
        e = { k: 'index', target: e, index, line };
      } else if (this.at('.') || this.at('->')) {
        const arrow = this.tok.text === '->';
        this.i++;
        e = { k: 'member', target: e, name: this.ident('a member name'), arrow, line };
      } else if (this.eat('(')) {
        const args: Expr[] = [];
        if (!this.at(')')) {
          do {
            args.push(this.expression());
          } while (this.eat(','));
        }
        this.expect(')', 'to close the argument list');
        e = { k: 'call', callee: e, args, line };
      } else if (this.at('++') || this.at('--')) {
        const op = this.toks[this.i++].text as '++' | '--';
        e = { k: 'update', op, arg: e, prefix: false, line };
      } else {
        return e;
      }
    }
  }

  private primary(): Expr {
    const t = this.tok;
    const line = t.line;

    // `vector<int>(m + 1, 0)` — a sized container written inline, which is how
    // the inner rows of a two-dimensional vector are always spelled. Without
    // this the `<` would be read as a comparison and the error would be about
    // something else entirely.
    if (t.kind === 'id' && SIZED_TYPES.has(t.text) && this.at('<', 1)) {
      this.type();
      this.expect('(', 'after a sized container type');
      const size = this.expression();
      const fill = this.eat(',') ? this.expression() : null;
      this.expect(')', 'to close the container size');
      return { k: 'newArray', size, fill, line };
    }

    // `q.push({0, 0})` — a braced pair as an argument, which is how the grid
    // listing on this site queues a cell.
    if (this.at('{')) return this.arrayLiteral();

    if (t.kind === 'num') {
      this.i++;
      const text = t.text.replace(/[uUlLfF]+$/, '');
      const v = Number(text);
      if (!Number.isFinite(v)) this.fail(`"${t.text}" is not a number I can read`);
      return { k: 'num', v, line };
    }
    if (t.kind === 'str') {
      this.i++;
      return { k: 'str', v: t.text, line };
    }
    if (t.kind === 'char') {
      this.i++;
      return { k: 'num', v: t.text.charCodeAt(0), line };
    }
    if (this.eat('(')) {
      const e = this.expression();
      this.expect(')', 'to close the group');
      return e;
    }
    if (t.kind === 'id') {
      this.i++;
      if (t.text === 'true') return { k: 'bool', v: true, line };
      if (t.text === 'false') return { k: 'bool', v: false, line };
      if (t.text === 'nullptr' || t.text === 'null' || t.text === 'NULL') return { k: 'null', line };
      // `std::swap`, `Math.abs` — keep only the last name; the interpreter's
      // builtins are matched on it.
      if (this.eat('::')) return { k: 'name', name: this.ident('a name after "::"'), line };
      return { k: 'name', name: t.text, line };
    }

    this.fail(`Unexpected "${t.text || 'end of file'}"`);
  }
}

export type ParseResult =
  | { ok: true; program: Program }
  | { ok: false; message: string; line: number };

export function parse(src: string): ParseResult {
  try {
    return { ok: true, program: new Parser(lex(src)).parse() };
  } catch (err) {
    if (err instanceof SyntaxError_) return { ok: false, message: err.message, line: err.line };
    return { ok: false, message: err instanceof Error ? err.message : String(err), line: 1 };
  }
}
