/** AST for the C-family subset the reader is allowed to write. */

export interface TypeNode {
  /** `int`, `bool`, `vector`, `Node`, … — the spelling before any decoration. */
  base: string;
  /** Element type of `vector<int>` / `stack<int>` / `Deque<Integer>`. */
  arg?: TypeNode;
  /** True for `int[]`, `int a[]`, `vector<int>`, `int*` used as an array. */
  isArray: boolean;
  /** `&` in C++ — recorded, but every array is a reference here anyway. */
  isRef: boolean;
}

export type Expr =
  | { k: 'num'; v: number; line: number }
  | { k: 'str'; v: string; line: number }
  | { k: 'bool'; v: boolean; line: number }
  | { k: 'null'; line: number }
  | { k: 'name'; name: string; line: number }
  | { k: 'index'; target: Expr; index: Expr; line: number }
  /** `obj.member` and `obj->member` alike; `arrow` is kept only for messages. */
  | { k: 'member'; target: Expr; name: string; arrow: boolean; line: number }
  | { k: 'call'; callee: Expr; args: Expr[]; line: number }
  | { k: 'unary'; op: string; arg: Expr; line: number }
  | { k: 'update'; op: '++' | '--'; arg: Expr; prefix: boolean; line: number }
  | { k: 'bin'; op: string; a: Expr; b: Expr; line: number }
  | { k: 'logical'; op: '&&' | '||'; a: Expr; b: Expr; line: number }
  | { k: 'cond'; test: Expr; yes: Expr; no: Expr; line: number }
  | { k: 'assign'; op: string; target: Expr; value: Expr; line: number }
  /** `{1, 2, 3}` and `new int[]{1, 2, 3}` — an array literal either way. */
  | { k: 'arrayLit'; items: Expr[]; line: number }
  /** `new int[n]`, `vector<int> v(n, -1)` — a run of `fill`, `n` long. */
  | { k: 'newArray'; size: Expr; fill: Expr | null; line: number }
  /** `new Node(1)`, `new HashMap<>()` — whatever the named type turns out to be. */
  | { k: 'construct'; type: string; args: Expr[]; line: number };

export interface Declarator {
  name: string;
  /** `int a[10]` / `new int[n]` — a sized array with no initialiser list. */
  arraySize: Expr | null;
  isArray: boolean;
  init: Expr | null;
}

export type Stmt =
  | { k: 'block'; body: Stmt[]; line: number }
  | { k: 'expr'; expr: Expr; line: number }
  | { k: 'decl'; type: TypeNode; decls: Declarator[]; line: number }
  | { k: 'if'; test: Expr; yes: Stmt; no: Stmt | null; line: number }
  | { k: 'while'; test: Expr; body: Stmt; line: number }
  | { k: 'do'; test: Expr; body: Stmt; line: number }
  | {
      k: 'for';
      init: Stmt | null;
      test: Expr | null;
      update: Expr[];
      body: Stmt;
      line: number;
    }
  /** `for (int x : arr)` — the range-for, identical in C++ and Java. */
  | { k: 'forEach'; name: string; iterable: Expr; body: Stmt; line: number }
  | { k: 'return'; value: Expr | null; line: number }
  | { k: 'break'; line: number }
  | { k: 'continue'; line: number }
  | { k: 'empty'; line: number };

export interface Param {
  name: string;
  type: TypeNode;
}

export interface FuncDecl {
  name: string;
  params: Param[];
  ret: TypeNode;
  body: Stmt;
  line: number;
}

/**
 * A `struct Node { int val; Node* next; };` or the Java class equivalent.
 *
 * Only the field names are kept. Their declared types would let the
 * interpreter pre-fill a sensible zero, and that is not worth the machinery:
 * every field this subset needs is either assigned before it is read or is a
 * pointer, and a pointer's sensible zero is null, which is what an unset field
 * already reads as.
 */
export interface StructDecl {
  name: string;
  fields: string[];
}

export interface Program {
  functions: FuncDecl[];
  structs: StructDecl[];
}
