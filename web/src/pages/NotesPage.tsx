import { useMemo, useState } from 'react';
import {
  BookOpen,
  Plus,
  RefreshCw,
  SearchX,
  Sparkles,
  Archive as ArchiveIcon,
} from 'lucide-react';
import { Brand } from '../components/Brand';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { FeedSkeleton, PageLoadingLine } from '../components/FeedSkeleton';
import { ItemCard } from '../components/ItemCard';
import { SearchBar } from '../components/SearchBar';
import { TagBar } from '../components/TagBar';
import { useCollection } from '../hooks/useCollection';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useItemActions } from '../hooks/useItemActions';
import { haptic } from '../lib/telegram';
import { cn, plural } from '../lib/utils';
import type { Item, ItemStatus } from '../types/item';
import type { Notify } from '../types/ui';

interface NotesPageProps {
  notify: Notify;
  onOpenEditor: (item: Item) => void;
  onNewNote: () => void;
  refreshKey: number;
}

export function NotesPage({
  notify,
  onOpenEditor,
  onNewNote,
  refreshKey,
}: NotesPageProps) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ItemStatus>('active');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search, 250);

  const collection = useCollection({
    type: 'note',
    status,
    tag: selectedTag,
    q: debouncedSearch,
    refreshKey,
  });
  const actions = useItemActions({ notify, onChanged: collection.refresh });

  const hasFilters = Boolean(search || selectedTag || status !== 'active');
  const today = useMemo(
    () =>
      new Date().toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }),
    [],
  );

  function clearFilters(): void {
    setSearch('');
    setSelectedTag(null);
    setStatus('active');
  }

  return (
    <div className="pb-8">
      <header className="px-5 pt-[calc(18px+env(safe-area-inset-top))]">
        <div className="flex items-center justify-between">
          <Brand />
          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--app-hint)]">
            {today}
          </span>
        </div>

        <div className="relative mt-8 flex items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.2em] text-[var(--app-hint)]">
              <span className="h-1 w-1 rounded-full bg-[var(--app-accent)]" />
              Library
              <span className="opacity-50">·</span>
              {plural(collection.total, 'note')}
            </p>
            <h1 className="mt-1.5 font-display text-[46px] leading-[0.95] tracking-[-0.045em] text-[var(--app-text)]">
              Notes<span className="text-[var(--app-accent)]">.</span>
            </h1>
            <p className="mt-2.5 max-w-[280px] text-[12.5px] leading-relaxed text-[var(--app-hint)]">
              Ideas with a little more room to grow.
            </p>
          </div>

          <div className="mb-1 flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                haptic('light');
                collection.refresh();
              }}
              disabled={collection.loading}
              aria-label="Refresh notes"
              title="Refresh"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-surface)_75%,transparent)] text-[var(--app-hint)] transition hover:text-[var(--app-text)] disabled:opacity-50"
            >
              <RefreshCw
                size={14}
                className={cn(collection.loading && 'animate-spin')}
              />
            </button>
            <button
              type="button"
              onClick={() => {
                haptic('medium');
                onNewNote();
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--app-text)] px-3.5 text-[11.5px] font-semibold text-[var(--app-bg)] transition hover:opacity-85 active:scale-[0.98]"
            >
              <Plus size={14} strokeWidth={2.5} />
              New
            </button>
          </div>
        </div>
      </header>

      <div className="mt-6 space-y-3 px-5">
        <SearchBar
          value={search}
          onChange={setSearch}
          status={status}
          onStatusChange={(next) => {
            haptic('light');
            setStatus(next);
          }}
          placeholder="Search your notes"
        />
        <TagBar tags={collection.tags} selected={selectedTag} onSelect={setSelectedTag} />
        <PageLoadingLine visible={collection.loading && collection.items.length > 0} />
      </div>

      <main className="px-5">
        <div className="mb-2.5 mt-4 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-hint)]">
            {search || selectedTag
              ? `${plural(collection.total, 'match', 'matches')}`
              : status === 'archived'
                ? 'Archived'
                : 'Recently tended'}
          </span>
          <span className="text-[10px] text-[var(--app-hint)] opacity-60">
            {collection.loading && collection.items.length === 0
              ? 'Loading'
              : `${collection.items.length} shown`}
          </span>
        </div>

        {collection.error ? (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-[color-mix(in_srgb,#c6493e_25%,var(--app-border))] bg-[color-mix(in_srgb,#c6493e_6%,var(--app-surface))] px-3.5 py-3">
            <p className="text-[12px] leading-snug text-[var(--app-text)]">
              {collection.error}
            </p>
            <button
              type="button"
              onClick={collection.refresh}
              className="shrink-0 text-[11px] font-semibold underline decoration-[var(--app-hint)] underline-offset-2"
            >
              Retry
            </button>
          </div>
        ) : null}

        {collection.loading && collection.items.length === 0 ? (
          <FeedSkeleton />
        ) : collection.items.length === 0 ? (
          hasFilters ? (
            <EmptyState
              icon={SearchX}
              eyebrow="No matches"
              title="Nothing in this light."
              description="No notes fit those words and filters. Try a broader search."
              actionLabel="Clear filters"
              onAction={clearFilters}
            />
          ) : status === 'archived' ? (
            <EmptyState
              icon={ArchiveIcon}
              eyebrow="Archive"
              title="No notes set aside."
              description="When a note has served its purpose, archive it here without losing the thought."
              actionLabel="Back to active"
              onAction={() => setStatus('active')}
            />
          ) : (
            <EmptyState
              icon={BookOpen}
              eyebrow="A blank shelf"
              title="Give an idea room."
              description="Promote a blink when a thought needs structure, or begin with a fresh page."
              actionLabel="Start a note"
              onAction={onNewNote}
            />
          )
        ) : (
          <div className="space-y-3">
            {collection.items.map((item, index) => (
              <ItemCard
                key={item.id}
                item={item}
                index={index}
                pending={actions.pendingId === item.id}
                onOpen={onOpenEditor}
                onTagClick={setSelectedTag}
                onPin={actions.togglePin}
                onPromote={actions.promote}
                onArchive={actions.toggleArchive}
                onDelete={actions.requestDelete}
              />
            ))}

            {collection.hasMore ? (
              <button
                type="button"
                onClick={() => void collection.loadMore()}
                disabled={collection.loadingMore}
                className="mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--app-border)] text-[12px] font-medium text-[var(--app-hint)] transition hover:border-[color-mix(in_srgb,var(--app-text)_25%,transparent)] hover:text-[var(--app-text)] disabled:opacity-50"
              >
                {collection.loadingMore ? (
                  <RefreshCw size={13} className="animate-spin" />
                ) : (
                  <BookOpen size={13} />
                )}
                {collection.loadingMore ? 'Loading' : 'Load older notes'}
              </button>
            ) : collection.items.length > 4 ? (
              <p className="flex items-center justify-center gap-1.5 py-5 text-[10px] uppercase tracking-[0.14em] text-[var(--app-hint)] opacity-55">
                <Sparkles size={10} /> All notes in view
              </p>
            ) : null}
          </div>
        )}
      </main>

      <ConfirmDialog
        open={Boolean(actions.deleteTarget)}
        title="Let this note go?"
        description="The note and everything in it will be permanently deleted. This cannot be undone."
        confirmLabel="Delete note"
        danger
        busy={actions.deleting}
        onCancel={actions.cancelDelete}
        onConfirm={() => void actions.confirmDelete()}
      />
    </div>
  );
}
