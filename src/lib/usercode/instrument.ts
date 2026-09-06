import { parse } from 'acorn';
import type { Node } from 'acorn';

/**
 * Turn a plain JavaScript function into one that reports what it did.
 *
 * The transform is deliberately source-level rather than a full compile: we
 * parse to find where statements begin, then splice a `yield` in front of each
 * one and turn the function into a generator. Nothing about the user's own code
 * is rewritten, so the source they read is the source that ran — which is the
 * whole point of the product and would not survive a desugaring pass.
 *
 * The yielded record carries the line number and the value of every variable
 * that is in scope at that point, which is exactly what a Trace step needs.
 */

export interface InstrumentResult {
  ok: true;
  /** The instrumented source, ready to be turned into a generator function. */
  code: string;
  /** Name of the function that was instrumented. */
  fnName: string;
  /** Parameter names, in order. */
  params: string[];
}

export interface InstrumentError {
  ok: false;
  message: string;
  /** 1-based line the problem is on, when the parser knows. */
  line?: number;
}

/* ------------------------------------------------------------------ *
 * A minimal view of the ESTree shapes we care about. acorn's own types
 * are deliberately loose here, so the walker keeps its own narrow ones.
 * ------------------------------------------------------------------ */

interface Pos {
  start: number;
  end: number;
  loc?: { start: { line: number } };
}
type AnyNode = Node & Pos & Record<string, unknown>;

const line = (n: AnyNode) => n.loc?.start.line ?? 1;

/** Names a declaration pattern introduces. Destructuring included. */
function patternNames(node: AnyNode | null | undefined, out: string[]) {
  if (!node) return;
  switch (node.type) {
    case 'Identifier':
      out.push(node.name as string);
      break;
    case 'ObjectPattern':
      for (const p of node.properties as AnyNode[]) {
        patternNames((p.value ?? p.argument) as AnyNode, out);
      }
      break;
    case 'ArrayPattern':
      for (const e of node.elements as (AnyNode | null)[]) patternNames(e, out);
      break;
    case 'AssignmentPattern':
      patternNames(node.left as AnyNode, out);
      break;
    case 'RestElement':
      patternNames(node.argument as AnyNode, out);
      break;
    default:
      break;
  }
}

interface Splice {
  at: number;
  text: string;
}

/**
 * Statement types we put a probe in front of. Declarations are excluded on
 * purpose — probing before a `let` would read it inside its temporal dead
 * zone; the probe after the statement picks the new value up instead.
 */
const PROBE_BEFORE = new Set([
  'ExpressionStatement',
  'ReturnStatement',
  'IfStatement',
  'ForStatement',
  'ForOfStatement',
  'ForInStatement',
  'WhileStatement',
  'DoWhileStatement',
  'BreakStatement',
  'ContinueStatement',
  'SwitchStatement',
]);

class Instrumenter {
  splices: Splice[] = [];
  /** Names visible at the point currently being walked. */
  scope: string[] = [];

  probe(at: number, ln: number) {
    const names = [...new Set(this.scope)];
    const snapshot = names.length ? `{${names.join(',')}}` : '{}';
    this.splices.push({ at, text: `yield[${ln},${snapshot}];` });
  }

  /** Walk a statement list, growing the visible-name set as declarations appear. */
  block(body: AnyNode[]) {
    const before = this.scope.length;
    for (const stmt of body) {
      if (PROBE_BEFORE.has(stmt.type)) this.probe(stmt.start, line(stmt));
      this.statement(stmt);
      if (stmt.type === 'VariableDeclaration') {
        for (const d of stmt.declarations as AnyNode[]) {
          patternNames(d.id as AnyNode, this.scope);
        }
        // Probe *after* a declaration, so the new binding is readable.
        this.probe(stmt.end, line(stmt));
      }
    }
    this.scope.length = before;
  }

  /**
   * A loop or branch body that is a bare statement gets braces, so a probe can
   * be placed inside it and every iteration reports even when the body is empty.
   */
  wrapBody(body: AnyNode, ln: number) {
    if (body.type === 'BlockStatement') {
      this.splices.push({ at: body.start + 1, text: `yield[${ln},{${[...new Set(this.scope)].join(',')}}];` });
      this.block(body.body as AnyNode[]);
      return;
    }
    this.splices.push({ at: body.start, text: `{yield[${ln},{${[...new Set(this.scope)].join(',')}}];` });
    this.statement(body);
    this.splices.push({ at: body.end, text: '}' });
  }

  statement(node: AnyNode) {
    switch (node.type) {
      case 'BlockStatement':
        this.block(node.body as AnyNode[]);
        break;

      case 'IfStatement':
        this.wrapBody(node.consequent as AnyNode, line(node.consequent as AnyNode));
        if (node.alternate) this.wrapBody(node.alternate as AnyNode, line(node.alternate as AnyNode));
        break;

      case 'ForStatement': {
        const before = this.scope.length;
        const init = node.init as AnyNode | null;
        if (init && init.type === 'VariableDeclaration') {
          for (const d of init.declarations as AnyNode[]) patternNames(d.id as AnyNode, this.scope);
        }
        this.wrapBody(node.body as AnyNode, line(node.body as AnyNode));
        this.scope.length = before;
        break;
      }

      case 'ForOfStatement':
      case 'ForInStatement': {
        const before = this.scope.length;
        const left = node.left as AnyNode;
        if (left.type === 'VariableDeclaration') {
          for (const d of left.declarations as AnyNode[]) patternNames(d.id as AnyNode, this.scope);
        }
        this.wrapBody(node.body as AnyNode, line(node.body as AnyNode));
        this.scope.length = before;
        break;
      }

      case 'WhileStatement':
      case 'DoWhileStatement':
        this.wrapBody(node.body as AnyNode, line(node.body as AnyNode));
        break;

      case 'SwitchStatement':
        for (const c of node.cases as AnyNode[]) this.block(c.consequent as AnyNode[]);
        break;

      case 'TryStatement':
        this.statement(node.block as AnyNode);
        if (node.handler) this.statement((node.handler as AnyNode).body as AnyNode);
        if (node.finalizer) this.statement(node.finalizer as AnyNode);
        break;

      default:
        break;
    }
  }
}

const BANNED = /\b(import|require|fetch|XMLHttpRequest|eval|Function|postMessage|localStorage|document|window|globalThis)\b/;

export function instrument(source: string, expected?: string): InstrumentResult | InstrumentError {
  if (BANNED.test(source)) {
    return {
      ok: false,
      message:
        'This runs your code for real, so it is restricted to plain computation — no imports, network calls, or access to the page.',
    };
  }

  let ast: AnyNode;
  try {
    ast = parse(source, { ecmaVersion: 2022, locations: true }) as unknown as AnyNode;
  } catch (err) {
    const e = err as { message?: string; loc?: { line?: number } };
    return { ok: false, message: e.message ?? 'Could not parse that.', line: e.loc?.line };
  }

  const fns = (ast.body as AnyNode[]).filter((n) => n.type === 'FunctionDeclaration');
  if (fns.length === 0) {
    return {
      ok: false,
      message: expected
        ? `No function found. Define one, for example: function ${expected}(...) { … }`
        : 'No function declaration found.',
    };
  }
  const fn = (expected && fns.find((f) => ((f.id as AnyNode).name as string) === expected)) || fns[0];
  const fnName = (fn.id as AnyNode).name as string;

  const params: string[] = [];
  for (const p of fn.params as AnyNode[]) patternNames(p, params);

  const inst = new Instrumenter();
  inst.scope.push(...params);
  inst.block((fn.body as AnyNode).body as AnyNode[]);

  // Apply from the end so earlier offsets stay valid.
  let out = source;
  for (const s of [...inst.splices].sort((a, b) => b.at - a.at)) {
    out = out.slice(0, s.at) + s.text + out.slice(s.at);
  }

  // `function name(` → `function* name(`, using the original offset, which the
  // splices above never touch because they all sit inside the body.
  const star = out.indexOf('function', fn.start);
  out = out.slice(0, star + 'function'.length) + '*' + out.slice(star + 'function'.length);

  return { ok: true, code: out, fnName, params };
}
