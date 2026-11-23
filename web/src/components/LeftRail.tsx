import { Activity, Brain, CircleHelp, Cpu, Hash, Lightbulb, Link2, RotateCcw, Sparkles, Timer, Waves } from 'lucide-react';
import type { Bucket, Head, Telemetry } from '../types/capture';
import { cn } from '../lib/utils';

const BUCKETS: Array<{ key: Bucket; label: string; icon: typeof Lightbulb }> = [
  { key: 'idea', label: 'Ideas', icon: Lightbulb },
  { key: 'memory', label: 'Memories', icon: Brain },
  { key: 'reminder', label: 'Reminders', icon: Timer },
  { key: 'question', label: 'Questions', icon: CircleHelp },
  { key: 'reference', label: 'References', icon: Link2 },
  { key: 'noise', label: 'Noise', icon: Waves },
];

export interface SmartFilters {
  paradoxOnly?: boolean;
  minResonance?: number;
  decaying?: boolean;
  sublimated?: boolean;
}

export function LeftRail({
  counts,
  activeBucket,
  onBucket,
  heads,
  headValues,
  onHeadValue,
  tags,
  activeTag,
  onTag,
  telemetry,
  smart,
  onSmart,
  onOpenJev,
}: {
  counts: Record<string, number>;
  activeBucket: string;
  onBucket: (bucket: string) => void;
  heads: Head[];
  headValues: Record<string, number>;
  onHeadValue: (head: string, value: number) => void;
  tags: Array<{ name: string; count: number }>;
  activeTag: string | null;
  onTag: (tag: string | null) => void;
  telemetry: Telemetry | null;
  smart: SmartFilters;
  onSmart: (next: SmartFilters) => void;
  onOpenJev: () => void;
}) {
  const dailyPct = telemetry ? Math.min(100, (telemetry.usageToday / Math.max(1, telemetry.caps.dailyCalls)) * 100) : 0;
  const ramPct = telemetry ? Math.min(100, (telemetry.rssMb / 400) * 100) : 0;
  const filterHeads = heads.filter((head) => head.active && head.primitive !== 'choice').slice(0, 8);
  const sublimatedCount = (telemetry?.survivalBuckets ?? []).reduce((sum, bucket) => sum + bucket.sublimated, 0);

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
          <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Smart Filters</span>
          <button type="button" onClick={() => onSmart({})} title="Reset filters" className="text-[var(--muted)] hover:text-[var(--text)]">
            <RotateCcw size={11} />
          </button>
        </div>
        <div className="mt-1.5 space-y-0.5">
          <Row label="Paradoxes ⚔️" count={smart.paradoxOnly ? (counts.all ?? 0) : 0} active={!!smart.paradoxOnly} onClick={() => onSmart({ ...smart, paradoxOnly: !smart.paradoxOnly })} />
          <Row label="Resonant ×2+" count={smart.minResonance ? (counts.all ?? 0) : 0} active={smart.minResonance === 2} onClick={() => onSmart({ ...smart, minResonance: smart.minResonance === 2 ? undefined : 2 })} />
          <Row label="Decaying" count={smart.decaying ? (counts.all ?? 0) : 0} active={!!smart.decaying} onClick={() => onSmart({ ...smart, decaying: !smart.decaying })} />
          <Row label="Sublimated" count={sublimatedCount} active={!!smart.sublimated} onClick={() => onSmart({ ...smart, sublimated: !smart.sublimated })} />
        </div>
      </div>

      <div className="border-t border-[var(--border)] p-3">
        <div className="px-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Jev Probability</div>
        <div className="mt-2 space-y-3">
          {filterHeads.length === 0 ? <p className="px-1 text-[11px] text-[var(--muted)]">No active score/noul heads.</p> : null}
          {filterHeads.map((head) => {
            const max = head.primitive === 'noul' ? 1 : (head.config.max ?? 3);
            const step = head.primitive === 'noul' ? 0.05 : 0.1;
            const value = headValues[head.name] ?? 0;
            return (
              <label key={head.id} className="block px-1">
                <span className="flex items-center justify-between text-[10.5px] text-[var(--hint)]">
                  <span>{head.name}</span>
                  <span className="mono text-[var(--emerald)]">{value.toFixed(head.primitive === 'noul' ? 2 : 1)}+</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={max}
                  step={step}
                  value={value}
                  onChange={(event) => onHeadValue(head.name, Number(event.target.value))}
                  className="mt-1 h-1 w-full cursor-pointer appearance-none rounded bg-[var(--surface-hover)] accent-[var(--emerald)]"
                />
              </label>
            );
          })}
        </div>
      </div>

      <div className="border-t border-[var(--border)] p-3">
        <div className="flex items-center gap-1 px-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
          <Hash size={11} /> Tags
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {tags.slice(0, 24).map((tag) => (
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
          <div className="flex justify-between"><span>Jev today</span><span className="text-[var(--text)]">{telemetry?.usageToday ?? 0}/{telemetry?.caps.dailyCalls ?? 30} · ${(telemetry?.usageTodayUsd ?? 0).toFixed(4)}</span></div>
          <div className="h-1 overflow-hidden rounded bg-[var(--surface-hover)]"><div className="h-full bg-[var(--amber)]" style={{ width: `${dailyPct}%` }} /></div>
          <div className="flex justify-between"><span>Local hit</span><span className="text-[var(--emerald)]">{Math.round((telemetry?.localHitRate ?? 0) * 100)}%</span></div>
          <div className="flex justify-between"><span>RAM</span><span className={ramPct > 80 ? 'text-[var(--rose)]' : 'text-[var(--text)]'}>{telemetry?.rssMb ?? 0} / 400 MB</span></div>
          <div className="h-1 overflow-hidden rounded bg-[var(--surface-hover)]"><div className={cn('h-full', ramPct > 80 ? 'bg-[var(--rose)]' : 'bg-[var(--emerald)]')} style={{ width: `${ramPct}%` }} /></div>
          <div className="flex items-center justify-between pt-0.5">
            <span className="flex items-center gap-1"><Cpu size={10} /> {telemetry?.vectorCount ?? 0} vectors</span>
            <span className="flex items-center gap-1 text-[var(--amber)]"><Sparkles size={10} /> {telemetry?.jevMode ?? 'gated'}</span>
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
