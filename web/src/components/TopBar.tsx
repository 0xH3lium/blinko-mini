import { Command, LogOut, Plus, Radio, TriangleAlert } from 'lucide-react';
import type { Mode } from '../types/capture';
import { cn } from '../lib/utils';

const MODES: Array<{ key: Mode; label: string; hotkey: string }> = [
  { key: 'stream', label: 'Stream', hotkey: '1' },
  { key: 'topology', label: 'Topology', hotkey: '2' },
  { key: 'triage', label: 'Triage', hotkey: '3' },
  { key: 'jev', label: 'Jev Lab', hotkey: '4' },
];

export function TopBar({
  mode,
  onMode,
  onSearch,
  onCapture,
  onLogout,
  connected,
  triageCount,
  jevMode,
}: {
  mode: Mode;
  onMode: (mode: Mode) => void;
  onSearch: () => void;
  onCapture: () => void;
  onLogout: () => void;
  connected: boolean;
  triageCount: number;
  jevMode: string;
}) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-4 border-b border-[var(--border)] bg-[#0b0e11] px-4">
      <div className="flex items-center gap-2.5">
        <span className="text-[13px] font-bold tracking-[0.2em] text-[var(--emerald)]">BLINKO//OS</span>
        <span className="rounded border border-[var(--border-strong)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-[var(--muted)]">
          {jevMode}
        </span>
      </div>

      <nav className="ml-3 flex items-center gap-1">
        {MODES.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onMode(item.key)}
            className={cn(
              'flex items-center gap-2 rounded px-2.5 py-1.5 text-[12px] font-medium transition',
              mode === item.key
                ? 'bg-[var(--surface-hover)] text-[var(--text)]'
                : 'text-[var(--hint)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]',
            )}
          >
            <span className="mono rounded border border-[var(--border)] px-1 text-[9px] text-[var(--muted)]">{item.hotkey}</span>
            {item.label}
            {item.key === 'triage' && triageCount > 0 ? (
              <span className="mono flex items-center gap-1 rounded bg-[var(--amber-soft)] px-1.5 text-[10px] text-[var(--amber)]">
                <TriangleAlert size={10} /> {triageCount}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        <span
          className={cn('flex items-center gap-1.5 text-[10px] uppercase tracking-wider', connected ? 'text-[var(--emerald)]' : 'text-[var(--rose)]')}
          title={connected ? 'SSE stream live' : 'SSE disconnected'}
        >
          <Radio size={12} className={connected ? 'animate-pulse' : ''} />
          {connected ? 'live' : 'offline'}
        </span>
        <button
          type="button"
          onClick={onSearch}
          className="flex items-center gap-2 rounded border border-[var(--border-strong)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[11px] text-[var(--hint)] hover:text-[var(--text)]"
        >
          <Command size={13} /> <span className="mono">⌘K</span> Search
        </button>
        <button
          type="button"
          onClick={onCapture}
          className="flex items-center gap-1.5 rounded bg-[var(--emerald)] px-2.5 py-1.5 text-[11px] font-semibold text-[#05130d] hover:brightness-110"
        >
          <Plus size={13} /> Capture
        </button>
        <button
          type="button"
          onClick={onLogout}
          title="Log out"
          className="rounded border border-transparent p-1.5 text-[var(--muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
        >
          <LogOut size={14} />
        </button>
      </div>
    </header>
  );
}
