import { useCallback, useEffect, useRef, useState } from 'react';
import { getItems, getTags } from '../api/client';
import type { Item, ItemStatus, ItemType, TagCount } from '../types/item';

interface CollectionOptions {
  type: ItemType;
  status: ItemStatus;
  tag: string | null;
  q: string;
  refreshKey: number;
}

interface CollectionResult {
  items: Item[];
  tags: TagCount[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  refresh: () => void;
  loadMore: () => Promise<void>;
}

export function useCollection({
  type,
  status,
  tag,
  q,
  refreshKey,
}: CollectionOptions): CollectionResult {
  const [items, setItems] = useState<Item[]>([]);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const itemsRef = useRef<Item[]>([]);

  itemsRef.current = items;

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);

    getItems(
      {
        type,
        status,
        tag: tag ?? undefined,
        q: q.trim() || undefined,
        limit: 50,
        offset: 0,
      },
      controller.signal,
    )
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setTotal(page.total);
      })
      .catch((reason: unknown) => {
        if (!active || (reason instanceof DOMException && reason.name === 'AbortError')) {
          return;
        }
        setError(reason instanceof Error ? reason.message : 'Could not load items.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [type, status, tag, q, refreshKey, nonce]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    getTags({ type, status }, controller.signal)
      .then((next) => {
        if (active) setTags(next);
      })
      .catch(() => {
        // Tag counts are ancillary; the feed should still work if they fail.
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [type, status, refreshKey, nonce]);

  const loadMore = useCallback(async () => {
    if (loadingMore || itemsRef.current.length >= total) return;
    setLoadingMore(true);
    try {
      const page = await getItems({
        type,
        status,
        tag: tag ?? undefined,
        q: q.trim() || undefined,
        limit: 50,
        offset: itemsRef.current.length,
      });
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !seen.has(item.id))];
      });
      setTotal(page.total);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load more items.');
    } finally {
      setLoadingMore(false);
    }
  }, [type, status, tag, q, total, loadingMore]);

  return {
    items,
    tags,
    total,
    loading,
    loadingMore,
    error,
    hasMore: items.length < total,
    refresh,
    loadMore,
  };
}
