import { useEffect, useState } from 'react';
import { Check, Copy, Download, ExternalLink, LoaderCircle, WandSparkles, X } from 'lucide-react';
import { extract } from '../api/client';
import type { ExtractorTemplate } from '../types/capture';
import { cn, copyText, downloadText } from '../lib/utils';
import type { Notify } from '../types/ui';

export function ExtractModal({
  open, onClose, templates, captureIds, query, initialTemplateId, notify,
}: {
  open: boolean;
  onClose: () => void;
  templates: ExtractorTemplate[];
  captureIds?: string[];
  query?: string;
  initialTemplateId?: string;
  notify: Notify;
}) {
  const [templateId, setTemplateId] = useState('');
  const [includeNeighbors, setIncludeNeighbors] = useState(true);
  const [result, setResult] = useState<Awaited<ReturnType<typeof extract>> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTemplateId(initialTemplateId ?? templates.find((template) => template.isDefault)?.id ?? templates[0]?.id ?? '');
    setResult(null);
  }, [open, templates, initialTemplateId]);

  useEffect(() => {
    if (!open || !templateId) return;
    let cancelled = false;
    setBusy(true);
    const timer = window.setTimeout(() => {
      extract({ templateId, captureIds, q: captureIds?.length ? undefined : query, includeNeighbors })
        .then((compiled) => { if (!cancelled) setResult(compiled); })
        .catch((error: unknown) => { if (!cancelled) notify(error instanceof Error ? error.message : 'Compile failed', 'error'); })
        .finally(() => { if (!cancelled) setBusy(false); });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [open, templateId, captureIds, query, includeNeighbors, notify]);

  if (!open) return null;
  const template = templates.find((item) => item.id === templateId);
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="flex max-h-[92vh] w-full max-w-[880px] animate-rise flex-col rounded-lg border border-[var(--border-strong)] bg-[var(--surface)]">
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-4 py-3">
          <WandSparkles size={14} className="text-[var(--emerald)]" />
          <h2 className="text-[12px] font-semibold text-[var(--text)]">1-Click Extract</h2>
          <select value={templateId} onChange={(event) => setTemplateId(event.target.value)} className="ml-2 rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[10px] outline-none">
            {templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <label className="mono ml-2 flex items-center gap-1 text-[9.5px] text-[var(--muted)]">
            <input type="checkbox" checked={includeNeighbors} onChange={(event) => setIncludeNeighbors(event.target.checked)} /> Include 1-hop linked captures
          </label>
          <button type="button" onClick={onClose} className="ml-auto text-[var(--muted)] hover:text-[var(--text)]"><X size={15} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {busy ? <div className="flex items-center justify-center py-16 text-[var(--muted)]"><LoaderCircle size={18} className="animate-spin" /></div> : null}
          {result ? (
            <>
              <div className="mono mb-2 flex flex-wrap gap-3 text-[10px] text-[var(--muted)]">
                <span>{result.captureCount} captures</span><span>{result.neighborCount} neighbors</span>
                <span>{result.charCount} chars</span><span className="text-[var(--emerald)]">~{result.estimatedTokens} tokens</span>
              </div>
              <pre dir="auto" className="mono max-h-[52vh] overflow-auto whitespace-pre-wrap rounded border border-[var(--border)] bg-[#0b0f12] p-3 text-[10.5px] leading-relaxed text-[var(--hint)]">{result.text}</pre>
            </>
          ) : !busy ? <p className="py-16 text-center text-[11px] text-[var(--muted)]">No compiled output yet.</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-[var(--border)] px-4 py-3">
          <button type="button" disabled={!result} onClick={() => { if (!result) return; void copyText(result.text).then(() => notify(`Copied ${result.captureCount} captures · ~${result.estimatedTokens} tokens`, 'success')); }}
            className="flex items-center gap-1 rounded bg-[var(--emerald)] px-2.5 py-1.5 text-[10px] font-semibold text-[#05130d] disabled:opacity-40"><Copy size={11} /> Copy to Clipboard</button>
          <button type="button" disabled={!result} onClick={() => result && downloadText(result.text, `blinko-${template?.slug ?? 'extract'}.md`)}
            className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1.5 text-[10px] text-[var(--hint)] disabled:opacity-40"><Download size={11} /> Download .md</button>
          {result?.obsidianUri ? (
            <a href={result.obsidianUri} className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1.5 text-[10px] text-[var(--cyan)]"><ExternalLink size={11} /> Open in Obsidian</a>
          ) : null}
          <span className="mono ml-auto text-[9.5px] text-[var(--muted)]">{template?.description}</span>
          <button type="button" onClick={onClose} className={cn('rounded border border-[var(--border)] px-2 py-1.5 text-[10px] text-[var(--hint)]')}><Check size={11} /> Done</button>
        </div>
      </div>
    </div>
  );
}
