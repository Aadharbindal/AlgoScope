'use client';

import { ResolvedView } from '@/lib/trace/lens';
import { Frame, SeqStruct, Step, Struct } from '@/lib/trace/types';
import { ArrayView, RegionLegend } from './ArrayView';
import { TextView } from './TextView';
import { GraphLegend, GraphView } from './GraphView';
import { GridLegend, GridView } from './GridView';
import { ListView } from './ListView';
import { TableLegend, TableView } from './TableView';
import { TreeLegend, TreeView } from './TreeView';

export function SeqView({ struct, previous }: { struct: SeqStruct; previous?: SeqStruct }) {
  const grew = previous ? struct.values.length > previous.values.length : false;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {struct.values.length === 0 ? (
        <span className="font-mono text-xs text-faint">empty</span>
      ) : (
        struct.values.map((v, i) => {
          const isNewest = grew && i === struct.values.length - 1;
          return (
            <span
              key={`${i}-${isNewest ? struct.values.length : 's'}`}
              className={[
                'rounded-[3px] border px-2 py-1 font-mono text-xs tabular-nums',
                isNewest
                  ? 'border-accent-edge bg-accent-dim text-ink flash'
                  : 'border-hairline bg-panel text-ink-2',
              ].join(' ')}
            >
              {String(v)}
            </span>
          );
        })
      )}
    </div>
  );
}

export function CallStackView({ frames }: { frames: Frame[] }) {
  if (frames.length === 0) {
    return <p className="font-mono text-xs text-faint">stack empty</p>;
  }
  return (
    <div className="flex flex-col-reverse gap-1">
      {frames.map((f, i) => {
        const innermost = i === frames.length - 1;
        return (
          <div
            key={`${f.label}-${i}`}
            className={[
              'flex items-center gap-2 rounded-[3px] border px-2 py-1.5 font-mono text-xs',
              innermost
                ? 'border-accent-edge bg-accent-dim text-ink'
                : 'border-hairline bg-panel text-muted',
            ].join(' ')}
            style={{ marginLeft: `${Math.min(i, 8) * 10}px` }}
          >
            <span className="text-[0.6rem] text-faint tabular-nums">{i}</span>
            <span className="truncate">{f.label}</span>
            {innermost && <span className="ml-auto text-[0.6rem] text-accent">running</span>}
          </div>
        );
      })}
    </div>
  );
}

function Unsupported({ struct }: { struct: Struct }) {
  return (
    <div className="rounded border border-dashed border-hairline-strong p-6 text-center">
      <p className="font-mono text-xs text-muted">
        no view yet for structure kind &ldquo;{struct.kind}&rdquo;
      </p>
      <p className="mt-1 text-xs text-faint">
        Rather than draw something approximate, this renders nothing. The trace is still exact — see
        the variables panel.
      </p>
    </div>
  );
}

function One({
  struct,
  previous,
  view,
  step,
  event,
  vars,
}: {
  struct: Struct;
  previous?: Struct;
  view: ResolvedView;
  step: number;
  event?: Step['event'];
  vars?: Step['vars'];
}) {
  switch (struct.kind) {
    case 'array':
      return (
        <ArrayView
          struct={struct}
          previous={previous?.kind === 'array' ? previous : undefined}
          pointers={view.pointers}
          regions={view.regions}
          event={event}
          step={step}
        />
      );
    case 'text':
      return (
        <TextView
          struct={struct}
          previous={previous?.kind === 'text' ? previous : undefined}
          pointers={view.pointers}
          regions={view.regions}
          step={step}
        />
      );
    case 'list':
      return (
        <ListView struct={struct} previous={previous?.kind === 'list' ? previous : undefined} />
      );
    case 'seq':
      return <SeqView struct={struct} previous={previous?.kind === 'seq' ? previous : undefined} />;
    case 'tree':
      return (
        <TreeView
          struct={struct}
          previous={previous?.kind === 'tree' ? previous : undefined}
          event={event}
          vars={vars}
        />
      );
    case 'grid':
      return (
        <GridView struct={struct} previous={previous?.kind === 'grid' ? previous : undefined} />
      );
    case 'table':
      return (
        <TableView struct={struct} previous={previous?.kind === 'table' ? previous : undefined} />
      );
    case 'graph':
      return (
        <GraphView struct={struct} previous={previous?.kind === 'graph' ? previous : undefined} />
      );
    default:
      return <Unsupported struct={struct} />;
  }
}

/** The key to the shading, for whichever kind is on stage. */
function Legend({ struct, view }: { struct: Struct; view: ResolvedView }) {
  switch (struct.kind) {
    case 'array':
    case 'text':
      return <RegionLegend regions={view.regions} />;
    case 'tree':
      return <TreeLegend struct={struct} />;
    case 'grid':
      return <GridLegend struct={struct} />;
    case 'table':
      return <TableLegend struct={struct} />;
    case 'graph':
      return <GraphLegend struct={struct} />;
    default:
      return null;
  }
}

interface StageProps {
  step: Step;
  previous?: Step;
  view: ResolvedView;
  primary: string;
}

export function Stage({ step, previous, view, primary }: StageProps) {
  const main = step.structs[primary];
  const others = Object.values(step.structs).filter((s) => s.id !== primary);

  return (
    <div className="flex w-full flex-col gap-6">
      {main && (
        <div className="flex flex-col gap-3">
          <One
            struct={main}
            previous={previous?.structs[primary]}
            view={view}
            step={step.i}
            event={step.event}
            vars={step.vars}
          />
          <Legend struct={main} view={view} />
        </div>
      )}

      {others.length > 0 && (
        <div className="flex flex-wrap gap-x-8 gap-y-4 border-t border-hairline pt-4">
          {others.map((s) => (
            <div key={s.id} className="min-w-0 flex-1">
              <p className="label mb-2">{s.label ?? s.id}</p>
              <One
                struct={s}
                previous={previous?.structs[s.id]}
                view={view}
                step={step.i}
                event={step.event}
                vars={step.vars}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
