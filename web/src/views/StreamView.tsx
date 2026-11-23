import { useEffect, useMemo, useRef } from 'react';
import { Brain, CircleHelp, Lightbulb, Link2, Pin, Timer, TriangleAlert, Waves } from 'lucide-react';
import type { Capture, Head } from '../types/capture';
import { cn, relativeTime } from '../lib/utils';

const ICONS = { idea: Lightbulb, memory: Brain, reminder: Timer, question: CircleHelp, reference: Link2, noise: Waves };

export function StreamView({
  captures, selectedId, onSelect, heads, onPin, onResolve, onDelete, onJev,
}: {
  captures: Capture[];
  selectedId: string | null;
  onSelect: (capture: Capture) => void;
  heads: Head[];
  onPin: (capture: Capture) => void;
  onResolve: (capture: Capture) => void;
  onDelete: (capture: Capture) => void;
  onJev: (capture: Capture) => void;
}) {
  const index = useMemo(() => captures.findIndex((capture) => capture.id === selectedId), [captures, selectedId]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const current = captures[index];
      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault();
        const next = captures[Math.min(captures.length - 1, index + 1)];
        if (next) onSelect(next);
      } else if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = captures[Math.max(0, index - 1)];
        if (next) onSelect(next);
      } else if (!current) {
        return;
      } else if (event.key === ' ') { event.preventDefault(); onSelect(current); }
      else if (event.key === 'p') onPin(current);
      else if (event.key === 'r') onResolve(current);
      else if (event.key === 'x') onDelete(current);
      else if (event.key === 'e') onJev(current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [captures, index, onSelect, onPin, onResolve, onDelete, onJev]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-id="${selectedId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  return (
    <div ref={listRef} className="h-full overflow-y-auto">
      <table className="war-table w-full border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-[#0b0e11]">
          <tr className="border-b border-[var(--border)] text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">
            <th className="w-8 py-2 pl-3 font-medium">E</th>
            <th className="w-8 font-medium" />
            <th className="py-2 font-medium">Capture</th>
            <th className="w-20 font-medium">Bucket</th>
            <th className="w-32 font-medium">Heads</th>
            <th className="w-24 font-medium">Due</th>
            <th className="w-24 pr-3 text-right font-medium">Age</th>
          </tr>
        </thead>
        <tbody>
          {captures.map((capture) => {
            const Icon = ICONS[capture.bucket];
            const selected = capture.id === selectedId;
            return (
              <tr key={capture.id} data-id={capture.id} onClick={() => onSelect(capture)} className={cn('cursor-pointer border-b border-[var(--border)] align-middle', selected && 'selected')}>
                <td className="py-2 pl-3">
                  <span className="relative block h-6 w-[2px] rounded bg-[var(--surface-hover)]">
                    <span className={cn('absolute bottom-0 left-0 w-full rounded', capture.energy >= 1 ? 'bg-[var(--emerald)]' : capture.energy > 0.4 ? 'bg-[var(--amber)]' : 'bg-[var(--rose)]')} style={{ height: `${Math.max(4, Math.min(100, capture.energy * 50))}%` }} />
                  </span>
                </td>
                <td className="text-[var(--muted)]">
                  <span className="flex h-5 w-5 items-center justify-center rounded bg-[var(--surface-2)]">
                    <Icon size={11} className={capture.bucket === 'reminder' ? 'text-[var(--amber)]' : 'text-[var(--hint)]'} />
                  </span>
                </td>
                <td className="max-w-0 py-2 pr-3">
                  <div className="flex items-center gap-1.5">
                    {capture.isPinned ? <Pin size={11} className="shrink-0 text-[var(--amber)]" /> : null}
                    <span className="truncate text-[12.5px] text-[var(--text)]">{capture.content}</span>
                    {capture.resonanceCount > 1 ? <span className="mono shrink-0 rounded bg-[var(--emerald-soft)] px-1 text-[9px] text-[var(--emerald)]">×{capture.resonanceCount}</span> : null}
                    <TriangleAlert size={11} className="shrink-0 text-[var(--rose)]" style={{ display: 'none' }} />
                  </div>
                  {capture.tags.length > 0 ? (
                    <div className="mt-0.5 flex gap-1">
                      {capture.tags.slice(0, 4).map((tag) => <span key={tag} className="mono text-[9px] text-[var(--muted)]">#{tag}</span>)}
                    </div>
                  ) : null}
                </td>
                <td className="py-2 pr-2"><span className="mono rounded border border-[var(--border)] px-1.5 py-0.5 text-[9.5px] uppercase text-[var(--hint)]">{capture.bucket}</span></td>
                <td className="py-2 pr-2"><span className="mono flex gap-1 text-[9.5px] text-[var(--muted)]"><span>L:{(capture as Capture & { leverage?: number }).leverage ?? '–'}</span><span>F:{Math.round(((capture as Capture & { falsifiable?: number }).falsifiable ?? 0) * 100)}%</span></span></td>
                <td className="mono py-2 pr-2 text-[10px] text-[var(--amber)]">{capture.bucket === 'reminder' ? '⏰' : ''}</td>
                <td className="mono py-2 pr-3 text-right text-[10px] text-[var(--muted)]">{relativeTime(capture.createdAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {captures.length === 0 ? (
        <div className="flex h-[60%] flex-col items-center justify-center text-center">
          <p className="text-[var(--hint)]">No captures in this view.</p>
          <p className="mt-1 text-[11px] text-[var(--muted)]">Send text to the Telegram bot or press ⌘K to create one.</p>
        </div>
      ) : null}
      <div className="sticky bottom-0 border-t border-[var(--border)] bg-[#0b0e11]/95 px-3 py-1.5 text-[9.5px] text-[var(--muted)]">
        <span className="mono">j/k</span> move · <span className="mono">space</span> inspect · <span className="mono">p</span> pin · <span className="mono">r</span> resolve · <span className="mono">x</span> delete · <span className="mono">e</span> force Jev
        <span className="float-right">{heads.filter((head) => head.active).length} active heads</span>
      </div>
    </div>
  );
}
