import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Eye, RefreshCw, Sparkles } from 'lucide-react';
import type { Bucket, CaptureStatus, Decision, Head, Review, ReviewCapture } from '../types/capture';
import { cn, relativeTime } from '../lib/utils';

const BUCKETS: Bucket[] = ['idea', 'memory', 'reminder', 'question', 'reference', 'noise'];

type Item = { kind: 'uncertain' | 'unclassified'; capture: ReviewCapture };

export function ReviewView({
  review, heads, onBucket, onOverride, onJev, onInspect, onStatus, notify,
}: {
  review: Review;
  heads: Head[];
  onBucket: (id: string, bucket: Bucket) => void;
  onOverride: (id: string, headId: string, valueText?: string, valueNum?: number) => void;
  onJev: (id: string) => void;
  onInspect: (id: string) => void;
  onStatus: (id: string, status: CaptureStatus) => void;
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
}) {
  const [index, setIndex] = useState(0);
  const items = useMemo<Item[]>(() => [
    ...review.uncertain.map((capture): Item => ({ kind: 'uncertain', capture })),
    ...review.unclassified.map((capture): Item => ({ kind: 'unclassified', capture })),
  ], [review]);
  const item = items[Math.min(index, Math.max(0, items.length - 1))];

  useEffect(() => {
    if (index >= items.length && items.length > 0) setIndex(0);
  }, [index, items.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (event.key === 'ArrowRight') setIndex((value) => Math.min(items.length - 1, value + 1));
      else if (event.key === 'ArrowLeft') setIndex((value) => Math.max(0, value - 1));
      else if (item && /^[1-6]$/.test(event.key)) {
        const bucket = BUCKETS[Number(event.key) - 1];
        if (bucket) {
          onBucket(item.capture.id, bucket);
          notify(`Bucket → ${bucket}`, 'success');
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
        <p className="mt-3 text-[13px] text-[var(--hint)]">Review queue is clear.</p>
        <p className="mt-1 text-[11px] text-[var(--muted)]">No uncertain or unclassified captures remain.</p>
      </div>
    );
  }

  const capture = item.capture;
  const uncertainHeads = item.kind === 'uncertain' ? capture.reviewDecisions : [];

  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      <div className="w-full max-w-[780px] animate-rise rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={cn('mono rounded px-2 py-1 text-[10px] uppercase tracking-wider', item.kind === 'uncertain' ? 'bg-[var(--amber-soft)] text-[var(--amber)]' : 'bg-[var(--emerald-soft)] text-[var(--emerald)]')}>
              {item.kind === 'uncertain' ? 'Uncertain Decisions' : 'Unclassified'}
            </span>
            <span className="mono text-[10px] text-[var(--muted)]">{index + 1} / {items.length}</span>
          </div>
          <div className="flex gap-1">
            <button type="button" onClick={() => setIndex((value) => Math.max(0, value - 1))} className="rounded border border-[var(--border)] p-1.5 text-[var(--hint)]"><ArrowLeft size={14} /></button>
            <button type="button" onClick={() => setIndex((value) => Math.min(items.length - 1, value + 1))} className="rounded border border-[var(--border)] p-1.5 text-[var(--hint)]"><ArrowRight size={14} /></button>
          </div>
        </div>

        <blockquote className="mt-5 whitespace-pre-wrap text-[17px] leading-relaxed text-[var(--text)]">{capture.content}</blockquote>
        <div className="mono mt-3 flex flex-wrap items-center gap-2 text-[10px] text-[var(--muted)]">
          <span className="rounded border border-[var(--border)] px-1.5 py-0.5">{capture.bucket}</span>
          <span>{capture.captureMode}</span>
          <span>{relativeTime(capture.createdAt)}</span>
          {capture.tags.map((tag) => <span key={tag} className="text-[var(--emerald)]">#{tag}</span>)}
        </div>

        {uncertainHeads.length > 0 ? (
          <div className="mt-4 space-y-3 rounded border border-[var(--border)] bg-[var(--surface-2)] p-3">
            {uncertainHeads.map((decision) => (
              <DecisionRow key={decision.headId} decision={decision} heads={heads} onOverride={onOverride} />
            ))}
          </div>
        ) : (
          <p className="mt-4 text-[11px] text-[var(--muted)]">No Jev decision was recorded. Run Jev or set every field manually.</p>
        )}

        <div className="mt-6">
          <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Bucket override · hotkeys 1–6</div>
          <div className="mt-2 grid grid-cols-6 gap-1.5">
            {BUCKETS.map((bucket, position) => (
              <button
                key={bucket}
                type="button"
                onClick={() => { onBucket(capture.id, bucket); notify(`Bucket → ${bucket}`, 'success'); }}
                className={cn('rounded border px-2 py-2 text-[11px] transition', capture.bucket === bucket ? 'border-[var(--emerald)] bg-[var(--emerald-soft)] text-[var(--emerald)]' : 'border-[var(--border)] text-[var(--hint)] hover:text-[var(--text)]')}
              >
                <span className="mono mr-1 text-[9px] text-[var(--muted)]">{position + 1}</span>{bucket}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={() => onJev(capture.id)} className="flex items-center gap-1 rounded border border-[var(--border-strong)] px-3 py-1.5 text-[11px] text-[var(--amber)]"><Sparkles size={11} /> Re-run Jev</button>
          <button type="button" onClick={() => onInspect(capture.id)} className="flex items-center gap-1 rounded border border-[var(--border-strong)] px-3 py-1.5 text-[11px] text-[var(--text)]"><Eye size={11} /> Inspect</button>
          <button type="button" onClick={() => onStatus(capture.id, 'resolved')} className="flex items-center gap-1 rounded border border-[var(--border-strong)] px-3 py-1.5 text-[11px] text-[var(--emerald)]"><Check size={11} /> Resolve</button>
          <button type="button" onClick={() => onStatus(capture.id, 'archived')} className="flex items-center gap-1 rounded border border-[var(--border-strong)] px-3 py-1.5 text-[11px] text-[var(--hint)]">Archive</button>
        </div>
      </div>
    </div>
  );
}

function DecisionRow({
  decision, heads, onOverride,
}: {
  decision: Decision;
  heads: Head[];
  onOverride: (id: string, headId: string, valueText?: string, valueNum?: number) => void;
}) {
  const head = heads.find((item) => item.id === decision.headId || item.name === decision.headName);
  return (
    <div>
      <div className="flex items-center justify-between text-[10.5px]">
        <span className="text-[var(--hint)]">{decision.headName}</span>
        <span className="mono text-[var(--amber)]">H {decision.entropy.toFixed(2)} · {decision.source}</span>
      </div>
      <div className="mono mt-1 flex flex-wrap gap-2 text-[9px] text-[var(--muted)]">
        {Object.entries(decision.probs).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([key, probability]) => (
          <span key={key} className="flex items-center gap-1">
            {key}
            <span className="inline-block h-1 w-10 overflow-hidden rounded bg-[var(--surface-hover)]"><span className="block h-full bg-[var(--amber)]" style={{ width: `${probability * 100}%` }} /></span>
            {(probability * 100).toFixed(0)}%
          </span>
        ))}
      </div>
      {head ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {head.primitive === 'choice' ? (head.config.options ?? []).map((option) => (
            <button key={option.value} type="button" onClick={() => onOverride(decision.captureId, head.id, option.value)} className={cn('mono rounded border px-1.5 py-0.5 text-[9px]', decision.valueText === option.value ? 'border-[var(--emerald)] text-[var(--emerald)]' : 'border-[var(--border)] text-[var(--muted)]')}>{option.value}</button>
          )) : null}
          {head.primitive === 'score' ? Array.from({ length: Math.max(0, (head.config.max ?? 3) - (head.config.min ?? 0) + 1) }, (_, index) => (head.config.min ?? 0) + index).map((rung) => (
            <button key={rung} type="button" onClick={() => onOverride(decision.captureId, head.id, undefined, rung)} className={cn('mono rounded border px-1.5 py-0.5 text-[9px]', decision.valueNum === rung ? 'border-[var(--emerald)] text-[var(--emerald)]' : 'border-[var(--border)] text-[var(--muted)]')}>{rung}</button>
          )) : null}
          {head.primitive === 'noul' ? (
            <>
              <button type="button" onClick={() => onOverride(decision.captureId, head.id, 'yes', 1)} className="mono rounded border border-[var(--border)] px-1.5 py-0.5 text-[9px] text-[var(--emerald)]">yes</button>
              <button type="button" onClick={() => onOverride(decision.captureId, head.id, 'no', 0)} className="mono rounded border border-[var(--border)] px-1.5 py-0.5 text-[9px] text-[var(--rose)]">no</button>
            </>
          ) : null}
          <button type="button" onClick={() => onOverride(decision.captureId, head.id, undefined, decision.valueNum ?? undefined)} className="mono flex items-center gap-1 rounded border border-[var(--border)] px-1.5 py-0.5 text-[9px] text-[var(--muted)]"><RefreshCw size={8} /> keep value</button>
        </div>
      ) : null}
    </div>
  );
}
