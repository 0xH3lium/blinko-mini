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
  const [captureMode, setCaptureMode] = useState<'auto' | 'manual'>('auto');
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
      q: filters.q, bucket: filters.bucket, status: filters.status, sort, order, limit: 300,
    });
    if (trashMode) setTrashPage(result); else setPage(result);
  }, [authed, captureFilters, sort, order, trashMode]);

  const refreshMeta = useCallback(async () => {
    if (!authed) return;
    const [telemetryResult, triageResult, agendaResult, viewsResult, fieldsResult, templatesResult, settingsResult, rulesResult] = await Promise.all([
      getTelemetry(), getTriage(), getAgenda(), getViews(), getFields(), getExtractors(), getSettings(), getRules(),
    ]);
    setTelemetry(telemetryResult);
    setTriage(triageResult);
    setAgenda(agendaResult);
    setViews(viewsResult.views);
    setFields(fieldsResult.fields);
    setTemplates(templatesResult.templates);
    setRules(rulesResult.rules);
    setSettingsDraft(settingsResult.settings);
  }, [authed]);

  const refreshAll = useCallback(async () => {
    try {
      await Promise.all([refreshStream(), refreshMeta()]);
      if (selectedId) {
        try { setDetail(await getCapture(selectedId)); }
        catch { setDetail(null); setSelectedId(null); }
      }
    } catch (error) {
      if (error instanceof Error && 'status' in error && (error as { status: number }).status === 401) { setAuthed(false); return; }
      notify(error instanceof Error ? error.message : 'Refresh failed', 'error');
    }
  }, [refreshStream, refreshMeta, selectedId, notify]);

  const refreshRef = useRef(refreshAll);
  refreshRef.current = refreshAll;

  useEffect(() => { getMe().then((result) => setAuthed(result.authenticated)).catch(() => setAuthed(false)); }, []);
  useEffect(() => { if (authed) void refreshAll(); }, [authed, refreshAll]);

  // SSE refreshes are scoped: capture events only touch capture views, reminder events only Agenda, etc.
  useEffect(() => {
    if (!authed) return;
    const close = openEvents((type) => {
      setConnected(true);
      if (type === 'capture.created' || type === 'capture.updated' || type === 'capture.deleted' || type === 'capture.restored' || type === 'capture.bulk') {
        if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
        refreshTimer.current = window.setTimeout(() => {
          void refreshRef.current();
        }, 180);
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
      if (typing) return;
      if (event.key === '/') { event.preventDefault(); setPaletteOpen(true); }
      else if (event.key === '1') setMode('stream');
      else if (event.key === '2') setMode('agenda');
      else if (event.key === '3') setMode('triage');
      else if (event.key === '4') setMode('studio');
      else if (event.key === 'Escape') { setInspectorOpen(false); setPaletteOpen(false); setCaptureOpen(false); setExtractOpen(false); setPatchOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [authed, selectedId, query]);

  const selectCapture = useCallback((capture: Capture) => { setSelectedId(capture.id); void loadDetail(capture.id); }, [loadDetail]);
  const selectById = useCallback((id: string) => { setSelectedId(id); void loadDetail(id); }, [loadDetail]);

  const applyPatch = useCallback(async (id: string, patch: CapturePatch) => {
    try { await updateCapture(id, patch); await refreshAll(); }
    catch (error) { notify(error instanceof Error ? error.message : 'Save failed', 'error'); }
  }, [refreshAll, notify]);

  const handleBulk = useCallback(async (ids: string[], action: BulkAction) => {
    try {
      const result = await bulkAction(ids, action);
      if (action.type !== 'trash' && action.type !== 'restore') notify(`${result.affected} captures updated`, 'success');
      await refreshAll();
    } catch (error) { notify(error instanceof Error ? error.message : 'Bulk action failed', 'error'); }
  }, [refreshAll, notify]);

  const handleReminder = useCallback(async (id: string, action: ReminderAction) => {
    try { await reminderAction(id, action); await refreshAll(); }
    catch (error) { notify(error instanceof Error ? error.message : 'Reminder update failed', 'error'); }
  }, [refreshAll, notify]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteCapture(id);
      setConfirmDelete(null);
      if (selectedId === id) { setSelectedId(null); setDetail(null); setInspectorOpen(false); }
      notify('Moved to trash', 'success', { label: 'Undo', run: () => void restoreCapture(id).then(refreshAll) });
      await refreshAll();
    } catch (error) { notify(error instanceof Error ? error.message : 'Delete failed', 'error'); }
  }, [selectedId, refreshAll, notify]);

  const handleMerge = useCallback(async (ids: string[]) => {
    if (ids.length < 2) { notify('Select at least two captures to stitch', 'error'); return; }
    const mergedContent = window.prompt('Merged content (leave empty to join originals)', '');
    try {
      const merged = await mergeCaptures(ids[0]!, ids.slice(1), mergedContent || undefined);
      notify(`Stitched into ${merged.id.slice(0, 8)}`, 'success');
      await refreshAll();
    } catch (error) { notify(error instanceof Error ? error.message : 'Merge failed', 'error'); }
  }, [refreshAll, notify]);

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
      await refreshAll();
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not save view', 'error'); }
  }, [query, sort, refreshAll, notify]);

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
      onRestore={(id) => void restoreCapture(id).then(refreshAll)}
      onEmptyTrash={() => void maintenance('empty_trash').then(() => { notify('Trash emptied', 'success'); void refreshAll(); })}
      onMerge={(ids) => void handleMerge(ids)} onExtract={(templateId, ids) => {
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
        onBatch={() => { setCaptureMode('auto'); setCaptureOpen(true); }}
        onExtract={() => openExtractModal()}
        onPatchImport={() => setPatchOpen(true)}
        onLogout={() => void logout().catch(() => undefined).finally(() => { setAuthed(false); setPage(null); setDetail(null); })}
        connected={connected} triageCount={triageCount} />

      <div className="flex min-h-0 flex-1">
        <LeftRail counts={bucketCounts} activeBucket={bucket}
          onBucket={(next) => { setBucket(next); setActiveViewId(null); setTrashMode(false); }}
          views={views} activeViewId={activeViewId} onView={applyView}
          onSaveView={() => void handleSaveView()}
          onDeleteView={(id) => void deleteView(id).then(refreshAll)}
          tags={telemetry?.tags ?? []} activeTag={null} onTag={(next) => { setQuery(next ? `#${next}` : ''); setTrashMode(false); }}
          telemetry={telemetry} status={status} onStatus={setStatus}
          trash={trashMode} onTrash={(value) => { setTrashMode(value); if (value) setQuery('is:trash'); else setQuery(''); }}
          trashCount={telemetry?.trashCount ?? 0} />

        <main className="relative min-w-0 flex-1 bg-[#090b0d]">
          {mode === 'stream' ? streamView : null}
          {mode === 'agenda' ? (
            agenda ? (
              <AgendaMatrixView agenda={agenda} captures={captures} fields={fields} q={matrixQuery}
                onQuery={(next) => { setMatrixQuery(next); void getCaptures({ q: next, status: 'active', limit: 300 }).then(setPage); }}
                onSelect={selectById} onReminderAction={(id, action) => void handleReminder(id, action)}
                onFieldValue={(id, name, value) => {
                  const field = fields.find((item) => item.name === name);
                  void applyPatch(id, { fields: { [name]: field?.fieldType === 'boolean' ? { valueText: value === 1 ? 'yes' : 'no', valueNum: value, source: 'human' } : { valueText: String(value), valueNum: value, source: 'human' } } });
                }} />
            ) : <Loading />
          ) : null}
          {mode === 'triage' ? (
            triage ? (
              <TriageView triage={triage} fields={fields} onPatch={applyPatch}
                onBucket={(id, next) => void applyPatch(id, { bucket: next })}
                onTrash={(id) => void deleteCapture(id).then(refreshAll)}
                onResolve={(id) => void applyPatch(id, { status: 'resolved' })}
                onStitch={(ids, mergedContent) => void handleMerge(ids)}
                onLinkThread={(ids) => void Promise.all(ids.slice(1).map((id, index) => addEdge(ids[index]!, id, 'related'))).then(refreshAll).catch((error: unknown) => notify(error instanceof Error ? error.message : 'Link failed', 'error'))}
                onExtract={() => void extract({ captureIds: triage.untriaged.map((capture) => capture.id) }).then((result) => {
                  void copyText(result.text).then(() => notify(`Copied ${result.captureCount} untriaged captures · ~${result.estimatedTokens} tokens`, 'success'));
                }).catch((error: unknown) => notify(error instanceof Error ? error.message : 'Extract failed', 'error'))}
                onOpenPatch={() => setPatchOpen(true)} onInspect={selectById} notify={notify} />
            ) : <Loading />
          ) : null}
          {mode === 'studio' ? (
            <StudioView fields={fields} rules={rules} templates={templates} settings={settingsDraft} captures={captures}
              onRefresh={refreshAll} notify={notify} />
          ) : null}
        </main>

        {inspectorOpen ? (
          <Inspector detail={detail} fields={fields} allTags={allTags} onPatch={applyPatch}
            onClearField={async (id, name) => { await clearField(id, name); await refreshAll(); }}
            onDelete={(id) => setConfirmDelete(id)} onClose={() => setInspectorOpen(false)} onJump={selectById}
            onAddEdge={async (id, targetId, relation: EdgeRelation, note) => { await addEdge(id, targetId, relation, note); await refreshAll(); }}
            onRemoveEdge={async (id, targetId, relation) => { await removeEdge(id, targetId, relation); await refreshAll(); }}
            onFetchUrl={async (id) => { await fetchUrl(id); await refreshAll(); }}
            onExtract={(_templateId, ids) => openExtractModal(ids)}
            notify={notify} />
        ) : null}
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onSelect={selectCapture}
        onCaptureAuto={() => { setCaptureMode('auto'); setCaptureOpen(true); }}
        onCaptureManual={() => { setCaptureMode('manual'); setCaptureOpen(true); }}
        onMode={setMode} onBatch={() => setCaptureOpen(true)} onExtract={() => openExtractModal()}
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

      {toast ? <Toast key={toast.id} message={toast.message} tone={toast.tone} action={toast.action} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}

function Loading() {
  return <div className="flex h-full items-center justify-center text-[var(--muted)]"><LoaderCircle className="animate-spin" size={18} /></div>;
}
