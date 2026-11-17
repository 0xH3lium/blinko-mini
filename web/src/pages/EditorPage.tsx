import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowUpRight,
  Check,
  Hash,
  LoaderCircle,
  Pin,
  PinOff,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { createItem, deleteItem, updateItem } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { WebApp, haptic } from '../lib/telegram';
import {
  cn,
  extractHashtags,
  firstLineTitle,
  fullTimestamp,
  normalizeTag,
  plural,
} from '../lib/utils';
import type { Item, ItemStatus, ItemType } from '../types/item';
import type { Notify } from '../types/ui';

interface EditorPageProps {
  item: Item | null;
  initialType?: ItemType;
  notify: Notify;
  onClose: () => void;
  onSaved: (item: Item, options?: { keepOpen?: boolean }) => void;
  onDeleted: () => void;
}

interface Snapshot {
  type: ItemType;
  title: string;
  content: string;
  tags: string[];
}

function serializeSnapshot(snapshot: Snapshot): string {
  return JSON.stringify({
    ...snapshot,
    tags: [...snapshot.tags].sort(),
  });
}

export function EditorPage({
  item,
  initialType = 'note',
  notify,
  onClose,
  onSaved,
  onDeleted,
}: EditorPageProps) {
  const initialContent = item?.content ?? '';
  const initialInlineTags = extractHashtags(initialContent);
  const [persistedId, setPersistedId] = useState<string | null>(item?.id ?? null);
  const [type, setType] = useState<ItemType>(item?.type ?? initialType);
  const [title, setTitle] = useState(item?.title ?? '');
  const [content, setContent] = useState(initialContent);
  const [manualTags, setManualTags] = useState<string[]>(
    (item?.tags ?? []).filter((tag) => !initialInlineTags.includes(tag)),
  );
  const [tagInput, setTagInput] = useState('');
  const [tagError, setTagError] = useState(false);
  const [status, setStatus] = useState<ItemStatus>(item?.status ?? 'active');
  const [isPinned, setIsPinned] = useState(item?.isPinned ?? false);
  const [saving, setSaving] = useState(false);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [createdAt] = useState(item?.createdAt ?? Date.now());
  const [updatedAt, setUpdatedAt] = useState(item?.updatedAt ?? Date.now());
  const [baseline, setBaseline] = useState(() =>
    serializeSnapshot({
      type: item?.type ?? initialType,
      title: item?.title ?? '',
      content: initialContent,
      tags: item?.tags ?? [],
    }),
  );

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const requestCloseRef = useRef<() => void>(() => {});
  const isNew = persistedId === null;
  const inlineTags = useMemo(() => extractHashtags(content), [content]);
  const allTags = useMemo(
    () => [...new Set([...inlineTags, ...manualTags])],
    [inlineTags, manualTags],
  );
  const currentSnapshot = useMemo(
    () =>
      serializeSnapshot({
        type,
        title,
        content,
        tags: allTags,
      }),
    [type, title, content, allTags],
  );
  const dirty = currentSnapshot !== baseline;
  const canSave = dirty && content.trim().length > 0 && !saving && !actionPending;
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;

  // Grow editors with their content.
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.max(el.scrollHeight, 280)}px`;
  }, [content]);

  // New notes start with the caret in the body.
  useEffect(() => {
    if (!isNew) return;
    const timer = window.setTimeout(() => contentRef.current?.focus(), 120);
    return () => window.clearTimeout(timer);
  }, [isNew]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // Telegram's native back button is the primary exit affordance inside TMA.
  useEffect(() => {
    try {
      WebApp.BackButton.show();
      const handler = () => requestCloseRef.current();
      WebApp.BackButton.onClick(handler);
      return () => {
        WebApp.BackButton.offClick(handler);
        WebApp.BackButton.hide();
      };
    } catch {
      return undefined;
    }
  }, []);

  function requestClose(): void {
    if (saving || actionPending) return;
    if (dirty) setCloseOpen(true);
    else onClose();
  }

  requestCloseRef.current = requestClose;

  function addTag(raw: string): void {
    const normalized = normalizeTag(raw);
    if (!normalized) {
      setTagError(true);
      return;
    }
    setManualTags((current) =>
      current.includes(normalized) ? current : [...current, normalized],
    );
    setTagInput('');
    setTagError(false);
  }

  async function handleSave(): Promise<void> {
    if (!canSave) return;
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      notify('Write something first.', 'error');
      return;
    }

    const wasNew = isNew;
    setSaving(true);
    try {
      const contentPayload = {
        type,
        title: title.trim() || null,
        content: trimmedContent,
        tags: allTags,
      };
      const saved = persistedId
        ? await updateItem(persistedId, { ...contentPayload, status, isPinned })
        : await createItem(contentPayload);

      setPersistedId(saved.id);
      setContent(saved.content);
      setTitle(saved.title ?? '');
      setManualTags(
        saved.tags.filter((tag) => !extractHashtags(saved.content).includes(tag)),
      );
      setUpdatedAt(saved.updatedAt);
      setBaseline(
        serializeSnapshot({
          type: saved.type,
          title: saved.title ?? '',
          content: saved.content,
          tags: saved.tags,
        }),
      );
      haptic('success');
      notify(wasNew ? 'Note created' : 'Saved', 'success');
      onSaved(saved);
    } catch (error) {
      haptic('error');
      notify(error instanceof Error ? error.message : 'Could not save.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function patchMeta(
    action: 'pin' | 'archive',
    update: { isPinned?: boolean; status?: ItemStatus },
  ): Promise<void> {
    if (!persistedId || actionPending) return;
    setActionPending(action);
    try {
      const saved = await updateItem(persistedId, update);
      if (action === 'pin') setIsPinned(saved.isPinned);
      else setStatus(saved.status);
      setUpdatedAt(saved.updatedAt);
      haptic('light');
      notify(action === 'pin' ? (saved.isPinned ? 'Pinned' : 'Unpinned') : saved.status === 'archived' ? 'Archived' : 'Restored', 'success');
      onSaved(saved, { keepOpen: true });
    } catch (error) {
      haptic('error');
      notify(error instanceof Error ? error.message : 'That action failed.', 'error');
    } finally {
      setActionPending(null);
    }
  }

  async function handlePromote(): Promise<void> {
    if (!persistedId || type === 'note' || actionPending || saving) return;
    if (!content.trim()) {
      notify('Write something first.', 'error');
      return;
    }

    const promotedTitle = title.trim() || firstLineTitle(content);
    setActionPending('promote');
    setType('note');
    setTitle(promotedTitle);
    try {
      const saved = await updateItem(persistedId, {
        type: 'note',
        title: promotedTitle,
        content: content.trim(),
        tags: allTags,
        status,
        isPinned,
      });
      setContent(saved.content);
      setTitle(saved.title ?? '');
      setUpdatedAt(saved.updatedAt);
      setBaseline(
        serializeSnapshot({
          type: saved.type,
          title: saved.title ?? '',
          content: saved.content,
          tags: saved.tags,
        }),
      );
      haptic('success');
      notify('Promoted to a Note', 'success');
      onSaved(saved, { keepOpen: true });
      requestAnimationFrame(() => {
        titleRef.current?.focus();
        titleRef.current?.setSelectionRange(0, titleRef.current.value.length);
      });
    } catch (error) {
      haptic('error');
      setType('blink');
      notify(error instanceof Error ? error.message : 'Could not promote.', 'error');
    } finally {
      setActionPending(null);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!persistedId || deleting) return;
    setDeleting(true);
    try {
      await deleteItem(persistedId);
      haptic('warning');
      notify('Deleted forever', 'success');
      setDeleteOpen(false);
      onDeleted();
    } catch (error) {
      haptic('error');
      notify(error instanceof Error ? error.message : 'Could not delete.', 'error');
    } finally {
      setDeleting(false);
    }
  }

  const typeLabel = type === 'blink' ? 'Blink' : 'Note';

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-[var(--app-bg)] animate-fade"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          void handleSave();
        }
      }}
    >
      <div className="relative flex h-full w-full max-w-[760px] flex-col overflow-hidden bg-[var(--app-bg)] shadow-[0_0_80px_rgba(0,0,0,0.12)]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-[radial-gradient(ellipse_at_top,var(--app-accent-soft),transparent_68%)] opacity-60" />

        <header className="relative z-10 flex h-[calc(58px+env(safe-area-inset-top))] shrink-0 items-center gap-2 border-b border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-bg)_86%,transparent)] px-4 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close editor"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--app-text)] transition hover:bg-[var(--app-accent-soft)] active:scale-95"
          >
            <ArrowLeft size={19} />
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold text-[var(--app-text)]">
              {isNew ? 'New note' : `Editing ${typeLabel.toLowerCase()}`}
            </p>
            <p className="mt-0.5 flex items-center gap-1 text-[9.5px] uppercase tracking-[0.12em] text-[var(--app-hint)]">
              {dirty ? (
                <>
                  <span className="h-1 w-1 rounded-full bg-[var(--app-accent)]" />
                  Unsaved changes
                </>
              ) : isNew ? (
                'Markdown friendly'
              ) : (
                <>
                  <Check size={9} /> Up to date
                </>
              )}
            </p>
          </div>

          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave}
            className={cn(
              'flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-[11.5px] font-semibold transition-all',
              canSave
                ? 'bg-[var(--app-accent)] text-[var(--app-accent-text)] shadow-[0_5px_18px_-7px_var(--app-accent)] hover:scale-[1.02] active:scale-95'
                : 'bg-[color-mix(in_srgb,var(--app-text)_8%,transparent)] text-[var(--app-hint)]',
            )}
          >
            {saving ? <LoaderCircle size={13} className="animate-spin" /> : null}
            Save
          </button>
        </header>

        <main className="relative z-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="mx-auto w-full max-w-[680px] px-5 pb-8 pt-6 sm:px-8">
            <div className="flex items-center justify-between gap-3">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-[0.14em]',
                  type === 'blink'
                    ? 'border-[var(--app-border)] text-[var(--app-hint)]'
                    : 'border-[color-mix(in_srgb,var(--app-accent)_28%,transparent)] bg-[var(--app-accent-soft)] text-[var(--app-accent)]',
                )}
              >
                {type === 'blink' ? 'Blink' : 'Note'}
                {status === 'archived' ? ' · archived' : ''}
              </span>
              <span className="text-[10px] text-[var(--app-hint)] opacity-70">
                {isNew ? 'Draft' : fullTimestamp(updatedAt)}
              </span>
            </div>

            <textarea
              ref={titleRef}
              rows={1}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={
                type === 'blink' ? 'Add a title to promote…' : 'A title, if it needs one'
              }
              aria-label="Title"
              maxLength={300}
              className="mt-6 block w-full resize-none overflow-hidden bg-transparent font-display text-[34px] font-normal leading-[1.12] tracking-[-0.035em] text-[var(--app-text)] outline-none placeholder:text-[color-mix(in_srgb,var(--app-hint)_55%,transparent)] focus-visible:outline-none sm:text-[39px]"
            />

            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-[var(--app-border)]" />
              <span className="font-display text-[11px] italic text-[var(--app-hint)]">
                {type === 'blink' ? 'a caught thought' : 'room to think'}
              </span>
              <span className="h-px w-8 bg-[var(--app-border)]" />
            </div>

            <textarea
              ref={contentRef}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder={
                isNew
                  ? 'Start writing. Follow a thread, shape a thought…\n\nMarkdown is welcome. Type #tags anywhere.'
                  : 'Write something worth keeping…'
              }
              aria-label="Content"
              maxLength={100_000}
              className="block min-h-[280px] w-full resize-none overflow-hidden bg-transparent text-[16px] leading-[1.72] text-[var(--app-text)] outline-none placeholder:text-[color-mix(in_srgb,var(--app-hint)_58%,transparent)] focus-visible:outline-none sm:text-[16.5px]"
            />

            <section className="mt-5 rounded-[20px] border border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-surface)_68%,transparent)] p-3.5">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-[var(--app-hint)]">
                  <Hash size={11} /> Tags
                </h2>
                <span className="text-[9.5px] text-[var(--app-hint)] opacity-60">
                  {allTags.length ? plural(allTags.length, 'tag') : 'none yet'}
                </span>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {inlineTags.map((tag) => (
                  <span
                    key={`inline-${tag}`}
                    className="inline-flex items-center gap-0.5 rounded-full bg-[var(--app-accent-soft)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--app-accent)]"
                    title="Detected in your text"
                  >
                    #{tag}
                  </span>
                ))}
                {manualTags.map((tag) => (
                  <span
                    key={`manual-${tag}`}
                    className="inline-flex items-center gap-1 rounded-full border border-[var(--app-border)] py-1 pl-2.5 pr-1.5 text-[11.5px] font-medium text-[var(--app-text)]"
                  >
                    #{tag}
                    <button
                      type="button"
                      aria-label={`Remove tag ${tag}`}
                      onClick={() =>
                        setManualTags((current) => current.filter((value) => value !== tag))
                      }
                      className="flex h-4 w-4 items-center justify-center rounded-full text-[var(--app-hint)] transition hover:bg-[color-mix(in_srgb,var(--app-text)_10%,transparent)] hover:text-[var(--app-text)]"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}

                <label
                  className={cn(
                    'inline-flex h-7 min-w-[128px] flex-1 items-center gap-1 rounded-full border px-2.5 transition',
                    tagError
                      ? 'border-[#c6493e]'
                      : 'border-dashed border-[var(--app-border)] focus-within:border-[var(--app-accent)]',
                  )}
                >
                  <Plus size={11} className="shrink-0 text-[var(--app-hint)]" />
                  <input
                    value={tagInput}
                    onChange={(event) => {
                      setTagInput(event.target.value);
                      setTagError(false);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ',') {
                        event.preventDefault();
                        addTag(tagInput);
                      } else if (event.key === 'Backspace' && !tagInput && manualTags.length) {
                        setManualTags((current) => current.slice(0, -1));
                      }
                    }}
                    onBlur={() => {
                      if (tagInput.trim()) addTag(tagInput);
                    }}
                    placeholder="Add a tag"
                    aria-label="Add a tag"
                    maxLength={51}
                    className="min-w-0 flex-1 bg-transparent text-[11.5px] text-[var(--app-text)] outline-none placeholder:text-[var(--app-hint)] focus-visible:outline-none"
                  />
                </label>
              </div>

              {tagError ? (
                <p className="mt-2 text-[10px] text-[#c6493e]">
                  Tags use letters, numbers, dashes, or underscores.
                </p>
              ) : (
                <p className="mt-2 text-[9.5px] leading-relaxed text-[var(--app-hint)] opacity-60">
                  Inline #tags appear here automatically. Add extras for cross-cutting themes.
                </p>
              )}
            </section>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--app-border)] pt-3 text-[9.5px] uppercase tracking-[0.12em] text-[var(--app-hint)]">
              <span>{plural(wordCount, 'word')}</span>
              <span className="flex items-center gap-3">
                <span>Created {fullTimestamp(createdAt)}</span>
                <span className="h-0.5 w-0.5 rounded-full bg-current opacity-50" />
                <span>{status === 'archived' ? 'Archived' : 'Active'}</span>
              </span>
            </div>
          </div>
        </main>

        <footer className="relative z-10 shrink-0 border-t border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-bg)_92%,transparent)] px-4 pb-[max(10px,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur-xl">
          {persistedId ? (
            <div className="mx-auto flex w-full max-w-[680px] items-center gap-1.5 sm:px-4">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={isPinned ? 'Unpin' : 'Pin'}
                  onClick={() => void patchMeta('pin', { isPinned: !isPinned })}
                  disabled={Boolean(actionPending)}
                  className={cn(
                    'flex h-9 items-center gap-1.5 rounded-full border px-2.5 text-[10.5px] font-medium transition disabled:opacity-45',
                    isPinned
                      ? 'border-[color-mix(in_srgb,var(--app-accent)_28%,transparent)] bg-[var(--app-accent-soft)] text-[var(--app-accent)]'
                      : 'border-[var(--app-border)] text-[var(--app-hint)] hover:text-[var(--app-text)]',
                  )}
                >
                  {actionPending === 'pin' ? (
                    <LoaderCircle size={12} className="animate-spin" />
                  ) : isPinned ? (
                    <PinOff size={12} />
                  ) : (
                    <Pin size={12} />
                  )}
                  <span className="hidden xs:inline">{isPinned ? 'Unpin' : 'Pin'}</span>
                </button>

                <button
                  type="button"
                  aria-label={status === 'active' ? 'Archive' : 'Restore'}
                  onClick={() => void patchMeta('archive', { status: status === 'active' ? 'archived' : 'active' })}
                  disabled={Boolean(actionPending)}
                  className="flex h-9 items-center gap-1.5 rounded-full border border-[var(--app-border)] px-2.5 text-[10.5px] font-medium text-[var(--app-hint)] transition hover:text-[var(--app-text)] disabled:opacity-45"
                >
                  {actionPending === 'archive' ? (
                    <LoaderCircle size={12} className="animate-spin" />
                  ) : status === 'active' ? (
                    <Archive size={12} />
                  ) : (
                    <ArchiveRestore size={12} />
                  )}
                  <span className="hidden xs:inline">
                    {status === 'active' ? 'Archive' : 'Restore'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setDeleteOpen(true)}
                  disabled={Boolean(actionPending)}
                  aria-label="Delete"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-transparent text-[var(--app-hint)] transition hover:border-[color-mix(in_srgb,#c6493e_25%,transparent)] hover:bg-[color-mix(in_srgb,#c6493e_8%,transparent)] hover:text-[#c6493e] disabled:opacity-45"
                >
                  <Trash2 size={13} />
                </button>
              </div>

              <div className="ml-auto">
                {type === 'blink' ? (
                  <button
                    type="button"
                    onClick={() => void handlePromote()}
                    disabled={Boolean(actionPending) || saving}
                    className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--app-text)] px-3.5 text-[10.5px] font-semibold text-[var(--app-bg)] transition hover:opacity-85 active:scale-[0.98] disabled:opacity-45"
                  >
                    {actionPending === 'promote' ? (
                      <LoaderCircle size={12} className="animate-spin" />
                    ) : (
                      <ArrowUpRight size={13} />
                    )}
                    Promote to Note
                  </button>
                ) : (
                  <span className="flex h-9 items-center gap-1.5 px-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--app-hint)]">
                    <Check size={12} className="text-[var(--app-accent)]" />
                    {typeLabel}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="mx-auto flex h-9 w-full max-w-[680px] items-center justify-between px-1 text-[10px] text-[var(--app-hint)] sm:px-4">
              <span className="flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-[var(--app-accent)]" />
                Draft · not saved yet
              </span>
              <span className="hidden sm:inline">⌘ / Ctrl + Enter to save</span>
            </div>
          )}
        </footer>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title={`Delete this ${typeLabel.toLowerCase()}?`}
        description="This is permanent. The text and its tags will be removed from your archive."
        confirmLabel={`Delete ${typeLabel.toLowerCase()}`}
        danger
        busy={deleting}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => void confirmDelete()}
      />
      <ConfirmDialog
        open={closeOpen}
        title="Discard unsaved changes?"
        description={
          isNew
            ? 'This draft has not been saved yet. Closing the editor will discard it.'
            : 'Your edits since the last save will be lost. The original item will stay untouched.'
        }
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        danger
        onCancel={() => setCloseOpen(false)}
        onConfirm={() => {
          setCloseOpen(false);
          onClose();
        }}
      />
    </div>
  );
}
