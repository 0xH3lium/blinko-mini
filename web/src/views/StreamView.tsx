import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Brain, CircleHelp, Download, Lightbulb, Link2, Pin, Save, Timer, Trash2, Waves, Zap,
} from 'lucide-react';
import type { BulkAction, Bucket, Capture, CaptureStatus, Decision, Head } from '../types/capture';
import { exportUrl } from '../api/client';
import { cn, relativeTime } from '../lib/utils';
import type { Notify } from '../types/ui';

const ICONS = { idea: Lightbulb, memory: Brain, reminder: Timer, question: CircleHelp, reference: Link2, noise: Waves };
const BUCKETS: Bucket[] = ['idea', 'memory', 'reminder', 'question', 'reference', 'noise'];
const SORTS = ['recent', 'updated', 'due', 'entropy'];

export function StreamView({
  captures, total, heads, query, onQuery, status, onStatus, sort, onSort, order, onOrder,
  onSaveView, selectedId, onSelect, onBulk, onDelete, onJev, onPin, onResolve, notify,
}: {
  captures: Capture[];
  total: number;
  heads: Head[];
  query: string;
  onQuery: (query: string) => void;
  status: CaptureStatus | 'all';
  onStatus: (status: CaptureStatus | 'all') => void;
  sort: string;
  onSort: (sort: string) => void;
  order: 'asc' | 'desc';
  onOrder: (order: 'asc' | 'desc') => void;
  onSaveView: () => void;
  selectedId: string | null;
  onSelect: (capture: Capture) => void;
  onBulk: (ids: string[], action: BulkAction) => void;
  onDelete: (capture: Capture) => void;
  onJev: (capture: Capture) => void;
  onPin: (capture: Capture) => void;
  onResolve: (capture: Capture) => void;
  notify: Notify;
}) {
  const [draft, setDraft] = useState(query);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkTag, setBulkTag] = useState('');
  const [bulkBucket, setBulkBucket] = useState<Bucket>('idea');
  const lastIndex = useRef<number | null>(null);
  const activeHeads = heads.filter((head) => head.active);
  const selectedIndex = useMemo(() => captures.findIndex((capture) => capture.id === selectedId), [captures, selectedId]);

  useEffect(() => setDraft(query), [query]);
  useEffect(() => {
    const timer = window.setTimeout(() => { if (draft !== query) onQuery(draft); }, 260);
    return () => window.clearTimeout(timer);
  }, [draft, query, onQuery]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const current = captures[selectedIndex];
      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault();
        const next = captures[Math.min(captures.length - 1, selectedIndex + 1)];
        if (next) onSelect(next);
      } else if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = captures[Math.max(0, selectedIndex - 1)];
        if (next) onSelect(next);
      } else if (!current) return;
      else if (event.key === ' ') { event.preventDefault(); onSelect(current); }
      else if (event.key === 'p') onPin(current);
      else if (event.key === 'r') onResolve(current);
      else if (event.key === 'x') onDelete(current);
      else if (event.key === 'e') onJev(current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [captures, selectedIndex, onSelect, onPin, onResolve, onDelete, onJev]);

  function toggleChecked(index: number, id: string, shift: boolean): void {
    setChecked((current) => {
      const next = new Set(current);
      if (shift && lastIndex.current !== null) {
        const [from, to] = [Math.min(lastIndex.current, index), Math.max(lastIndex.current, index)];
        for (let position = from; position <= to; position += 1) {
          const capture = captures[position];
          if (capture) next.add(capture.id);
        }
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    lastIndex.current = index;
  }

  const ids = [...checked];
  const runBulk = (action: BulkAction) => {
    onBulk(ids, action);
    setChecked(new Set());
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--border)] bg-[#0b0e11] px-3 py-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="b:idea leverage>=2 #work"
          className="min-w-[220px] flex-1 rounded border border-[var(--border-strong)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[11.5px] outline-none focus:border-[var(--emerald)]"
        />
        <button type="button" onClick={onSaveView} className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1.5 text-[10px] text-[var(--hint)] hover:text-[var(--text)]"><Save size={11} /> Save as View</button>
        <select value={sort} onChange={(event) => onSort(event.target.value)} className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-1.5 text-[10px] outline-none">
          <optgroup label="Standard">
            {SORTS.map((value) => <option key={value} value={value}>{value}</option>)}
          </optgroup>
          <optgroup label="Decision heads">
            {activeHeads.map((head) => <option key={head.id} value={`head:${head.name}`}>head:{head.name}</option>)}
          </optgroup>
        </select>
        <button type="button" onClick={() => onOrder(order === 'desc' ? 'asc' : 'desc')} className="mono rounded border border-[var(--border)] px-1.5 py-1.5 text-[10px] text-[var(--hint)]">{order}</button>
        <button type="button" onClick={() => onStatus(status === 'active' ? 'all' : 'active')} className="rounded border border-[var(--border)] px-2 py-1.5 text-[10px] capitalize text-[var(--hint)]">{status}</button>
        <div className="group relative">
          <button type="button" className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1.5 text-[10px] text-[var(--hint)]"><Download size={11} /> Export</button>
          <div className="invisible absolute right-0 top-full z-20 mt-1 w-28 rounded border border-[var(--border-strong)] bg-[var(--surface)] p-1 opacity-0 shadow-xl transition group-hover:visible group-hover:opacity-100">
            <a href={exportUrl('json')} className="block rounded px-2 py-1 text-[10px] text-[var(--hint)] hover:bg-[var(--surface-hover)]">JSON</a>
            <a href={exportUrl('md')} className="block rounded px-2 py-1 text-[10px] text-[var(--hint)] hover:bg-[var(--surface-hover)]">Markdown</a>
          </div>
        </div>
        <span className="mono ml-auto text-[9.5px] text-[var(--muted)]">{total} captures</span>
      </div>

      {checked.size > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--emerald)] bg-[var(--emerald-soft)] px-3 py-1.5">
          <span className="mono text-[10px] text-[var(--emerald)]">{checked.size} selected</span>
          <select value={bulkBucket} onChange={(event) => setBulkBucket(event.target.value as Bucket)} className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-1 text-[10px]">
            {BUCKETS.map((bucket) => <option key={bucket}>{bucket}</option>)}
          </select>
          <button type="button" onClick={() => runBulk({ type: 'bucket', value: bulkBucket })} className="rounded border border-[var(--border)] px-1.5 py-1 text-[10px] text-[var(--hint)]">Set bucket</button>
          <input value={bulkTag} onChange={(event) => setBulkTag(event.target.value)} placeholder="#tag" className="w-20 rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-1 text-[10px] outline-none" />
          <button type="button" onClick={() => { if (bulkTag.trim()) { runBulk({ type: 'addTags', value: [bulkTag.trim().replace(/^#/, '')] }); setBulkTag(''); } }} className="rounded border border-[var(--border)] px-1.5 py-1 text-[10px] text-[var(--hint)]">Add tag</button>
          <button type="button" onClick={() => runBulk({ type: 'status', value: 'resolved' })} className="rounded border border-[var(--border)] px-1.5 py-1 text-[10px] text-[var(--hint)]">Resolve</button>
          <button type="button" onClick={() => runBulk({ type: 'status', value: 'archived' })} className="rounded border border-[var(--border)] px-1.5 py-1 text-[10px] text-[var(--hint)]">Archive</button>
          <button type="button" onClick={() => runBulk({ type: 'runJev' })} className="flex items-center gap-1 rounded border border-[var(--border)] px-1.5 py-1 text-[10px] text-[var(--amber)]"><Zap size={10} /> Re-run Jev</button>
          <button type="button" onClick={() => runBulk({ type: 'delete' })} className="flex items-center gap-1 rounded border border-[var(--border)] px-1.5 py-1 text-[10px] text-[var(--rose)]"><Trash2 size={10} /> Delete</button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="war-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-[#0b0e11]">
            <tr className="border-b border-[var(--border)] text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">
              <th className="w-8 py-2 pl-3 font-medium" />
              <th className="w-8 font-medium" />
              <th className="py-2 font-medium">Capture</th>
              <th className="w-20 font-medium">Bucket</th>
              <th className="w-40 font-medium">Heads</th>
              <th className="w-28 font-medium">Due</th>
              <th className="w-20 pr-3 text-right font-medium">Age</th>
            </tr>
          </thead>
          <tbody>
            {captures.map((capture, index) => {
              const Icon = ICONS[capture.bucket];
              const selected = capture.id === selectedId;
              const due = capture.reminder?.dueAt;
              const dueTone = due && due < Date.now() ? 'text-[var(--rose)]' : due && due < Date.now() + 86_400_000 ? 'text-[var(--amber)]' : 'text-[var(--muted)]';
              return (
                <tr key={capture.id} data-id={capture.id} onClick={() => onSelect(capture)} className={cn('cursor-pointer border-b border-[var(--border)] align-middle', selected && 'selected')}>
                  <td className="py-2 pl-3" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={checked.has(capture.id)}
                      onClick={(event) => toggleChecked(index, capture.id, event.shiftKey)}
                      onChange={() => undefined}
                      className="accent-[var(--emerald)]"
                    />
                  </td>
                  <td className="text-[var(--muted)]">
                    <span className="flex h-5 w-5 items-center justify-center rounded bg-[var(--surface-2)]">
                      <Icon size={11} className={capture.bucket === 'reminder' ? 'text-[var(--amber)]' : 'text-[var(--hint)]'} />
                    </span>
                  </td>
                  <td className="max-w-0 py-2 pr-3">
                    <div className="flex items-center gap-1.5">
                      {capture.isPinned ? <Pin size={11} className="shrink-0 text-[var(--amber)]" /> : null}
                      <span className="truncate text-[12.5px] text-[var(--text)]" dangerouslySetInnerHTML={{ __html: capture.snippet ?? escapeHtml(capture.content) }} />
                      {capture.sourceUrl ? <Link2 size={10} className="shrink-0 text-[var(--cyan)]" /> : null}
                      {capture.edgeCount > 0 ? <span className="mono shrink-0 rounded bg-[var(--surface-hover)] px-1 text-[9px] text-[var(--hint)]">{capture.edgeCount}</span> : null}
                    </div>
                    {capture.tags.length > 0 ? (
                      <div className="mt-0.5 flex gap-1">{capture.tags.slice(0, 5).map((tag) => <span key={tag} className="mono text-[9px] text-[var(--muted)]">#{tag}</span>)}</div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-2"><span className="mono rounded border border-[var(--border)] px-1.5 py-0.5 text-[9.5px] uppercase text-[var(--hint)]">{capture.bucket}</span></td>
                  <td className="py-2 pr-2">
                    <span className="mono flex flex-wrap gap-1 text-[9px] text-[var(--hint)]">
                      {activeHeads.slice(0, 6).map((head) => (
                        <span key={head.id} title={`${head.name} · ${detailOf(head, capture.decisions[head.name] ?? capture.decisions[head.id])}`}>
                          {badge(head, capture.decisions[head.name] ?? capture.decisions[head.id])}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className={cn('mono py-2 pr-2 text-[10px]', dueTone)}>{due ? new Date(due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}</td>
                  <td className="mono py-2 pr-3 text-right text-[10px] text-[var(--muted)]">{relativeTime(capture.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {captures.length === 0 ? (
          <div className="flex h-[55%] flex-col items-center justify-center text-center">
            <p className="text-[var(--hint)]">No captures in this view.</p>
            <p className="mt-1 text-[11px] text-[var(--muted)]">Try a different Query DSL filter or create a capture.</p>
          </div>
        ) : null}
      </div>

      <div className="sticky bottom-0 border-t border-[var(--border)] bg-[#0b0e11]/95 px-3 py-1.5 text-[9.5px] text-[var(--muted)]">
        <span className="mono">j/k</span> move · <span className="mono">space</span> inspect · <span className="mono">p</span> pin · <span className="mono">r</span> resolve · <span className="mono">x</span> delete · <span className="mono">e</span> Jev
        <span className="float-right">{activeHeads.length} active heads</span>
      </div>
      {query ? <span className="sr-only" onClick={() => notify('Query applied', 'info')} /> : null}
    </div>
  );
}

function badge(head: Head, decision?: Decision): string {
  if (!decision) return `${short(head.name)}:–`;
  if (head.primitive === 'choice') return `${short(head.name)}:${decision.valueText?.slice(0, 4) ?? '–'}`;
  if (head.primitive === 'noul') return `${short(head.name)}:${Math.round((decision.valueNum ?? 0) * 100)}%`;
  return `${short(head.name)}:${decision.valueNum ?? '–'}`;
}

function detailOf(head: Head, decision?: Decision): string {
  if (!decision) return 'unset';
  return `${head.name}=${decision.valueText ?? decision.valueNum} (${decision.source}, H ${decision.entropy.toFixed(2)})`;
}

function short(name: string): string {
  if (name === 'leverage') return 'L';
  if (name === 'actionable') return 'Act';
  if (name === 'falsifiable') return 'Fals';
  if (name === 'bucket') return 'B';
  return name.slice(0, 3);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}
