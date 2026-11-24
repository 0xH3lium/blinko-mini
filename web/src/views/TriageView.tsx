import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Clock, FileInput, Link2, Maximize2, Scissors, Skull, Trash2, WandSparkles } from 'lucide-react';
import type { Bucket, Capture, CapturePatch, CustomField, Triage } from '../types/capture';
import { cn, relativeTime } from '../lib/utils';
import type { Notify } from '../types/ui';

type Tab = 'inbox' | 'bursts' | 'stubs' | 'stale';
const BUCKETS: Bucket[] = ['idea', 'memory', 'reminder', 'question', 'reference', 'noise'];

export function TriageView({
  triage, fields, onPatch, onBucket, onTrash, onResolve, onStitch, onLinkThread, onExtract, onOpenPatch, onInspect, notify,
}: {
  triage: Triage;
  fields: CustomField[];
  onPatch: (id: string, patch: CapturePatch) => Promise<void>;
  onBucket: (id: string, bucket: Bucket) => void;
  onTrash: (id: string) => void;
  onResolve: (id: string) => void;
  onStitch: (ids: string[], mergedContent?: string) => void;
  onLinkThread: (ids: string[]) => void;
  onExtract: () => void;
  onOpenPatch: () => void;
  onInspect: (id: string) => void;
  notify: Notify;
}) {
  const [tab, setTab] = useState<Tab>('inbox');
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [mergeDraft, setMergeDraft] = useState<{ ids: string[]; text: string } | null>(null);
  const cards = tab === 'inbox' ? triage.untriaged : tab === 'stubs' ? triage.stubs : tab === 'stale' ? triage.stale : [];
  const current = cards[index];

  useEffect(() => setIndex(0), [tab]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'ArrowRight') { event.preventDefault(); setIndex((value) => Math.min(cards.length - 1, value + 1)); return; }
      if (event.key === 'ArrowLeft') { event.preventDefault(); setIndex((value) => Math.max(0, value - 1)); return; }
      if (!current || tab !== 'inbox') return;
      if (/^[1-6]$/.test(event.key)) onBucket(current.id, BUCKETS[Number(event.key) - 1]!);
      else if (event.key === 'a') {
        const value = current.fields.actionable?.valueText === 'yes' ? 'no' : 'yes';
        void onPatch(current.id, { fields: { actionable: { valueText: value, valueNum: value === 'yes' ? 1 : 0, source: 'human' } } });
      } else if (/^[0-3]$/.test(event.key)) {
        void onPatch(current.id, { fields: { leverage: { valueNum: Number(event.key), valueText: event.key, source: 'human' } } });
      } else if (event.key === ' ') { event.preventDefault(); void onPatch(current.id, { triaged: true }); }
      else if (event.key === 'r') onResolve(current.id);
      else if (event.key === 'x') onTrash(current.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cards, current, tab, onPatch, onBucket, onResolve, onTrash]);

  const counts: Record<Tab, number> = useMemo(() => ({
    inbox: triage.untriaged.length, bursts: triage.bursts.length, stubs: triage.stubs.length, stale: triage.stale.length,
  }), [triage]);
  const scoreField = fields.find((field) => field.name === 'leverage');

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--border)] bg-[#0b0e11] px-3 py-2">
        {(['inbox', 'bursts', 'stubs', 'stale'] as const).map((value) => (
          <button key={value} type="button" onClick={() => setTab(value)}
            className={cn('flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[11px] font-medium capitalize',
              tab === value ? 'bg-[var(--surface-hover)] text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]')}>
            {value} <span className="mono text-[var(--emerald)]">{counts[value]}</span>
          </button>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={onExtract} className="flex items-center gap-1 rounded border border-[var(--emerald)] px-2 py-1 text-[10px] text-[var(--emerald)]"><WandSparkles size={11} /> ⚡ Export Untriaged</button>
          <button type="button" onClick={onOpenPatch} className="flex items-center gap-1 rounded border border-[var(--border-strong)] px-2 py-1 text-[10px] text-[var(--hint)]"><FileInput size={11} /> 📥 Paste AI JSON Patch</button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'inbox' ? (
          <div className="mx-auto max-w-[820px] space-y-2">
            {triage.untriaged.map((capture, position) => (
              <Card key={capture.id} capture={capture} active={position === index} expanded={expanded === capture.id}
                onClick={() => { setIndex(position); onInspect(capture.id); }}
                onToggle={() => setExpanded(expanded === capture.id ? null : capture.id)} />
            ))}
            {triage.untriaged.length === 0 ? <Empty label="Inbox zero — everything is triaged." /> : null}
          </div>
        ) : null}

        {tab === 'bursts' ? (
          <div className="mx-auto max-w-[900px] space-y-3">
            {triage.bursts.map((burst, position) => (
              <section key={position} className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                <header className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2 text-[11px] text-[var(--hint)]">
                  <Clock size={12} className="text-[var(--emerald)]" /> Burst · {burst.captures.length} notes · {burst.spanSec}s
                  <div className="ml-auto flex gap-1">
                    <button type="button" onClick={() => setMergeDraft({ ids: burst.captures.map((capture) => capture.id), text: burst.captures.map((capture) => capture.content).join('\n\n') })} className="flex items-center gap-1 rounded border border-[var(--emerald)] px-1.5 py-0.5 text-[9.5px] text-[var(--emerald)]"><Scissors size={10} /> Stitch into One</button>
                    <button type="button" onClick={() => { onLinkThread(burst.captures.map((capture) => capture.id)); notify('Linked as thread', 'success'); }} className="flex items-center gap-1 rounded border border-[var(--border)] px-1.5 py-0.5 text-[9.5px] text-[var(--hint)]"><Link2 size={10} /> Link as Thread</button>
                    <button type="button" onClick={() => notify('Kept separate', 'info')} className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[9.5px] text-[var(--hint)]">Keep Separate</button>
                  </div>
                </header>
                <div className="divide-y divide-[var(--border)]">
                  {burst.captures.map((capture) => (
                    <button key={capture.id} type="button" onClick={() => onInspect(capture.id)} dir="auto" className="block w-full truncate px-3 py-2 text-left text-[11.5px] text-[var(--hint)] hover:text-[var(--text)]">{capture.content}</button>
                  ))}
                </div>
              </section>
            ))}
            {triage.bursts.length === 0 ? <Empty label="No rapid-fire bursts detected." /> : null}
          </div>
        ) : null}

        {tab === 'stubs' ? (
          <div className="mx-auto max-w-[820px] space-y-2">
            {triage.stubs.map((capture, position) => (
              <section key={capture.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <button type="button" onClick={() => setExpanded(expanded === capture.id ? null : capture.id)} dir="auto" className="w-full truncate text-left text-[12px] text-[var(--text)]">{capture.content}</button>
                {expanded === capture.id ? <textarea dir="auto" defaultValue={capture.content} onBlur={(event) => { if (event.target.value !== capture.content) void onPatch(capture.id, { content: event.target.value }); }} rows={3} className="mono mt-2 w-full resize-y rounded border border-[var(--border-strong)] bg-[#0b0f12] p-2 text-[11px] outline-none focus:border-[var(--emerald)]" /> : null}
                <div className="mono mt-2 flex flex-wrap items-center gap-1.5 text-[9.5px] text-[var(--muted)]">
                  <span>{capture.content.length} chars</span>
                  <button type="button" onClick={() => setExpanded(expanded === capture.id ? null : capture.id)} className="flex items-center gap-1 rounded border border-[var(--border)] px-1.5 py-0.5 text-[var(--hint)]"><Maximize2 size={9} /> Expand inline</button>
                  <button type="button" onClick={() => { const previous = triage.stubs[position - 1]; if (previous) onStitch([previous.id, capture.id]); else notify('No previous stub to stitch', 'error'); }} className="flex items-center gap-1 rounded border border-[var(--border)] px-1.5 py-0.5 text-[var(--hint)]"><Scissors size={9} /> Stitch to previous</button>
                  <button type="button" onClick={() => onTrash(capture.id)} className="flex items-center gap-1 rounded border border-[var(--border)] px-1.5 py-0.5 text-[var(--rose)]"><Trash2 size={9} /> Trash</button>
                </div>
              </section>
            ))}
            {triage.stubs.length === 0 ? <Empty label="No short fragments." /> : null}
          </div>
        ) : null}

        {tab === 'stale' ? (
          <div className="mx-auto max-w-[820px] space-y-2">
            {triage.stale.map((capture) => (
              <section key={capture.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <button type="button" onClick={() => onInspect(capture.id)} dir="auto" className="w-full truncate text-left text-[12px] text-[var(--text)]">{capture.content}</button>
                <div className="mono mt-2 flex flex-wrap items-center gap-1.5 text-[9.5px] text-[var(--muted)]">
                  <span>touched {relativeTime(capture.updatedAt)}</span>
                  <button type="button" onClick={() => onResolve(capture.id)} className="flex items-center gap-1 rounded border border-[var(--emerald)] px-1.5 py-0.5 text-[var(--emerald)]"><Check size={9} /> Resolve</button>
                  <button type="button" onClick={() => void onPatch(capture.id, { status: 'archived' })} className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[var(--hint)]">Archive</button>
                  <button type="button" onClick={() => void onPatch(capture.id, {})} className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[var(--hint)]">Keep Active (bump)</button>
                </div>
              </section>
            ))}
            {triage.stale.length === 0 ? <Empty label="No stale active items." /> : null}
          </div>
        ) : null}
      </div>

      {tab === 'inbox' && current ? (
        <div className="sticky bottom-0 flex shrink-0 flex-wrap items-center gap-1.5 border-t border-[var(--border)] bg-[#0b0e11] px-3 py-1.5 text-[10px] text-[var(--muted)]">
          <span className="mono">{index + 1}/{cards.length}</span>
          <ArrowLeft size={11} /> <ArrowRight size={11} /> skip
          {BUCKETS.map((bucket, position) => (
            <button key={bucket} type="button" onClick={() => onBucket(current.id, bucket)} className="mono rounded border border-[var(--border)] px-1 py-0.5 text-[9px] text-[var(--hint)] hover:border-[var(--emerald)]">{position + 1} {bucket.slice(0, 3)}</button>
          ))}
          <button type="button" onClick={() => { const next = current.fields.actionable?.valueText === 'yes' ? 'no' : 'yes'; void onPatch(current.id, { fields: { actionable: { valueText: next, valueNum: next === 'yes' ? 1 : 0, source: 'human' } } }); }} className="mono rounded border border-[var(--border)] px-1 py-0.5 text-[9px]">a actionable</button>
          {scoreField ? Array.from({ length: (scoreField.config.max ?? 3) + 1 }, (_, score) => (
            <button key={score} type="button" onClick={() => void onPatch(current.id, { fields: { leverage: { valueNum: score, valueText: String(score), source: 'human' } } })} className="mono rounded border border-[var(--border)] px-1 py-0.5 text-[9px]">{score}</button>
          )) : null}
          <button type="button" onClick={() => void onPatch(current.id, { triaged: true })} className="mono rounded border border-[var(--emerald)] px-1 py-0.5 text-[9px] text-[var(--emerald)]">space approve</button>
          <button type="button" onClick={() => onResolve(current.id)} className="mono rounded border border-[var(--border)] px-1 py-0.5 text-[9px]">r resolve</button>
          <button type="button" onClick={() => onTrash(current.id)} className="mono rounded border border-[var(--border)] px-1 py-0.5 text-[9px] text-[var(--rose)]">x trash</button>
        </div>
      ) : null}

      {mergeDraft ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setMergeDraft(null); }}>
          <div className="w-full max-w-[560px] rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] p-4">
            <h3 className="text-[12px] font-semibold text-[var(--text)]">Stitch {mergeDraft.ids.length} captures into one</h3>
            <textarea value={mergeDraft.text} onChange={(event) => setMergeDraft({ ...mergeDraft, text: event.target.value })} dir="auto" rows={10} className="mono mt-2 w-full resize-y rounded border border-[var(--border-strong)] bg-[#0b0f12] p-2 text-[11.5px] outline-none focus:border-[var(--emerald)]" />
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" onClick={() => setMergeDraft(null)} className="rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--hint)]">Cancel</button>
              <button type="button" onClick={() => { onStitch(mergeDraft.ids, mergeDraft.text); setMergeDraft(null); }} className="flex items-center gap-1 rounded bg-[var(--emerald)] px-2 py-1 text-[10px] font-semibold text-[#05130d]"><Skull size={11} /> Stitch into One</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Card({ capture, active, expanded, onClick, onToggle }: {
  capture: Capture; active: boolean; expanded: boolean; onClick: () => void; onToggle: () => void;
}) {
  return (
    <section onClick={onClick} className={cn('cursor-pointer rounded-lg border bg-[var(--surface)] p-3 transition', active ? 'border-[var(--emerald)]' : 'border-[var(--border)] hover:border-[var(--border-strong)]')}>
      <div className="flex items-start gap-2">
        <span className="mono rounded bg-[var(--surface-hover)] px-1 py-0.5 text-[9px] text-[var(--muted)]">{capture.bucket.slice(0, 3)}</span>
        <p dir="auto" className={cn('min-w-0 flex-1 whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--text)]', expanded ? '' : 'line-clamp-2')}>{capture.content}</p>
        <button type="button" onClick={(event) => { event.stopPropagation(); onToggle(); }} className="text-[var(--muted)] hover:text-[var(--emerald)]"><Maximize2 size={11} /></button>
      </div>
      <div className="mono mt-2 flex flex-wrap gap-1 text-[9.5px] text-[var(--muted)]" dir="auto">
        {capture.tags.map((tag) => <span key={tag}>#{tag}</span>)}
        {Object.values(capture.fields).map((field) => <span key={field.fieldId} className="text-[var(--hint)]">{field.name}={field.valueText ?? field.valueNum}</span>)}
      </div>
    </section>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="py-16 text-center text-[11px] text-[var(--muted)]">{label}</p>;
}
