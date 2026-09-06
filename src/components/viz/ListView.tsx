'use client';

import { ListStruct } from '@/lib/trace/types';

interface Props {
  struct: ListStruct;
  previous?: ListStruct;
}

const NODE_W = 92;
const NODE_H = 46;
const GAP = 40;
const NODE_Y = 96;
const PAD = 28;

const ANCHOR_STYLE: Record<string, { color: string; y: number }> = {
  head: { color: 'var(--muted)', y: 22 },
  prev: { color: 'var(--accent)', y: 44 },
  curr: { color: 'var(--probe)', y: 22 },
  next: { color: 'var(--info)', y: 44 },
  slow: { color: 'var(--accent)', y: 22 },
  fast: { color: 'var(--probe)', y: 44 },
};

export function ListView({ struct, previous }: Props) {
  const nodes = struct.nodes;
  const n = nodes.length;

  if (n === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-10">
        <div className="rounded border border-dashed border-hairline-strong px-8 py-6 font-mono text-sm text-muted">
          head → nullptr
        </div>
        <p className="max-w-sm text-center text-sm text-muted">
          An empty list. The loop body never runs, and the correct answer is null — a case a
          surprising amount of production code dereferences straight through.
        </p>
      </div>
    );
  }

  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const x = (i: number) => PAD + i * (NODE_W + GAP);
  const cx = (i: number) => x(i) + NODE_W / 2;
  const width = PAD * 2 + n * NODE_W + (n - 1) * GAP + 90;
  const height = 210;

  const prevNext = new Map(previous?.nodes.map((node) => [node.id, node.next]) ?? []);

  const anchorEntries = Object.entries(struct.anchors).filter(([k]) => k in ANCHOR_STYLE);

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="mx-auto block h-auto w-full"
        style={{ maxWidth: `${Math.min(width, 1000)}px` }}
        role="img"
        aria-label={`Linked list of ${n} nodes. ${anchorEntries
          .map(([k, v]) => `${k} points to ${v === null ? 'null' : nodes[index.get(v) ?? 0]?.value}`)
          .join('; ')}.`}
      >
        <defs>
          <marker id="ll-fwd" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
          </marker>
          <marker id="ll-back" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--probe)" />
          </marker>
          <marker id="ll-anchor" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
          </marker>
        </defs>

        {/* next-pointer arcs: forward above the row, backward below it */}
        {nodes.map((node, i) => {
          const changed = prevNext.has(node.id) && prevNext.get(node.id) !== node.next;
          if (node.next === null) {
            const sx = x(i) + NODE_W;
            // Mid-list nulls are normal during a reversal, but their label
            // would land on top of the following node — draw the stub only.
            const isLast = i === n - 1;
            return (
              <g key={`null-${node.id}`} opacity={changed ? 1 : 0.85}>
                <line
                  x1={sx}
                  y1={NODE_Y + NODE_H / 2}
                  x2={sx + 26}
                  y2={NODE_Y + NODE_H / 2}
                  stroke="var(--faint)"
                  strokeWidth="1.5"
                />
                <line
                  x1={sx + 26}
                  y1={NODE_Y + 8}
                  x2={sx + 26}
                  y2={NODE_Y + NODE_H - 8}
                  stroke="var(--faint)"
                  strokeWidth="1.5"
                />
                {isLast && (
                  <text
                    x={sx + 30}
                    y={NODE_Y + NODE_H / 2 + 22}
                    fontFamily="var(--font-mono)"
                    fontSize="10"
                    fill="var(--faint)"
                  >
                    null
                  </text>
                )}
              </g>
            );
          }

          const j = index.get(node.next);
          if (j === undefined) return null;
          const forward = j > i;
          const sx = x(i) + NODE_W * (forward ? 0.78 : 0.22);
          const tx = x(j) + NODE_W * (forward ? 0.22 : 0.78);
          const y = forward ? NODE_Y : NODE_Y + NODE_H;
          const lift = (forward ? -1 : 1) * (30 + 14 * Math.abs(j - i));
          const d = `M ${sx} ${y} C ${sx} ${y + lift}, ${tx} ${y + lift}, ${tx} ${y}`;
          return (
            <path
              key={`next-${node.id}`}
              d={d}
              fill="none"
              stroke={forward ? 'var(--accent)' : 'var(--probe)'}
              strokeWidth={changed ? 2.4 : 1.6}
              markerEnd={forward ? 'url(#ll-fwd)' : 'url(#ll-back)'}
              opacity={changed ? 1 : 0.8}
            />
          );
        })}

        {/* nodes */}
        {nodes.map((node, i) => {
          const isCurr = struct.anchors.curr === node.id;
          const isPrev = struct.anchors.prev === node.id;
          const ring = isCurr ? 'var(--probe)' : isPrev ? 'var(--accent)' : 'var(--hairline-strong)';
          return (
            <g key={node.id}>
              <rect
                x={x(i)}
                y={NODE_Y}
                width={NODE_W}
                height={NODE_H}
                rx="4"
                fill="var(--panel)"
                stroke={ring}
                strokeWidth={isCurr || isPrev ? 2 : 1.2}
              />
              <line
                x1={x(i) + NODE_W * 0.58}
                y1={NODE_Y}
                x2={x(i) + NODE_W * 0.58}
                y2={NODE_Y + NODE_H}
                stroke="var(--hairline)"
                strokeWidth="1"
              />
              <text
                x={x(i) + NODE_W * 0.29}
                y={NODE_Y + NODE_H / 2 + 5}
                textAnchor="middle"
                fontFamily="var(--font-mono)"
                fontSize="15"
                fill="var(--ink)"
              >
                {node.value}
              </text>
              <text
                x={x(i) + NODE_W * 0.79}
                y={NODE_Y + NODE_H / 2 + 4}
                textAnchor="middle"
                fontFamily="var(--font-mono)"
                fontSize="9"
                fill="var(--faint)"
              >
                next
              </text>
            </g>
          );
        })}

        {/* anchors */}
        {anchorEntries.map(([name, target]) => {
          const style = ANCHOR_STYLE[name];
          if (target === null) {
            const px = x(n - 1) + NODE_W + 30;
            return (
              <text
                key={name}
                x={px}
                y={style.y + 4}
                textAnchor="middle"
                fontFamily="var(--font-mono)"
                fontSize="11"
                fill={style.color}
              >
                {name} = null
              </text>
            );
          }
          const i = index.get(target);
          if (i === undefined) return null;
          return (
            <g key={name} style={{ color: style.color }}>
              <text
                x={cx(i)}
                y={style.y}
                textAnchor="middle"
                fontFamily="var(--font-mono)"
                fontSize="11"
                fill={style.color}
              >
                {name}
              </text>
              <line
                x1={cx(i)}
                y1={style.y + 6}
                x2={cx(i)}
                y2={NODE_Y - 6}
                stroke={style.color}
                strokeWidth="1.2"
                strokeDasharray="3 3"
                markerEnd="url(#ll-anchor)"
              />
            </g>
          );
        })}
      </svg>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 font-mono text-[0.65rem] text-muted">
        {/* Wording stays neutral: a backward link means a reversal in one
            algorithm and a cycle in another, and the view cannot tell which. */}
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: 'var(--accent)' }} />
          links forward, toward the tail
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: 'var(--probe)' }} />
          links backward, toward the head
        </span>
      </div>
    </div>
  );
}
