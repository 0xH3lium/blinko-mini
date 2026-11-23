import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '../lib/utils';
import type { ToastTone } from '../types/ui';

interface ToastProps {
  message: string;
  tone: ToastTone;
  onDismiss: () => void;
}

const icons = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

export function Toast({ message, tone, onDismiss }: ToastProps) {
  const Icon = icons[tone];

  useEffect(() => {
    const timer = window.setTimeout(onDismiss, 2800);
    return () => window.clearTimeout(timer);
  }, [message, tone, onDismiss]);

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'fixed left-1/2 top-[max(12px,env(safe-area-inset-top))] z-[100] flex w-[calc(100%-24px)] max-w-[420px]',
        '-translate-x-1/2 animate-toast-in items-center gap-2.5 rounded-xl border px-3.5 py-2.5 shadow-float backdrop-blur-xl',
        'border-[var(--app-border)] bg-[var(--app-surface)] text-[var(--app-text)]',
        tone === 'success' && 'border-[var(--app-accent-border)]',
        tone === 'error' && 'border-[var(--app-danger-soft)]',
      )}
    >
      <Icon
        size={17}
        className={cn(
          'shrink-0',
          tone === 'success' && 'text-[var(--app-accent-bright)]',
          tone === 'error' && 'text-[var(--app-danger)]',
          tone === 'info' && 'text-[var(--app-accent)]',
        )}
      />
      <span className="min-w-0 flex-1 text-[12.5px] font-medium leading-snug">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--app-muted)] transition hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text)]"
      >
        <X size={13} />
      </button>
    </div>,
    document.body,
  );
}
