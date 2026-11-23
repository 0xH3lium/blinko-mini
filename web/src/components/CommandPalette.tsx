import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Command, Search, Sparkles } from 'lucide-react';
import type { Capture, Mode } from '../types/capture';
import { getCaptures } from '../api/client';
import { cn } from '../lib/utils';

export function CommandPalette({
  open,
  onClose,
  onSelect,
  onCapture,
  onMode,
  onToggleJev,
  onCollide,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (capture: Capture) => void;
  onCapture: () => void;
  onMode: (mode: Mode) => void;
  onToggleJev: () => void;
  onCollide: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Capture[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setResults([]);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !query.trim()) { setResults([]); return; }
    let cancelled = false;
    setBusy(true);
    const timer = window.setTimeout(() => {
      getCaptures({ q: query, limit: 8 })
        .then((page) => { if (!cancelled) setResults(page.captures); })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setBusy(false); });
    }, 160);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [open, query]);

  if (!open) return null;

  const actions: Array<{ label: string; hint: string; run: () => void }> = [
    { label: 'Create capture', hint: 'new', run: onCapture },
    { label: 'Switch to Topology', hint: '2', run: () => onMode('topology') },
    { label: 'Switch to Triage', hint: '3', run: () => onMode('triage') },
    { label: 'Toggle Jev mode', hint: 'gated/bootstrap/off', run: onToggleJev },
    { label: 'Run collision scan', hint: '/collide', run: onCollide },
  ];

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/60 pt-[12vh] backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="w-full max-w-[620px] animate-rise overflow-hidden rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] shadow-2xl">
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-3.5 py-3">
          <Search size={15} className="text-[var(--muted)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                if (results[0]) { onSelect(results[0]); onClose(); }
                else if (query.trim()) { onCapture(); onClose(); }
              }
            }}
            placeholder="Search captures (FTS5 + cosine) or type a command…"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--muted)]"
          />
          <span className="mono rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">esc</span>
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-1.5">
          {query.trim() ? (
            <div>
              <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                {busy ? 'Searching…' : `Captures · ${results.length}`}
              </div>
              {results.map((capture) => (
                <button
                  key={capture.id}
                  type="button"
                  onClick={() => { onSelect(capture); onClose(); }}
                  className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-[var(--surface-hover)]"
                >
                  <span className="mono text-[9px] uppercase text-[var(--emerald)]">{capture.bucket.slice(0, 3)}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text)]">{capture.content}</span>
                  <ArrowRight size={12} className="text-[var(--muted)]" />
                </button>
              ))}
              {!busy && results.length === 0 ? <p className="px-2 py-3 text-[11px] text-[var(--muted)]">No matches. Press Enter to capture this text.</p> : null}
            </div>
          ) : null}

          <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Actions</div>
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => { action.run(); onClose(); }}
              className={cn('flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-[var(--surface-hover)]')}
            >
              <Command size={12} className="text-[var(--muted)]" />
              <span className="flex-1 text-[12px] text-[var(--text)]">{action.label}</span>
              <span className="mono text-[10px] text-[var(--muted)]">{action.hint}</span>
            </button>
          ))}
          <button type="button" onClick={() => { onCollide(); onClose(); }} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-[var(--surface-hover)]">
            <Sparkles size={12} className="text-[var(--amber)]" />
            <span className="flex-1 text-[12px] text-[var(--text)]">Force Jev recalculation on selected</span>
          </button>
        </div>
      </div>
    </div>
  );
}
