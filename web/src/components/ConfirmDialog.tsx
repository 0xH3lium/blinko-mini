import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, LoaderCircle, X } from 'lucide-react';
import { cn } from '../lib/utils';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  busy = false,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cancelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, busy, onCancel]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-[rgba(18,15,10,0.42)] p-3 backdrop-blur-[3px] animate-fade sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-description"
        className="w-full max-w-[400px] animate-rise rounded-[26px] border border-[var(--app-border)] bg-[var(--app-surface)] p-5 shadow-float"
      >
        <div className="flex items-start justify-between gap-4">
          <span
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl',
              danger
                ? 'bg-[color-mix(in_srgb,#d8564a_12%,transparent)] text-[#c6493e]'
                : 'bg-[var(--app-accent-soft)] text-[var(--app-accent)]',
            )}
          >
            <AlertTriangle size={18} />
          </span>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition hover:bg-[var(--app-accent-soft)] hover:text-[var(--app-text)] disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </div>

        <h2
          id="confirm-title"
          className="mt-4 font-display text-[24px] leading-tight tracking-[-0.02em] text-[var(--app-text)]"
        >
          {title}
        </h2>
        <p
          id="confirm-description"
          className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--app-hint)]"
        >
          {description}
        </p>

        <div className="mt-6 flex gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-11 flex-1 rounded-2xl border border-[var(--app-border)] text-[13px] font-semibold text-[var(--app-text)] transition hover:bg-[var(--app-accent-soft)] disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={cn(
              'flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl text-[13px] font-semibold text-white transition active:scale-[0.98] disabled:opacity-60',
              danger ? 'bg-[#c6493e] hover:bg-[#b23e34]' : 'bg-[var(--app-accent)]',
            )}
          >
            {busy ? <LoaderCircle size={15} className="animate-spin" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
