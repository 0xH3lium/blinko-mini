import { useEffect, useMemo, useState } from 'react';
import { Link2, LoaderCircle, Plus, X } from 'lucide-react';
import { createAutoCapture, createManualCapture, getCaptures } from '../api/client';
import type { Bucket, Capture, CaptureResult, CaptureStatus, EdgeRelation, Head } from '../types/capture';
import { cn, normalizeTag } from '../lib/utils';
import type { Notify } from '../types/ui';

const BUCKETS: Bucket[] = ['idea', 'memory', 'reminder', 'question', 'reference', 'noise'];
const STATUSES: CaptureStatus[] = ['active', 'resolved', 'archived'];
const RELATIONS: EdgeRelation[] = ['related', 'refines', 'supports', 'blocks', 'answers', 'reply'];

interface DecisionValue {
  valueText?: string | null;
  valueNum?: number | null;
}

export function CaptureModal({
  open, initialMode, heads, tags, notify, onClose, onCreated,
}: {
  open: boolean;
  initialMode: 'auto' | 'manual';
  heads: Head[];
  tags: string[];
  notify: Notify;
  onClose: () => void;
  onCreated: (result: CaptureResult) => void;
}) {
  const [mode, setMode] = useState<'auto' | 'manual'>(initialMode);
  const [autoText, setAutoText] = useState('');
  const [skipUrlFetch, setSkipUrlFetch] = useState(false);
  const [content, setContent] = useState('');
  const [bucket, setBucket] = useState<Bucket>('idea');
  const [status, setStatus] = useState<CaptureStatus>('active');
  const [isPinned, setIsPinned] = useState(false);
  const [manualTags, setManualTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [urlTitle, setUrlTitle] = useState('');
  const [urlExcerpt, setUrlExcerpt] = useState('');
  const [createdAt, setCreatedAt] = useState('');
  const [decisions, setDecisions] = useState<Record<string, DecisionValue | null>>({});
  const [links, setLinks] = useState<Array<{ targetId: string; relation: EdgeRelation; note?: string }>>([]);
  const [linkQuery, setLinkQuery] = useState('');
  const [linkResults, setLinkResults] = useState<Capture[]>([]);
  const [linkTarget, setLinkTarget] = useState<Capture | null>(null);
  const [linkRelation, setLinkRelation] = useState<EdgeRelation>('related');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'm') {
        event.preventDefault();
        setMode((current) => (current === 'auto' ? 'manual' : 'auto'));
      }
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, initialMode, onClose]);

  useEffect(() => {
    if (!open || !linkQuery.trim()) {
      setLinkResults([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      getCaptures({ q: linkQuery, status: 'all', limit: 8 })
        .then((page) => { if (!cancelled) setLinkResults(page.captures); })
        .catch(() => { if (!cancelled) setLinkResults([]); });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [open, linkQuery]);

  const suggestions = useMemo(
    () => tags.filter((tag) => !manualTags.includes(tag) && tag.includes(tagDraft.toLowerCase())).slice(0, 6),
    [tags, manualTags, tagDraft],
  );
  const activeHeads = heads.filter((head) => head.active);

  function addTag(raw: string): void {
    const tag = normalizeTag(raw);
    if (tag && !manualTags.includes(tag)) setManualTags((current) => [...current, tag]);
    setTagDraft('');
  }

  function quickDue(kind: '4h' | 'tomorrow' | 'week' | 'clear'): void {
    if (kind === 'clear') return setDueAt('');
    let target: Date;
    if (kind === '4h') target = new Date(Date.now() + 4 * 3_600_000);
    else if (kind === 'week') target = new Date(Date.now() + 7 * 86_400_000);
    else {
      target = new Date(Date.now() + 86_400_000);
      target.setHours(9, 0, 0, 0);
    }
    setDueAt(toLocalInput(target.getTime()));
  }

  async function submit(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const result = mode === 'auto'
        ? await createAutoCapture(autoText, skipUrlFetch)
        : await createManualCapture({
            content,
            bucket,
            status,
            isPinned,
            tags: manualTags,
            sourceUrl: sourceUrl || null,
            urlTitle: urlTitle || null,
            urlExcerpt: urlExcerpt || null,
            meta: {},
            ...(createdAt ? { createdAt: new Date(createdAt).getTime() } : {}),
            reminderDueAt: dueAt ? new Date(dueAt).getTime() : null,
            decisions,
            links,
          });
      notify(mode === 'manual' ? 'Manual capture created · zero Jev calls' : 'Auto capture routed', 'success');
      onCreated(result);
      reset();
      onClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Capture failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  function reset(): void {
    setAutoText(''); setContent(''); setManualTags([]); setDueAt(''); setSourceUrl('');
    setUrlTitle(''); setUrlExcerpt(''); setCreatedAt(''); setDecisions({}); setLinks([]);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="flex max-h-[92vh] w-full max-w-[720px] animate-rise flex-col rounded-lg border border-[var(--border-strong)] bg-[var(--surface)]">
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-3">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text)]"><Plus size={14} className="text-[var(--emerald)]" /> New Capture</h2>
          <div className="flex rounded border border-[var(--border-strong)] p-0.5">
            {(['auto', 'manual'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={cn('rounded px-3 py-1 text-[11px] font-semibold', mode === value ? 'bg-[var(--emerald)] text-[#05130d]' : 'text-[var(--muted)] hover:text-[var(--text)]')}
              >
                {value === 'auto' ? 'Auto (Jev)' : 'Manual (Full Control)'}
              </button>
            ))}
          </div>
          <button type="button" onClick={onClose} className="text-[var(--muted)] hover:text-[var(--text)]"><X size={15} /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {mode === 'auto' ? (
            <div>
              <textarea
                value={autoText}
                onChange={(event) => setAutoText(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit(); }}
                rows={8}
                autoFocus
                placeholder="Atomic thought, #tag, !rem tomorrow 9am, https://…"
                className="w-full resize-y rounded border border-[var(--border-strong)] bg-[#0b0f12] p-3 text-[13px] leading-relaxed outline-none focus:border-[var(--emerald)]"
              />
              <label className="mt-3 flex items-center gap-2 text-[11px] text-[var(--hint)]">
                <input type="checkbox" checked={skipUrlFetch} onChange={(event) => setSkipUrlFetch(event.target.checked)} className="accent-[var(--emerald)]" />
                Skip URL fetch
              </label>
              <p className="mono mt-3 text-[10px] leading-relaxed text-[var(--muted)]">
                !m / !raw bypass Jev · !rem · remind · mem: · idea: · q: · ref: · #tags · dates · URL readability
              </p>
              <p className="mt-2 text-[10.5px] text-[var(--muted)]">⌘Enter to submit · ⌘M switches to Manual mode.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit(); }}
                rows={4}
                autoFocus
                placeholder="Manual capture (Markdown) — no Jev call will be made"
                className="w-full resize-y rounded border border-[var(--border-strong)] bg-[#0b0f12] p-3 text-[13px] leading-relaxed outline-none focus:border-[var(--emerald)]"
              />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Bucket</Label>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {BUCKETS.map((value) => (
                      <Chip key={value} active={bucket === value} onClick={() => setBucket(value)} label={value} />
                    ))}
                  </div>
                </div>
                <div>
                  <Label>Status</Label>
                  <div className="mt-1 flex gap-1">
                    {STATUSES.map((value) => (
                      <Chip key={value} active={status === value} onClick={() => setStatus(value)} label={value} />
                    ))}
                    <Chip active={isPinned} onClick={() => setIsPinned((value) => !value)} label="📌 pin" />
                  </div>
                </div>
              </div>

              <div>
                <Label>Tags</Label>
                <div className="mt-1 flex flex-wrap items-center gap-1 rounded border border-[var(--border)] bg-[var(--surface-2)] p-1.5">
                  {manualTags.map((tag) => (
                    <button key={tag} type="button" onClick={() => setManualTags((current) => current.filter((item) => item !== tag))} className="mono rounded bg-[var(--emerald-soft)] px-1.5 py-0.5 text-[10px] text-[var(--emerald)]">
                      #{tag} ×
                    </button>
                  ))}
                  <input
                    value={tagDraft}
                    onChange={(event) => setTagDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addTag(tagDraft); }
                    }}
                    placeholder="type + Enter"
                    className="min-w-[110px] flex-1 bg-transparent px-1 text-[11px] outline-none"
                  />
                </div>
                {suggestions.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {suggestions.map((tag) => <Chip key={tag} label={`#${tag}`} onClick={() => addTag(tag)} />)}
                  </div>
                ) : null}
              </div>

              <div>
                <Label>Reminder</Label>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[11px] outline-none" />
                  <Chip label="+4h" onClick={() => quickDue('4h')} />
                  <Chip label="Tomorrow 9am" onClick={() => quickDue('tomorrow')} />
                  <Chip label="+1w" onClick={() => quickDue('week')} />
                  <Chip label="Clear" onClick={() => quickDue('clear')} />
                </div>
              </div>

              <div>
                <Label>Source URL & metadata</Label>
                <div className="mt-1 flex gap-1.5">
                  <input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://…" className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[11px] outline-none" />
                  <button type="button" onClick={() => setSourceUrl('')} className="rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--muted)]">Clear</button>
                </div>
                <div className="mt-1 grid grid-cols-2 gap-1.5">
                  <input value={urlTitle} onChange={(event) => setUrlTitle(event.target.value)} placeholder="Editable title" className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[11px] outline-none" />
                  <input value={urlExcerpt} onChange={(event) => setUrlExcerpt(event.target.value)} placeholder="Editable excerpt" className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[11px] outline-none" />
                </div>
              </div>

              <div>
                <Label>All Active Decision Heads · zero Jev</Label>
                <div className="mt-1.5 space-y-2">
                  {activeHeads.map((head) => {
                    const value = decisions[head.name] ?? decisions[head.id];
                    return (
                      <div key={head.id} className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-[var(--hint)]">{head.name}</span>
                          <span className="mono text-[9px] text-[var(--muted)]">{head.primitive}</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {head.primitive === 'choice' ? (head.config.options ?? []).map((option) => (
                            <Chip key={option.value} label={option.value} active={value?.valueText === option.value} title={option.description} onClick={() => setDecisions((current) => ({ ...current, [head.name]: { valueText: option.value } }))} />
                          )) : null}
                          {head.primitive === 'score' ? Array.from({ length: Math.max(0, (head.config.max ?? 3) - (head.config.min ?? 0) + 1) }, (_, index) => (head.config.min ?? 0) + index).map((rung) => (
                            <Chip key={rung} label={String(rung)} active={value?.valueNum === rung} title={head.config.rubric?.[String(rung)]} onClick={() => setDecisions((current) => ({ ...current, [head.name]: { valueNum: rung } }))} />
                          )) : null}
                          {head.primitive === 'noul' ? (
                            <>
                              <Chip label="yes" active={value?.valueText === 'yes'} onClick={() => setDecisions((current) => ({ ...current, [head.name]: { valueText: 'yes', valueNum: 1 } }))} />
                              <Chip label="no" active={value?.valueText === 'no'} onClick={() => setDecisions((current) => ({ ...current, [head.name]: { valueText: 'no', valueNum: 0 } }))} />
                            </>
                          ) : null}
                          <Chip label="Unset" active={value === null} onClick={() => setDecisions((current) => ({ ...current, [head.name]: null }))} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <Label>Manual Links</Label>
                <div className="mt-1 flex gap-1.5">
                  <input value={linkQuery} onChange={(event) => setLinkQuery(event.target.value)} placeholder="FTS5 search captures…" className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[11px] outline-none" />
                  <select value={linkRelation} onChange={(event) => setLinkRelation(event.target.value as EdgeRelation)} className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-1 text-[11px]">
                    {RELATIONS.map((relation) => <option key={relation} value={relation}>{relation}</option>)}
                  </select>
                </div>
                {linkResults.length > 0 ? (
                  <div className="mt-1 max-h-24 overflow-y-auto rounded border border-[var(--border)] bg-[var(--surface-2)]">
                    {linkResults.map((capture) => (
                      <button key={capture.id} type="button" onClick={() => setLinkTarget(capture)} className="block w-full truncate px-2 py-1 text-left text-[10.5px] text-[var(--hint)] hover:bg-[var(--surface-hover)]">
                        <span className="mono mr-1 text-[var(--emerald)]">{capture.bucket.slice(0, 3)}</span>{capture.content}
                      </button>
                    ))}
                  </div>
                ) : null}
                {linkTarget ? (
                  <button type="button" onClick={() => { setLinks((current) => [...current, { targetId: linkTarget.id, relation: linkRelation }]); setLinkTarget(null); setLinkQuery(''); }} className="mt-1 flex items-center gap-1 rounded border border-[var(--emerald)] px-2 py-1 text-[10px] text-[var(--emerald)]">
                    <Link2 size={10} /> Link “{linkTarget.content.slice(0, 40)}” as {linkRelation}
                  </button>
                ) : null}
                {links.length > 0 ? (
                  <div className="mt-1 space-y-0.5">
                    {links.map((link, index) => (
                      <div key={`${link.targetId}:${link.relation}:${index}`} className="flex items-center justify-between rounded bg-[var(--surface-2)] px-2 py-1 text-[10px] text-[var(--hint)]">
                        <span className="mono">{link.relation} → {link.targetId.slice(0, 8)}</span>
                        <button type="button" onClick={() => setLinks((current) => current.filter((_, position) => position !== index))} className="text-[var(--muted)] hover:text-[var(--rose)]"><X size={10} /></button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <details className="rounded border border-[var(--border)] p-2">
                <summary className="cursor-pointer text-[10px] text-[var(--muted)]">Created At override</summary>
                <input type="datetime-local" value={createdAt} onChange={(event) => setCreatedAt(event.target.value)} className="mt-2 rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[11px] outline-none" />
              </details>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] px-5 py-3">
          <span className="mono text-[10px] text-[var(--muted)]">{mode === 'manual' ? 'Zero Jev calls · human decisions only' : 'One batched Jev call when mode=auto'}</span>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || (mode === 'auto' ? !autoText.trim() : !content.trim())}
            className="flex items-center gap-1.5 rounded bg-[var(--emerald)] px-3 py-1.5 text-[11px] font-semibold text-[#05130d] disabled:opacity-40"
          >
            {busy ? <LoaderCircle size={12} className="animate-spin" /> : null}
            {mode === 'manual' ? 'Create manually' : 'Route capture'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">{children}</div>;
}

function Chip({ label, active = false, onClick, title }: { label: string; active?: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'mono rounded border px-1.5 py-0.5 text-[9.5px] transition',
        active ? 'border-[var(--emerald)] bg-[var(--emerald-soft)] text-[var(--emerald)]' : 'border-[var(--border)] text-[var(--hint)] hover:border-[var(--border-strong)] hover:text-[var(--text)]',
      )}
    >
      {label}
    </button>
  );
}

function toLocalInput(timestamp: number): string {
  const date = new Date(timestamp - new Date().getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}
