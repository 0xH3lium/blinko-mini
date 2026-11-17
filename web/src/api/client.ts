import { getInitData } from '../lib/telegram';
import type {
  CreateItemInput,
  Item,
  ItemFilters,
  ItemPage,
  TagCount,
  TagResponse,
  UpdateItemInput,
} from '../types/item';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const initData = getInitData();
  if (initData) headers.set('X-Telegram-Init-Data', initData);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers,
      cache: 'no-store',
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('Could not reach the server. Check your connection.', 0);
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      // Keep the status-based fallback.
    }
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}

export async function getItems(
  filters: ItemFilters = {},
  signal?: AbortSignal,
): Promise<ItemPage> {
  return request<ItemPage>(
    `/api/items${buildQuery({
      type: filters.type,
      status: filters.status,
      tag: filters.tag,
      q: filters.q,
      limit: filters.limit,
      offset: filters.offset,
    })}`,
    { signal },
  );
}

export async function getItem(id: string, signal?: AbortSignal): Promise<Item> {
  return request<Item>(`/api/items/${encodeURIComponent(id)}`, { signal });
}

export async function createItem(input: CreateItemInput): Promise<Item> {
  return request<Item>('/api/items', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateItem(id: string, input: UpdateItemInput): Promise<Item> {
  return request<Item>(`/api/items/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteItem(id: string): Promise<{ deleted: boolean; id: string }> {
  return request<{ deleted: boolean; id: string }>(
    `/api/items/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
}

export async function getTags(
  options: { type?: 'blink' | 'note'; status?: 'active' | 'archived' } = {},
  signal?: AbortSignal,
): Promise<TagCount[]> {
  const response = await request<TagResponse>(
    `/api/tags${buildQuery({ type: options.type, status: options.status })}`,
    { signal },
  );
  return response.tags;
}
