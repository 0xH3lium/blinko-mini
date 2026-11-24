import { useState } from 'react';
import { Check, FileInput, LoaderCircle, X } from 'lucide-react';
import { applyPatch, previewPatch } from '../api/client';
import type { PatchPreview } from '../types/capture';
import { cn } from '../lib/utils';
import type { Notify } from '../types/ui';

export function PatchImportModal({
  open, onClose, notify, onApplied,
}: {
  open: boolean; onClose: () => void; notify: Notify; onApplied: () => Promise<void>;
}) {
  const [raw, setRaw] = useState('');
  const [preview, setPreview] = useState<PatchPreview | null>(null);
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  if (!open) return null;
  const selected = preview
    ? [...preview.diffs.map((diff) => diff.id), ...preview.newItems.map((item) => item.key)].filter((key) => !deselected.has(key))
    : [];
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="flex max-h-[92vh] w-full max-w-[920px] animate-rise flex-col rounded-lg border border-[var(--border-strong)] bg-[var(--surface)]">
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
          <FileInput size={14} className="text-[var(--emerald)]" />
          <h2 className="text-[12px] font-semibold text-[var(--text)]">Paste AI JSON Patch</h2>
          <span className="mono text-[9.5px] text-[var(--muted)]">```json fences supported · atomic apply</span>
          <button type="button" onClick={onClose} className="ml-auto text-[var(--muted)] hover:text-[var(--text)]"><X size={15} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <textarea value={raw} onChange={(event) => setRaw(event.target.value)} dir="auto" rows={10} spellCheck={false}
            placeholder={'```json\n{"updates":[{"id":"...","bucket":"idea","addTags":["verified"]}]}\n```'}
            className="mono w-full resize-y rounded border border-[var(--border-strong)] bg-[#0b0f12] p-3 text-[10.5px] outline-none focus:border-[var(--emerald)]" />
          <div className="mt-2 flex items-center gap-2">
            <button type="button" disabled={!raw.trim() || busy} onClick={() => {
              setBusy(true);
              previewPatch(raw).then((result) => { setPreview(result); setDeselected(new Set()); })
                .catch((error: unknown) => notify(error instanceof Error ? error.message : 'Preview failed', 'error'))
                .finally(() => setBusy(false));
            }} className="flex items-center gap-1 rounded border border-[var(--emerald)] px-2.5 py-1.5 text-[10px] text-[var(--emerald)] disabled:opacity-40">
              {busy ? <LoaderCircle size={11} className="animate-spin" /> : <Check size={11} />} Preview Diff
            </button>
            {preview ? <span className="mono text-[10px] text-[var(--muted)]">{preview.diffs.length} changes · {preview.updateCount} updates · {preview.mergeCount} merges · {preview.newCount} new</span> : null}
          </div>
          {preview ? (
            <div className="mt-3 overflow-hidden rounded border border-[var(--border)]">
              {preview.errors.map((error, index) => <p key={index} className="mono bg-[var(--rose-soft)] px-2 py-1 text-[10px] text-[var(--rose)]">{error}</p>)}
              {preview.warnings.map((warning, index) => <p key={index} className="mono bg-[var(--amber-soft)] px-2 py-1 text-[10px] text-[var(--amber)]">{warning}</p>)}
              <table className="war-table w-full border-collapse text-left">
                <thead className="bg-[var(--surface-2)] text-[9px] uppercase tracking-wider text-[var(--muted)]">
                  <tr><th className="w-10 px-2 py-1.5">Apply</th><th className="w-24 py-1.5">ID</th><th className="py-1.5">Before</th><th className="py-1.5">After</th></tr>
                </thead>
                <tbody>
                  {preview.newItems.map((item) => (
                    <tr key={item.key} className="border-t border-[var(--border)] align-top">
                      <td className="px-2 py-1.5">
                        <input type="checkbox" checked={!deselected.has(item.key)} onChange={() => setDeselected((current) => {
                          const next = new Set(current);
                          if (next.has(item.key)) next.delete(item.key); else next.add(item.key);
                          return next;
                        })} className="accent-[var(--emerald)]" />
                      </td>
                      <td className="mono py-1.5 text-[9.5px] text-[var(--cyan)]">{item.key}</td>
                      <td className="mono py-1.5 text-[9px] text-[var(--muted)]">new capture</td>
                      <td className="mono py-1.5 text-[9px] text-[var(--hint)]" dir="auto">{item.bucket} · {item.content.slice(0, 160)}</td>
                    </tr>
                  ))}
                  {preview.diffs.map((diff) => (
                    <tr key={diff.id} className="border-t border-[var(--border)] align-top">
                      <td className="px-2 py-1.5">
                        <input type="checkbox" checked={!deselected.has(diff.id)} onChange={() => setDeselected((current) => {
                          const next = new Set(current);
                          if (next.has(diff.id)) next.delete(diff.id); else next.add(diff.id);
                          return next;
                        })} className="accent-[var(--emerald)]" />
                      </td>
                      <td className="mono py-1.5 text-[9.5px] text-[var(--emerald)]">{diff.id.slice(0, 12)}</td>
                      <td className="mono py-1.5 text-[9px] text-[var(--muted)]" dir="auto">{JSON.stringify(diff.before)}</td>
                      <td className="mono py-1.5 text-[9px] text-[var(--hint)]" dir="auto">{JSON.stringify(diff.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
          <button type="button" onClick={onClose} className="rounded border border-[var(--border)] px-2 py-1.5 text-[10px] text-[var(--hint)]">Cancel</button>
          <button type="button" disabled={!preview || selected.length === 0 || busy} onClick={() => {
            setBusy(true);
            applyPatch(raw, selected).then((result) => {
              notify(`Applied ${result.affected} updates · ${result.merges} merges · ${result.created} new`, 'success');
              setPreview(null); setRaw('');
              void onApplied();
            }).catch((error: unknown) => notify(error instanceof Error ? error.message : 'Apply failed', 'error')).finally(() => setBusy(false));
          }} className={cn('flex items-center gap-1 rounded bg-[var(--emerald)] px-2.5 py-1.5 text-[10px] font-semibold text-[#05130d] disabled:opacity-40')}>
            Apply Selected Patches
          </button>
        </div>
      </div>
    </div>
  );
}
