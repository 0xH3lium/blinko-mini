import { Activity, Brain, CircleHelp, Cpu, Hash, Lightbulb, Link2, Plus, Save, Timer, Trash2, Waves } from 'lucide-react';
import type { Bucket, CaptureStatus, SavedView, Telemetry } from '../types/capture';
import { cn } from '../lib/utils';

const BUCKETS: Array<{ key: Bucket; label: string; icon: typeof Lightbulb }> = [
  { key: 'idea', label: 'Ideas', icon: Lightbulb },
  { key: 'memory', label: 'Memories', icon: Brain },
  { key: 'reminder', label: 'Reminders', icon: Timer },
  { key: 'question', label: 'Questions', icon: CircleHelp },
  { key: 'reference', label: 'References', icon: Link2 },
  { key: 'noise', label: 'Noise', icon: Waves },
];

export function LeftRail({
  counts, activeBucket, onBucket, views, activeViewId, onView, onSaveView, onDeleteView,
  tags, activeTag, onTag, telemetry, onOpenJev, status, onStatus,
}: {
  counts: Record<string, number>;
  activeBucket: string;
  onBucket: (bucket: string) => void;
  views: SavedView[];
  activeViewId: string | null;
  onView: (view: SavedView) => void;
  onSaveView: () => void;
  onDeleteView: (id: string) => void;
  tags: Array<{ name: string; count: number }>;
  activeTag: string | null;
  onTag: (tag: string | null) => void;
  telemetry: Telemetry | null;
  onOpenJev: () => void;
  status: CaptureStatus | 'all';
  onStatus: (status: CaptureStatus | 'all') => void;
}) {
  const dailyPct = telemetry ? Math.min(100, (telemetry.usageToday / Math.max(1, telemetry.caps.dailyCalls)) * 100) : 0;
  const ramPct = telemetry ? Math.min(100, (telemetry.rssMb / 400) * 100) : 0;

  return (
    <aside className="flex w-[240px] shrink-0 flex-col overflow-y-auto border-r border-[var(--border)] bg-[#0c1013]">
      <div className="p-3">
        <div className="px-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Buckets</div>
        <div className="mt-1.5 space-y-0.5">
          <Row label="All" count={counts.all ?? 0} active={activeBucket === 'all'} onClick={() => onBucket('all')} />
          {BUCKETS.map((bucket) => {
            const Icon = bucket.icon;
            return (
              <Row
                key={bucket.key}
                label={bucket.label}
                count={counts[bucket.key] ?? 0}
                active={activeBucket === bucket.key}
                onClick={() => onBucket(bucket.key)}
                icon={<Icon size={13} />}
              />
            );
          })}
        </div>
      </div>

      <div className="border-t border-[var(--border)] p-3">
        <div className="flex items-center justify-between px-1">
          <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Saved Views</span>
          <button type="button" onClick={onSaveView} title="Save current query" className="text-[var(--muted)] hover:text-[var(--emerald)]">
            <Plus size={12} />
          </button>
        </div>
        <div className="mt-1.5 space-y-0.5">
          {views.map((view) => (
            <div key={view.id} className="group flex items-center gap-1">
              <button
                type="button"
                onClick={() => onView(view)}
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-[11.5px]',
                  activeViewId === view.id
                    ? 'bg-[var(--surface-hover)] text-[var(--text)]'
                    : 'text-[var(--hint)] hover:bg-[var(--surface)] hover:text-[var(--text)]',
                )}
                title={view.query}
              >
                <Save size={11} className="shrink-0 text-[var(--muted)]" />
                <span className="min-w-0 flex-1 truncate">{view.name}</span>
              </button>
              <button
                type="button"
                onClick={() => onDeleteView(view.id)}
                title="Delete view"
                className="rounded p-1 text-[var(--muted)] opacity-0 transition hover:text-[var(--rose)] group-hover:opacity-100"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
          {views.length === 0 ? <p className="px-1 text-[11px] text-[var(--muted)]">No saved views.</p> : null}
        </div>
      </div>

      <div className="border-t border-[var(--border)] p-3">
        <div className="px-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Status</div>
        <div className="mt-1.5 grid grid-cols-4 gap-1">
          {(['active', 'resolved', 'archived', 'all'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onStatus(value)}
              className={cn(
                'rounded border px-1 py-1 text-[9.5px] capitalize',
                status === value
                  ? 'border-[var(--emerald)] bg-[var(--emerald-soft)] text-[var(--emerald)]'
                  : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]',
              )}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-[var(--border)] p-3">
        <div className="flex items-center gap-1 px-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
          <Hash size={11} /> Tags
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {tags.slice(0, 30).map((tag) => (
            <button
              key={tag.name}
              type="button"
              onClick={() => onTag(activeTag === tag.name ? null : tag.name)}
              className={cn(
                'rounded border px-1.5 py-0.5 text-[10px] transition',
                activeTag === tag.name
                  ? 'border-[var(--emerald)] bg-[var(--emerald-soft)] text-[var(--emerald)]'
                  : 'border-[var(--border)] text-[var(--hint)] hover:border-[var(--border-strong)] hover:text-[var(--text)]',
              )}
            >
              #{tag.name} <span className="mono text-[var(--muted)]">{tag.count}</span>
            </button>
          ))}
          {tags.length === 0 ? <span className="px-1 text-[11px] text-[var(--muted)]">No tags yet.</span> : null}
        </div>
      </div>

      <button type="button" onClick={onOpenJev} className="mt-auto block border-t border-[var(--border)] p-3 text-left hover:bg-[var(--surface)]">
        <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
          <Activity size={11} /> Engine Health
        </div>
        <div className="mono mt-2 space-y-1.5 text-[10.5px] text-[var(--hint)]">
          <div className="flex justify-between"><span>Today</span><span className="text-[var(--text)]">{telemetry?.usageToday ?? 0}/{telemetry?.caps.dailyCalls ?? 30} · ${(telemetry?.usageTodayUsd ?? 0).toFixed(4)}</span></div>
          <div className="h-1 overflow-hidden rounded bg-[var(--surface-hover)]"><div className="h-full bg-[var(--amber)]" style={{ width: `${dailyPct}%` }} /></div>
          <div className="flex justify-between"><span>Month USD</span><span className="text-[var(--text)]">${(telemetry?.usageMonthUsd ?? 0).toFixed(4)}</span></div>
          <div className="flex justify-between"><span>RAM RSS</span><span className={ramPct > 80 ? 'text-[var(--rose)]' : 'text-[var(--text)]'}>{telemetry?.rssMb ?? 0} MB</span></div>
          <div className="h-1 overflow-hidden rounded bg-[var(--surface-hover)]"><div className={cn('h-full', ramPct > 80 ? 'bg-[var(--rose)]' : 'bg-[var(--emerald)]')} style={{ width: `${ramPct}%` }} /></div>
          <div className="flex items-center justify-between pt-0.5">
            <span className="flex items-center gap-1"><Cpu size={10} /> {telemetry?.totalCaptures ?? 0} captures</span>
            <span className="rounded border border-[var(--border)] px-1 text-[var(--amber)]">{telemetry?.jevMode ?? 'auto'}</span>
          </div>
        </div>
      </button>
    </aside>
  );
}

function Row({ label, count, active, onClick, icon }: { label: string; count: number; active: boolean; onClick: () => void; icon?: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] transition',
        active ? 'bg-[var(--surface-hover)] text-[var(--text)]' : 'text-[var(--hint)] hover:bg-[var(--surface)] hover:text-[var(--text)]',
      )}
    >
      {icon ? <span className={active ? 'text-[var(--emerald)]' : 'text-[var(--muted)]'}>{icon}</span> : <span className="w-[13px]" />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="mono text-[10px] text-[var(--muted)]">{count}</span>
    </button>
  );
}
