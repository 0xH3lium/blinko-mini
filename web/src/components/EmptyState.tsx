import type { LucideIcon } from 'lucide-react';
import { ArrowDown, Plus } from 'lucide-react';
import { cn } from '../lib/utils';

interface EmptyStateProps {
  icon: LucideIcon;
  eyebrow?: string;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  hint?: string;
}

export function EmptyState({
  icon: Icon,
  eyebrow = 'Nothing here yet',
  title,
  description,
  actionLabel,
  onAction,
  hint,
}: EmptyStateProps) {
  return (
    <div className="flex animate-rise flex-col items-center px-4 pb-10 pt-14 text-center">
      <div className="relative flex h-24 w-24 items-center justify-center">
        <span className="absolute inset-0 rounded-full border border-[var(--app-border)] opacity-80" />
        <span className="absolute inset-3 rounded-full border border-dashed border-[var(--app-border)] opacity-70" />
        <span className="absolute inset-6 rounded-full bg-[var(--app-accent-soft)]" />
        <Icon
          size={25}
          strokeWidth={1.6}
          className="relative text-[var(--app-accent)]"
        />
        <span className="absolute -right-0.5 top-2 h-1.5 w-1.5 rounded-full bg-[var(--app-accent)] opacity-70" />
      </div>

      <p className="mt-6 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--app-hint)]">
        {eyebrow}
      </p>
      <h2 className="mt-2 max-w-[290px] font-display text-[30px] leading-[1.1] tracking-[-0.03em] text-[var(--app-text)]">
        {title}
      </h2>
      <p className="mt-2.5 max-w-[310px] text-[13px] leading-relaxed text-[var(--app-hint)]">
        {description}
      </p>

      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-full bg-[var(--app-text)] px-4 text-[12.5px] font-semibold text-[var(--app-bg)] transition hover:opacity-85 active:scale-[0.98]"
        >
          <Plus size={14} />
          {actionLabel}
        </button>
      ) : null}

      {hint ? (
        <span className="mt-5 inline-flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.12em] text-[var(--app-hint)] opacity-75">
          {hint}
          <ArrowDown size={11} className="translate-y-px" />
        </span>
      ) : null}
    </div>
  );
}
