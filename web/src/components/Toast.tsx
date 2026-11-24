import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '../lib/utils';
import type { ToastTone, ToastAction } from '../types/ui';

export function Toast({ message, tone, action, onDismiss }: {
  message: string; tone: ToastTone; action?: ToastAction; onDismiss: () => void;
}) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'error' ? AlertCircle : Info;
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, action ? 6000 : 2800);
    return () => window.clearTimeout(timer);
  }, [message, tone, action, onDismiss]);
  return createPortal(
    <div role="status" aria-live="polite"
      className={cn('fixed left-1/2 top-3 z-[100] flex w-[calc(100%-24px)] max-w-[460px] -translate-x-1/2 animate-rise items-center gap-2.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 py-2.5 shadow-xl backdrop-blur-xl',
        tone === 'success' && 'border-[var(--emerald)]', tone === 'error' && 'border-[var(--rose)]')}
    >
      <Icon size={16} className={cn('shrink-0', tone === 'success' ? 'text-[var(--emerald)]' : tone === 'error' ? 'text-[var(--rose)]' : 'text-[var(--cyan)]')} />
      <span className="min-w-0 flex-1 text-[12px] text-[var(--text)]">{message}</span>
      {action ? (
        <button type="button" onClick={() => { action.run(); onDismiss(); }} className="mono rounded border border-[var(--emerald)] px-1.5 py-0.5 text-[10px] text-[var(--emerald)]">{action.label}</button>
      ) : null}
      <button type="button" onClick={onDismiss} aria-label="Dismiss notification" className="rounded p-0.5 text-[var(--muted)] hover:text-[var(--text)]"><X size={13} /></button>
    </div>, document.body,
  );
}
