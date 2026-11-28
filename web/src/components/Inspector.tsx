import { useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { Check, ChevronDown, Link2, Pencil, Pin, Sparkles, Trash2, Unlock, X } from 'lucide-react';
import { getCaptures, getRelated, reminderAction } from '../api/client';
import type {
  Bucket, Capture, CaptureDetail, CaptureField, CapturePatch, CaptureStatus, CustomField,
  EdgeRelation, Reminder,
} from '../types/capture';
import { cn, extractHashtags, normalizeTag } from '../lib/utils';
import type { Notify } from '../types/ui';

const BUCKETS: Bucket[] = ['idea', 'memory', 'reminder', 'question', 'reference', 'noise'];
const STATUSES: CaptureStatus[] = ['active', 'resolved', 'archived'];
const RELATIONS: EdgeRelation[] = ['reply', 'related', 'refines', 'supports', 'blocks', 'answers'];

export function Inspector({
  detail, fields, allTags, onPatch, onClearField, onDelete, onClose, onJump,
  onAddEdge, onRemoveEdge, onFetchUrl, onExtract, notify,
}: {
  detail: CaptureDetail | null;
  fields: CustomField[];
  allTags: string[];
  onPatch: (id: string, patch: CapturePatch) => Promise<void>;
  onClearField: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => void;
  onClose: () => void;
  onJump: (id: string) => void;
  onAddEdge: (id: string, targetId: string, relation: EdgeRelation, note?: string) => Promise<void>;
  onRemoveEdge: (id: string, targetId: string, relation: EdgeRelation) => Promise<void>;
  onFetchUrl: (id: string) => Promise<void>;
  onExtract: (templateId?: string, captureIds?: string[]) => void;
  notify: Notify;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  const [metaDraft, setMetaDraft] = useState('{}');
  const [linkQuery, setLinkQuery] = useState('');
  const [linkResults, setLinkResults] = useState<Capture[]>([]);
  const [linkRelation, setLinkRelation] = useState<EdgeRelation>('related');
  const [linkNote, setLinkNote] = useState('');
  const [related, setRelated] = useState<Array<{ capture: Capture; reason: string }>>([]);

  // Buffering text inputs prevents a PATCH on every keystroke; save happens on blur or after 400ms.
  const [urlDraft, setUrlDraft] = useState({ sourceUrl: '', urlTitle: '', urlExcerpt: '', createdAt: '' });
  const urlFocused = useRef(false);
  // Drafts follow the selected capture only: an SSE echo must not overwrite in-flight typing.
  useEffect(() => {
    urlFocused.current = false;
    setEditing(false);
    setDraft(detail?.content ?? '');
    setMetaDraft(JSON.stringify(detail?.meta ?? {}, null, 2));
    setUrlDraft({
      sourceUrl: detail?.sourceUrl ?? '', urlTitle: detail?.urlTitle ?? '', urlExcerpt: detail?.urlExcerpt ?? '',
      createdAt: detail ? toLocalInput(detail.createdAt) : '',
    });
  }, [detail?.id]);
  useEffect(() => { if (!editing) setDraft(detail?.content ?? ''); }, [detail?.id, detail?.content]);

  const urlPatch = useMemo((): CapturePatch | null => {
    if (!detail) return null;
    const patch: CapturePatch = {};
    if (urlDraft.sourceUrl !== (detail.sourceUrl ?? '')) patch.sourceUrl = urlDraft.sourceUrl || null;
    if (urlDraft.urlTitle !== (detail.urlTitle ?? '')) patch.urlTitle = urlDraft.urlTitle || null;
    if (urlDraft.urlExcerpt !== (detail.urlExcerpt ?? '')) patch.urlExcerpt = urlDraft.urlExcerpt || null;
    const created = new Date(urlDraft.createdAt).getTime();
    if (urlDraft.createdAt && Number.isFinite(created) && created !== detail.createdAt) patch.createdAt = created;
    return Object.keys(patch).length ? patch : null;
  }, [detail, urlDraft]);

  useEffect(() => {
    if (!detail || !urlPatch || urlFocused.current) return;
    const timer = window.setTimeout(() => { void onPatch(detail.id, urlPatch); }, 400);
    return () => window.clearTimeout(timer);
  }, [detail, urlPatch, onPatch]);

  useEffect(() => {
    if (!detail?.id) { setRelated([]); return; }
    let cancelled = false;
    getRelated(detail.id).then((result) => { if (!cancelled) setRelated(result.related.slice(0, 5)); }).catch(() => { if (!cancelled) setRelated([]); });
    return () => { cancelled = true; };
  }, [detail?.id, detail?.edgeCount]);

  useEffect(() => {
    if (!linkQuery.trim()) { setLinkResults([]); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      getCaptures({ q: linkQuery, status: 'all', limit: 8 })
        .then((page) => { if (!cancelled) setLinkResults(page.captures.filter((capture) => capture.id !== detail?.id)); })
        .catch(() => { if (!cancelled) setLinkResults([]); });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [linkQuery, detail?.id]);

  const html = useMemo(() => (detail ? DOMPurify.sanitize(String(marked.parse(detail.content))) : ''), [detail?.content]);

  if (!detail) {
    return (
      <aside className="flex w-[420px] shrink-0 flex-col border-l border-[var(--border)] bg-[#0c1013]">
        <div className="flex flex-1 items-center justify-center p-6 text-center text-[11px] text-[var(--muted)]">Select a capture to edit everything locally.</div>
      </aside>
    );
  }

  const saveContent = () => { void onPatch(detail.id, { content: draft }); setEditing(false); };
  const addTag = (raw: string) => {
    const tag = normalizeTag(raw);
    if (!tag || detail.tags.includes(tag)) return;
    void onPatch(detail.id, { tags: [...detail.tags, tag] });
    setTagDraft('');
  };
  const saveMeta = () => {
    try {
      const parsed = JSON.parse(metaDraft) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('meta must be a JSON object');
      void onPatch(detail.id, { meta: parsed });
      notify('meta saved', 'success');
    } catch (error) { notify(error instanceof Error ? error.message : 'Invalid meta JSON', 'error'); }
  };
  const setField = (field: CustomField, value: { valueText?: string | null; valueNum?: number | null }) => {
    void onPatch(detail.id, { fields: { [field.name]: { ...value, source: 'human' } } });
  };

  return (
    <aside className="flex w-[420px] shrink-0 flex-col overflow-y-auto border-l border-[var(--border)] bg-[#0c1013]">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1.5 border-b border-[var(--border)] bg-[#0c1013] px-3 py-2">
        <select value={detail.bucket} onChange={(event) => void onPatch(detail.id, { bucket: event.target.value as Bucket })} className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-1 text-[10px]">
          {BUCKETS.map((bucket) => <option key={bucket}>{bucket}</option>)}
        </select>
        <select value={detail.status} onChange={(event) => void onPatch(detail.id, { status: event.target.value as CaptureStatus })} className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-1 text-[10px]">
          {STATUSES.map((status) => <option key={status}>{status}</option>)}
        </select>
        <button type="button" onClick={() => void onPatch(detail.id, { isPinned: !detail.isPinned })} title="Pin" className={cn('rounded p-1', detail.isPinned ? 'text-[var(--amber)]' : 'text-[var(--muted)] hover:text-[var(--text)]')}><Pin size={13} /></button>
        <button type="button" onClick={() => void onPatch(detail.id, { triaged: !detail.triaged })} title="Toggle triaged" className={cn('mono rounded border px-1 py-0.5 text-[9px]', detail.triaged ? 'border-[var(--emerald)] text-[var(--emerald)]' : 'border-[var(--border)] text-[var(--muted)]')}>{detail.triaged ? '✓ triaged' : 'untriaged'}</button>
        <button type="button" onClick={() => onExtract(undefined, [detail.id])} title="Extract + Links" className="rounded p-1 text-[var(--muted)] hover:text-[var(--emerald)]"><Sparkles size={13} /></button>
        <button type="button" onClick={() => onDelete(detail.id)} title="Trash" className="rounded p-1 text-[var(--muted)] hover:text-[var(--rose)]"><Trash2 size={13} /></button>
        <button type="button" onClick={onClose} title="Close" className="ml-auto rounded p-1 text-[var(--muted)] hover:text-[var(--text)]"><X size={13} /></button>
      </div>

      <Section title="Content">
        {editing ? (
          <div>
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} dir="auto"
              onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) saveContent(); }}
              rows={8} autoFocus className="w-full resize-y rounded border border-[var(--border-strong)] bg-[#0b0f12] p-2.5 text-[12.5px] leading-relaxed outline-none focus:border-[var(--emerald)]" />
            <div className="mt-2 flex gap-1.5">
              <button type="button" onClick={saveContent} className="rounded bg-[var(--emerald)] px-2 py-1 text-[10px] font-semibold text-[#05130d]">Save ⌘Enter</button>
              <button type="button" onClick={() => { setDraft(detail.content); setEditing(false); }} className="rounded border border-[var(--border-strong)] px-2 py-1 text-[10px] text-[var(--hint)]">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="group relative">
            <div className="markdown text-[12.5px]" dir="auto" dangerouslySetInnerHTML={{ __html: html }} />
            <button type="button" onClick={() => setEditing(true)} className="absolute right-0 top-0 rounded border border-[var(--border)] bg-[var(--surface-2)] p-1 text-[var(--muted)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--text)]"><Pencil size={11} /></button>
          </div>
        )}
        <button type="button" onClick={() => void onPatch(detail.id, { tags: [...new Set([...detail.tags, ...extractHashtags(detail.content)])] })}
          className="mt-2 rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--hint)] hover:text-[var(--text)]">Extract #tags from text</button>
      </Section>

      <Section title={`Tags · ${detail.tags.length}`}>
        <div className="flex flex-wrap items-center gap-1" dir="auto">
          {detail.tags.map((tag) => (
            <button key={tag} type="button" onClick={() => void onPatch(detail.id, { tags: detail.tags.filter((item) => item !== tag) })} className="mono rounded bg-[var(--emerald-soft)] px-1.5 py-0.5 text-[10px] text-[var(--emerald)]">#{tag} ×</button>
          ))}
          <input value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} dir="auto"
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addTag(tagDraft); } }}
            list="inspector-tags" placeholder="+ tag" className="w-[90px] bg-transparent px-1 py-0.5 text-[10px] outline-none" />
          <datalist id="inspector-tags">{allTags.map((tag) => <option key={tag} value={tag} />)}</datalist>
        </div>
      </Section>

      <Section title={`Custom Fields · ${Object.keys(detail.fields).length}/${fields.length}`}>
        <div className="space-y-2">
          {fields.filter((field) => field.active).map((field) => (
            <FieldControl key={field.id} field={field} value={detail.fields[field.name]} onSet={setField}
              onClear={() => void onClearField(detail.id, field.name)} />
          ))}
          {fields.length === 0 ? <p className="text-[10.5px] text-[var(--muted)]">No custom fields configured.</p> : null}
        </div>
      </Section>

      <Section title="Reminder / Recurrence / TTL">
        <ReminderEditor reminder={detail.reminder} recurrence={detail.reminder?.recurrence ?? null}
          expiresAt={detail.expiresAt} expireAction={detail.expireAction}
          onSave={(reminder, recurrence) => void onPatch(detail.id, {
            reminder: reminder ? { dueAt: reminder.dueAt, state: reminder.state, snoozeCount: reminder.snoozeCount, recurrence } : null,
          })}
          onAction={(action) => void reminderAction(detail.id, action).then(() => notify('Reminder updated', 'success'))}
          onExpiry={(expiresAt, expireAction) => void onPatch(detail.id, { expiresAt, expireAction })}
          notify={notify} />
      </Section>

      <Section title={`Links · ${detail.edges.length}`}>
        <div className="space-y-1">
          {detail.edges.map((edge) => (
            <div key={`${edge.sourceId}:${edge.targetId}:${edge.relation}`} className="flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-1">
              <span className={cn('mono rounded px-1 text-[8.5px] uppercase', edge.direction === 'outgoing' ? 'bg-[var(--emerald-soft)] text-[var(--emerald)]' : 'bg-[var(--surface-hover)] text-[var(--hint)]')}>
                {edge.direction === 'outgoing' ? '→' : '←'} {edge.relation}
              </span>
              <button type="button" onClick={() => onJump(edge.otherId)} dir="auto" className="min-w-0 flex-1 truncate text-left text-[10.5px] text-[var(--hint)] hover:text-[var(--text)]" title={edge.otherContent}>
                {edge.otherContent.slice(0, 80)} <span className="mono ml-1 text-[8.5px] text-[var(--muted)]">{edge.otherBucket}</span>
              </button>
              <button type="button" onClick={() => void onRemoveEdge(detail.id, edge.otherId, edge.relation)} className="text-[var(--muted)] hover:text-[var(--rose)]"><X size={10} /></button>
            </div>
          ))}
          {detail.edges.length === 0 ? <p className="text-[10.5px] text-[var(--muted)]">No links.</p> : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          <input value={linkQuery} onChange={(event) => setLinkQuery(event.target.value)} dir="auto" placeholder="FTS5 search to link…" className="min-w-[120px] flex-1 rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-1 text-[10px] outline-none" />
          <select value={linkRelation} onChange={(event) => setLinkRelation(event.target.value as EdgeRelation)} className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-1 text-[10px]">
            {RELATIONS.map((relation) => <option key={relation}>{relation}</option>)}
          </select>
          <input value={linkNote} onChange={(event) => setLinkNote(event.target.value)} dir="auto" placeholder="note" className="w-16 rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-1 text-[10px] outline-none" />
        </div>
        {linkResults.length ? (
          <div className="mt-1 max-h-28 overflow-y-auto rounded border border-[var(--border)] bg-[var(--surface-2)]">
            {linkResults.map((capture) => (
              <button key={capture.id} type="button" onClick={() => { void onAddEdge(detail.id, capture.id, linkRelation, linkNote || undefined); setLinkQuery(''); setLinkResults([]); }} dir="auto" className="block w-full truncate px-1.5 py-1 text-left text-[10px] text-[var(--hint)] hover:bg-[var(--surface-hover)]">{capture.content}</button>
            ))}
          </div>
        ) : null}
      </Section>

      <Section title="Suggested Related Captures">
        {related.length ? (
          <div className="space-y-1">
            {related.map(({ capture, reason }) => (
              <div key={capture.id} className="flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-1">
                <div className="min-w-0 flex-1">
                  <button type="button" onClick={() => onJump(capture.id)} dir="auto" className="block w-full truncate text-left text-[10.5px] text-[var(--hint)] hover:text-[var(--text)]">{capture.content}</button>
                  <div className="mono text-[8.5px] text-[var(--muted)]">{reason}</div>
                </div>
                <button type="button" title="+ Link" onClick={() => void onAddEdge(detail.id, capture.id, 'related')} className="rounded border border-[var(--emerald)] px-1 text-[9px] text-[var(--emerald)]">+ Link</button>
              </div>
            ))}
          </div>
        ) : <p className="text-[10.5px] text-[var(--muted)]">No suggestions yet — add tags or links to improve ranking.</p>}
      </Section>

      <details className="border-b border-[var(--border)] p-3">
        <summary className="flex cursor-pointer items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Source URL & Advanced <ChevronDown size={10} /></summary>
        <div className="mt-2 space-y-1.5">
          <input value={urlDraft.sourceUrl} onChange={(event) => setUrlDraft({ ...urlDraft, sourceUrl: event.target.value })} dir="auto" onFocus={() => { urlFocused.current = true; }} onBlur={() => { urlFocused.current = false; if (urlPatch) void onPatch(detail.id, urlPatch); }} placeholder="sourceUrl" className="w-full rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-1 text-[10px] outline-none focus:border-[var(--emerald)]" />
          <input value={urlDraft.urlTitle} onChange={(event) => setUrlDraft({ ...urlDraft, urlTitle: event.target.value })} dir="auto" onFocus={() => { urlFocused.current = true; }} onBlur={() => { urlFocused.current = false; if (urlPatch) void onPatch(detail.id, urlPatch); }} placeholder="urlTitle" className="w-full rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-1 text-[10px] outline-none focus:border-[var(--emerald)]" />
          <textarea value={urlDraft.urlExcerpt} onChange={(event) => setUrlDraft({ ...urlDraft, urlExcerpt: event.target.value })} dir="auto" onFocus={() => { urlFocused.current = true; }} onBlur={() => { urlFocused.current = false; if (urlPatch) void onPatch(detail.id, urlPatch); }} placeholder="urlExcerpt" rows={2} className="w-full resize-y rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-1 text-[10px] outline-none focus:border-[var(--emerald)]" />
          <button type="button" onClick={() => void onFetchUrl(detail.id)} className="rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--hint)] hover:text-[var(--text)]">Re-fetch Readability</button>
          <div className="mono flex items-center gap-2 pt-1 text-[9px] text-[var(--muted)]">
            <span>captureMode: <span className="text-[var(--emerald)]">{detail.captureMode}</span></span>
            <label>createdAt <input type="datetime-local" value={urlDraft.createdAt} onChange={(event) => setUrlDraft({ ...urlDraft, createdAt: event.target.value })} onFocus={() => { urlFocused.current = true; }} onBlur={() => { urlFocused.current = false; if (urlPatch) void onPatch(detail.id, urlPatch); }} className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-0.5 text-[9px] outline-none" /></label>
          </div>
          <textarea value={metaDraft} onChange={(event) => setMetaDraft(event.target.value)} dir="auto" rows={4} className="mono mt-1 w-full resize-y rounded border border-[var(--border)] bg-[#0b0f12] p-1.5 text-[9.5px] outline-none" />
          <button type="button" onClick={saveMeta} className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--emerald)]"><Check size={10} /> Save meta JSON</button>
        </div>
      </details>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-[var(--border)] p-3">
      <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{title}</div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function FieldControl({ field, value, onSet, onClear }: {
  field: CustomField;
  value: CaptureField | undefined;
  onSet: (field: CustomField, value: { valueText?: string | null; valueNum?: number | null }) => void;
  onClear: () => void;
}) {
  const [text, setText] = useState(value?.valueText ?? '');
  useEffect(() => setText(value?.valueText ?? ''), [value?.valueText]);
  return (
    <div className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-[var(--text)]">{field.name}</span>
        <span className="mono rounded border border-[var(--border)] px-1 text-[8.5px] text-[var(--muted)]">{field.fieldType}</span>
        {value ? <span className="mono text-[9px] text-[var(--hint)]">{value.source}{value.locked ? ' 🔒' : ''}</span> : <span className="mono text-[9px] text-[var(--muted)]">unset</span>}
        <button type="button" title={value?.locked ? 'Human-locked — clear to unlock' : 'Clear field'} onClick={onClear} className="ml-auto text-[var(--muted)] hover:text-[var(--rose)]">
          {value?.locked ? <Unlock size={10} /> : <X size={11} />}
        </button>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {field.fieldType === 'choice' ? (field.config.options ?? []).map((option) => (
          <Chip key={option.value} label={option.label ?? option.value} active={value?.valueText === option.value} title={option.color} onClick={() => onSet(field, { valueText: option.value, valueNum: null })} />
        )) : null}
        {field.fieldType === 'score' ? Array.from({ length: Math.max(0, (field.config.max ?? 3) - (field.config.min ?? 0) + 1) }, (_, index) => (field.config.min ?? 0) + index).map((rung) => (
          <Chip key={rung} label={String(rung)} active={value?.valueNum === rung} title={field.config.rubric?.[String(rung)]} onClick={() => onSet(field, { valueNum: rung, valueText: String(rung) })} />
        )) : null}
        {field.fieldType === 'boolean' ? (['yes', 'no'] as const).map((choice) => (
          <Chip key={choice} label={choice} active={value?.valueText === choice} onClick={() => onSet(field, { valueText: choice, valueNum: choice === 'yes' ? 1 : 0 })} />
        )) : null}
        {field.fieldType === 'text' || field.fieldType === 'score' ? (
          <input value={text} onChange={(event) => setText(event.target.value)} dir="auto" onBlur={() => {
            if (text === (value?.valueText ?? '')) return;
            const numeric = Number(text);
            onSet(field, field.fieldType === 'score' && Number.isFinite(numeric) ? { valueText: text, valueNum: numeric } : { valueText: text, valueNum: null });
          }} placeholder="exact" className="mono w-20 rounded border border-[var(--border)] bg-[var(--surface)] px-1 py-0.5 text-[9px] outline-none focus:border-[var(--emerald)]" />
        ) : null}
      </div>
    </div>
  );
}

function Chip({ label, active = false, onClick, title }: { label: string; active?: boolean; onClick: () => void; title?: string }) {
  return (
    <button type="button" onClick={onClick} title={title} className={cn('mono rounded border px-1.5 py-0.5 text-[9px] transition',
      active ? 'border-[var(--emerald)] bg-[var(--emerald-soft)] text-[var(--emerald)]' : 'border-[var(--border)] text-[var(--hint)] hover:border-[var(--border-strong)] hover:text-[var(--text)]')}>
      {label}
    </button>
  );
}

function ReminderEditor({ reminder, recurrence, expiresAt, expireAction, onSave, onAction, onExpiry, notify }: {
  reminder: Reminder | null;
  recurrence: string | null;
  expiresAt: number | null;
  expireAction: 'archive' | 'trash' | 'delete';
  onSave: (value: { dueAt: number; state?: Reminder['state']; snoozeCount?: number } | null, recurrence: string | null) => void;
  onAction: (action: 'done' | 'snooze1' | 'snooze4' | 'tomorrow' | 'week' | 'kill') => void;
  onExpiry: (expiresAt: number | null, expireAction: 'archive' | 'trash' | 'delete') => void;
  notify: Notify;
}) {
  const [dueAt, setDueAt] = useState(reminder ? toLocalInput(reminder.dueAt) : '');
  const [recurrenceDraft, setRecurrenceDraft] = useState(recurrence ?? '');
  const [expiryDraft, setExpiryDraft] = useState(expiresAt ? toLocalInput(expiresAt) : '');
  const [expireActionDraft, setExpireActionDraft] = useState(expireAction);
  useEffect(() => {
    setDueAt(reminder ? toLocalInput(reminder.dueAt) : '');
    setRecurrenceDraft(recurrence ?? '');
    setExpiryDraft(expiresAt ? toLocalInput(expiresAt) : '');
    setExpireActionDraft(expireAction);
  }, [reminder?.dueAt, recurrence, expiresAt, expireAction]);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <div className="space-y-1.5">
      {!reminder ? (
        <button type="button" onClick={() => onSave({ dueAt: Date.now() + 4 * 3_600_000 }, recurrenceDraft || null)} className="rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--hint)]">+ Add reminder</button>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1">
            <input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-1 text-[10px] outline-none focus:border-[var(--emerald)]" />
            <button type="button" onClick={() => {
              const parsed = new Date(dueAt).getTime();
              if (!Number.isFinite(parsed)) { notify('Choose a valid date', 'error'); return; }
              onSave({ dueAt: parsed, state: reminder.state, snoozeCount: reminder.snoozeCount }, recurrenceDraft || null);
            }} className="rounded bg-[var(--emerald)] px-2 py-1 text-[9.5px] font-semibold text-[#05130d]">Save</button>
            <select value={reminder.state} onChange={(event) => onSave({ dueAt: reminder.dueAt, state: event.target.value as Reminder['state'], snoozeCount: reminder.snoozeCount }, recurrence)} className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-1 text-[10px]">
              <option value="pending">pending</option><option value="notified">notified</option><option value="done">done</option><option value="killed">killed</option>
            </select>
            <button type="button" onClick={() => onSave(null, null)} className="rounded border border-[var(--border)] px-1.5 py-1 text-[9.5px] text-[var(--rose)]">Remove</button>
          </div>
          <div className="mono flex flex-wrap items-center gap-1 text-[9px] text-[var(--muted)]">
            <span>snoozed {reminder.snoozeCount}×</span>
            <button type="button" onClick={() => onAction('snooze1')} className="rounded border border-[var(--border)] px-1">+1h</button>
            <button type="button" onClick={() => onAction('snooze4')} className="rounded border border-[var(--border)] px-1">+4h</button>
            <button type="button" onClick={() => onAction('tomorrow')} className="rounded border border-[var(--border)] px-1">Tomorrow 9am</button>
            <button type="button" onClick={() => onAction('week')} className="rounded border border-[var(--border)] px-1">+1w</button>
            <button type="button" onClick={() => onAction('done')} className="rounded border border-[var(--border)] px-1 text-[var(--emerald)]">↻ done</button>
          </div>
        </>
      )}
      <div className="mono flex flex-wrap items-center gap-1 text-[9px] text-[var(--muted)]">
        <span>↻</span>
        <input value={recurrenceDraft} onChange={(event) => setRecurrenceDraft(event.target.value)} dir="auto" placeholder="daily@08:00 · weekly:mon,thu@09:00 · every:6h" className="min-w-[160px] flex-1 rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-0.5 text-[9px] outline-none" />
        {reminder ? <button type="button" onClick={() => onSave({ dueAt: reminder.dueAt, state: reminder.state, snoozeCount: reminder.snoozeCount }, recurrenceDraft || null)} className="rounded border border-[var(--border)] px-1">Set</button> : null}
      </div>
      <div className="mono flex flex-wrap items-center gap-1 text-[9px] text-[var(--muted)]">
        <span>⏳ expires</span>
        <input type="datetime-local" value={expiryDraft} onChange={(event) => setExpiryDraft(event.target.value)} className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-0.5 text-[9px] outline-none" />
        <select value={expireActionDraft} onChange={(event) => setExpireActionDraft(event.target.value as 'archive' | 'trash' | 'delete')} className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-0.5 text-[9px]">
          <option value="archive">archive</option><option value="trash">trash</option><option value="delete">delete</option>
        </select>
        <button type="button" onClick={() => {
          const parsed = expiryDraft ? new Date(expiryDraft).getTime() : null;
          if (expiryDraft && !Number.isFinite(parsed)) { notify('Invalid expiry date', 'error'); return; }
          onExpiry(parsed, expireActionDraft);
        }} className="rounded border border-[var(--border)] px-1">Set TTL</button>
      </div>
      <p className="mono text-[8.5px] text-[var(--muted)]">All times are computed server-side in OWNER_TIMEZONE ({timezone} here).</p>
    </div>
  );
}

function toLocalInput(timestamp: number): string {
  return new Date(timestamp - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
