import type {
  Capture, CaptureDetail, CapturePage, GraphData, Head, HeadFilter, IngestResult, Telemetry, Triage,
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
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers, cache: 'no-store' });
  } catch {
    throw new ApiError('Could not reach the server.', 0);
  }
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
  bucket?: string; q?: string; tag?: string; paradoxOnly?: boolean; minResonance?: number;
  minEnergy?: number; maxEnergy?: number; status?: string; sort?: string;
  headFilters?: HeadFilter[]; limit?: number; offset?: number;
}): Promise<CapturePage> {
  return request(`/api/captures${query({
    bucket: filters.bucket, q: filters.q, tag: filters.tag, paradoxOnly: filters.paradoxOnly,
    minResonance: filters.minResonance, minEnergy: filters.minEnergy, maxEnergy: filters.maxEnergy,
    status: filters.status ?? 'active', sort: filters.sort, limit: filters.limit, offset: filters.offset,
    headFilters: filters.headFilters?.length ? JSON.stringify(filters.headFilters) : undefined,
  })}`);
}

export async function getCapture(id: string): Promise<CaptureDetail> {
  return request(`/api/captures/${encodeURIComponent(id)}`);
}

export async function createCapture(content: string, forceJev = false): Promise<IngestResult> {
  return request('/api/captures', { method: 'POST', body: JSON.stringify({ content, forceJev }) });
}

export async function updateCapture(id: string, input: Partial<Capture> & { reminderDueAt?: number | null }): Promise<Capture> {
  return request(`/api/captures/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export async function deleteCapture(id: string): Promise<{ deleted: boolean }> {
  return request(`/api/captures/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function overrideDecision(id: string, headId: string, valueText?: string, valueNum?: number): Promise<Capture> {
  return request(`/api/captures/${encodeURIComponent(id)}/override`, {
    method: 'POST', body: JSON.stringify({ headId, valueText, valueNum }),
  });
}

export async function forceJev(id: string): Promise<unknown> {
  return request(`/api/captures/${encodeURIComponent(id)}/jev`, { method: 'POST' });
}

export async function getTriage(): Promise<Triage> {
  return request('/api/triage');
}

export async function getGraph(): Promise<GraphData> {
  return request('/api/graph');
}

export async function getHeads(): Promise<{ heads: Head[] }> {
  return request('/api/heads');
}

export async function createHead(input: { name: string; primitive: string; instructions: string }): Promise<Head> {
  return request('/api/heads', { method: 'POST', body: JSON.stringify(input) });
}

export async function updateHead(id: string, input: Record<string, unknown>): Promise<Head> {
  return request(`/api/heads/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export async function deleteHead(id: string): Promise<{ deleted: boolean }> {
  return request(`/api/heads/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function previewSweep(id: string, filter: Record<string, unknown>): Promise<{ count: number; estimatedUsd: number }> {
  return request(`/api/heads/${encodeURIComponent(id)}/sweep/preview`, { method: 'POST', body: JSON.stringify(filter) });
}

export async function runSweep(id: string, filter: Record<string, unknown>): Promise<{ started: boolean; count: number }> {
  return request(`/api/heads/${encodeURIComponent(id)}/sweep/run`, { method: 'POST', body: JSON.stringify(filter) });
}

export async function testHeads(text: string, useJev = false): Promise<{
  deterministic: Record<string, unknown>;
  local: Array<Record<string, unknown>>;
  jev: { predictions: Array<Record<string, unknown>>; latencyMs: number } | null;
}> {
  return request('/api/heads/test', { method: 'POST', body: JSON.stringify({ text, useJev }) });
}

export async function getTelemetry(): Promise<Telemetry> {
  return request('/api/telemetry');
}

export async function updateSettings(settings: Record<string, string>): Promise<{ settings: Record<string, string> }> {
  return request('/api/settings', { method: 'PATCH', body: JSON.stringify(settings) });
}

export function openEvents(onEvent: (type: string, data: unknown) => void): () => void {
  const source = new EventSource('/api/events');
  const types = ['capture.created', 'capture.updated', 'capture.deleted', 'edge.created', 'reminder.updated', 'telemetry.updated', 'sweep.progress'];
  for (const type of types) {
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
