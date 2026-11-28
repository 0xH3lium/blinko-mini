import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { TopBar } from './components/TopBar';
import { LeftRail } from './components/LeftRail';
import { LoginGate } from './components/LoginGate';
import { Inspector } from './components/Inspector';
import { CaptureModal } from './components/CaptureModal';
import { ExtractModal } from './components/ExtractModal';
import { PatchImportModal } from './components/PatchImportModal';
import { CommandPalette } from './components/CommandPalette';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Toast } from './components/Toast';
import { StreamView } from './views/StreamView';
import { AgendaMatrixView } from './views/AgendaMatrixView';
import { TriageView } from './views/TriageView';
import { StudioView } from './views/StudioView';
import {
  addEdge, bulkAction, clearField, createView, deleteCapture, deleteView, extract, fetchUrl, getAgenda, getCapture,
  getCaptures, getExtractors, getFields, getMe, getRules, getSettings, getTelemetry, getTriage, getViews,
  logout, mergeCaptures, openEvents, removeEdge, reminderAction, restoreCapture, updateCapture, updateSettings,
  maintenance,
} from './api/client';
import type {
  BulkAction, Bucket, Capture, CaptureDetail, CapturePatch, CaptureStatus, CustomField,
  EdgeRelation, ExtractorTemplate, Mode, ReminderAction, Rule, SavedView, Telemetry, Triage,
} from './types/capture';
import type { Notify, ToastAction, ToastTone } from './types/ui';
import { copyText } from './lib/utils';

interface ToastState { id: number; message: string; tone: ToastTone; action?: ToastAction }

function parseActiveTag(query: string): string | null {
  return query.split(/\s+/).map((token) => /^-?#([^\s#]+)$/.exec(token)?.[1]).find(Boolean) ?? null;
}

function toggleQueryTag(query: string, tag: string | null): string {
  if (!tag) return query.split(/\s+/).filter((part) => !/^-?#([^\s#]+)$/.test(part)).join(' ');
  const token = `#${tag}`;
  const parts = query.split(/\s+/).filter(Boolean);
  const index = parts.findIndex((part) => part.toLowerCase() === token.toLowerCase() || part.toLowerCase() === `-${token.toLowerCase()}`);
  if (index >= 0) parts.splice(index, 1);
  else parts.push(token);
  return parts.join(' ');
}

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>('stream');
  const [page, setPage] = useState<Awaited<ReturnType<typeof getCaptures>> | null>(null);
  const [trashPage, setTrashPage] = useState<Awaited<ReturnType<typeof getCaptures>> | null>(null);
  const [trashMode, setTrashMode] = useState(false);
  const [fields, setFields] = useState<CustomField[]>([]);
  const [templates, setTemplates] = useState<ExtractorTemplate[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [settingsDraft, setSettingsDraft] = useState<Record<string, string>>({});
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [triage, setTriage] = useState<Triage | null>(null);
  const [agenda, setAgenda] = useState<Awaited<ReturnType<typeof getAgenda>> | null>(null);
  const [views, setViews] = useState<SavedView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaptureDetail | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureMode, setCaptureMode] = useState<'auto' | 'manual' | 'batch'>('auto');
  const [extractOpen, setExtractOpen] = useState(false);
  const [extractScope, setExtractScope] = useState<{ captureIds?: string[]; q?: string; templateId?: string }>({});
  const [patchOpen, setPatchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matrixQuery, setMatrixQuery] = useState('');
  const [bucket, setBucket] = useState('all');
  const [status, setStatus] = useState<CaptureStatus | 'all'>('active');
  const [sort, setSort] = useState('recent');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false);
  const [streamLimit, setStreamLimit] = useState(300);
  const [railOpen, setRailOpen] = useState(true);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [connected, setConnected] = useState(false);
  const refreshTimer = useRef<number | null>(null);

  const notify = useCallback<Notify>((message, tone = 'info', action) => {
    setToast({ id: Date.now(), message, tone, action });
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try { setDetail(await getCapture(id)); setInspectorOpen(true); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not load capture', 'error'); }
  }, [notify]);

  const captureFilters = useCallback(() => ({
    q: trashMode ? 'is:trash' : query || undefined,
    bucket: !trashMode && bucket !== 'all' ? bucket : undefined,
    status: trashMode ? 'all' as const : status,
  }), [trashMode, query, bucket, status]);

  const refreshStream = useCallback(async () => {
    if (!authed) return;
    const filters = captureFilters();
    const result = await getCaptures({
      q: filters.q, bucket: filters.bucket, status: filters.status, sort, order, limit: streamLimit,
    });
    if (trashMode) setTrashPage(result); else setPage(result);
  }, [authed, captureFilters, sort, order, trashMode, streamLimit]);

  // Studio config is static during capture edits; only volatile views need a refresh after a patch.
  const refreshStatic = useCallback(async () => {
    if (!authed) return;
    const [viewsResult, fieldsResult, templatesResult, settingsResult, rulesResult] = await Promise.all([
      getViews(), getFields(), getExtractors(), getSettings(), getRules(),
    ]);
    setViews(viewsResult.views);
    setFields(fieldsResult.fields);
    setTemplates(templatesResult.templates);
    setRules(rulesResult.rules);
    setSettingsDraft(settingsResult.settings);
  }, [authed]);

  const refreshDynamic = useCallback(async () => {
    if (!authed) return;
    const [telemetryResult, triageResult, agendaResult] = await Promise.all([getTelemetry(), getTriage(), getAgenda()]);
    setTelemetry(telemetryResult);
    setTriage(triageResult);
    setAgenda(agendaResult);
  }, [authed]);

  const refreshDetail = useCallback(async () => {
    if (!selectedId) return;
    try { setDetail(await getCapture(selectedId)); }
    catch { setDetail(null); setSelectedId(null); }
  }, [selectedId]);

  const refreshCaptures = useCallback(async () => {
    try {
      await Promise.all([refreshStream(), refreshDynamic(), refreshDetail()]);
    } catch (error) {
      if (error instanceof Error && 'status' in error && (error as { status: number }).status === 401) { setAuthed(false); return; }
      notify(error instanceof Error ? error.message : 'Refresh failed', 'error');
    }
  }, [refreshStream, refreshDynamic, refreshDetail, notify]);

  const refreshAll = useCallback(async () => {
    try {
      await Promise.all([refreshStream(), refreshStatic(), refreshDynamic(), refreshDetail()]);
    } catch (error) {
      if (error instanceof Error && 'status' in error && (error as { status: number }).status === 401) { setAuthed(false); return; }
      notify(error instanceof Error ? error.message : 'Refresh failed', 'error');
    }
  }, [refreshStream, refreshStatic, refreshDynamic, refreshDetail, notify]);

  const refreshRef = useRef(refreshCaptures);
  refreshRef.current = refreshCaptures;

  useEffect(() => { getMe().then((result) => setAuthed(result.authenticated)).catch(() => setAuthed(false)); }, []);
  useEffect(() => { if (authed) void refreshAll(); }, [authed, refreshAll]);

  // Apply SSE payloads locally; only telemetry is re-fetched, on a debounce.
  useEffect(() => {
    if (!authed) return;
    const close = openEvents((type, data) => {
      setConnected(true);
      if (type === 'capture.created' || type === 'capture.updated' || type === 'capture.deleted' || type === 'capture.restored') {
        const event = data as { id?: string; deletedAt?: number | null } | null;
        const id = event?.id;
        if (!id) return;
        const incoming = type === 'capture.created' || type === 'capture.updated'
          ? { ...(event as Capture), deletedAt: type === 'capture.updated' ? (event as Capture).deletedAt : null }
          : null;
        const removed = type === 'capture.deleted' || type === 'capture.restored';
        const change = (capture: Capture): Capture | null => {
          if (capture.id !== id) return capture;
          if (removed) return null;
          return incoming!;
        };
        const patchPage = (current: typeof page) => {
          if (!current || !incoming) return current;
          const exists = current.captures.some((capture) => capture.id === id);
          return { ...current, captures: exists ? current.captures.map(change).filter(Boolean) as Capture[] : [incoming, ...current.captures] };
        };
        setPage((current) => type === 'capture.deleted' ? (current ? { ...current, captures: current.captures.filter((capture) => capture.id !== id) } : current) : patchPage(current));
        setTrashPage((current) => type === 'capture.restored' ? (current ? { ...current, captures: current.captures.filter((capture) => capture.id !== id) } : current) : patchPage(current));
        setDetail((current) => {
          if (!current || current.id !== id) return current;
          if (removed && type === 'capture.deleted') return null;
          return incoming ? { ...incoming, edges: current.edges } : current;
        });
        setTriage((current) => {
          if (!current) return current;
          const map = (list: Capture[]) => list.map(change).filter((capture): capture is Capture => capture !== null);
          return {
            untriaged: map(current.untriaged).filter((capture) => !capture.triaged && capture.status === 'active' && !capture.deletedAt),
            stubs: map(current.stubs),
            stale: map(current.stale),
            bursts: current.bursts.map((burst) => ({ ...burst, captures: map(burst.captures) })),
          };
        });
        if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
        refreshTimer.current = window.setTimeout(() => { void getTelemetry().then(setTelemetry).catch(() => undefined); }, 400);
      } else if (type === 'capture.bulk') {
        if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
        refreshTimer.current = window.setTimeout(() => { void refreshRef.current(); }, 180);
      } else if (type === 'reminder.updated') {
        void getAgenda().then(setAgenda).catch(() => undefined);
      } else if (type === 'telemetry.updated') {
        void getTelemetry().then(setTelemetry).catch(() => undefined);
        void getSettings().then((result) => setSettingsDraft(result.settings)).catch(() => undefined);
      }
    });
    setConnected(true);
    return () => { close(); if (refreshTimer.current) window.clearTimeout(refreshTimer.current); setConnected(false); };
  }, [authed]);

  useEffect(() => {
    if (!authed) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPaletteOpen(true); return; }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'm') { event.preventDefault(); setCaptureMode('manual'); setCaptureOpen(true); return; }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'e') { event.preventDefault(); setExtractScope({ captureIds: selectedId ? [selectedId] : undefined, q: query }); setExtractOpen(true); return; }
      if (event.altKey && /^[1-4]$/.test(event.key)) { event.preventDefault(); setMode((['stream', 'agenda', 'triage', 'studio'] as const)[Number(event.key) - 1]!); return; }
      if (typing) return;
      if (event.key === '/') { event.preventDefault(); setPaletteOpen(true); }
      else if (event.key === '[') setRailOpen((open) => !open);
      else if (event.key === 'Escape') { setInspectorOpen(false); setPaletteOpen(false); setCaptureOpen(false); setExtractOpen(false); setPatchOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [authed, selectedId, query]);

  const selectCapture = useCallback((capture: Capture) => { setSelectedId(capture.id); void loadDetail(capture.id); }, [loadDetail]);
  const selectById = useCallback((id: string) => { setSelectedId(id); void loadDetail(id); }, [loadDetail]);

  const applyPatch = useCallback(async (id: string, patch: CapturePatch) => {
    try { await updateCapture(id, patch); await refreshCaptures(); }
    catch (error) { notify(error instanceof Error ? error.message : 'Save failed', 'error'); }
  }, [refreshCaptures, notify]);

  const handleBulk = useCallback(async (ids: string[], action: BulkAction) => {
    try {
      const result = await bulkAction(ids, action);
      if (action.type !== 'trash' && action.type !== 'restore') notify(`${result.affected} captures updated`, 'success');
      await refreshCaptures();
    } catch (error) { notify(error instanceof Error ? error.message : 'Bulk action failed', 'error'); }
  }, [refreshCaptures, notify]);

  const handleReminder = useCallback(async (id: string, action: ReminderAction) => {
    try { await reminderAction(id, action); await refreshCaptures(); }
    catch (error) { notify(error instanceof Error ? error.message : 'Reminder update failed', 'error'); }
  }, [refreshCaptures, notify]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteCapture(id);
      setConfirmDelete(null);
      if (selectedId === id) { setSelectedId(null); setDetail(null); setInspectorOpen(false); }
      notify('Moved to trash', 'success', { label: 'Undo', run: () => void restoreCapture(id).then(refreshCaptures) });
      await refreshCaptures();
    } catch (error) { notify(error instanceof Error ? error.message : 'Delete failed', 'error'); }
  }, [selectedId, refreshCaptures, notify]);

  const handleMerge = useCallback(async (ids: string[], providedContent?: string) => {
    if (ids.length < 2) { notify('Select at least two captures to stitch', 'error'); return; }
    const mergedContent = providedContent ?? window.prompt('Merged content (leave empty to join originals)', '');
    try {
      const merged = await mergeCaptures(ids[0]!, ids.slice(1), mergedContent || undefined);
      notify(`Stitched into ${merged.id.slice(0, 8)}`, 'success');
      await refreshCaptures();
    } catch (error) { notify(error instanceof Error ? error.message : 'Merge failed', 'error'); }
  }, [refreshCaptures, notify]);

  const handleExtract = useCallback(async (templateId?: string, captureIds?: string[]) => {
    try {
      const result = await extract({
        templateId, captureIds,
        q: captureIds?.length ? undefined : (query || undefined),
        status: 'all', includeNeighbors: true,
      });
      void copyText(result.text).then(() => notify(`Copied ${result.captureCount} captures · ~${result.estimatedTokens} tokens`, 'success'));
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Extraction failed', 'error');
    }
  }, [query, notify]);

  const openExtractModal = useCallback((captureIds?: string[], templateId?: string) => {
    setExtractScope({ captureIds, q: query, templateId });
    setExtractOpen(true);
  }, [query]);

  const handleSaveView = useCallback(async () => {
    const name = window.prompt('Save current query as view', query || 'Untitled view');
    if (!name) return;
    try {
      await createView({ name, query, sort });
      notify('View saved', 'success');
      await refreshStatic();
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not save view', 'error'); }
  }, [query, sort, refreshStatic, notify]);

  const applyView = useCallback((view: SavedView) => {
    setQuery(view.query); setSort(view.sort); setBucket('all'); setTrashMode(false); setActiveViewId(view.id);
  }, []);

  const handleSettingsSave = useCallback(async (next: Record<string, string>) => {
    try { await updateSettings(next); setSettingsDraft(next); notify('Settings saved', 'success'); await refreshAll(); }
    catch (error) { notify(error instanceof Error ? error.message : 'Settings save failed', 'error'); }
  }, [refreshAll, notify]);

  const captures = useMemo(() => (trashMode ? trashPage : page)?.captures ?? [], [trashMode, trashPage, page]);
  const bucketCounts = useMemo(() => (trashMode ? trashPage : page)?.bucketCounts ?? {}, [trashMode, trashPage, page]);
  const allTags = useMemo(() => (telemetry?.tags ?? []).map((item) => item.name), [telemetry]);
  const activeTag = useMemo(() => parseActiveTag(query), [query]);
  const triageCount = triage ? triage.untriaged.length + triage.stubs.length + triage.bursts.length : 0;

  if (authed === null) return <div className="flex h-full items-center justify-center text-[var(--muted)]"><LoaderCircle className="animate-spin" size={18} /></div>;
  if (!authed) return <LoginGate onAuthed={() => setAuthed(true)} />;

  const streamView = (
    <StreamView
      captures={captures} total={(trashMode ? trashPage : page)?.total ?? 0} fields={fields}
      templates={templates} telemetrySettings={settingsDraft} query={query} onQuery={(next) => { setQuery(next); setActiveViewId(null); }}
      status={status} onStatus={setStatus} sort={sort} onSort={(next) => { setSort(next); setActiveViewId(null); }}
      order={order} onOrder={setOrder} onSaveView={() => void handleSaveView()} selectedId={selectedId}
      onSelect={selectCapture} onBulk={(ids, action) => void handleBulk(ids, action)} onDelete={(capture) => setConfirmDelete(capture.id)}
      onRestore={(id) => void restoreCapture(id).then(refreshCaptures)}
      onEmptyTrash={() => setConfirmEmptyTrash(true)}
      onLoadMore={() => setStreamLimit((limit) => limit + 300)}
      onMerge={(ids, mergedContent) => void handleMerge(ids, mergedContent)} onExtract={(templateId, ids) => {
        if (templateId || ids) openExtractModal(ids, templateId); else void handleExtract();
      }}
      onBucket={(capture, next) => void applyPatch(capture.id, { bucket: next })}
      onPin={(capture) => void applyPatch(capture.id, { isPinned: !capture.isPinned })}
      onResolve={(capture) => void applyPatch(capture.id, { status: 'resolved' })}
      onTriage={(capture) => void applyPatch(capture.id, { triaged: true })} trashMode={trashMode} notify={notify}
    />
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar mode={mode} onMode={setMode} onSearch={() => setPaletteOpen(true)}
        onCapture={(next) => { setCaptureMode(next); setCaptureOpen(true); }}
        onBatch={() => { setCaptureMode('batch'); setCaptureOpen(true); }}
        onExtract={() => openExtractModal()}
        onPatchImport={() => setPatchOpen(true)}
        onLogout={() => void logout().catch(() => undefined).finally(() => { setAuthed(false); setPage(null); setDetail(null); })}
        connected={connected} triageCount={triageCount} />

      <div className="relative flex min-h-0 flex-1">
        {railOpen ? <LeftRail counts={bucketCounts} activeBucket={bucket}
          onBucket={(next) => { setBucket(next); setActiveViewId(null); setTrashMode(false); }}
          views={views} activeViewId={activeViewId} onView={applyView}
          onSaveView={() => void handleSaveView()}
          onDeleteView={(id) => void deleteView(id).then(refreshStatic)}
          tags={telemetry?.tags ?? []} activeTag={activeTag} onTag={(next) => { setTrashMode(false); setQuery((current) => toggleQueryTag(current.replace(/\bis:trash\b/g, ''), next)); setActiveViewId(null); }}
          telemetry={telemetry} status={status} onStatus={setStatus}
          trash={trashMode} onTrash={(value) => { setTrashMode(value); if (value) setQuery('is:trash'); else setQuery(''); }}
          trashCount={telemetry?.trashCount ?? 0} /> : null}

        <main className="relative min-w-0 flex-1 bg-[#090b0d]">
          {mode === 'stream' ? streamView : null}
          {mode === 'agenda' ? (
            agenda ? (
              <AgendaMatrixView agenda={agenda} captures={captures} fields={fields} q={matrixQuery}
                onQuery={(next) => { setMatrixQuery(next); void getCaptures({ q: next, status: 'active', limit: 300 }).then(setPage); }}
                onSelect={selectById} onReminderAction={(id, action) => void handleReminder(id, action)}
                onFieldValue={(id, name, value) => {
                  const field = fields.find((item) => item.name === name);
                  const numeric = typeof value === 'number' ? value : null;
                  void applyPatch(id, { fields: { [name]: field?.fieldType === 'boolean'
                    ? { valueText: value === 1 ? 'yes' : 'no', valueNum: numeric, source: 'human' }
                    : { valueText: String(value), valueNum: numeric, source: 'human' } } });
                }} />
            ) : <Loading />
          ) : null}
          {mode === 'triage' ? (
            triage ? (
              <TriageView triage={triage} fields={fields} onPatch={applyPatch}
                onBucket={(id, next) => void applyPatch(id, { bucket: next })}
                onTrash={(id) => void deleteCapture(id).then(refreshAll)}
                onResolve={(id) => void applyPatch(id, { status: 'resolved' })}
                onStitch={(ids, mergedContent) => void handleMerge(ids, mergedContent)}
                onLinkThread={(ids) => void Promise.all(ids.slice(1).map((id, index) => addEdge(ids[index]!, id, 'related'))).then(refreshAll).catch((error: unknown) => notify(error instanceof Error ? error.message : 'Link failed', 'error'))}
                onExtract={() => void extract({ captureIds: triage.untriaged.map((capture) => capture.id) }).then((result) => {
                  void copyText(result.text).then(() => notify(`Copied ${result.captureCount} untriaged captures · ~${result.estimatedTokens} tokens`, 'success'));
                }).catch((error: unknown) => notify(error instanceof Error ? error.message : 'Extract failed', 'error'))}
                onOpenPatch={() => setPatchOpen(true)} onInspect={selectById} notify={notify} />
            ) : <Loading />
          ) : null}
          {mode === 'studio' ? (
            <StudioView fields={fields} rules={rules} templates={templates} settings={settingsDraft} captures={captures}
              onRefresh={refreshStatic} notify={notify} />
          ) : null}
        </main>

        {inspectorOpen ? (
          <div className="inspector-pane relative z-40">
          <Inspector detail={detail} fields={fields} allTags={allTags} onPatch={applyPatch}
            onClearField={async (id, name) => { await clearField(id, name); await refreshAll(); }}
            onDelete={(id) => setConfirmDelete(id)} onClose={() => setInspectorOpen(false)} onJump={selectById}
            onAddEdge={async (id, targetId, relation: EdgeRelation, note) => { await addEdge(id, targetId, relation, note); await refreshAll(); }}
            onRemoveEdge={async (id, targetId, relation) => { await removeEdge(id, targetId, relation); await refreshAll(); }}
            onFetchUrl={async (id) => { await fetchUrl(id); await refreshAll(); }}
            onExtract={(_templateId, ids) => openExtractModal(ids)}
            notify={notify} />
          </div>
        ) : null}
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onSelect={selectCapture}
        onCaptureAuto={() => { setCaptureMode('auto'); setCaptureOpen(true); }}
        onCaptureManual={() => { setCaptureMode('manual'); setCaptureOpen(true); }}
        onMode={setMode} onBatch={() => { setCaptureMode('batch'); setCaptureOpen(true); }} onExtract={() => openExtractModal()}
        onPatchImport={() => setPatchOpen(true)} selectedId={selectedId} />

      <CaptureModal open={captureOpen} initialMode={captureMode} fields={fields} tags={allTags} notify={notify}
        onClose={() => setCaptureOpen(false)} onCreated={async (result) => { await refreshAll(); if (result.capture) selectCapture(result.capture); }} />

      <ExtractModal open={extractOpen} onClose={() => setExtractOpen(false)} templates={templates}
        captureIds={extractScope.captureIds} query={extractScope.q} initialTemplateId={extractScope.templateId} notify={notify} />
      <PatchImportModal open={patchOpen} onClose={() => setPatchOpen(false)} notify={notify} onApplied={refreshAll} />

      <ConfirmDialog open={confirmDelete !== null} title="Move to trash?"
        description="Soft-delete keeps the capture restorable until the trash retention period expires."
        confirmLabel="Move to trash" danger onCancel={() => setConfirmDelete(null)}
        onConfirm={() => { if (confirmDelete) void handleDelete(confirmDelete); }} />

      <ConfirmDialog open={confirmEmptyTrash} title="Empty trash permanently?"
        description="Every soft-deleted capture will be erased. This cannot be undone."
        confirmLabel="Empty Trash" danger onCancel={() => setConfirmEmptyTrash(false)}
        onConfirm={() => {
          setConfirmEmptyTrash(false);
          void maintenance('empty_trash').then(() => { notify('Trash emptied', 'success'); void refreshCaptures(); })
            .catch((error: unknown) => notify(error instanceof Error ? error.message : 'Could not empty trash', 'error'));
        }} />

      {toast ? <Toast key={toast.id} message={toast.message} tone={toast.tone} action={toast.action} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}

function Loading() {
  return <div className="flex h-full items-center justify-center text-[var(--muted)]"><LoaderCircle className="animate-spin" size={18} /></div>;
}
