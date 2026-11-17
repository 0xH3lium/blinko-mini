import { Archive, Inbox, Search, X } from 'lucide-react';
import type { ItemStatus } from '../types/item';
import { cn } from '../lib/utils';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  status: ItemStatus;
  onStatusChange: (status: ItemStatus) => void;
  placeholder: string;
}

export function SearchBar({
  value,
  onChange,
  status,
  onStatusChange,
  placeholder,
}: SearchBarProps) {
  const archived = status === 'archived';

  return (
    <div className="flex items-center gap-2">
      <label
        className={cn(
          'group flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-2xl border border-[var(--app-border)]',
          'bg-[color-mix(in_srgb,var(--app-surface)_82%,transparent)] px-3.5',
          'transition focus-within:border-[color-mix(in_srgb,var(--app-accent)_55%,var(--app-border))]',
          'focus-within:bg-[var(--app-surface)] focus-within:shadow-[0_0_0_3px_var(--app-accent-soft)]',
        )}
      >
        <Search
          size={17}
          strokeWidth={2}
          className="shrink-0 text-[var(--app-hint)] transition group-focus-within:text-[var(--app-accent)]"
        />
        <input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-label={placeholder}
          className="min-w-0 flex-1 appearance-none bg-transparent text-[15px] text-[var(--app-text)] outline-none placeholder:text-[var(--app-hint)] focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {value ? (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Clear search"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] transition hover:bg-[var(--app-accent-soft)] hover:text-[var(--app-text)]"
          >
            <X size={14} />
          </button>
        ) : null}
      </label>

      <button
        type="button"
        onClick={() => onStatusChange(archived ? 'active' : 'archived')}
        aria-pressed={archived}
        title={archived ? 'Show active items' : 'Show archived items'}
        className={cn(
          'flex h-11 shrink-0 items-center gap-1.5 rounded-2xl border px-3 text-[11px] font-semibold tracking-[0.04em] transition',
          archived
            ? 'border-[color-mix(in_srgb,var(--app-accent)_45%,transparent)] bg-[var(--app-accent-soft)] text-[var(--app-accent)]'
            : 'border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-surface)_82%,transparent)] text-[var(--app-hint)] hover:text-[var(--app-text)]',
        )}
      >
        {archived ? <Archive size={14} /> : <Inbox size={14} />}
        <span>{archived ? 'Archived' : 'Active'}</span>
      </button>
    </div>
  );
}
