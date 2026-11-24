import type {
  Agenda, BulkAction, CompiledExtraction, Capture, CaptureDetail, CapturePage, CapturePatch,
  CaptureResult, CustomField, ExtractorTemplate, ManualCaptureInput, PatchPreview, ReminderAction,
  Rule, SavedView, Telemetry, Triage,
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

export const getMe = (): Promise<{ authenticated: boolean }> => request('/auth/me');
export const loginWithCode = (code: string): Promise<{ authenticated: boolean }> =>
  request('/auth/code', { method: 'POST', body: JSON.stringify({ code }) });
export const logout = (): Promise<void> => request('/auth/logout', { method: 'POST' });

export function getCaptures(filters: {
  q?: string; bucket?: string; status?: string; tag?: string; sort?: string; order?: string;
  limit?: number; offset?: number;
} = {}): Promise<CapturePage> {
  return request(`/api/captures${query({
    q: filters.q, bucket: filters.bucket, status: filters.status ?? 'active', tag: filters.tag,
    sort: filters.sort, order: filters.order, limit: filters.limit ?? 200, offset: filters.offset,
  })}`);
}

export const getCapture = (id: string): Promise<CaptureDetail> => request(`/api/captures/${encodeURIComponent(id)}`);
export const createAutoCapture = (content: string, skipUrlFetch = false): Promise<CaptureResult> =>
  request('/api/captures', { method: 'POST', body: JSON.stringify({ mode: 'auto', content, skipUrlFetch }) });
export const createManualCapture = (input: ManualCaptureInput): Promise<CaptureResult> =>
  request('/api/captures', { method: 'POST', body: JSON.stringify({ mode: 'manual', ...input }) });
export const createBatch = (text: string, delimiter = '\n\n'): Promise<{ created: number; captures: Capture[] }> =>
  request('/api/captures/batch', { method: 'POST', body: JSON.stringify({ text, delimiter }) });
export const mergeCaptures = (survivorId: string, absorbIds: string[], mergedContent?: string): Promise<Capture> =>
  request('/api/captures/merge', { method: 'POST', body: JSON.stringify({ survivorId, absorbIds, mergedContent }) });
export const bulkAction = (ids: string[], action: BulkAction): Promise<{ affected: number }> =>
  request('/api/captures/bulk', { method: 'POST', body: JSON.stringify({ ids, action }) });
export const updateCapture = (id: string, patch: CapturePatch): Promise<Capture> =>
  request(`/api/captures/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
export const deleteCapture = (id: string, permanent = false): Promise<{ deleted: boolean }> =>
  request(`/api/captures/${encodeURIComponent(id)}${permanent ? '?permanent=true' : ''}`, { method: 'DELETE' });
export const restoreCapture = (id: string): Promise<{ restored: boolean }> =>
  request(`/api/captures/${encodeURIComponent(id)}/restore`, { method: 'POST' });
export const clearField = (id: string, name: string): Promise<Capture> =>
  request(`/api/captures/${encodeURIComponent(id)}/fields/${encodeURIComponent(name)}`, { method: 'DELETE' });
export const reminderAction = (id: string, action: ReminderAction): Promise<Capture> =>
  request(`/api/captures/${encodeURIComponent(id)}/reminder/action`, { method: 'POST', body: JSON.stringify({ action }) });
export const getRelated = (id: string): Promise<{ related: Array<{ capture: Capture; score: number; reason: string }> }> =>
  request(`/api/captures/${encodeURIComponent(id)}/related`);
export const fetchUrl = (id: string, url?: string): Promise<Capture> =>
  request(`/api/captures/${encodeURIComponent(id)}/fetch-url`, { method: 'POST', body: JSON.stringify(url ? { url } : {}) });
export const addEdge = (id: string, targetId: string, relation: string, note?: string): Promise<unknown> =>
  request(`/api/captures/${encodeURIComponent(id)}/edges`, { method: 'POST', body: JSON.stringify({ targetId, relation, note: note || null }) });
export const removeEdge = (id: string, targetId: string, relation: string): Promise<unknown> =>
  request(`/api/captures/${encodeURIComponent(id)}/edges`, { method: 'DELETE', body: JSON.stringify({ targetId, relation }) });

export const getTriage = (): Promise<Triage> => request('/api/triage');
export const getAgenda = (): Promise<Agenda> => request('/api/agenda');

export const getFields = (): Promise<{ fields: CustomField[] }> => request('/api/fields');
export const createField = (input: Partial<CustomField> & { name: string; fieldType: CustomField['fieldType'] }): Promise<CustomField> =>
  request('/api/fields', { method: 'POST', body: JSON.stringify(input) });
export const updateField = (id: string, input: Partial<CustomField>): Promise<CustomField> =>
  request(`/api/fields/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
export const deleteField = (id: string): Promise<{ deleted: boolean }> =>
  request(`/api/fields/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const getRules = (): Promise<{ rules: Rule[] }> => request('/api/rules');
export const createRule = (input: Partial<Rule> & { name: string; conditions: Record<string, unknown>; actions: Record<string, unknown> }): Promise<Rule> =>
  request('/api/rules', { method: 'POST', body: JSON.stringify(input) });
export const updateRule = (id: string, input: Partial<Rule>): Promise<Rule> =>
  request(`/api/rules/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
export const deleteRule = (id: string): Promise<{ deleted: boolean }> =>
  request(`/api/rules/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const testRules = (input: { text: string; url?: string }): Promise<{
  deterministic: Record<string, unknown>; matchedRules: Array<{ id: string; name: string; changes: Record<string, unknown> }>;
  patch: Record<string, unknown>; final: Record<string, unknown>;
}> => request('/api/rules/test', { method: 'POST', body: JSON.stringify(input) });
export const previewSweep = (input: { ruleId?: string; q?: string }): Promise<{
  affectedCount: number; sampleDiffs: Array<{ id: string; content: string; before: Record<string, unknown>; after: Record<string, unknown> }>;
}> => request('/api/rules/sweep/preview', { method: 'POST', body: JSON.stringify(input) });
export const runSweep = (input: { ruleId?: string; q?: string; overwriteLocked?: boolean }): Promise<{ affected: number }> =>
  request('/api/rules/sweep/run', { method: 'POST', body: JSON.stringify(input) });

export const getExtractors = (): Promise<{ templates: ExtractorTemplate[] }> => request('/api/extractors');
export const createExtractor = (input: Partial<ExtractorTemplate> & { name: string; slug: string }): Promise<ExtractorTemplate> =>
  request('/api/extractors', { method: 'POST', body: JSON.stringify(input) });
export const updateExtractor = (id: string, input: Partial<ExtractorTemplate>): Promise<ExtractorTemplate> =>
  request(`/api/extractors/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
export const deleteExtractor = (id: string): Promise<{ deleted: boolean }> =>
  request(`/api/extractors/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const extract = (input: {
  templateId?: string; captureIds?: string[]; q?: string; bucket?: string; status?: string; tag?: string; includeNeighbors?: boolean;
}): Promise<CompiledExtraction> => request('/api/extract', { method: 'POST', body: JSON.stringify(input) });

export const previewPatch = (raw: string): Promise<PatchPreview> =>
  request('/api/patch/preview', { method: 'POST', body: JSON.stringify({ raw }) });
export const applyPatch = (raw: string, selectedIds?: string[]): Promise<{ affected: number; merges: number; created: number; warnings: string[] }> =>
  request('/api/patch/apply', { method: 'POST', body: JSON.stringify({ raw, selectedIds }) });

export const getSettings = (): Promise<{ settings: Record<string, string> }> => request('/api/settings');
export const updateSettings = (settings: Record<string, string | number | boolean>): Promise<{ settings: Record<string, string> }> =>
  request('/api/settings', { method: 'PATCH', body: JSON.stringify(settings) });
export const maintenance = (action: 'rebuild_fts' | 'vacuum' | 'empty_trash' | 'run_ttl'): Promise<Record<string, unknown>> =>
  request('/api/system/maintenance', { method: 'POST', body: JSON.stringify({ action }) });
export const importBackup = (payload: unknown): Promise<{ imported: number }> =>
  request('/api/import/json', { method: 'POST', body: JSON.stringify(payload) });

export const getViews = (): Promise<{ views: SavedView[] }> => request('/api/views');
export const createView = (input: { name: string; query: string; sort?: string }): Promise<SavedView> =>
  request('/api/views', { method: 'POST', body: JSON.stringify(input) });
export const deleteView = (id: string): Promise<{ deleted: boolean }> =>
  request(`/api/views/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const getTelemetry = (): Promise<Telemetry> => request('/api/telemetry');
export const exportUrl = (format: 'json' | 'md', includeTrash = false): string =>
  `/api/export?format=${format}${includeTrash ? '&includeTrash=true' : ''}`;

const EVENT_TYPES = [
  'capture.created', 'capture.updated', 'capture.deleted', 'capture.restored', 'capture.bulk',
  'edge.updated', 'reminder.updated', 'telemetry.updated', 'sweep.progress',
];

export function openEvents(onEvent: (type: string, data: unknown) => void): () => void {
  const source = new EventSource('/api/events');
  for (const type of EVENT_TYPES) {
    source.addEventListener(type, (event) => {
      try { onEvent(type, JSON.parse((event as MessageEvent).data)); }
      catch { onEvent(type, null); }
    });
  }
  return () => source.close();
}
