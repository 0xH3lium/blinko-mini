import { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { Check, ChevronDown, Pencil, Pin, RefreshCw, Sparkles, Trash2, X } from 'lucide-react';
import { getCaptures } from '../api/client';
import type {
  Bucket, Capture, CaptureDetail, CapturePatch, CaptureStatus, EdgeRelation, Head, Reminder,
} from '../types/capture';
import { cn, normalizeTag } from '../lib/utils';
import type { Notify } from '../types/ui';

const BUCKETS: Bucket[] = ['idea', 'memory', 'reminder', 'question', 'reference', 'noise'];
const STATUSES: CaptureStatus[] = ['active', 'resolved', 'archived'];
const RELATIONS: EdgeRelation[] = ['reply', 'related', 'refines', 'supports', 'blocks', 'answers'];

export function Inspector({
  detail, heads, allTags, onPatch, onOverride, onJev, onClearDecision, onDelete, onClose, onJump,
  onAddEdge, onRemoveEdge, onFetchUrl, notify,
}: {
  detail: CaptureDetail | null;
  heads: Head[];
  allTags: string[];
  onPatch: (id: string, patch: CapturePatch) => Promise<void>;
  onOverride: (id: string, headId: string, valueText?: string, valueNum?: number) => Promise<void>;
  onJev: (id: string, headIds?: string[]) => Promise<void>;
  onClearDecision: (id: string, headId: string) => Promise<void>;
  onDelete: (id: string) => void;
  onClose: () => void;
  onJump: (id: string) => void;
  onAddEdge: (id: string, targetId: string, relation: EdgeRelation, note?: string) => Promise<void>;
  onRemoveEdge: (id: string, targetId: string, relation: EdgeRelation) => Promise<void>;
  onFetchUrl: (id: string) => Promise<void>;
  notify: Notify;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  const [metaDraft, setMetaDraft] = useState('{}');
  const [numberDrafts, setNumberDrafts] = useState<Record<string, string>>({});
  const [linkQuery, setLinkQuery] = useState('');
  const [linkResults, setLinkResults] = useState<Capture[]>([]);
  const [linkRelation, setLinkRelation] = useState<EdgeRelation>('related');
  const [linkNote, setLinkNote] = useState('');

  useEffect(() => {
    setEditing(false);
    setDraft(detail?.content ?? '');
    setMetaDraft(JSON.stringify(detail?.meta ?? {}, null, 2));
    setNumberDrafts({});
  }, [detail?.id, detail?.content, detail?.meta]);

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
        <div className="flex flex-1 items-center justify-center p-6 text-center text-[11px] text-[var(--muted)]">
          Select a capture to edit literally anything.
        </div>
      </aside>
    );
  }

  const activeHeads = heads.filter((head) => head.active);
  const saveContent = () => {
    void onPatch(detail.id, { content: draft });
    setEditing(false);
  };
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
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Invalid meta JSON', 'error');
    }
  };

  return (
    <aside className="flex w-[420px] shrink-0 flex-col overflow-y-auto border-l border-[var(--border)] bg-[#0c1013]">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1.5 border-b border-[var(--border)] bg-[#0c1013] px-3 py-2">
        <select value={detail.bucket} onChange={(event) => void onPatch(detail.id, { bucket: event.target.value as Bucket })} className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-1 text-[10px]">
          {BUCKETS.map((bucket) => <option key={bucket} value={bucket}>{bucket}</option>)}
        </select>
        <select value={detail.status} onChange={(event) => void onPatch(detail.id, { status: event.target.value as CaptureStatus })} className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-1 text-[10px]">
          {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <button type="button" onClick={() => void onPatch(detail.id, { isPinned: !detail.isPinned })} title="Pin" className={cn('rounded p-1', detail.isPinned ? 'text-[var(--amber)]' : 'text-[var(--muted)] hover:text-[var(--text)]')}><Pin size={13} /></button>
        <button type="button" onClick={() => void onJev(detail.id)} title="Re-run all Jev" className="rounded p-1 text-[var(--muted)] hover:text-[var(--amber)]"><Sparkles size={13} /></button>
        <button type="button" onClick={() => onDelete(detail.id)} title="Delete" className="rounded p-1 text-[var(--muted)] hover:text-[var(--rose)]"><Trash2 size={13} /></button>
        <button type="button" onClick={onClose} title="Close" className="ml-auto rounded p-1 text-[var(--muted)] hover:text-[var(--text)]"><X size={13} /></button>
      </div>

      <Section title="Content">
        {editing ? (
          <div>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) saveContent(); }}
              rows={8}
              autoFocus
              className="w-full resize-y rounded border border-[var(--border-strong)] bg-[#0b0f12] p-2.5 text-[12.5px] leading-relaxed outline-none focus:border-[var(--emerald)]"
            />
            <div className="mt-2 flex gap-1.5">
              <button type="button" onClick={saveContent} className="rounded bg-[var(--emerald)] px-2 py-1 text-[10px] font-semibold text-[#05130d]">Save ⌘Enter</button>
              <button type="button" onClick={() => { setDraft(detail.content); setEditing(false); }} className="rounded border border-[var(--border-strong)] px-2 py-1 text-[10px] text-[var(--hint)]">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="group relative">
            <div className="markdown text-[12.5px]" dangerouslySetInnerHTML={{ __html: html }} />
            <button type="button" onClick={() => setEditing(true)} className="absolute right-0 top-0 rounded border border-[var(--border)] bg-[var(--surface-2)] p-1 text-[var(--muted)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--text)]"><Pencil size={11} /></button>
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            const fromText = [...new Set([...detail.tags, ...(detail.content.match(/(?:^|\s)#([a-zA-Z0-9_-]{1,50})/g) ?? []).map((tag) => normalizeTag(tag) ?? '')])].filter(Boolean);
            void onPatch(detail.id, { tags: fromText });
          }}
          className="mt-2 rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--hint)] hover:text-[var(--text)]"
        >
          Extract #tags from text
        </button>
      </Section>

      <Section title={`Tags · ${detail.tags.length}`}>
        <div className="flex flex-wrap items-center gap-1">
          {detail.tags.map((tag) => (
            <button key={tag} type="button" onClick={() => void onPatch(detail.id, { tags: detail.tags.filter((item) => item !== tag) })} className="mono rounded bg-[var(--emerald-soft)] px-1.5 py-0.5 text-[10px] text-[var(--emerald)]">#{tag} ×</button>
          ))}
          <input
            value={tagDraft}
            onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addTag(tagDraft); } }}
            list="inspector-tags"
            placeholder="+ tag"
            className="w-[90px] bg-transparent px-1 py-0.5 text-[10px] outline-none"
          />
          <datalist id="inspector-tags">{allTags.map((tag) => <option key={tag} value={tag} />)}</datalist>
        </div>
      </Section>

      <Section title="Reminder">
        <ReminderEditor
          reminder={detail.reminder}
          onSave={(reminder) => void onPatch(detail.id, { reminder })}
          notify={notify}
        />
      </Section>

      <Section title={`Decision Heads · ${activeHeads.length}`}>
        <div className="space-y-3">
          {activeHeads.map((head) => {
            const decision = detail.decisions[head.name] ?? detail.decisions[head.id];
            return (
              <div key={head.id} className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-[var(--text)]">{head.name}</span>
                  <span className="mono rounded border border-[var(--border)] px-1 text-[8.5px] text-[var(--muted)]">{head.primitive}</span>
                  {decision ? (
                    <span className="mono text-[9px] text-[var(--hint)]">
                      {decision.source} · H {decision.entropy.toFixed(2)} · {decision.modelVersion?.slice(-12) ?? 'no model'}
                    </span>
                  ) : <span className="mono text-[9px] text-[var(--muted)]">unset</span>}
                  <button type="button" onClick={() => void onJev(detail.id, [head.id])} title="Re-run Jev" className="ml-auto text-[var(--muted)] hover:text-[var(--amber)]"><RefreshCw size={10} /></button>
                  <button type="button" onClick={() => void onClearDecision(detail.id, head.id)} title="Clear decision" className="text-[var(--muted)] hover:text-[var(--rose)]"><X size={11} /></button>
                </div>

                {decision ? (
                  <div className="mt-1.5 space-y-0.5">
                    {Object.entries(decision.probs).slice(0, 8).map(([key, probability]) => (
                      <div key={key} className="flex items-center gap-1.5">
                        <span className="mono w-14 shrink-0 truncate text-[9px] text-[var(--muted)]">{key}</span>
                        <div className="h-1 flex-1 overflow-hidden rounded bg-[var(--surface-hover)]">
                          <div className={cn('h-full', probability > 0.5 ? 'bg-[var(--emerald)]' : 'bg-[var(--amber)]')} style={{ width: `${Math.max(1, probability * 100)}%` }} />
                        </div>
                        <span className="mono w-8 text-right text-[9px] text-[var(--hint)]">{(probability * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="mt-1.5 flex flex-wrap gap-1">
                  {head.primitive === 'choice' ? (head.config.options ?? []).map((option) => (
                    <Chip key={option.value} label={option.value} active={decision?.valueText === option.value} title={option.description} onClick={() => void onOverride(detail.id, head.id, option.value)} />
                  )) : null}
                  {head.primitive === 'score' ? Array.from({ length: Math.max(0, (head.config.max ?? 3) - (head.config.min ?? 0) + 1) }, (_, index) => (head.config.min ?? 0) + index).map((rung) => (
                    <Chip key={rung} label={String(rung)} active={decision?.valueNum === rung} title={head.config.rubric?.[String(rung)]} onClick={() => void onOverride(detail.id, head.id, undefined, rung)} />
                  )) : null}
                  {head.primitive === 'score' ? (
                    <input
                      value={numberDrafts[head.id] ?? ''}
                      onChange={(event) => setNumberDrafts((current) => ({ ...current, [head.id]: event.target.value }))}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && numberDrafts[head.id]) {
                          void onOverride(detail.id, head.id, undefined, Number(numberDrafts[head.id]));
                        }
                      }}
                      placeholder="exact"
                      className="mono w-14 rounded border border-[var(--border)] bg-[var(--surface)] px-1 py-0.5 text-[9px] outline-none"
                    />
                  ) : null}
                  {head.primitive === 'noul' ? (
                    <>
                      <Chip label={`yes ${(decision?.probs?.yes ?? 0.9).toFixed(2)}`} active={decision?.valueText === 'yes'} onClick={() => void onOverride(detail.id, head.id, 'yes', Number(numberDrafts[head.id] ?? 0.9))} />
                      <Chip label={`no ${(1 - Number(numberDrafts[head.id] ?? 0.1)).toFixed(2)}`} active={decision?.valueText === 'no'} onClick={() => void onOverride(detail.id, head.id, 'no', Number(numberDrafts[head.id] ?? 0.1))} />
                      <input
                        value={numberDrafts[head.id] ?? ''}
                        onChange={(event) => setNumberDrafts((current) => ({ ...current, [head.id]: event.target.value }))}
                        placeholder="p(yes)"
                        className="mono w-14 rounded border border-[var(--border)] bg-[var(--surface)] px-1 py-0.5 text-[9px] outline-none"
                      />
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title={`Links · ${detail.edges.length}`}>
        <div className="space-y-1">
          {detail.edges.map((edge) => (
            <div key={`${edge.sourceId}:${edge.targetId}:${edge.relation}`} className="flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-1">
              <span className={cn('mono rounded px-1 text-[8.5px] uppercase', edge.direction === 'outgoing' ? 'bg-[var(--emerald-soft)] text-[var(--emerald)]' : 'bg-[var(--surface-hover)] text-[var(--hint)]')}>
                {edge.direction === 'outgoing' ? '→' : '←'} {edge.relation}
              </span>
              <button type="button" onClick={() => onJump(edge.otherId)} className="min-w-0 flex-1 truncate text-left text-[10.5px] text-[var(--hint)] hover:text-[var(--text)]" title={edge.otherContent}>
                {edge.otherContent.slice(0, 80)}
                <span className="mono ml-1 text-[8.5px] text-[var(--muted)]">{edge.otherBucket}</span>
              </button>
              <button type="button" onClick={() => void onRemoveEdge(detail.id, edge.otherId, edge.relation)} className="text-[var(--muted)] hover:text-[var(--rose)]"><X size={10} /></button>
            </div>
          ))}
          {detail.edges.length === 0 ? <p className="text-[10.5px] text-[var(--muted)]">No links.</p> : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          <input value={linkQuery} onChange={(event) => setLinkQuery(event.target.value)} placeholder="FTS5 search to link…" className="min-w-[120px] flex-1 rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-1 text-[10px] outline-none" />
          <select value={linkRelation} onChange={(event) => setLinkRelation(event.target.value as EdgeRelation)} className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-1 text-[10px]">
            {RELATIONS.map((relation) => <option key={relation}>{relation}</option>)}
          </select>
          <input value={linkNote} onChange={(event) => setLinkNote(event.target.value)} placeholder="note" className="w-16 rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-1 text-[10px] outline-none" />
        </div>
        {linkResults.length > 0 ? (
          <div className="mt-1 max-h-28 overflow-y-auto rounded border border-[var(--border)] bg-[var(--surface-2)]">
            {linkResults.map((capture) => (
              <button
                key={capture.id}
                type="button"
                onClick={() => { void onAddEdge(detail.id, capture.id, linkRelation, linkNote || undefined); setLinkQuery(''); setLinkResults([]); }}
                className="block w-full truncate px-1.5 py-1 text-left text-[10px] text-[var(--hint)] hover:bg-[var(--surface-hover)]"
              >
                {capture.content}
              </button>
            ))}
          </div>
        ) : null}
      </Section>

      <details className="border-b border-[var(--border)] p-3">
        <summary className="flex cursor-pointer items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
          Source URL & Advanced <ChevronDown size={10} />
        </summary>
        <div className="mt-2 space-y-1.5">
          <input value={detail.sourceUrl ?? ''} onChange={(event) => void onPatch(detail.id, { sourceUrl: event.target.value || null })} placeholder="sourceUrl" className="w-full rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-1 text-[10px] outline-none" />
          <input value={detail.urlTitle ?? ''} onChange={(event) => void onPatch(detail.id, { urlTitle: event.target.value || null })} placeholder="urlTitle" className="w-full rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-1 text-[10px] outline-none" />
          <textarea value={detail.urlExcerpt ?? ''} onChange={(event) => void onPatch(detail.id, { urlExcerpt: event.target.value || null })} placeholder="urlExcerpt" rows={2} className="w-full resize-y rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-1 text-[10px] outline-none" />
          <button type="button" onClick={() => void onFetchUrl(detail.id)} className="rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--hint)] hover:text-[var(--text)]">Re-fetch Readability</button>
          <div className="mono flex items-center gap-2 pt-1 text-[9px] text-[var(--muted)]">
            <span>captureMode: <span className="text-[var(--emerald)]">{detail.captureMode}</span></span>
            <label>createdAt <input type="datetime-local" value={toLocalInput(detail.createdAt)} onChange={(event) => void onPatch(detail.id, { createdAt: new Date(event.target.value).getTime() })} className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-0.5 text-[9px] outline-none" /></label>
          </div>
          <textarea value={metaDraft} onChange={(event) => setMetaDraft(event.target.value)} rows={4} className="mono mt-1 w-full resize-y rounded border border-[var(--border)] bg-[#0b0f12] p-1.5 text-[9.5px] outline-none" />
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

function Chip({ label, active = false, onClick, title }: { label: string; active?: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'mono rounded border px-1.5 py-0.5 text-[9px] transition',
        active ? 'border-[var(--emerald)] bg-[var(--emerald-soft)] text-[var(--emerald)]' : 'border-[var(--border)] text-[var(--hint)] hover:border-[var(--border-strong)] hover:text-[var(--text)]',
      )}
    >
      {label}
    </button>
  );
}

function ReminderEditor({ reminder, onSave, notify }: {
  reminder: Reminder | null;
  onSave: (value: { dueAt: number; state?: Reminder['state']; snoozeCount?: number } | null) => void;
  notify: Notify;
}) {
  const [dueAt, setDueAt] = useState(reminder ? toLocalInput(reminder.dueAt) : '');
  useEffect(() => setDueAt(reminder ? toLocalInput(reminder.dueAt) : ''), [reminder]);
  if (!reminder) return <button type="button" onClick={() => onSave({ dueAt: Date.now() + 4 * 3_600_000 })} className="rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--hint)]">+ Add reminder</button>;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1">
        <input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-1 text-[10px] outline-none" />
        <button type="button" onClick={() => onSave({ dueAt: new Date(dueAt).getTime(), state: reminder.state, snoozeCount: reminder.snoozeCount })} className="rounded bg-[var(--emerald)] px-2 py-1 text-[9.5px] font-semibold text-[#05130d]">Save</button>
        <select value={reminder.state} onChange={(event) => onSave({ dueAt: reminder.dueAt, state: event.target.value as Reminder['state'], snoozeCount: reminder.snoozeCount })} className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-1 text-[10px]">
          <option value="pending">pending</option><option value="notified">notified</option><option value="done">done</option><option value="killed">killed</option>
        </select>
        <button type="button" onClick={() => onSave(null)} className="rounded border border-[var(--border)] px-1.5 py-1 text-[9.5px] text-[var(--rose)]">Remove</button>
      </div>
      <div className="mono flex flex-wrap items-center gap-1 text-[9px] text-[var(--muted)]">
        <span>snoozed {reminder.snoozeCount}×</span>
        <button type="button" onClick={() => onSave({ dueAt: reminder.dueAt + 3_600_000, snoozeCount: reminder.snoozeCount + 1 })} className="rounded border border-[var(--border)] px-1">+1h</button>
        <button type="button" onClick={() => onSave({ dueAt: reminder.dueAt + 4 * 3_600_000, snoozeCount: reminder.snoozeCount + 1 })} className="rounded border border-[var(--border)] px-1">+4h</button>
        <button type="button" onClick={() => { const target = new Date(Date.now() + 86_400_000); target.setHours(9, 0, 0, 0); onSave({ dueAt: target.getTime(), snoozeCount: reminder.snoozeCount + 1 }); }} className="rounded border border-[var(--border)] px-1">Tomorrow 9am</button>
        <button type="button" onClick={() => onSave({ dueAt: reminder.dueAt + 7 * 86_400_000, snoozeCount: reminder.snoozeCount + 1 })} className="rounded border border-[var(--border)] px-1">+1w</button>
        <button type="button" onClick={() => onSave({ dueAt: reminder.dueAt, snoozeCount: 0 })} className="rounded border border-[var(--border)] px-1">Reset count</button>
      </div>
      {Number.isNaN(new Date(dueAt).getTime()) ? <p className="text-[9px] text-[var(--rose)]">Invalid date</p> : null}
      {!dueAt ? <button type="button" onClick={() => notify('Choose a date before saving', 'error')} className="hidden" /> : null}
    </div>
  );
}

function toLocalInput(timestamp: number): string {
  return new Date(timestamp - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
