import type {
  Agenda, Capture, CaptureDetail, CapturePage, CapturePatch, CaptureResult, BulkAction,
  Head, JevResult, ManualCaptureInput, Review, SavedView, Telemetry,
} from '../types/capture';

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...init, headers, cache: 'no-store' });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) message = payload.error;
    } catch { /* keep fallback */ }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : '';
}

export async function getMe(): Promise<{ authenticated: boolean }> {
  return request('/auth/me');
}

export async function loginWithCode(code: string): Promise<{ authenticated: boolean }> {
  return request('/auth/code', { method: 'POST', body: JSON.stringify({ code }) });
}

export async function logout(): Promise<void> {
  await request('/auth/logout', { method: 'POST' });
}

export async function getCaptures(filters: {
  q?: string; bucket?: string; status?: string; tag?: string; sort?: string; order?: string;
  limit?: number; offset?: number;
} = {}): Promise<CapturePage> {
  return request(`/api/captures${query({
    q: filters.q, bucket: filters.bucket, status: filters.status ?? 'active', tag: filters.tag,
    sort: filters.sort, order: filters.order, limit: filters.limit ?? 200, offset: filters.offset,
  })}`);
}

export async function getCapture(id: string): Promise<CaptureDetail> {
  return request(`/api/captures/${encodeURIComponent(id)}`);
}

export async function createAutoCapture(content: string, skipUrlFetch = false): Promise<CaptureResult> {
  return request('/api/captures', { method: 'POST', body: JSON.stringify({ mode: 'auto', content, skipUrlFetch }) });
}

export async function createManualCapture(input: ManualCaptureInput): Promise<CaptureResult> {
  return request('/api/captures', { method: 'POST', body: JSON.stringify({ mode: 'manual', ...input }) });
}

export async function bulkAction(ids: string[], action: BulkAction): Promise<{ affected: number }> {
  return request('/api/captures/bulk', { method: 'POST', body: JSON.stringify({ ids, action }) });
}

export async function updateCapture(id: string, patch: CapturePatch): Promise<Capture> {
  return request(`/api/captures/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export async function deleteCapture(id: string): Promise<{ deleted: boolean }> {
  return request(`/api/captures/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function overrideDecision(id: string, headId: string, valueText?: string, valueNum?: number): Promise<Capture> {
  return request(`/api/captures/${encodeURIComponent(id)}/override`, {
    method: 'POST', body: JSON.stringify({ headId, valueText, valueNum }),
  });
}

export async function clearDecision(id: string, headId: string): Promise<Capture> {
  return request(`/api/captures/${encodeURIComponent(id)}/decisions/${encodeURIComponent(headId)}`, { method: 'DELETE' });
}

export async function forceJev(id: string, headIds?: string[]): Promise<{ capture: Capture; modelVersion: string | null; latencyMs: number }> {
  return request(`/api/captures/${encodeURIComponent(id)}/jev`, {
    method: 'POST', body: JSON.stringify(headIds ? { headIds } : {}),
  });
}

export async function fetchUrl(id: string, url?: string): Promise<Capture> {
  return request(`/api/captures/${encodeURIComponent(id)}/fetch-url`, {
    method: 'POST', body: JSON.stringify(url ? { url } : {}),
  });
}

export async function addEdge(id: string, targetId: string, relation: string, note?: string): Promise<unknown> {
  return request(`/api/captures/${encodeURIComponent(id)}/edges`, {
    method: 'POST', body: JSON.stringify({ targetId, relation, note: note || null }),
  });
}

export async function removeEdge(id: string, targetId: string, relation: string): Promise<unknown> {
  return request(`/api/captures/${encodeURIComponent(id)}/edges`, {
    method: 'DELETE', body: JSON.stringify({ targetId, relation }),
  });
}

export async function getReview(): Promise<Review> {
  return request('/api/review');
}

export async function getAgenda(): Promise<Agenda> {
  return request('/api/agenda');
}

export async function getHeads(): Promise<{ heads: Head[] }> {
  return request('/api/heads');
}

export interface HeadInput {
  name: string;
  primitive: 'choice' | 'score' | 'noul';
  instructions: string;
  config: Record<string, unknown>;
  entropyThreshold: number;
  sortOrder: number;
  active: boolean;
}

export async function createHead(input: HeadInput): Promise<Head> {
  return request('/api/heads', { method: 'POST', body: JSON.stringify(input) });
}

export async function updateHead(id: string, input: Partial<HeadInput>): Promise<Head> {
  return request(`/api/heads/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export async function deleteHead(id: string): Promise<{ deleted: boolean }> {
  return request(`/api/heads/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function previewSweep(id: string, input: { q?: string; onlyMissing?: boolean }): Promise<{
  count: number; estimatedUsd: number; cap: { ok: boolean; reason?: string };
}> {
  return request(`/api/heads/${encodeURIComponent(id)}/sweep/preview`, { method: 'POST', body: JSON.stringify(input) });
}

export async function runSweep(id: string, input: { q?: string; onlyMissing?: boolean }): Promise<{ started: boolean; count: number }> {
  return request(`/api/heads/${encodeURIComponent(id)}/sweep/run`, { method: 'POST', body: JSON.stringify(input) });
}

export async function testJev(input: { text: string; url?: string; headIds?: string[] }): Promise<{
  deterministic: Record<string, unknown>; jev: JevResult | null;
}> {
  return request('/api/heads/test', { method: 'POST', body: JSON.stringify(input) });
}

export async function getViews(): Promise<{ views: SavedView[] }> {
  return request('/api/views');
}

export async function createView(input: { name: string; query: string; sort?: string }): Promise<SavedView> {
  return request('/api/views', { method: 'POST', body: JSON.stringify(input) });
}

export async function deleteView(id: string): Promise<{ deleted: boolean }> {
  return request(`/api/views/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function getTelemetry(): Promise<Telemetry> {
  return request('/api/telemetry');
}

export async function setJevMode(mode: 'auto' | 'off'): Promise<{ settings: Record<string, string> }> {
  return request('/api/settings', { method: 'PATCH', body: JSON.stringify({ jev_mode: mode }) });
}

export function exportUrl(format: 'json' | 'md'): string {
  return `/api/export?format=${format}`;
}

const EVENT_TYPES = [
  'capture.created', 'capture.updated', 'capture.deleted', 'edge.updated',
  'reminder.updated', 'telemetry.updated', 'sweep.progress',
];

export function openEvents(onEvent: (type: string, data: unknown) => void): () => void {
  const source = new EventSource('/api/events');
  for (const type of EVENT_TYPES) {
    source.addEventListener(type, (event) => {
      try {
        onEvent(type, JSON.parse((event as MessageEvent).data));
      } catch {
        onEvent(type, null);
      }
    });
  }
  return () => source.close();
}
