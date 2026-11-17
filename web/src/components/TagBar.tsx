import { Hash } from 'lucide-react';
import type { TagCount } from '../types/item';
import { cn } from '../lib/utils';

interface TagBarProps {
  tags: TagCount[];
  selected: string | null;
  onSelect: (tag: string | null) => void;
}

export function TagBar({ tags, selected, onSelect }: TagBarProps) {
  if (tags.length === 0) return null;

  return (
    <div
      role="group"
      aria-label="Filter by tag"
      className="tag-scroller no-scrollbar -mx-5 flex gap-1.5 overflow-x-auto px-5 py-0.5"
    >
      <button
        type="button"
        onClick={() => onSelect(null)}
        aria-pressed={selected === null}
        className={cn(
          'shrink-0 rounded-full border px-3 py-1.5 text-[12px] font-medium transition',
          selected === null
            ? 'border-transparent bg-[var(--app-text)] text-[var(--app-bg)]'
            : 'border-[var(--app-border)] text-[var(--app-hint)] hover:border-[color-mix(in_srgb,var(--app-text)_24%,transparent)] hover:text-[var(--app-text)]',
        )}
      >
        All
      </button>

      {tags.map((tag) => {
        const active = selected === tag.name;
        return (
          <button
            key={tag.name}
            type="button"
            onClick={() => onSelect(active ? null : tag.name)}
            aria-pressed={active}
            className={cn(
              'inline-flex shrink-0 items-center gap-0.5 rounded-full border py-1.5 pl-2.5 pr-2 text-[12px] font-medium transition',
              active
                ? 'border-transparent bg-[var(--app-accent)] text-[var(--app-accent-text)]'
                : 'border-[var(--app-border)] text-[var(--app-hint)] hover:border-[color-mix(in_srgb,var(--app-text)_24%,transparent)] hover:text-[var(--app-text)]',
            )}
          >
            <Hash size={11} strokeWidth={2.4} className="opacity-60" />
            <span>{tag.name}</span>
            <span
              className={cn(
                'ml-0.5 rounded-full px-1 text-[10px] tabular-nums',
                active ? 'opacity-70' : 'opacity-45',
              )}
            >
              {tag.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
