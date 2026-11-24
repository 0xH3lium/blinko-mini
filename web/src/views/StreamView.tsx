import { useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import {
  Brain, ChevronDown, CircleHelp, Download, Lightbulb, Link2, Pin, RotateCcw, Save, Timer, Trash2, WandSparkles, Waves, Zap,
} from 'lucide-react';
import type { BulkAction, Bucket, Capture, CaptureStatus, CustomField, ExtractorTemplate } from '../types/capture';
import { exportUrl } from '../api/client';
import { cn, relativeTime } from '../lib/utils';
import type { Notify } from '../types/ui';

const ICONS = { idea: Lightbulb, memory: Brain, reminder: Timer, question: CircleHelp, reference: Link2, noise: Waves };
const BUCKETS: Bucket[] = ['idea', 'memory', 'reminder', 'question', 'reference', 'noise'];
const SORTS = ['recent', 'relevance', 'updated', 'due', 'length'];

function safeSnippet(capture: Capture): string {
  const raw = capture.snippet ?? capture.content;
  return DOMPurify.sanitize(raw, { ALLOWED_TAGS: ['mark'], ALLOWED_ATTR: [] });
}

export function StreamView({
  captures, total, fields, templates, telemetrySettings, query, onQuery, status, onStatus, sort, onSort,
  order, onOrder, onSaveView, selectedId, onSelect, onBulk, onDelete, onRestore, onEmptyTrash, onMerge,
  onExtract, onBucket, onPin, onResolve, onTriage, trashMode, notify,
}: {
  captures: Capture[];
  total: number;
  fields: CustomField[];
  templates: ExtractorTemplate[];
  telemetrySettings: Record<string, string>;
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
  onRestore: (id: string) => void;
  onEmptyTrash: () => void;
  onMerge: (ids: string[]) => void;
  onExtract: (templateId?: string, captureIds?: string[]) => void;
  onBucket: (capture: Capture, bucket: Bucket) => void;
  onPin: (capture: Capture) => void;
  onResolve: (capture: Capture) => void;
  onTriage: (capture: Capture) => void;
  trashMode: boolean;
  notify: Notify;
}) {
  const [draft, setDraft] = useState(query);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkBucket, setBulkBucket] = useState<Bucket>('idea');
  const [fieldName, setFieldName] = useState(fields[0]?.name ?? '');
  const [fieldValue, setFieldValue] = useState('');
  const lastIndex = useRef<number | null>(null);
  const selectedIndex = useMemo(() => captures.findIndex((capture) => capture.id === selectedId), [captures, selectedId]);
  const visibleFields = fields.filter((field) => field.active && field.showInStream);
  const burstSec = Number(telemetrySettings.burst_window_sec ?? 180) * 1000;

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
      } else if (!current || trashMode) return;
      else if (event.key === ' ') { event.preventDefault(); onSelect(current); }
      else if (event.key === 'p') onPin(current);
      else if (event.key === 'r') onResolve(current);
      else if (event.key === 't') onTriage(current);
      else if (event.key === 'x') onDelete(current);
      else if (event.key === 'e') onExtract(undefined, [current.id]);
      else if (/^[1-6]$/.test(event.key)) onBucket(current, BUCKETS[Number(event.key) - 1]!);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [captures, selectedIndex, onSelect, onPin, onResolve, onTriage, onDelete, onExtract, onBucket, trashMode]);

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
  const runBulk = (action: BulkAction) => { onBulk(ids, action); setChecked(new Set()); };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--border)] bg-[#0b0e11] px-3 py-2">
        <input value={draft} onChange={(event) => setDraft(event.target.value)} dir="auto"
          placeholder="b:idea leverage>=2 #تگ len<25 is:triaged" className="min-w-[220px] flex-1 rounded border border-[var(--border-strong)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[11.5px] outline-none focus:border-[var(--emerald)]" />
        <button type="button" onClick={onSaveView} className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1.5 text-[10px] text-[var(--hint)] hover:text-[var(--text)]"><Save size={11} /> Save</button>
        <select value={sort} onChange={(event) => onSort(event.target.value)} className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-1.5 text-[10px] outline-none">
          <optgroup label="Standard">{SORTS.map((value) => <option key={value} value={value}>{value}</option>)}</optgroup>
          <optgroup label="Custom fields">{visibleFields.map((field) => <option key={field.id} value={`field:${field.name}`}>field:{field.name}</option>)}</optgroup>
        </select>
        <button type="button" onClick={() => onOrder(order === 'desc' ? 'asc' : 'desc')} className="mono rounded border border-[var(--border)] px-1.5 py-1.5 text-[10px] text-[var(--hint)]">{order}</button>
        {!trashMode ? (
          <button type="button" onClick={() => onStatus(status === 'active' ? 'all' : 'active')} className="rounded border border-[var(--border)] px-2 py-1.5 text-[10px] capitalize text-[var(--hint)]">{status}</button>
        ) : null}
        <div className="group relative">
          <button type="button" className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1.5 text-[10px] text-[var(--hint)]"><Download size={11} /> Export</button>
          <div className="invisible absolute right-0 top-full z-20 mt-1 w-32 rounded border border-[var(--border-strong)] bg-[var(--surface)] p-1 opacity-0 shadow-xl transition group-hover:visible group-hover:opacity-100">
            <a href={exportUrl('json')} className="block rounded px-2 py-1 text-[10px] text-[var(--hint)] hover:bg-[var(--surface-hover)]">JSON</a>
            <a href={exportUrl('md')} className="block rounded px-2 py-1 text-[10px] text-[var(--hint)] hover:bg-[var(--surface-hover)]">Markdown</a>
            <a href={exportUrl('json', true)} className="block rounded px-2 py-1 text-[10px] text-[var(--hint)] hover:bg-[var(--surface-hover)]">JSON + trash</a>
          </div>
        </div>
        <div className="flex overflow-visible rounded border border-[var(--emerald)] text-[10px]">
          <button type="button" onClick={() => onExtract()} className="flex items-center gap-1 bg-[var(--emerald-soft)] px-2 py-1.5 text-[var(--emerald)]"><WandSparkles size={11} /> Extract</button>
          <div className="group relative">
            <button type="button" className="h-full border-l border-[var(--emerald)] px-1.5 text-[var(--emerald)]"><ChevronDown size={11} /></button>
            <div className="invisible absolute right-0 top-full z-20 mt-1 w-60 rounded border border-[var(--border-strong)] bg-[var(--surface)] p-1 opacity-0 shadow-xl transition group-hover:visible group-hover:opacity-100">
              {templates.map((template) => (
                <button key={template.id} type="button" onClick={() => onExtract(template.id)} className="block w-full truncate rounded px-2 py-1 text-left text-[10px] text-[var(--hint)] hover:bg-[var(--surface-hover)]">
                  {template.name}{template.isDefault ? ' · default' : ''}
                </button>
              ))}
            </div>
          </div>
        </div>
        {trashMode ? (
          <button type="button" onClick={onEmptyTrash} className="flex items-center gap-1 rounded border border-[var(--rose)] px-2 py-1.5 text-[10px] text-[var(--rose)]"><Trash2 size={11} /> Empty Trash</button>
        ) : null}
        <span className="mono ml-auto text-[9.5px] text-[var(--muted)]">{total} captures</span>
      </div>

      {checked.size > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--emerald)] bg-[var(--emerald-soft)] px-3 py-1.5">
          <span className="mono text-[10px] text-[var(--emerald)]">{checked.size} selected</span>
          <button type="button" onClick={() => onExtract(undefined, ids)} className="rounded border border-[var(--border)] px-1.5 py-1 text-[10px] text-[var(--emerald)]">⚡ Extract</button>
          <button type="button" onClick={() => { onMerge(ids); setChecked(new Set()); }} className="rounded border border-[var(--border)] px-1.5 py-1 text-[10px] text-[var(--hint)]">Stitch / Merge</button>
          <button type="button" onClick={() => runBulk({ type: 'triaged', value: true })} className="rounded border border-[var(--border)] px-1.5 py-1 text-[10px] text-[var(--hint)]">Mark Triaged</button>
          <select value={fieldName} onChange={(event) => setFieldName(event.target.value)} className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-1 text-[10px]">
            {fields.map((field) => <option key={field.id} value={field.name}>{field.name}</option>)}
          </select>
          <input value={fieldValue} onChange={(event) => setFieldValue(event.target.value)} dir="auto" placeholder="value" className="w-20 rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-1 text-[10px] outline-none" />
          <button type="button" onClick={() => { if (fieldName) runBulk({ type: 'setField', name: fieldName, value: fieldValue }); }} className="rounded border border-[var(--border)] px-1.5 py-1 text-[10px] text-[var(--hint)]">Set Field</button>
          <select value={bulkBucket} onChange={(event) => setBulkBucket(event.target.value as Bucket)} className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-1 text-[10px]">
            {BUCKETS.map((bucket) => <option key={bucket}>{bucket}</option>)}
          </select>
          <button type="button" onClick={() => runBulk({ type: 'bucket', value: bulkBucket })} className="rounded border border-[var(--border)] px-1.5 py-1 text-[10px] text-[var(--hint)]">Bucket</button>
          <button type="button" onClick={() => {
            onBulk(ids, { type: 'trash' });
            setChecked(new Set());
            notify(`${ids.length} moved to trash`, 'success', { label: 'Undo', run: () => onBulk(ids, { type: 'restore' }) });
          }} className="flex items-center gap-1 rounded border border-[var(--border)] px-1.5 py-1 text-[10px] text-[var(--rose)]"><Trash2 size={10} /> Trash</button>
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
              <th className="w-24 font-medium">
                <button type="button" onClick={() => onSort('length')} className="hover:text-[var(--emerald)]">Length</button>
              </th>
              {visibleFields.map((field) => (
                <th key={field.id} className="w-24 font-medium">
                  <button type="button" onClick={() => onSort(`field:${field.name}`)} title={field.description} className="hover:text-[var(--emerald)]">{field.alias ?? field.name}</button>
                </th>
              ))}
              <th className="w-28 font-medium">Due</th>
              <th className="w-20 pr-3 text-right font-medium">Age</th>
            </tr>
          </thead>
          <tbody>
            {captures.map((capture, index) => {
              const Icon = ICONS[capture.bucket];
              const selected = capture.id === selectedId;
              const previous = captures[index - 1];
              const inBurst = previous && capture.createdAt - previous.createdAt <= burstSec;
              const due = capture.reminder?.dueAt;
              const dueTone = due && due < Date.now() ? 'text-[var(--rose)]' : due && due < Date.now() + 86_400_000 ? 'text-[var(--amber)]' : 'text-[var(--muted)]';
              return (
                <tr key={capture.id} data-id={capture.id} onClick={() => onSelect(capture)} className={cn('group cursor-pointer border-b border-[var(--border)] align-middle', selected && 'selected')}>
                  <td className="py-2 pl-3" onClick={(event) => event.stopPropagation()}>
                    <input type="checkbox" checked={checked.has(capture.id)} onClick={(event) => toggleChecked(index, capture.id, event.shiftKey)} onChange={() => undefined} className="accent-[var(--emerald)]" />
                  </td>
                  <td className={cn('text-[var(--muted)]', inBurst ? 'border-l-2 border-l-[var(--emerald)]' : '')}>
                    <span className="flex h-5 w-5 items-center justify-center rounded bg-[var(--surface-2)]"><Icon size={11} className={capture.bucket === 'reminder' ? 'text-[var(--amber)]' : 'text-[var(--hint)]'} /></span>
                  </td>
                  <td className="max-w-0 py-2 pr-3" dir="auto">
                    <div className="flex items-center gap-1.5">
                      {capture.isPinned ? <Pin size={11} className="shrink-0 text-[var(--amber)]" /> : null}
                      {!capture.triaged && !trashMode ? <span className="mono shrink-0 rounded bg-[var(--amber-soft)] px-1 text-[9px] text-[var(--amber)]">new</span> : null}
                      <span className="truncate text-[12.5px] text-[var(--text)]" dangerouslySetInnerHTML={{ __html: safeSnippet(capture) }} />
                      {capture.sourceUrl ? <Link2 size={10} className="shrink-0 text-[var(--cyan)]" /> : null}
                      {capture.edgeCount > 0 ? <span className="mono shrink-0 rounded bg-[var(--surface-hover)] px-1 text-[9px] text-[var(--hint)]">{capture.edgeCount}</span> : null}
                      {inBurst && !trashMode ? (
                        <button type="button" onClick={(event) => { event.stopPropagation(); onMerge([previous!.id, capture.id]); }} className="mono shrink-0 rounded border border-[var(--emerald)] px-1 text-[9px] text-[var(--emerald)] opacity-0 transition group-hover:opacity-100">Stitch</button>
                      ) : null}
                    </div>
                    {capture.tags.length > 0 ? (
                      <div className="mt-0.5 flex gap-1" dir="auto">{capture.tags.slice(0, 5).map((tag) => <span key={tag} className="mono text-[9px] text-[var(--muted)]">#{tag}</span>)}</div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-2"><span className="mono rounded border border-[var(--border)] px-1.5 py-0.5 text-[9.5px] uppercase text-[var(--hint)]">{capture.bucket}</span></td>
                  <td className="mono py-2 pr-2 text-[10px] text-[var(--muted)]">{capture.content.length}</td>
                  {visibleFields.map((field) => {
                    const value = capture.fields[field.name];
                    const text = value ? (value.valueText ?? String(value.valueNum ?? '')) : '–';
                    return (
                      <td key={field.id} className="py-2 pr-2">
                        <span className={cn('mono text-[9.5px]', value?.locked ? 'text-[var(--amber)]' : 'text-[var(--hint)]')} title={value ? `${value.source}${value.locked ? ' · locked' : ''}` : 'unset'}>
                          {text}{value?.locked ? ' 🔒' : ''}
                        </span>
                      </td>
                    );
                  })}
                  <td className={cn('mono py-2 pr-2 text-[10px]', dueTone)}>
                    {due ? new Date(due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}
                    {capture.reminder?.recurrence ? <span className="ml-1 text-[var(--cyan)]" title={capture.reminder.recurrence}>↻</span> : null}
                  </td>
                  <td className="mono py-2 pr-3 text-right text-[10px] text-[var(--muted)]">
                    {trashMode ? (
                      <button type="button" onClick={(event) => { event.stopPropagation(); onRestore(capture.id); }} className="flex items-center gap-1 text-[var(--emerald)] hover:underline"><RotateCcw size={10} /> restore</button>
                    ) : relativeTime(capture.createdAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {captures.length === 0 ? (
          <div className="flex h-[55%] flex-col items-center justify-center text-center">
            <p className="text-[var(--hint)]">{trashMode ? 'Trash is empty.' : 'No captures in this view.'}</p>
            <p className="mt-1 text-[11px] text-[var(--muted)]">Try a different Query DSL filter or create a capture.</p>
          </div>
        ) : null}
      </div>

      <div className="sticky bottom-0 border-t border-[var(--border)] bg-[#0b0e11]/95 px-3 py-1.5 text-[9.5px] text-[var(--muted)]">
        <span className="mono">j/k</span> move · <span className="mono">space</span> inspect · <span className="mono">p</span> pin · <span className="mono">r</span> resolve · <span className="mono">t</span> triaged · <span className="mono">x</span> trash · <span className="mono">e</span> extract · <span className="mono">1–6</span> bucket
        <span className="float-right">{visibleFields.length} field columns · {fields.length} fields</span>
      </div>
    </div>
  );
}
