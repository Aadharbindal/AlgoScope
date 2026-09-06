/**
 * Tokeniser for the C-family subset.
 *
 * C, C++ and Java share enough surface syntax that one lexer covers all three;
 * the differences that matter (declaration spelling, array length, `null` vs
 * `nullptr`) live in the parser and the interpreter, not here.
 */

export type TokKind = 'num' | 'id' | 'punct' | 'str' | 'char' | 'eof';

export interface Tok {
  kind: TokKind;
  text: string;
  line: number;
  col: number;
}

export class SyntaxError_ extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
  }
}

/**
 * Longest match first — `>>=` must win over `>>`, which must win over `>`.
 * `<<` and `>>` are here for completeness; template angle brackets are handled
 * by the parser reading `<` and `>` as single tokens, which is why generics
 * never nest in this subset.
 */
const PUNCT = [
  '<<=', '>>=',
  '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '::',
  '(', ')', '[', ']', '{', '}', ';', ',', '.',
  '+', '-', '*', '/', '%', '<', '>', '=', '!', '&', '|', '^', '~', '?', ':',
];

const isDigit = (c: string) => c >= '0' && c <= '9';
const isIdStart = (c: string) => /[A-Za-z_$]/.test(c);
const isIdPart = (c: string) => /[A-Za-z0-9_$]/.test(c);

export function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;

  const push = (kind: TokKind, text: string, at: number) =>
    out.push({ kind, text, line, col: at - lineStart + 1 });

  while (i < src.length) {
    const c = src[i];

    if (c === '\n') {
      line++;
      i++;
      lineStart = i;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }

    // `#include`, `#define` — the reader pasted a real file; skip the line.
    // Leading whitespace is allowed: a directive indented inside a pasted
    // block is still a directive, and refusing it would be a lexer being
    // fussy about something that has no meaning here either way.
    if (c === '#' && src.slice(lineStart, i).trim() === '') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }

    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') {
          line++;
          lineStart = i + 1;
        }
        i++;
      }
      i += 2;
      continue;
    }

    if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) {
      const start = i;
      while (i < src.length && /[0-9.eExXa-fA-F]/.test(src[i])) {
        // `1e+5` — the sign belongs to the exponent, not to a following operator
        if ((src[i] === 'e' || src[i] === 'E') && /[+-]/.test(src[i + 1] ?? '')) i++;
        i++;
      }
      while (i < src.length && /[uUlLfF]/.test(src[i])) i++; // 1L, 0u, 2.0f
      push('num', src.slice(start, i), start);
      continue;
    }

    if (isIdStart(c)) {
      const start = i;
      while (i < src.length && isIdPart(src[i])) i++;
      push('id', src.slice(start, i), start);
      continue;
    }

    if (c === '"' || c === "'") {
      const quote = c;
      const start = i;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i++;
        if (src[i] === '\n') throw new SyntaxError_('Unterminated string', line);
        i++;
      }
      i++;
      push(quote === '"' ? 'str' : 'char', src.slice(start + 1, i - 1), start);
      continue;
    }

    const p = PUNCT.find((q) => src.startsWith(q, i));
    if (p) {
      push('punct', p, i);
      i += p.length;
      continue;
    }

    throw new SyntaxError_(`Unexpected character "${c}"`, line);
  }

  out.push({ kind: 'eof', text: '', line, col: 1 });
  return out;
}
