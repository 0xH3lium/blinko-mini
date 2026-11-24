import { Command, FileInput, FlaskConical, LogOut, Plus, Radio, Rows3, TriangleAlert, WandSparkles } from 'lucide-react';
import type { Mode } from '../types/capture';
import { cn } from '../lib/utils';

const MODES: Array<{ key: Mode; label: string; hotkey: string }> = [
  { key: 'stream', label: 'Stream', hotkey: '1' },
  { key: 'agenda', label: 'Agenda & Matrix', hotkey: '2' },
  { key: 'triage', label: 'Triage', hotkey: '3' },
  { key: 'studio', label: 'Studio', hotkey: '4' },
];

export function TopBar({
  mode, onMode, onSearch, onCapture, onBatch, onExtract, onPatchImport, onLogout, connected, triageCount,
}: {
  mode: Mode;
  onMode: (mode: Mode) => void;
  onSearch: () => void;
  onCapture: (mode: 'auto' | 'manual') => void;
  onBatch: () => void;
  onExtract: () => void;
  onPatchImport: () => void;
  onLogout: () => void;
  connected: boolean;
  triageCount: number;
}) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[#0b0e11] px-4">
      <span className="text-[13px] font-bold tracking-[0.2em] text-[var(--emerald)]">BLINKO//OS</span>
      <span className="mono rounded border border-[var(--border-strong)] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[var(--muted)]">v2 · local</span>

      <nav className="ml-2 flex items-center gap-1">
        {MODES.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onMode(item.key)}
            className={cn(
              'flex items-center gap-2 rounded px-2.5 py-1.5 text-[12px] font-medium transition',
              mode === item.key ? 'bg-[var(--surface-hover)] text-[var(--text)]' : 'text-[var(--hint)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]',
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

      <div className="ml-auto flex items-center gap-1.5">
        <span className={cn('flex items-center gap-1.5 text-[10px] uppercase tracking-wider', connected ? 'text-[var(--emerald)]' : 'text-[var(--rose)]')}>
          <Radio size={12} className={connected ? 'animate-pulse' : ''} /> {connected ? 'live' : 'offline'}
        </span>
        <button type="button" onClick={onSearch} title="⌘K Search" className="flex items-center gap-1.5 rounded border border-[var(--border-strong)] bg-[var(--surface-2)] px-2 py-1.5 text-[11px] text-[var(--hint)] hover:text-[var(--text)]">
          <Command size={12} /> <span className="mono">⌘K</span>
        </button>
        <button type="button" onClick={onExtract} title="⚡ Extract" className="flex items-center gap-1 rounded border border-[var(--border-strong)] px-2 py-1.5 text-[11px] text-[var(--emerald)] hover:bg-[var(--emerald-soft)]">
          <WandSparkles size={12} /> Extract
        </button>
        <button type="button" onClick={() => onCapture('auto')} className="flex items-center gap-1 rounded bg-[var(--emerald)] px-2 py-1.5 text-[11px] font-semibold text-[#05130d] hover:brightness-110">
          <Plus size={12} /> Capture
        </button>
        <button type="button" onClick={onBatch} title="Batch paste" className="rounded border border-[var(--border-strong)] p-1.5 text-[var(--hint)] hover:text-[var(--text)]"><Rows3 size={13} /></button>
        <button type="button" onClick={onPatchImport} title="Patch Import" className="rounded border border-[var(--border-strong)] p-1.5 text-[var(--hint)] hover:text-[var(--text)]"><FileInput size={13} /></button>
        <button type="button" onClick={() => onCapture('manual')} title="⌘M Manual capture" className="rounded border border-[var(--border-strong)] p-1.5 text-[var(--hint)] hover:text-[var(--text)]"><FlaskConical size={13} /></button>
        <button type="button" onClick={onLogout} title="Log out" className="rounded border border-transparent p-1.5 text-[var(--muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"><LogOut size={14} /></button>
      </div>
    </header>
  );
}
