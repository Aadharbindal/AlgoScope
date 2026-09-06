'use client';

import { useEffect, useRef } from 'react';

/**
 * A deliberately small C++ tokenizer.
 *
 * The alternative is shipping a full highlighting library to colour nine
 * algorithms' worth of textbook C++. This covers the subset those listings
 * actually use, and gives exact control over line decoration — which is the
 * only feature the panel really needs.
 */
const KEYWORDS = new Set([
  'if', 'else', 'while', 'for', 'return', 'break', 'continue', 'void', 'int', 'bool',
  'true', 'false', 'nullptr', 'struct', 'class', 'const', 'new', 'delete', 'size_t',
]);
const TYPES = new Set(['vector', 'Node', 'string', 'pair', 'queue', 'stack', 'unordered_map']);
const FUNCS = new Set(['swap', 'push_back', 'size', 'min', 'max', 'empty', 'pop', 'push', 'front']);

type Tok = { text: string; cls: string };

function tokenizeLine(line: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);

    const comment = rest.match(/^\/\/.*/);
    if (comment) {
      out.push({ text: comment[0], cls: 'text-faint italic' });
      break;
    }

    const ws = rest.match(/^\s+/);
    if (ws) {
      out.push({ text: ws[0], cls: '' });
      i += ws[0].length;
      continue;
    }

    const word = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (word) {
      const w = word[0];
      const cls = KEYWORDS.has(w)
        ? 'text-accent'
        : TYPES.has(w)
          ? 'text-info'
          : FUNCS.has(w)
            ? 'text-probe'
            : 'text-ink';
      out.push({ text: w, cls });
      i += w.length;
      continue;
    }

    const num = rest.match(/^\d+/);
    if (num) {
      out.push({ text: num[0], cls: 'text-probe' });
      i += num[0].length;
      continue;
    }

    const op = rest.match(/^(->|<=|>=|==|!=|\+\+|--|[-+*/%<>=!&|;,.()[\]{}:&*])/);
    if (op) {
      out.push({ text: op[0], cls: 'text-muted' });
      i += op[0].length;
      continue;
    }

    out.push({ text: rest[0], cls: 'text-ink' });
    i += 1;
  }
  return out;
}

interface Props {
  code: string;
  activeLine: number;
  /** Line changed by a variant, highlighted so the edit is obvious. */
  changedLines?: number[];
  onLineClick?: (line: number) => void;
}

export function CodePanel({ code, activeLine, changedLines = [], onLineClick }: Props) {
  const lines = code.split('\n');
  const activeRef = useRef<HTMLDivElement>(null);
  const changed = new Set(changedLines);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeLine]);

  return (
    <div className="overflow-x-auto rounded-[7px] border border-hairline bg-sunk">
      <div className="min-w-fit py-1.5 font-mono text-[0.8rem] leading-[1.7]">
        {lines.map((line, idx) => {
          const n = idx + 1;
          const isActive = n === activeLine;
          const isChanged = changed.has(n);
          return (
            <div
              key={n}
              ref={isActive ? activeRef : undefined}
              onClick={onLineClick ? () => onLineClick(n) : undefined}
              className={[
                'flex gap-3 border-l-2 pr-4 transition-colors duration-100',
                isActive
                  ? 'border-l-accent bg-accent-dim'
                  : isChanged
                    ? 'border-l-danger bg-danger-dim/40'
                    : 'border-l-transparent',
                onLineClick ? 'cursor-pointer hover:bg-raised' : '',
              ].join(' ')}
            >
              <span
                className={[
                  'w-8 shrink-0 select-none pl-2 text-right tabular-nums',
                  isActive ? 'text-accent' : 'text-faint',
                ].join(' ')}
              >
                {n}
              </span>
              <code className="whitespace-pre">
                {line.length === 0 ? ' ' : tokenizeLine(line).map((t, k) => (
                  <span key={k} className={isActive ? t.cls : `${t.cls} opacity-75`}>
                    {t.text}
                  </span>
                ))}
              </code>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Line numbers where two listings differ — used to mark a variant's edit. */
export function diffLines(a: string, b: string): number[] {
  const la = a.split('\n');
  const lb = b.split('\n');
  const out: number[] = [];
  for (let i = 0; i < lb.length; i++) {
    if (la[i] !== lb[i]) out.push(i + 1);
  }
  return out;
}
