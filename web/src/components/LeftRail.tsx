import { Activity, Brain, CircleHelp, Cpu, Database, Hash, Lightbulb, Link2, Plus, Save, Timer, Trash2, Waves } from 'lucide-react';
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
  tags, activeTag, onTag, telemetry, status, onStatus, trash, onTrash, trashCount,
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
  status: CaptureStatus | 'all';
  onStatus: (status: CaptureStatus | 'all') => void;
  trash: boolean;
  onTrash: (value: boolean) => void;
  trashCount: number;
}) {
  const ramPct = telemetry ? Math.min(100, (telemetry.rssMb / 90) * 100) : 0;
  return (
    <aside className="flex w-[240px] shrink-0 flex-col overflow-y-auto border-r border-[var(--border)] bg-[#0c1013]">
      <div className="p-3">
        <div className="px-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Buckets</div>
        <div className="mt-1.5 space-y-0.5">
          <Row label="All" count={counts.all ?? 0} active={activeBucket === 'all' && !trash} onClick={() => { onTrash(false); onBucket('all'); }} />
          {BUCKETS.map((bucket) => {
            const Icon = bucket.icon;
            return (
              <Row key={bucket.key} label={bucket.label} count={counts[bucket.key] ?? 0}
                active={activeBucket === bucket.key && !trash} icon={<Icon size={13} />}
                onClick={() => { onTrash(false); onBucket(bucket.key); }} />
            );
          })}
          <Row label="Trash" count={trashCount} active={trash} icon={<Trash2 size={13} />} onClick={() => onTrash(true)} />
        </div>
      </div>

      <div className="border-t border-[var(--border)] p-3">
        <div className="flex items-center justify-between px-1">
          <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Saved Views</span>
          <button type="button" onClick={onSaveView} title="Save current query" className="text-[var(--muted)] hover:text-[var(--emerald)]"><Plus size={12} /></button>
        </div>
        <div className="mt-1.5 space-y-0.5">
          {views.map((view) => (
            <div key={view.id} className="group flex items-center gap-1">
              <button type="button" onClick={() => { onTrash(false); onView(view); }}
                className={cn('flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-[11.5px]',
                  activeViewId === view.id ? 'bg-[var(--surface-hover)] text-[var(--text)]' : 'text-[var(--hint)] hover:bg-[var(--surface)] hover:text-[var(--text)]')}
                title={view.query}>
                <Save size={11} className="shrink-0 text-[var(--muted)]" />
                <span className="min-w-0 flex-1 truncate">{view.name}</span>
              </button>
              <button type="button" onClick={() => onDeleteView(view.id)} title="Delete view"
                className="rounded p-1 text-[var(--muted)] opacity-0 transition hover:text-[var(--rose)] group-hover:opacity-100"><Trash2 size={11} /></button>
            </div>
          ))}
          {views.length === 0 ? <p className="px-1 text-[11px] text-[var(--muted)]">No saved views.</p> : null}
        </div>
      </div>

      <div className="border-t border-[var(--border)] p-3">
        <div className="px-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Status</div>
        <div className="mt-1.5 grid grid-cols-4 gap-1">
          {(['active', 'resolved', 'archived', 'all'] as const).map((value) => (
            <button key={value} type="button" onClick={() => onStatus(value)}
              className={cn('rounded border px-1 py-1 text-[9.5px] capitalize',
                status === value ? 'border-[var(--emerald)] bg-[var(--emerald-soft)] text-[var(--emerald)]' : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]')}>
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-[var(--border)] p-3">
        <div className="flex items-center gap-1 px-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]"><Hash size={11} /> Tags</div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {tags.slice(0, 30).map((tag) => (
            <button key={tag.name} type="button" onClick={() => onTag(activeTag === tag.name ? null : tag.name)}
              className={cn('rounded border px-1.5 py-0.5 text-[10px] transition',
                activeTag === tag.name ? 'border-[var(--emerald)] bg-[var(--emerald-soft)] text-[var(--emerald)]' : 'border-[var(--border)] text-[var(--hint)] hover:border-[var(--border-strong)] hover:text-[var(--text)]')}>
              #{tag.name} <span className="mono text-[var(--muted)]">{tag.count}</span>
            </button>
          ))}
          {tags.length === 0 ? <span className="px-1 text-[11px] text-[var(--muted)]">No tags yet.</span> : null}
        </div>
      </div>

      <div className="mt-auto border-t border-[var(--border)] p-3">
        <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
          <Activity size={11} /> System Telemetry
        </div>
        <div className="mono mt-2 space-y-1 text-[10.5px] text-[var(--hint)]">
          <Line label="Active" value={telemetry?.activeCaptures ?? 0} />
          <Line label="Untriaged" value={telemetry?.untriaged ?? 0} />
          <Line label="Rules" value={`${telemetry?.rules ?? 0} (${telemetry?.ruleHits ?? 0} hits)`} />
          <Line label="Trash" value={telemetry?.trashCount ?? 0} />
          <Line label="DB" value={`${telemetry?.dbSizeMb ?? 0} MB`} />
          <Line label="RAM RSS" value={`${telemetry?.rssMb ?? 0} MB`} />
          <div className="h-1 overflow-hidden rounded bg-[var(--surface-hover)]">
            <div className={cn('h-full', ramPct > 90 ? 'bg-[var(--rose)]' : 'bg-[var(--emerald)]')} style={{ width: `${ramPct}%` }} />
          </div>
          <div className="flex items-center justify-between pt-0.5">
            <span className="flex items-center gap-1"><Cpu size={10} /> deterministic</span>
            <span className="flex items-center gap-1"><Database size={10} /> SQLite</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

function Line({ label, value }: { label: string; value: string | number }) {
  return <div className="flex justify-between"><span>{label}</span><span className="text-[var(--text)]">{value}</span></div>;
}

function Row({ label, count, active, onClick, icon }: { label: string; count: number; active: boolean; onClick: () => void; icon?: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] transition',
        active ? 'bg-[var(--surface-hover)] text-[var(--text)]' : 'text-[var(--hint)] hover:bg-[var(--surface)] hover:text-[var(--text)]')}>
      {icon ? <span className={active ? 'text-[var(--emerald)]' : 'text-[var(--muted)]'}>{icon}</span> : <span className="w-[13px]" />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="mono text-[10px] text-[var(--muted)]">{count}</span>
    </button>
  );
}
