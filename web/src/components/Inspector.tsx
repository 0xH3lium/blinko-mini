import { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { Check, Pencil, Pin, Sparkles, Trash2, X } from 'lucide-react';
import type { CaptureDetail, Decision, Head } from '../types/capture';
import { cn, relativeTime } from '../lib/utils';

export function Inspector({
  detail, heads, onClose, onSave, onOverride, onPin, onResolve, onJev, onDelete, onJump,
}: {
  detail: CaptureDetail | null;
  heads: Head[];
  onClose: () => void;
  onSave: (id: string, content: string) => void;
  onOverride: (id: string, headId: string, valueText?: string, valueNum?: number) => void;
  onPin: (id: string, pinned: boolean) => void;
  onResolve: (id: string) => void;
  onJev: (id: string) => void;
  onDelete: (id: string) => void;
  onJump: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    setEditing(false);
    setDraft(detail?.content ?? '');
  }, [detail?.id, detail?.content]);

  const html = useMemo(() => {
    if (!detail) return '';
    return DOMPurify.sanitize(String(marked.parse(detail.content)));
  }, [detail?.content, detail]);

  if (!detail) {
    return (
      <aside className="flex w-[360px] shrink-0 flex-col border-l border-[var(--border)] bg-[#0c1013]">
        <div className="flex flex-1 items-center justify-center p-6 text-center text-[11px] text-[var(--muted)]">
          Select a capture to inspect decisions, edges and physics.
        </div>
      </aside>
    );
  }

  const decisionMap = new Map(detail.decisions.map((decision) => [decision.headId, decision]));
  const neighbors = detail.edges.map((edge) => ({ edge, other: edge.sourceId === detail.id ? edge.targetId : edge.sourceId }));

  return (
    <aside className="flex w-[360px] shrink-0 flex-col overflow-y-auto border-l border-[var(--border)] bg-[#0c1013]">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-[var(--border)] bg-[#0c1013] px-3 py-2">
        <span className="mono rounded border border-[var(--border)] px-1.5 py-0.5 text-[9px] uppercase text-[var(--emerald)]">{detail.bucket}</span>
        <span className="mono text-[9.5px] text-[var(--muted)]">{relativeTime(detail.createdAt)}</span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => onPin(detail.id, !detail.isPinned)} title="Pin" className={cn('rounded p-1.5', detail.isPinned ? 'text-[var(--amber)]' : 'text-[var(--muted)] hover:text-[var(--text)]')}><Pin size={13} /></button>
          <button type="button" onClick={() => onJev(detail.id)} title="Force Jev" className="rounded p-1.5 text-[var(--muted)] hover:text-[var(--amber)]"><Sparkles size={13} /></button>
          <button type="button" onClick={() => onResolve(detail.id)} title="Resolve" className="rounded p-1.5 text-[var(--muted)] hover:text-[var(--emerald)]"><Check size={13} /></button>
          <button type="button" onClick={() => onDelete(detail.id)} title="Delete" className="rounded p-1.5 text-[var(--muted)] hover:text-[var(--rose)]"><Trash2 size={13} /></button>
          <button type="button" onClick={onClose} title="Close" className="rounded p-1.5 text-[var(--muted)] hover:text-[var(--text)]"><X size={13} /></button>
        </div>
      </div>

      <div className="border-b border-[var(--border)] p-3">
        {editing ? (
          <div>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { onSave(detail.id, draft); setEditing(false); } }}
              rows={7}
              autoFocus
              className="w-full resize-y rounded border border-[var(--border-strong)] bg-[#0b0f12] p-2.5 text-[12.5px] leading-relaxed outline-none focus:border-[var(--emerald)]"
            />
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => { onSave(detail.id, draft); setEditing(false); }} className="rounded bg-[var(--emerald)] px-2.5 py-1 text-[10.5px] font-semibold text-[#05130d]">Save ⌘Enter</button>
              <button type="button" onClick={() => { setDraft(detail.content); setEditing(false); }} className="rounded border border-[var(--border-strong)] px-2.5 py-1 text-[10.5px] text-[var(--hint)]">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="group relative">
            <div className="markdown text-[12.5px]" dangerouslySetInnerHTML={{ __html: html }} />
            <button type="button" onClick={() => setEditing(true)} className="absolute right-0 top-0 rounded border border-[var(--border)] bg-[var(--surface-2)] p-1 text-[var(--muted)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--text)]"><Pencil size={11} /></button>
          </div>
        )}
      </div>

      <div className="border-b border-[var(--border)] p-3">
        <SectionTitle>Decision Probabilities</SectionTitle>
        <div className="mt-2 space-y-3">
          {heads.filter((head) => head.active).map((head) => {
            const decision = decisionMap.get(head.id);
            return (
              <div key={head.id}>
                <div className="flex items-center justify-between text-[10.5px]">
                  <span className="text-[var(--hint)]">{head.name}</span>
                  <span className="mono text-[var(--muted)]">{decision ? `${decision.source} · H ${decision.entropy.toFixed(2)}` : 'no decision'}</span>
                </div>
                <div className="mt-1 space-y-1">
                  {Object.entries(decision?.probs ?? {}).slice(0, 6).map(([key, probability]) => (
                    <div key={key} className="flex items-center gap-2">
                      <span className="mono w-[72px] shrink-0 truncate text-[9.5px] text-[var(--hint)]">{key}</span>
                      <div className="h-1 flex-1 overflow-hidden rounded bg-[var(--surface-hover)]"><div className={cn('h-full', probability > 0.5 ? 'bg-[var(--emerald)]' : 'bg-[var(--amber)]')} style={{ width: `${Math.max(1, probability * 100)}%` }} /></div>
                      <span className="mono w-9 text-right text-[9.5px] text-[var(--muted)]">{(probability * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {head.primitive === 'choice' ? (head.config.options ?? []).map((option) => (
                    <OverrideChip key={option.value} label={option.value} active={decision?.valueText === option.value} onClick={() => onOverride(detail.id, head.id, option.value)} />
                  )) : null}
                  {head.primitive === 'score' ? Array.from({ length: (head.config.max ?? 3) - (head.config.min ?? 0) + 1 }, (_, index) => (head.config.min ?? 0) + index).map((value) => (
                    <OverrideChip key={value} label={String(value)} active={decision?.valueNum !== null && decision?.valueNum !== undefined && Math.abs(decision.valueNum - value) < 0.25} onClick={() => onOverride(detail.id, head.id, undefined, value)} />
                  )) : null}
                  {head.primitive === 'noul' ? (
                    <>
                      <OverrideChip label="yes" active={decision?.valueText === 'yes'} onClick={() => onOverride(detail.id, head.id, 'yes', 1)} />
                      <OverrideChip label="no" active={decision?.valueText === 'no'} onClick={() => onOverride(detail.id, head.id, 'no', 0)} />
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-b border-[var(--border)] p-3">
        <SectionTitle>Reminder</SectionTitle>
        {detail.reminder ? (
          <div className="mono mt-1.5 flex items-center justify-between text-[10px] text-[var(--amber)]">
            <span>{new Date(detail.reminder.dueAt).toLocaleString()}</span>
            <span className="mono text-[var(--muted)] text-[9px]">{detail.reminder.state} · {detail.reminder.snoozeCount}×</span>
          </div>
        ) : <p className="mt-1.5 text-[10.5px] text-[var(--muted)]">No reminder attached.</p>}
      </div>

      <div className="border-b border-[var(--border)] p-3">
        <SectionTitle>Graph Edges · {neighbors.length}</SectionTitle>
        <div className="mt-1.5 space-y-1">
          {neighbors.slice(0, 12).map(({ edge, other }) => (
            <button key={`${edge.sourceId}-${edge.targetId}-${edge.relation}`} type="button" onClick={() => onJump(other)} className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-[var(--surface-hover)]">
              <span className={cn('mono rounded px-1 text-[9px] uppercase', edge.relation === 'paradox' || edge.relation === 'contradicts' ? 'bg-[var(--rose-soft)] text-[var(--rose)]' : 'bg-[var(--surface-2)] text-[var(--hint)]')}>{edge.relation}</span>
              <span className="mono min-w-0 flex-1 truncate text-[9.5px] text-[var(--muted)]">{other.slice(0, 12)}…</span>
              <span className="mono text-[9px] text-[var(--muted)]">{edge.weight.toFixed(2)}</span>
            </button>
          ))}
          {neighbors.length === 0 ? <p className="text-[10.5px] text-[var(--muted)]">No connected edges.</p> : null}
        </div>
      </div>

      <div className="p-3">
        <SectionTitle>Raw Physics</SectionTitle>
        <div className="mono mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[9.5px] text-[var(--muted)]">
          <span>energy <span className="text-[var(--text)]">{detail.energy.toFixed(3)}</span></span>
          <span>effective <span className="text-[var(--emerald)]">{detail.effectiveEnergy.toFixed(3)}</span></span>
          <span>lambda <span className="text-[var(--text)]">{detail.decayLambda.toFixed(4)}</span></span>
          <span>resonance <span className="text-[var(--text)]">{detail.resonanceCount}</span></span>
          <span className="col-span-2 truncate">simhash <span className="text-[var(--text)]">{detail.simhash ?? '—'}</span></span>
          <span className="col-span-2 truncate">id <span className="text-[var(--text)]">{detail.id}</span></span>
        </div>
      </div>
    </aside>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{children}</div>;
}

function OverrideChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn('mono rounded border px-1.5 py-0.5 text-[9.5px] transition', active ? 'border-[var(--emerald)] bg-[var(--emerald-soft)] text-[var(--emerald)]' : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)]')}>{label}</button>
  );
}
