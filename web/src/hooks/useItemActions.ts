import { useCallback, useState } from 'react';
import { deleteItem, updateItem } from '../api/client';
import { haptic } from '../lib/telegram';
import type { Item } from '../types/item';
import type { Notify } from '../types/ui';

interface Options {
  notify: Notify;
  onChanged: () => void;
}

export function useItemActions({ notify, onChanged }: Options) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Item | null>(null);
  const [deleting, setDeleting] = useState(false);

  const patch = useCallback(
    async (
      item: Item,
      update: Parameters<typeof updateItem>[1],
      successMessage: string,
    ) => {
      if (pendingId) return;
      setPendingId(item.id);
      try {
        await updateItem(item.id, update);
        haptic('light');
        notify(successMessage, 'success');
        onChanged();
      } catch (error) {
        haptic('error');
        notify(error instanceof Error ? error.message : 'That action failed.', 'error');
      } finally {
        setPendingId(null);
      }
    },
    [notify, onChanged, pendingId],
  );

  const togglePin = useCallback(
    (item: Item) =>
      patch(
        item,
        { isPinned: !item.isPinned },
        item.isPinned ? 'Unpinned' : 'Pinned to the top',
      ),
    [patch],
  );

  const toggleArchive = useCallback(
    (item: Item) =>
      patch(
        item,
        { status: item.status === 'active' ? 'archived' : 'active' },
        item.status === 'active' ? 'Archived' : 'Restored to active',
      ),
    [patch],
  );

  const promote = useCallback(
    (item: Item) =>
      patch(
        item,
        { type: 'note', title: item.title },
        'Promoted to a Note',
      ),
    [patch],
  );

  const requestDelete = useCallback((item: Item) => {
    setDeleteTarget(item);
  }, []);

  const cancelDelete = useCallback(() => {
    if (!deleting) setDeleteTarget(null);
  }, [deleting]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await deleteItem(deleteTarget.id);
      haptic('warning');
      notify('Deleted forever', 'success');
      setDeleteTarget(null);
      onChanged();
    } catch (error) {
      haptic('error');
      notify(error instanceof Error ? error.message : 'Could not delete that item.', 'error');
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, deleting, notify, onChanged]);

  return {
    pendingId,
    togglePin,
    toggleArchive,
    promote,
    requestDelete,
    deleteTarget,
    cancelDelete,
    confirmDelete,
    deleting,
  };
}
