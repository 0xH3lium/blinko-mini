import {
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  FileText,
  LoaderCircle,
  Pin,
  PinOff,
  Trash2,
  Zap,
} from 'lucide-react';
import type { Item } from '../types/item';
import { cn, fullTimestamp, relativeTime } from '../lib/utils';

interface ItemCardProps {
  item: Item;
  index: number;
  pending: boolean;
  onOpen: (item: Item) => void;
  onTagClick: (tag: string) => void;
  onPin: (item: Item) => void;
  onPromote: (item: Item) => void;
  onArchive: (item: Item) => void;
  onDelete: (item: Item) => void;
}

function ActionButton({
  label,
  onClick,
  active,
  danger,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-full transition',
        'text-[var(--app-hint)] hover:bg-[color-mix(in_srgb,var(--app-text)_7%,transparent)] hover:text-[var(--app-text)]',
        active &&
          'bg-[var(--app-accent-soft)] text-[var(--app-accent)] hover:bg-[var(--app-accent-soft)] hover:text-[var(--app-accent)]',
        danger &&
          'hover:bg-[color-mix(in_srgb,#d8564a_12%,transparent)] hover:text-[#c6493e]',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      {children}
    </button>
  );
}

export function ItemCard({
  item,
  index,
  pending,
  onOpen,
  onTagClick,
  onPin,
  onPromote,
  onArchive,
  onDelete,
}: ItemCardProps) {
  const isBlink = item.type === 'blink';
  const preview = item.content.replace(/\s+/g, ' ').trim();

  return (
    <article
      className={cn(
        'group relative animate-rise overflow-hidden rounded-[22px] border bg-[var(--app-surface)]',
        'shadow-[0_1px_2px_rgba(28,24,16,0.03),0_10px_28px_-24px_rgba(28,24,16,0.35)]',
        'transition duration-300 hover:border-[color-mix(in_srgb,var(--app-text)_20%,transparent)]',
        item.isPinned
          ? 'border-[color-mix(in_srgb,var(--app-accent)_28%,var(--app-border))]'
          : 'border-[var(--app-border)]',
        pending && 'opacity-70',
      )}
      style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
    >
      {item.isPinned ? (
        <span className="absolute inset-y-4 left-0 w-[2px] rounded-r-full bg-[var(--app-accent)]" />
      ) : null}

      <button
        type="button"
        onClick={() => onOpen(item)}
        className="block w-full px-4 pb-2.5 pt-3.5 text-left outline-none focus-visible:bg-[var(--app-accent-soft)] sm:px-5 sm:pt-4"
        aria-label={isBlink ? 'Open blink' : `Open note: ${item.title ?? 'Untitled'}`}
      >
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-hint)]">
          <span className="inline-flex items-center gap-1">
            {isBlink ? (
              <Zap size={11} strokeWidth={2.2} className="text-[var(--app-accent)]" />
            ) : (
              <FileText size={11} strokeWidth={2} />
            )}
            {isBlink ? 'Blink' : 'Note'}
          </span>
          <span className="h-0.5 w-0.5 rounded-full bg-current opacity-40" />
          <time dateTime={new Date(item.updatedAt).toISOString()} title={fullTimestamp(item.updatedAt)}>
            {relativeTime(item.updatedAt)}
          </time>
          {item.isPinned ? (
            <span className="ml-auto inline-flex items-center gap-1 text-[var(--app-accent)]">
              <Pin size={10} strokeWidth={2.4} fill="currentColor" />
              Pinned
            </span>
          ) : null}
          {item.status === 'archived' ? (
            <span className={cn('text-[var(--app-hint)]', !item.isPinned && 'ml-auto')}>
              Archived
            </span>
          ) : null}
        </div>

        {!isBlink && item.title ? (
          <h2 className="mt-1.5 line-clamp-2 font-display text-[21px] leading-[1.25] tracking-[-0.02em] text-[var(--app-text)]">
            {item.title}
          </h2>
        ) : null}

        {preview ? (
          <p
            className={cn(
              'mt-1.5 whitespace-pre-line break-words text-[var(--app-text)]',
              isBlink
                ? 'line-clamp-5 text-[15.5px] leading-[1.6]'
                : 'line-clamp-2 text-[13.5px] leading-[1.55] text-[color-mix(in_srgb,var(--app-text)_70%,var(--app-hint))]',
            )}
          >
            {preview}
          </p>
        ) : null}
      </button>

      <div className="flex min-h-[42px] items-end justify-between gap-2 px-4 pb-2.5 sm:px-5">
        <div className="flex min-w-0 flex-wrap items-center gap-1 pt-1">
          {item.tags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => onTagClick(tag)}
              className="max-w-[160px] truncate rounded-full bg-[color-mix(in_srgb,var(--app-text)_5.5%,transparent)] px-2 py-[3px] text-[11px] font-medium text-[var(--app-hint)] transition hover:bg-[var(--app-accent-soft)] hover:text-[var(--app-accent)]"
              aria-label={`Filter by #${tag}`}
              title={`#${tag}`}
            >
              #{tag}
            </button>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {pending ? (
            <span className="flex h-8 w-8 items-center justify-center text-[var(--app-hint)]">
              <LoaderCircle size={14} className="animate-spin" />
            </span>
          ) : (
            <>
              <ActionButton
                label={item.isPinned ? 'Unpin' : 'Pin to top'}
                active={item.isPinned}
                onClick={() => onPin(item)}
              >
                {item.isPinned ? <PinOff size={15} /> : <Pin size={15} />}
              </ActionButton>
              {isBlink ? (
                <ActionButton label="Promote to Note" onClick={() => onPromote(item)}>
                  <ArrowUpRight size={15} />
                </ActionButton>
              ) : null}
              <ActionButton
                label={item.status === 'active' ? 'Archive' : 'Restore'}
                onClick={() => onArchive(item)}
              >
                {item.status === 'active' ? (
                  <Archive size={15} />
                ) : (
                  <ArchiveRestore size={15} />
                )}
              </ActionButton>
              <ActionButton label="Delete" danger onClick={() => onDelete(item)}>
                <Trash2 size={15} />
              </ActionButton>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
