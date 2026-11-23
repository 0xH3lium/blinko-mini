import { useMemo, useState } from 'react';
import { Check, Clock, Skull, Timer } from 'lucide-react';
import type { Agenda, AgendaItem, Bucket, Capture, Head } from '../types/capture';
import { cn } from '../lib/utils';

const BUCKET_COLORS: Record<Bucket, string> = {
  idea: '#34d399',
  memory: '#22d3ee',
  reminder: '#fbbf24',
  question: '#a78bfa',
  reference: '#60a5fa',
  noise: '#64717f',
};

export function AgendaMatrixView({
  agenda, captures, heads, onSelect, onReminderAction,
}: {
  agenda: Agenda;
  captures: Capture[];
  heads: Head[];
  onSelect: (id: string) => void;
  onReminderAction: (id: string, action: 'done' | 'snooze4' | 'tomorrow' | 'kill') => void;
}) {
  const [tab, setTab] = useState<'agenda' | 'matrix'>('agenda');
  const axes = heads.filter((head) => head.active && (head.primitive === 'score' || head.primitive === 'noul'));
  const [xAxis, setXAxis] = useState<string>('');
  const [yAxis, setYAxis] = useState<string>('');
  const xHead = axes.find((head) => head.id === (xAxis || axes[0]?.id)) ?? axes[0];
  const yHead = axes.find((head) => head.id === (yAxis || axes[1]?.id || axes[0]?.id)) ?? axes[0];

  const points = useMemo(
    () => captures.flatMap((capture) => {
      if (capture.status !== 'active' || !xHead || !yHead) return [];
      const xDecision = capture.decisions[xHead.name] ?? capture.decisions[xHead.id];
      const yDecision = capture.decisions[yHead.name] ?? capture.decisions[yHead.id];
      if (!xDecision || !yDecision) return [];
      const x = normalize(xHead, xDecision.valueNum, xDecision.valueText);
      const y = normalize(yHead, yDecision.valueNum, yDecision.valueText);
      return [{ capture, x: Math.max(0.04, Math.min(0.96, x)), y: Math.max(0.04, Math.min(0.96, y)) }];
    }),
    [captures, xHead, yHead],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[#0b0e11] px-3 py-2">
        {(['agenda', 'matrix'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn('rounded px-2.5 py-1.5 text-[11px] font-medium', tab === value ? 'bg-[var(--surface-hover)] text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]')}
          >
            {value === 'agenda' ? 'Agenda' : 'Decision Matrix'}
          </button>
        ))}
        {tab === 'matrix' ? (
          <div className="ml-auto flex items-center gap-1.5 text-[10px] text-[var(--muted)]">
            <label>X <select value={xHead?.id ?? ''} onChange={(event) => setXAxis(event.target.value)} className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-1">
              {axes.map((head) => <option key={head.id} value={head.id}>{head.name}</option>)}
            </select></label>
            <label>Y <select value={yHead?.id ?? ''} onChange={(event) => setYAxis(event.target.value)} className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-1">
              {axes.map((head) => <option key={head.id} value={head.id}>{head.name}</option>)}
            </select></label>
          </div>
        ) : null}
      </div>

      {tab === 'agenda' ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mx-auto grid max-w-[1100px] grid-cols-2 gap-4">
            <AgendaSection title="Overdue" items={agenda.overdue} tone="rose" onSelect={onSelect} onAction={onReminderAction} />
            <AgendaSection title="Today" items={agenda.today} tone="amber" onSelect={onSelect} onAction={onReminderAction} />
            <AgendaSection title="Upcoming" items={agenda.upcoming} tone="emerald" onSelect={onSelect} onAction={onReminderAction} />
            <AgendaSection title="Snoozed 3+×" items={agenda.snoozed} tone="hint" onSelect={onSelect} onAction={onReminderAction} />
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {xHead && yHead ? (
            <div className="mx-auto max-w-[900px]">
              <div className="mb-2 flex justify-between text-[10px] text-[var(--muted)]">
                <span>Y: {yHead.name}</span><span>X: {xHead.name}</span>
              </div>
              <div className="relative aspect-square w-full rounded-lg border border-[var(--border)] bg-[#0b0e11]">
                <div className="absolute left-1/2 top-0 h-full w-px bg-[var(--border)]" />
                <div className="absolute left-0 top-1/2 h-px w-full bg-[var(--border)]" />
                {points.map(({ capture, x, y }) => (
                  <button
                    key={capture.id}
                    type="button"
                    onClick={() => onSelect(capture.id)}
                    title={`${capture.content}\n${xHead.name}=${x.toFixed(2)} · ${yHead.name}=${y.toFixed(2)}`}
                    className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/50 transition hover:z-10 hover:scale-150"
                    style={{ left: `${x * 100}%`, top: `${(1 - y) * 100}%`, backgroundColor: BUCKET_COLORS[capture.bucket] }}
                  />
                ))}
                {points.length === 0 ? <p className="absolute inset-0 flex items-center justify-center text-[11px] text-[var(--muted)]">No captures have both axis decisions.</p> : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[9.5px] text-[var(--muted)]">
                {(Object.keys(BUCKET_COLORS) as Bucket[]).map((bucket) => (
                  <span key={bucket} className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: BUCKET_COLORS[bucket] }} />{bucket}</span>
                ))}
              </div>
            </div>
          ) : <p className="text-[11px] text-[var(--muted)]">Create active score or noul heads to plot the matrix.</p>}
        </div>
      )}
    </div>
  );
}

function AgendaSection({
  title, items, tone, onSelect, onAction,
}: {
  title: string;
  items: AgendaItem[];
  tone: 'rose' | 'amber' | 'emerald' | 'hint';
  onSelect: (id: string) => void;
  onAction: (id: string, action: 'done' | 'snooze4' | 'tomorrow' | 'kill') => void;
}) {
  const toneClass = tone === 'rose' ? 'text-[var(--rose)]' : tone === 'amber' ? 'text-[var(--amber)]' : tone === 'emerald' ? 'text-[var(--emerald)]' : 'text-[var(--hint)]';
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <h2 className={cn('flex items-center gap-1.5 border-b border-[var(--border)] px-3 py-2 text-[11px] font-semibold', toneClass)}>
        <Clock size={12} /> {title} <span className="mono ml-auto text-[var(--muted)]">{items.length}</span>
      </h2>
      <div className="divide-y divide-[var(--border)]">
        {items.map((item) => (
          <div key={`${item.captureId}:${item.dueAt}`} className="px-3 py-2">
            <button type="button" onClick={() => onSelect(item.captureId)} className="block w-full truncate text-left text-[11.5px] text-[var(--text)] hover:text-[var(--emerald)]">{item.content}</button>
            <div className="mono mt-1 flex flex-wrap items-center gap-1.5 text-[9px] text-[var(--muted)]">
              <span className={toneClass}>{new Date(item.dueAt).toLocaleString()}</span>
              <span>{item.bucket}</span>
              {item.snoozeCount > 0 ? <span className="text-[var(--amber)]">snoozed {item.snoozeCount}×</span> : null}
              <button type="button" onClick={() => onAction(item.captureId, 'done')} className="rounded border border-[var(--border)] px-1 text-[var(--emerald)]"><Check size={9} /></button>
              <button type="button" onClick={() => onAction(item.captureId, 'snooze4')} className="rounded border border-[var(--border)] px-1"><Timer size={9} /> 4h</button>
              <button type="button" onClick={() => onAction(item.captureId, 'tomorrow')} className="rounded border border-[var(--border)] px-1">9am</button>
              <button type="button" onClick={() => onAction(item.captureId, 'kill')} className="rounded border border-[var(--border)] px-1 text-[var(--rose)]"><Skull size={9} /></button>
            </div>
          </div>
        ))}
        {items.length === 0 ? <p className="px-3 py-3 text-[10.5px] text-[var(--muted)]">Nothing here.</p> : null}
      </div>
    </section>
  );
}

function normalize(head: Head, valueNum: number | null, valueText: string | null): number {
  if (head.primitive === 'noul') {
    if (valueText === 'no') return 0;
    return valueNum ?? 0;
  }
  const min = head.config.min ?? 0;
  const max = head.config.max ?? 3;
  const value = valueNum ?? Number(valueText ?? min);
  return (value - min) / Math.max(1, max - min);
}
