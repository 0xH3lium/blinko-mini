import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Clock, Skull, Swords, TimerOff, Zap } from 'lucide-react';
import type { Bucket, Capture, Triage } from '../types/capture';
import { cn, relativeTime } from '../lib/utils';

type Item =
  | { kind: 'uncertain'; capture: Capture }
  | { kind: 'paradox'; capture: Capture }
  | { kind: 'expiring'; capture: Capture; energy: number }
  | { kind: 'zombie'; reminder: Triage['zombies'][number] };

const BUCKETS: Bucket[] = ['idea', 'memory', 'reminder', 'question', 'reference', 'noise'];

export function TriageView({
  triage, onSelect, onBucket, onKeep, onSublimate, onReminderAction, onResolve, notify,
}: {
  triage: Triage;
  onSelect: (id: string) => void;
  onBucket: (id: string, bucket: Bucket) => void;
  onKeep: (id: string) => void;
  onSublimate: (id: string) => void;
  onReminderAction: (id: string, action: 'done' | 'snooze4' | 'kill') => void;
  onResolve: (capture: Capture) => void;
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
}) {
  const [index, setIndex] = useState(0);
  const items = useMemo<Item[]>(() => [
    ...triage.uncertain.map((capture) => ({ kind: 'uncertain' as const, capture })),
    ...triage.paradoxes.map((capture) => ({ kind: 'paradox' as const, capture })),
    ...triage.expiring.map((capture) => ({ kind: 'expiring' as const, capture, energy: capture.effectiveEnergy ?? capture.energy })),
    ...triage.zombies.map((reminder) => ({ kind: 'zombie' as const, reminder })),
  ], [triage]);

  useEffect(() => {
    if (index >= items.length) setIndex(0);
  }, [items.length, index]);

  const item = items[index];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (event.key === 'ArrowRight') setIndex((value) => Math.min(items.length - 1, value + 1));
      else if (event.key === 'ArrowLeft') setIndex((value) => Math.max(0, value - 1));
      else if (item && item.kind !== 'zombie' && /^[1-6]$/.test(event.key)) {
        const bucket = BUCKETS[Number(event.key) - 1];
        if (bucket) {
          onBucket(item.capture.id, bucket);
          notify(`Trained local probe · ${bucket}`, 'success');
          setIndex((value) => Math.min(items.length - 1, value + 1));
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items.length, item, onBucket, notify]);

  if (!item) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <Check size={22} className="text-[var(--emerald)]" />
        <p className="mt-3 text-[13px] text-[var(--hint)]">Triage queue is clear.</p>
        <p className="mt-1 text-[11px] text-[var(--muted)]">No uncertain, paradoxical, zombie or expiring captures right now.</p>
      </div>
    );
  }

  const capture = item.kind === 'zombie' ? null : item.capture;
  const zombieReminder = item.kind === 'zombie' ? item.reminder : null;
  const allDecisions = triage.uncertain.find((entry) => entry.id === capture?.id)?.decisions ?? [];

  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      <div className="w-full max-w-[760px] animate-rise rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={cn('mono rounded px-2 py-1 text-[10px] uppercase tracking-wider', item.kind === 'zombie' ? 'bg-[var(--amber-soft)] text-[var(--amber)]' : item.kind === 'paradox' ? 'bg-[var(--rose-soft)] text-[var(--rose)]' : 'bg-[var(--surface-2)] text-[var(--hint)]')}>
              {item.kind === 'zombie' ? '🧟 Zombie reminder' : item.kind === 'paradox' ? '⚔️ Paradox' : item.kind === 'expiring' ? 'Decaying' : 'High entropy'}
            </span>
            <span className="mono text-[10px] text-[var(--muted)]">{index + 1} / {items.length}</span>
          </div>
          <div className="flex gap-1">
            <button type="button" onClick={() => setIndex((value) => Math.max(0, value - 1))} className="rounded border border-[var(--border)] p-1.5 text-[var(--hint)] hover:text-[var(--text)]"><ArrowLeft size={14} /></button>
            <button type="button" onClick={() => setIndex((value) => Math.min(items.length - 1, value + 1))} className="rounded border border-[var(--border)] p-1.5 text-[var(--hint)] hover:text-[var(--text)]"><ArrowRight size={14} /></button>
          </div>
        </div>

        {capture ? (
          <>
            <blockquote className="mt-5 whitespace-pre-wrap text-[17px] leading-relaxed text-[var(--text)]">{capture.content}</blockquote>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-[10px] text-[var(--muted)]">
              <span className="mono rounded border border-[var(--border)] px-1.5 py-0.5">#{capture.bucket}</span>
              <span className="mono">E {capture.energy.toFixed(2)}</span>
              <span className="mono">λ {capture.decayLambda.toFixed(3)}</span>
              <span className="mono">×{capture.resonanceCount}</span>
              <span>{relativeTime(capture.createdAt)}</span>
              {capture.tags.map((tag) => <span key={tag} className="mono text-[var(--emerald)]">#{tag}</span>)}
            </div>

            {allDecisions.length > 0 ? (
              <div className="mt-4 space-y-1 rounded border border-[var(--border)] bg-[var(--surface-2)] p-2.5">
                {allDecisions.slice(0, 3).map((decision) => (
                  <div key={decision.head_name} className="flex items-center justify-between text-[10.5px]">
                    <span className="text-[var(--hint)]">{decision.head_name}</span>
                    <span className="mono text-[var(--amber)]">H {decision.entropy.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="mt-6">
              <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Reclassify · press 1–6 trains the bucket probe</div>
              <div className="mt-2 grid grid-cols-6 gap-1.5">
                {BUCKETS.map((bucket, position) => (
                  <button key={bucket} type="button" onClick={() => { onBucket(capture.id, bucket); notify(`Trained local probe · ${bucket}`, 'success'); }} className={cn('rounded border px-2 py-2 text-[11px] transition', capture.bucket === bucket ? 'border-[var(--emerald)] bg-[var(--emerald-soft)] text-[var(--emerald)]' : 'border-[var(--border)] text-[var(--hint)] hover:border-[var(--border-strong)] hover:text-[var(--text)]')}>
                    <span className="mono mr-1 text-[9px] text-[var(--muted)]">{position + 1}</span>{bucket}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => onSelect(capture.id)} className="rounded border border-[var(--border-strong)] px-3 py-1.5 text-[11px] text-[var(--text)] hover:bg-[var(--surface-hover)]">Inspect</button>
              <button type="button" onClick={() => onKeep(capture.id)} className="flex items-center gap-1 rounded border border-[var(--border-strong)] px-3 py-1.5 text-[11px] text-[var(--emerald)] hover:bg-[var(--emerald-soft)]"><Zap size={11} /> Keep +E</button>
              <button type="button" onClick={() => onSublimate(capture.id)} className="flex items-center gap-1 rounded border border-[var(--border-strong)] px-3 py-1.5 text-[11px] text-[var(--rose)] hover:bg-[var(--rose-soft)]"><TimerOff size={11} /> Sublimate</button>
              <button type="button" onClick={() => onResolve(capture)} className="flex items-center gap-1 rounded border border-[var(--border-strong)] px-3 py-1.5 text-[11px] text-[var(--hint)] hover:text-[var(--text)]"><Check size={11} /> Resolve</button>
              {item.kind === 'paradox' ? <span className="flex items-center gap-1 rounded border border-[var(--rose-soft)] px-3 py-1.5 text-[11px] text-[var(--rose)]"><Swords size={11} /> Open paradox</span> : null}
            </div>
          </>
        ) : (
          <>
            <blockquote className="mt-5 whitespace-pre-wrap text-[17px] leading-relaxed text-[var(--text)]">{zombieReminder!.content ?? zombieReminder!.captureId}</blockquote>
            <div className="mt-3 flex items-center gap-2 text-[10px] text-[var(--amber)]">
              <Clock size={12} /> due {new Date(zombieReminder!.dueAt).toLocaleString()} · snoozed {zombieReminder!.snoozeCount}×
            </div>
            <div className="mt-6 flex gap-2">
              <button type="button" onClick={() => onReminderAction(zombieReminder!.captureId, 'done')} className="flex items-center gap-1 rounded bg-[var(--emerald)] px-3 py-1.5 text-[11px] font-semibold text-[#05130d]"><Check size={11} /> Done</button>
              <button type="button" onClick={() => onReminderAction(zombieReminder!.captureId, 'snooze4')} className="rounded border border-[var(--border-strong)] px-3 py-1.5 text-[11px] text-[var(--hint)]">Snooze +4h</button>
              <button type="button" onClick={() => onReminderAction(zombieReminder!.captureId, 'kill')} className="flex items-center gap-1 rounded border border-[var(--border-strong)] px-3 py-1.5 text-[11px] text-[var(--rose)]"><Skull size={11} /> Kill</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
