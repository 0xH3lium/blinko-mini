import { useEffect, useMemo, useState } from 'react';
import { Layers, Link2, LoaderCircle, Plus, X } from 'lucide-react';
import { createAutoCapture, createBatch, createManualCapture, getCaptures } from '../api/client';
import type { Bucket, Capture, CaptureResult, CaptureStatus, CustomField, EdgeRelation } from '../types/capture';
import { cn, normalizeTag } from '../lib/utils';
import type { Notify } from '../types/ui';

const BUCKETS: Bucket[] = ['idea', 'memory', 'reminder', 'question', 'reference', 'noise'];
const STATUSES: CaptureStatus[] = ['active', 'resolved', 'archived'];
const RELATIONS: EdgeRelation[] = ['related', 'refines', 'supports', 'blocks', 'answers', 'reply'];

type Mode = 'auto' | 'manual' | 'batch';
interface FieldValue { valueText?: string | null; valueNum?: number | null }

export function CaptureModal({
  open, initialMode, fields, tags, notify, onClose, onCreated,
}: {
  open: boolean;
  initialMode: Mode;
  fields: CustomField[];
  tags: string[];
  notify: Notify;
  onClose: () => void;
  onCreated: (result: CaptureResult) => void;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
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
  const [recurrence, setRecurrence] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, FieldValue>>({});
  const [links, setLinks] = useState<Array<{ targetId: string; relation: EdgeRelation; note?: string }>>([]);
  const [linkQuery, setLinkQuery] = useState('');
  const [linkResults, setLinkResults] = useState<Capture[]>([]);
  const [linkTarget, setLinkTarget] = useState<Capture | null>(null);
  const [linkRelation, setLinkRelation] = useState<EdgeRelation>('related');
  const [batchText, setBatchText] = useState('');
  const [batchDelimiter, setBatchDelimiter] = useState<'blank' | 'line'>('blank');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'm') { event.preventDefault(); setMode((current) => current === 'manual' ? 'auto' : 'manual'); }
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, initialMode, onClose]);

  useEffect(() => {
    if (!open || !linkQuery.trim()) { setLinkResults([]); return; }
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
  const batchCount = batchText.split(batchDelimiter === 'blank' ? /\n\s*\n/ : '\n').map((part) => part.trim()).filter(Boolean).length;

  function addTag(raw: string): void {
    const tag = normalizeTag(raw);
    if (tag && !manualTags.includes(tag)) setManualTags((current) => [...current, tag]);
    setTagDraft('');
  }

  async function submit(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      if (mode === 'auto') {
        onCreated(await createAutoCapture(autoText, skipUrlFetch));
        notify('Auto capture routed by local rules · zero model calls', 'success');
      } else if (mode === 'batch') {
        const result = await createBatch(batchText, batchDelimiter === 'blank' ? '\n\n' : '\n');
        notify(`${result.created} atomic captures ingested`, 'success');
        if (result.captures[0]) onCreated({ capture: result.captures[0], appended: false });
      } else {
        onCreated(await createManualCapture({
          content, bucket, status, isPinned, tags: manualTags, sourceUrl: sourceUrl || null,
          urlTitle: urlTitle || null, urlExcerpt: urlExcerpt || null, meta: {},
          ...(createdAt ? { createdAt: new Date(createdAt).getTime() } : {}),
          reminderDueAt: dueAt ? new Date(dueAt).getTime() : null,
          recurrence: recurrence || null, expiresAt: expiresAt ? new Date(expiresAt).getTime() : null,
          fields: fieldValues, links,
        }));
        notify('Manual capture created · human fields locked', 'success');
      }
      reset();
      onClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Capture failed', 'error');
    } finally { setBusy(false); }
  }

  function reset(): void {
    setAutoText(''); setContent(''); setManualTags([]); setDueAt(''); setSourceUrl(''); setUrlTitle('');
    setUrlExcerpt(''); setCreatedAt(''); setRecurrence(''); setExpiresAt(''); setFieldValues({}); setLinks([]); setBatchText('');
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="flex max-h-[92vh] w-full max-w-[720px] animate-rise flex-col rounded-lg border border-[var(--border-strong)] bg-[var(--surface)]">
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-3">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text)]"><Plus size={14} className="text-[var(--emerald)]" /> New Capture</h2>
          <div className="flex rounded border border-[var(--border-strong)] p-0.5">
            {([
              ['auto', 'Quick (Rules)'], ['manual', 'Manual (Full Control)'], ['batch', 'Batch Paste'],
            ] as const).map(([value, label]) => (
              <button key={value} type="button" onClick={() => setMode(value)}
                className={cn('rounded px-2.5 py-1 text-[10.5px] font-semibold', mode === value ? 'bg-[var(--emerald)] text-[#05130d]' : 'text-[var(--muted)] hover:text-[var(--text)]')}>
                {label}
              </button>
            ))}
          </div>
          <button type="button" onClick={onClose} className="text-[var(--muted)] hover:text-[var(--text)]"><X size={15} /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {mode === 'auto' ? (
            <div>
              <textarea value={autoText} onChange={(event) => setAutoText(event.target.value)} dir="auto"
                onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit(); }}
                rows={9} autoFocus placeholder="i: idea #تگ !L3 tomorrow 8am https://…"
                className="w-full resize-y rounded border border-[var(--border-strong)] bg-[#0b0f12] p-3 text-[13px] leading-relaxed outline-none focus:border-[var(--emerald)]" />
              <label className="mt-3 flex items-center gap-2 text-[11px] text-[var(--hint)]">
                <input type="checkbox" checked={skipUrlFetch} onChange={(event) => setSkipUrlFetch(event.target.checked)} className="accent-[var(--emerald)]" /> Skip URL fetch
              </label>
              <p className="mono mt-3 text-[10px] leading-relaxed text-[var(--muted)]">
                i:/idea: · m:/mem: · q: · r:/ref: · n:/noise: · !rem · ++ append · ^ link · !pin · !ttl 15m · !every day 8am · !L3 · !act · @domain:infra · #تگ
              </p>
            </div>
          ) : mode === 'batch' ? (
            <div>
              <div className="flex items-center gap-3 text-[11px] text-[var(--hint)]">
                <span className="flex items-center gap-1"><Layers size={13} className="text-[var(--emerald)]" /> Split delimiter</span>
                <label className="mono flex items-center gap-1"><input type="radio" checked={batchDelimiter === 'blank'} onChange={() => setBatchDelimiter('blank')} /> Blank line</label>
                <label className="mono flex items-center gap-1"><input type="radio" checked={batchDelimiter === 'line'} onChange={() => setBatchDelimiter('line')} /> Every line</label>
              </div>
              <textarea value={batchText} onChange={(event) => setBatchText(event.target.value)} dir="auto" rows={12} autoFocus placeholder={'First atomic note\n\nSecond atomic note\n\nThird note'} className="mono mt-3 w-full resize-y rounded border border-[var(--border-strong)] bg-[#0b0f12] p-3 text-[12px] leading-relaxed outline-none focus:border-[var(--emerald)]" />
              <p className="mono mt-2 text-[10px] text-[var(--emerald)]">{batchCount} atomic captures detected · ingested through the deterministic Rule Engine</p>
            </div>
          ) : (
            <div className="space-y-4">
              <textarea value={content} onChange={(event) => setContent(event.target.value)} dir="auto" rows={4} autoFocus placeholder="Manual capture (Markdown)" className="w-full resize-y rounded border border-[var(--border-strong)] bg-[#0b0f12] p-3 text-[13px] leading-relaxed outline-none focus:border-[var(--emerald)]" />
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Bucket</Label><div className="mt-1 flex flex-wrap gap-1">{BUCKETS.map((value) => (
                  <Chip key={value} label={value} active={bucket === value} onClick={() => setBucket(value)} />
                ))}</div></div>
                <div><Label>Status</Label><div className="mt-1 flex gap-1">
                  {STATUSES.map((value) => <Chip key={value} label={value} active={status === value} onClick={() => setStatus(value)} />)}
                  <Chip active={isPinned} onClick={() => setIsPinned((value) => !value)} label="📌 pin" />
                </div></div>
              </div>
              <div>
                <Label>Tags</Label>
                <div className="mt-1 flex flex-wrap items-center gap-1 rounded border border-[var(--border)] bg-[var(--surface-2)] p-1.5">
                  {manualTags.map((tag) => (
                    <button key={tag} type="button" onClick={() => setManualTags((current) => current.filter((item) => item !== tag))} className="mono rounded bg-[var(--emerald-soft)] px-1.5 py-0.5 text-[10px] text-[var(--emerald)]">#{tag} ×</button>
                  ))}
                  <input value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} dir="auto"
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addTag(tagDraft); } }}
                    placeholder="type + Enter" className="min-w-[110px] flex-1 bg-transparent px-1 text-[11px] outline-none" />
                </div>
                {suggestions.length ? <div className="mt-1 flex flex-wrap gap-1">{suggestions.map((tag) => <Chip key={tag} label={`#${tag}`} onClick={() => addTag(tag)} />)}</div> : null}
              </div>
              <div>
                <Label>Reminder · Recurrence · TTL</Label>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[11px] outline-none" />
                  <input value={recurrence} onChange={(event) => setRecurrence(event.target.value)} dir="auto" placeholder="daily@08:00 / every:6h" className="mono w-40 rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[10px] outline-none" />
                  <input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} title="Expires at" className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[11px] outline-none" />
                  <button type="button" onClick={() => setDueAt(new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 16))} className="rounded border border-[var(--border)] px-1.5 py-1 text-[10px] text-[var(--hint)]">+4h</button>
                </div>
              </div>
              <div>
                <Label>Source URL & metadata</Label>
                <div className="mt-1 flex gap-1.5">
                  <input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} dir="auto" placeholder="https://…" className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[11px] outline-none" />
                </div>
                <div className="mt-1 grid grid-cols-2 gap-1.5">
                  <input value={urlTitle} onChange={(event) => setUrlTitle(event.target.value)} dir="auto" placeholder="Editable title" className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[11px] outline-none" />
                  <input value={urlExcerpt} onChange={(event) => setUrlExcerpt(event.target.value)} dir="auto" placeholder="Editable excerpt" className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[11px] outline-none" />
                </div>
              </div>
              <div>
                <Label>Custom Fields · human values are locked</Label>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  {fields.filter((field) => field.active).map((field) => (
                    <div key={field.id} className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10.5px] text-[var(--hint)]">{field.name}</span>
                        <span className="mono text-[9px] text-[var(--muted)]">{field.alias ?? field.fieldType}</span>
                      </div>
                      {field.fieldType === 'choice' ? (
                        <select value={fieldValues[field.name]?.valueText ?? ''} onChange={(event) => setFieldValues((current) => ({ ...current, [field.name]: { valueText: event.target.value } }))} className="mono mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-1 py-0.5 text-[9px] outline-none">
                          <option value="">unset</option>{(field.config.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label ?? option.value}</option>)}
                        </select>
                      ) : field.fieldType === 'boolean' ? (
                        <div className="mt-1 flex gap-1">
                          {(['yes', 'no'] as const).map((value) => <Chip key={value} label={value} active={fieldValues[field.name]?.valueText === value} onClick={() => setFieldValues((current) => ({ ...current, [field.name]: { valueText: value, valueNum: value === 'yes' ? 1 : 0 } }))} />)}
                        </div>
                      ) : (
                        <input value={fieldValues[field.name]?.valueText ?? ''} onChange={(event) => {
                          const raw = event.target.value;
                          setFieldValues((current) => ({ ...current, [field.name]: { valueText: raw, valueNum: Number.isFinite(Number(raw)) && field.fieldType === 'score' ? Number(raw) : null } }));
                        }} dir="auto" placeholder={field.fieldType === 'score' ? 'number' : 'text'} className="mono mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-1 py-0.5 text-[9px] outline-none" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <Label>Manual Links</Label>
                <div className="mt-1 flex gap-1.5">
                  <input value={linkQuery} onChange={(event) => setLinkQuery(event.target.value)} dir="auto" placeholder="FTS5 search captures…" className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[11px] outline-none" />
                  <select value={linkRelation} onChange={(event) => setLinkRelation(event.target.value as EdgeRelation)} className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-1 text-[11px]">
                    {RELATIONS.map((relation) => <option key={relation}>{relation}</option>)}
                  </select>
                </div>
                {linkResults.length ? (
                  <div className="mt-1 max-h-24 overflow-y-auto rounded border border-[var(--border)] bg-[var(--surface-2)]">
                    {linkResults.map((capture) => <button key={capture.id} type="button" onClick={() => setLinkTarget(capture)} dir="auto" className="block w-full truncate px-2 py-1 text-left text-[10.5px] text-[var(--hint)] hover:bg-[var(--surface-hover)]"><span className="mono mr-1 text-[var(--emerald)]">{capture.bucket.slice(0, 3)}</span>{capture.content}</button>)}
                  </div>
                ) : null}
                {linkTarget ? (
                  <button type="button" onClick={() => { setLinks((current) => [...current, { targetId: linkTarget.id, relation: linkRelation }]); setLinkTarget(null); setLinkQuery(''); }} className="mt-1 flex items-center gap-1 rounded border border-[var(--emerald)] px-2 py-1 text-[10px] text-[var(--emerald)]">
                    <Link2 size={10} /> Link “{linkTarget.content.slice(0, 40)}” as {linkRelation}
                  </button>
                ) : null}
                {links.length ? (
                  <div className="mt-1 space-y-0.5">{links.map((link, index) => (
                    <div key={`${link.targetId}:${link.relation}:${index}`} className="flex items-center justify-between rounded bg-[var(--surface-2)] px-2 py-1 text-[10px] text-[var(--hint)]">
                      <span className="mono">{link.relation} → {link.targetId.slice(0, 8)}</span>
                      <button type="button" onClick={() => setLinks((current) => current.filter((_, position) => position !== index))} className="text-[var(--muted)] hover:text-[var(--rose)]"><X size={10} /></button>
                    </div>
                  ))}</div>
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
          <span className="mono text-[10px] text-[var(--muted)]">{mode === 'batch' ? `${batchCount} notes · one transaction` : mode === 'manual' ? 'Human fields locked · zero model calls' : 'Local rules · zero model calls'}</span>
          <button type="button" onClick={() => void submit()} disabled={busy || (mode === 'batch' ? !batchText.trim() : !autoText.trim() && !content.trim())}
            className="flex items-center gap-1.5 rounded bg-[var(--emerald)] px-3 py-1.5 text-[11px] font-semibold text-[#05130d] disabled:opacity-40">
            {busy ? <LoaderCircle size={12} className="animate-spin" /> : null}
            {mode === 'batch' ? 'Ingest batch' : mode === 'manual' ? 'Create manually' : 'Route capture'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">{children}</div>;
}

function Chip({ label, active = false, onClick }: { label: string; active?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn('mono rounded border px-1.5 py-0.5 text-[9.5px] transition',
      active ? 'border-[var(--emerald)] bg-[var(--emerald-soft)] text-[var(--emerald)]' : 'border-[var(--border)] text-[var(--hint)] hover:border-[var(--border-strong)] hover:text-[var(--text)]')}>
      {label}
    </button>
  );
}
