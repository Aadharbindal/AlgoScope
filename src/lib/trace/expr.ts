/**
 * A deliberately tiny expression language for Lens specs.
 *
 * Supports: numbers, identifiers, arr[i] indexing, + - * / %, unary -, !,
 * comparisons, && ||, ternary, parentheses, and the calls min/max/abs/floor.
 *
 * It exists instead of `new Function(...)` for two reasons: lenses will one
 * day be produced by an inference layer rather than by us, and evaluating
 * untrusted strings as JavaScript is exactly how that becomes a security
 * incident. This evaluator can only read the scope it is handed.
 */

export type Scope = Record<string, number | string | boolean | null | number[]>;

type Tok =
  | { t: 'num'; v: number }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string };

const OPS3 = ['===', '!=='];
const OPS2 = ['<=', '>=', '==', '!=', '&&', '||'];
const OPS1 = '+-*/%<>!?:()[],'.split('');

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n') {
      i++;
      continue;
    }
    if (c >= '0' && c <= '9') {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      out.push({ t: 'num', v: parseFloat(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j++;
      out.push({ t: 'id', v: src.slice(i, j) });
      i = j;
      continue;
    }
    const three = src.slice(i, i + 3);
    if (OPS3.includes(three)) {
      out.push({ t: 'op', v: three });
      i += 3;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (OPS2.includes(two)) {
      out.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if (OPS1.includes(c)) {
      out.push({ t: 'op', v: c });
      i += 1;
      continue;
    }
    throw new Error(`expr: unexpected character ${JSON.stringify(c)} in ${JSON.stringify(src)}`);
  }
  return out;
}

/** Binding power for binary operators; higher binds tighter. */
const BP: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '===': 3,
  '!==': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
};

type Val = number | string | boolean | null | number[];

const FNS: Record<string, (...a: number[]) => number> = {
  min: Math.min,
  max: Math.max,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  log2: Math.log2,
  /** 1 when the variable exists in scope, 0 otherwise. */
  defined: (x: number) => (Number.isNaN(x) ? 0 : 1),
};

class Parser {
  private p = 0;
  constructor(private toks: Tok[], private scope: Scope) {}

  private peek(): Tok | undefined {
    return this.toks[this.p];
  }

  private eat(v: string) {
    const t = this.toks[this.p];
    if (!t || t.t !== 'op' || t.v !== v) {
      throw new Error(`expr: expected ${v}`);
    }
    this.p++;
  }

  parse(): Val {
    const v = this.ternary();
    if (this.p !== this.toks.length) throw new Error('expr: trailing input');
    return v;
  }

  private ternary(): Val {
    const cond = this.binary(0);
    const t = this.peek();
    if (t && t.t === 'op' && t.v === '?') {
      this.p++;
      const a = this.ternary();
      this.eat(':');
      const b = this.ternary();
      return truthy(cond) ? a : b;
    }
    return cond;
  }

  private binary(minBp: number): Val {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (!t || t.t !== 'op') break;
      const bp = BP[t.v];
      if (bp === undefined || bp < minBp) break;
      this.p++;
      // Short-circuit so `i < n && arr[i] > 0` cannot index out of bounds.
      if (t.v === '&&') {
        if (!truthy(left)) {
          this.binary(bp + 1);
          left = false;
          continue;
        }
        left = truthy(this.binary(bp + 1));
        continue;
      }
      if (t.v === '||') {
        if (truthy(left)) {
          this.binary(bp + 1);
          left = true;
          continue;
        }
        left = truthy(this.binary(bp + 1));
        continue;
      }
      const right = this.binary(bp + 1);
      left = apply(t.v, left, right);
    }
    return left;
  }

  private unary(): Val {
    const t = this.peek();
    if (t && t.t === 'op' && t.v === '-') {
      this.p++;
      return -num(this.unary());
    }
    if (t && t.t === 'op' && t.v === '!') {
      this.p++;
      return !truthy(this.unary());
    }
    return this.postfix();
  }

  private postfix(): Val {
    let v = this.primary();
    for (;;) {
      const t = this.peek();
      if (t && t.t === 'op' && t.v === '[') {
        this.p++;
        const idx = num(this.ternary());
        this.eat(']');
        if (!Array.isArray(v)) throw new Error('expr: indexing a non-array');
        v = idx >= 0 && idx < v.length ? v[idx] : NaN;
        continue;
      }
      break;
    }
    return v;
  }

  private primary(): Val {
    const t = this.peek();
    if (!t) throw new Error('expr: unexpected end');
    if (t.t === 'num') {
      this.p++;
      return t.v;
    }
    if (t.t === 'id') {
      this.p++;
      if (t.v === 'true') return true;
      if (t.v === 'false') return false;
      if (t.v === 'null') return null;
      const next = this.peek();
      if (next && next.t === 'op' && next.v === '(') {
        const fn = FNS[t.v];
        if (!fn) throw new Error(`expr: unknown function ${t.v}`);
        this.p++;
        const args: number[] = [];
        if (!(this.peek()?.t === 'op' && this.peek()?.v === ')')) {
          for (;;) {
            args.push(num(this.ternary()));
            const c = this.peek();
            if (c && c.t === 'op' && c.v === ',') {
              this.p++;
              continue;
            }
            break;
          }
        }
        this.eat(')');
        return fn(...args);
      }
      if (!(t.v in this.scope)) return NaN;
      return this.scope[t.v] as Val;
    }
    if (t.v === '(') {
      this.p++;
      const v = this.ternary();
      this.eat(')');
      return v;
    }
    throw new Error(`expr: unexpected token ${t.v}`);
  }
}

function truthy(v: Val): boolean {
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  return Boolean(v);
}

function num(v: Val): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null) return NaN;
  if (Array.isArray(v)) return NaN;
  const n = parseFloat(v);
  return Number.isNaN(n) ? NaN : n;
}

function apply(op: string, a: Val, b: Val): Val {
  switch (op) {
    case '+':
      return num(a) + num(b);
    case '-':
      return num(a) - num(b);
    case '*':
      return num(a) * num(b);
    case '/':
      return num(a) / num(b);
    case '%':
      return num(a) % num(b);
    case '<':
      return num(a) < num(b);
    case '<=':
      return num(a) <= num(b);
    case '>':
      return num(a) > num(b);
    case '>=':
      return num(a) >= num(b);
    case '==':
    case '===':
      return a === b;
    case '!=':
    case '!==':
      return a !== b;
    default:
      throw new Error(`expr: unknown operator ${op}`);
  }
}

const cache = new Map<string, Tok[]>();

/** Evaluate an expression against a scope. Never throws at call sites. */
export function evalExpr(src: string | number, scope: Scope): Val {
  if (typeof src === 'number') return src;
  try {
    let toks = cache.get(src);
    if (!toks) {
      toks = lex(src);
      cache.set(src, toks);
    }
    return new Parser(toks, scope).parse();
  } catch {
    return NaN;
  }
}

export function evalNumber(src: string | number, scope: Scope): number {
  return num(evalExpr(src, scope));
}

export function evalBool(src: string | number, scope: Scope): boolean {
  return truthy(evalExpr(src, scope));
}
