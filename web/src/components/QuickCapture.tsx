import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Hash, LoaderCircle, Sparkles } from 'lucide-react';
import { createItem } from '../api/client';
import { haptic } from '../lib/telegram';
import { cn } from '../lib/utils';
import type { Notify } from '../types/ui';

interface QuickCaptureProps {
  notify: Notify;
  onCaptured: () => void;
}

export function QuickCapture({ notify, onCaptured }: QuickCaptureProps) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = '0px';
    element.style.height = `${Math.min(element.scrollHeight, 124)}px`;
  }, [value]);

  async function submit(): Promise<void> {
    const content = value.trim();
    if (!content || sending) return;

    setSending(true);
    try {
      await createItem({ type: 'blink', content });
      setValue('');
      haptic('success');
      notify('Blink captured', 'success');
      onCaptured();
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (error) {
      haptic('error');
      notify(error instanceof Error ? error.message : 'Could not save that blink.', 'error');
    } finally {
      setSending(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className={cn(
        'capture-card group relative mb-2 rounded-[24px] border border-[var(--app-border)]',
        'bg-[var(--app-surface)] p-3.5 shadow-[0_16px_40px_-22px_rgba(24,20,12,0.45)]',
      )}
    >
      <div className="mb-2 flex items-center justify-between px-0.5">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-hint)]">
          <Sparkles size={11} className="text-[var(--app-accent)]" />
          Quick capture
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] text-[var(--app-hint)]">
          <Hash size={10} /> tags supported
        </span>
      </div>

      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder="Capture a blink…"
          aria-label="Capture a blink"
          maxLength={100_000}
          className="max-h-[124px] min-h-[28px] min-w-0 flex-1 resize-none bg-transparent px-0.5 py-0.5 text-[15.5px] leading-[1.5] text-[var(--app-text)] outline-none placeholder:text-[var(--app-hint)] focus-visible:outline-none"
        />
        <button
          type="submit"
          disabled={!value.trim() || sending}
          aria-label="Save blink"
          className={cn(
            'mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all duration-200',
            'bg-[var(--app-accent)] text-[var(--app-accent-text)] shadow-[0_5px_16px_-5px_var(--app-accent)]',
            'hover:scale-105 active:scale-95 disabled:scale-100 disabled:bg-[color-mix(in_srgb,var(--app-text)_10%,transparent)] disabled:text-[var(--app-hint)] disabled:shadow-none',
          )}
        >
          {sending ? (
            <LoaderCircle size={17} className="animate-spin" />
          ) : (
            <ArrowUp size={18} strokeWidth={2.4} />
          )}
        </button>
      </div>

      <div className="mt-1 flex items-center justify-between px-0.5 text-[10px] text-[var(--app-hint)]">
        <span>Enter to save · Shift + Enter for a new line</span>
        <span className="tabular-nums opacity-60">{value.length > 120 ? value.length : ''}</span>
      </div>
    </form>
  );
}
