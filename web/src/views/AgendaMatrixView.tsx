import { useMemo, useState } from 'react';
import { Check, Clock, RotateCcw, Skull, Timer } from 'lucide-react';
import type { Agenda, AgendaItem, Capture, CustomField, ReminderAction } from '../types/capture';
import { cn, relativeTime } from '../lib/utils';

const BUCKET_COLORS: Record<string, string> = {
  idea: '#34d399', memory: '#22d3ee', reminder: '#fbbf24', question: '#a78bfa', reference: '#60a5fa', noise: '#64717f',
};

export function AgendaMatrixView({
  agenda, captures, fields, q, onQuery, onSelect, onReminderAction, onFieldValue,
}: {
  agenda: Agenda;
  captures: Capture[];
  fields: CustomField[];
  q: string;
  onQuery: (q: string) => void;
  onSelect: (id: string) => void;
  onReminderAction: (id: string, action: ReminderAction) => void;
  onFieldValue: (id: string, field: string, value: number | string) => void;
}) {
  const [tab, setTab] = useState<'agenda' | 'matrix'>('agenda');
  const [queryDraft, setQueryDraft] = useState(q);
  const axes = fields.filter((field) => field.active && (field.fieldType === 'score' || field.fieldType === 'boolean' || field.fieldType === 'choice'));
  const [xName, setXName] = useState('');
  const [yName, setYName] = useState('');
  const xField = axes.find((field) => field.name === (xName || axes[0]?.name)) ?? axes[0];
  const yField = axes.find((field) => field.name === (yName || axes[1]?.name || axes[0]?.name)) ?? axes[0];

  const points = useMemo(() => captures.flatMap((capture) => {
    if (capture.status !== 'active' || !xField || !yField) return [];
    const x = normalizeField(xField, capture.fields[xField.name]?.valueNum ?? capture.fields[xField.name]?.valueText);
    const y = normalizeField(yField, capture.fields[yField.name]?.valueNum ?? capture.fields[yField.name]?.valueText);
    if (x === null || y === null) return [];
    return [{ capture, x: Math.max(0.04, Math.min(0.96, x)), y: Math.max(0.04, Math.min(0.96, y)) }];
  }), [captures, xField, yField]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[#0b0e11] px-3 py-2">
        {(['agenda', 'matrix'] as const).map((value) => (
          <button key={value} type="button" onClick={() => setTab(value)}
            className={cn('rounded px-2.5 py-1.5 text-[11px] font-medium', tab === value ? 'bg-[var(--surface-hover)] text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]')}>
            {value === 'agenda' ? 'Agenda' : '2D Matrix'}
          </button>
        ))}
        <input value={queryDraft} onChange={(event) => setQueryDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') onQuery(queryDraft); }} dir="auto"
          placeholder="Query DSL filter…" className="min-w-[180px] flex-1 rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[10px] outline-none focus:border-[var(--emerald)]" />
        <button type="button" onClick={() => onQuery(queryDraft)} className="rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--hint)]">Apply</button>
        {tab === 'matrix' ? (
          <div className="flex items-center gap-1.5 text-[10px] text-[var(--muted)]">
            <label>X
              <select value={xField?.name ?? ''} onChange={(event) => setXName(event.target.value)} className="ml-1 rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-1">
                {axes.map((field) => <option key={field.id} value={field.name}>{field.name}</option>)}
              </select>
            </label>
            <label>Y
              <select value={yField?.name ?? ''} onChange={(event) => setYName(event.target.value)} className="ml-1 rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-1">
                {axes.map((field) => <option key={field.id} value={field.name}>{field.name}</option>)}
              </select>
            </label>
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
          {xField && yField ? (
            <div className="mx-auto max-w-[900px]">
              <div className="mb-2 flex justify-between text-[10px] text-[var(--muted)]">
                <span>Y: {yField.name} ↑</span><span>X: {xField.name} →</span>
              </div>
              <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[#0b0e11]">
                <div className="absolute left-1/2 top-0 h-full w-px bg-[var(--border)]" />
                <div className="absolute left-0 top-1/2 h-px w-full bg-[var(--border)]" />
                <span className="mono absolute left-2 top-2 text-[9px] uppercase text-[var(--muted)]">Strategic</span>
                <span className="mono absolute right-2 top-2 text-[9px] uppercase text-[var(--emerald)]">Execute Now</span>
                <span className="mono absolute bottom-2 left-2 text-[9px] uppercase text-[var(--muted)]">Drop / Noise</span>
                <span className="mono absolute bottom-2 right-2 text-[9px] uppercase text-[var(--amber)]">Quick Wins</span>
                {points.map(({ capture, x, y }) => (
                  <button
                    key={capture.id} type="button"
                    onPointerDown={(event) => {
                      event.currentTarget.setPointerCapture(event.pointerId);
                      const container = event.currentTarget.parentElement?.getBoundingClientRect();
                      if (!container) return;
                      onFieldValue(capture.id, xField.name, denormalize(xField, (event.clientX - container.left) / container.width));
                      onFieldValue(capture.id, yField.name, denormalize(yField, 1 - (event.clientY - container.top) / container.height));
                    }}
                    onClick={() => onSelect(capture.id)}
                    title={`${capture.content}\n${xField.name}=${capture.fields[xField.name]?.valueText ?? capture.fields[xField.name]?.valueNum ?? '–'} · ${yField.name}=${capture.fields[yField.name]?.valueText ?? capture.fields[yField.name]?.valueNum ?? '–'}\nDrag to set X/Y`}
                    className="group absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border border-black/50 transition hover:z-10 hover:scale-150"
                    style={{ left: `${x * 100}%`, top: `${(1 - y) * 100}%`, backgroundColor: BUCKET_COLORS[capture.bucket] ?? '#64717f' }}
                  />
                ))}
                {points.length === 0 ? <p className="absolute inset-0 flex items-center justify-center text-[11px] text-[var(--muted)]">No captures have both axis fields.</p> : null}
              </div>
              <p className="mono mt-2 text-[9px] text-[var(--muted)]">Drag a dot to set fields (source=human, locked) · click for Inspector</p>
            </div>
          ) : <p className="text-[11px] text-[var(--muted)]">Create active score/choice fields to plot the matrix.</p>}
        </div>
      )}
    </div>
  );
}

function normalizeField(field: CustomField, value: number | string | null | undefined): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (field.fieldType === 'boolean') return String(value) === 'yes' || Number(value) === 1 ? 0.85 : 0.15;
  if (field.fieldType === 'choice') {
    const options = field.config.options ?? [];
    const index = options.findIndex((option) => option.value === String(value));
    return options.length > 1 ? (index < 0 ? 0.5 : index / (options.length - 1)) : 0.5;
  }
  const min = field.config.min ?? 0;
  const max = field.config.max ?? 3;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, (numeric - min) / Math.max(1, max - min))) : null;
}

function denormalize(field: CustomField, normalized: number): number | string {
  const clamped = Math.max(0, Math.min(1, normalized));
  if (field.fieldType === 'boolean') return clamped >= 0.5 ? 1 : 0;
  if (field.fieldType === 'choice') {
    const options = field.config.options ?? [];
    return options[Math.round(clamped * Math.max(0, options.length - 1))]?.value ?? '';
  }
  const min = field.config.min ?? 0;
  const max = field.config.max ?? 3;
  return Math.round(min + clamped * (max - min));
}

function AgendaSection({
  title, items, tone, onSelect, onAction,
}: {
  title: string; items: AgendaItem[]; tone: 'rose' | 'amber' | 'emerald' | 'hint';
  onSelect: (id: string) => void; onAction: (id: string, action: ReminderAction) => void;
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
            <button type="button" onClick={() => onSelect(item.captureId)} dir="auto" className="block w-full truncate text-left text-[11.5px] text-[var(--text)] hover:text-[var(--emerald)]">{item.content}</button>
            <div className="mono mt-1 flex flex-wrap items-center gap-1.5 text-[9px] text-[var(--muted)]">
              <span className={toneClass}>{new Date(item.dueAt).toLocaleString()}</span>
              <span>{item.bucket}</span>
              {item.recurrence ? <span className="text-[var(--cyan)]" title={item.recurrence}>↻ {item.recurrence}</span> : null}
              {item.snoozeCount > 0 ? <span className="text-[var(--amber)]">snoozed {item.snoozeCount}×</span> : null}
              <button type="button" onClick={() => onAction(item.captureId, 'done')} title="done" className="rounded border border-[var(--border)] px-1 text-[var(--emerald)]"><Check size={9} /></button>
              <button type="button" onClick={() => onAction(item.captureId, 'snooze1')} className="rounded border border-[var(--border)] px-1">1h</button>
              <button type="button" onClick={() => onAction(item.captureId, 'snooze4')} className="rounded border border-[var(--border)] px-1"><Timer size={9} /> 4h</button>
              <button type="button" onClick={() => onAction(item.captureId, 'tomorrow')} className="rounded border border-[var(--border)] px-1">9am</button>
              <button type="button" onClick={() => onAction(item.captureId, 'week')} className="rounded border border-[var(--border)] px-1"><RotateCcw size={9} /> 1w</button>
              <button type="button" onClick={() => onAction(item.captureId, 'kill')} className="rounded border border-[var(--border)] px-1 text-[var(--rose)]"><Skull size={9} /></button>
              <span className="ml-auto">{relativeTime(item.dueAt)}</span>
            </div>
          </div>
        ))}
        {items.length === 0 ? <p className="px-3 py-3 text-[10.5px] text-[var(--muted)]">Nothing here.</p> : null}
      </div>
    </section>
  );
}
