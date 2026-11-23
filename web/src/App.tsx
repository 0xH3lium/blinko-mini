import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { TopBar } from './components/TopBar';
import { LeftRail } from './components/LeftRail';
import { LoginGate } from './components/LoginGate';
import { Inspector } from './components/Inspector';
import { CaptureModal } from './components/CaptureModal';
import { CommandPalette } from './components/CommandPalette';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Toast } from './components/Toast';
import { StreamView } from './views/StreamView';
import { AgendaMatrixView } from './views/AgendaMatrixView';
import { ReviewView } from './views/ReviewView';
import { JevLabView } from './views/JevLabView';
import {
  addEdge, bulkAction, clearDecision, createView, deleteCapture, deleteView, fetchUrl, forceJev,
  getAgenda, getCapture, getCaptures, getHeads, getMe, getReview, getTelemetry, getViews, logout,
  openEvents, overrideDecision, removeEdge, setJevMode, updateCapture,
} from './api/client';
import type {
  BulkAction, Bucket, Capture, CaptureDetail, CapturePatch, CaptureResult, CaptureStatus,
  EdgeRelation, Head, Mode, SavedView, Telemetry,
} from './types/capture';
import type { Notify, ToastTone } from './types/ui';

interface ToastState { id: number; message: string; tone: ToastTone }

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>('stream');
  const [page, setPage] = useState<Awaited<ReturnType<typeof getCaptures>> | null>(null);
  const [heads, setHeads] = useState<Head[]>([]);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [review, setReview] = useState<Awaited<ReturnType<typeof getReview>> | null>(null);
  const [agenda, setAgenda] = useState<Awaited<ReturnType<typeof getAgenda>> | null>(null);
  const [views, setViews] = useState<SavedView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaptureDetail | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureMode, setCaptureMode] = useState<'auto' | 'manual'>('auto');
  const [query, setQuery] = useState('');
  const [bucket, setBucket] = useState('all');
  const [status, setStatus] = useState<CaptureStatus | 'all'>('active');
  const [tag, setTag] = useState<string | null>(null);
  const [sort, setSort] = useState('recent');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [sweepProgress, setSweepProgress] = useState<{ headId: string; done: number; total: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [connected, setConnected] = useState(false);
  const refreshTimer = useRef<number | null>(null);

  const notify = useCallback<Notify>((message, tone = 'info') => {
    setToast({ id: Date.now(), message, tone });
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      setDetail(await getCapture(id));
      setInspectorOpen(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not load capture', 'error');
    }
  }, [notify]);

  const refresh = useCallback(async () => {
    if (!authed) return;
    try {
      const [pageResult, telemetryResult, reviewResult, agendaResult, headsResult, viewsResult] = await Promise.all([
        getCaptures({
          q: query || undefined,
          bucket: bucket === 'all' ? undefined : bucket,
          tag: tag ?? undefined,
          status,
          sort,
          order,
          limit: 300,
        }),
        getTelemetry(),
        getReview(),
        getAgenda(),
        getHeads(),
        getViews(),
      ]);
      setPage(pageResult);
      setTelemetry(telemetryResult);
      setReview(reviewResult);
      setAgenda(agendaResult);
      setHeads(headsResult.heads);
      setViews(viewsResult.views);
      if (selectedId) {
        try { setDetail(await getCapture(selectedId)); }
        catch { setDetail(null); setSelectedId(null); }
      }
    } catch (error) {
      if (error instanceof Error && 'status' in error && (error as { status: number }).status === 401) {
        setAuthed(false);
        return;
      }
      notify(error instanceof Error ? error.message : 'Refresh failed', 'error');
    }
  }, [authed, query, bucket, tag, status, sort, order, selectedId, notify]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    getMe().then((result) => setAuthed(result.authenticated)).catch(() => setAuthed(false));
  }, []);

  useEffect(() => {
    if (!authed) return;
    void refresh();
  }, [authed, refresh]);

  // SSE lifecycle depends only on authentication; selection and tab changes never reopen the stream.
  useEffect(() => {
    if (!authed) return;
    const close = openEvents((type, data) => {
      setConnected(true);
      if (type === 'sweep.progress') {
        const progress = data as { headId?: string; done?: number; total?: number } | null;
        if (progress?.headId) setSweepProgress({ headId: progress.headId, done: progress.done ?? 0, total: progress.total ?? 0 });
      }
      if (type === 'capture.deleted' && (data as { id?: string } | null)?.id === confirmDelete) setConfirmDelete(null);
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => void refreshRef.current(), 180);
    });
    setConnected(true);
    return () => {
      close();
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      setConnected(false);
    };
  }, [authed]);

  useEffect(() => {
    if (!authed) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'm') {
        event.preventDefault();
        setCaptureMode('manual');
        setCaptureOpen(true);
        return;
      }
      if (typing) return;
      if (event.key === '/') { event.preventDefault(); setPaletteOpen(true); }
      else if (event.key === '1') setMode('stream');
      else if (event.key === '2') setMode('agenda');
      else if (event.key === '3') setMode('review');
      else if (event.key === '4') setMode('jev');
      else if (event.key === 'Escape') { setInspectorOpen(false); setPaletteOpen(false); setCaptureOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [authed]);

  const selectCapture = useCallback((capture: Capture) => {
    setSelectedId(capture.id);
    void loadDetail(capture.id);
  }, [loadDetail]);

  const selectById = useCallback((id: string) => {
    setSelectedId(id);
    void loadDetail(id);
  }, [loadDetail]);

  const applyPatch = useCallback(async (id: string, patch: CapturePatch) => {
    try {
      await updateCapture(id, patch);
      notify('Saved', 'success');
      await refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Save failed', 'error');
    }
  }, [notify, refresh]);

  const handleOverride = useCallback(async (id: string, headId: string, valueText?: string, valueNum?: number) => {
    await applyPatch(id, { decisions: { [headId]: { valueText: valueText ?? null, valueNum: valueNum ?? null } } });
  }, [applyPatch]);

  const handleJev = useCallback(async (id: string, headIds?: string[]) => {
    try {
      await forceJev(id, headIds);
      notify('Jev re-evaluation complete', 'success');
      await refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Jev call capped or unavailable', 'error');
    }
  }, [notify, refresh]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteCapture(id);
      setConfirmDelete(null);
      if (selectedId === id) { setSelectedId(null); setDetail(null); setInspectorOpen(false); }
      notify('Capture deleted', 'success');
      await refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Delete failed', 'error');
    }
  }, [selectedId, notify, refresh]);

  const handleBulk = useCallback(async (ids: string[], action: BulkAction) => {
    try {
      const result = await bulkAction(ids, action);
      notify(`${result.affected} captures updated`, 'success');
      await refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Bulk action failed', 'error');
    }
  }, [notify, refresh]);

  const handleReminderAction = useCallback(async (id: string, action: 'done' | 'snooze4' | 'tomorrow' | 'kill') => {
    try {
      const capture = await getCapture(id);
      const reminder = capture.reminder;
      if (action === 'done') await applyPatch(id, { status: 'resolved', reminder: reminder ? { dueAt: reminder.dueAt, state: 'done' } : null });
      else if (action === 'kill') await applyPatch(id, { reminder: reminder ? { dueAt: reminder.dueAt, state: 'killed' } : null });
      else if (reminder) {
        let dueAt = reminder.dueAt + 4 * 3_600_000;
        if (action === 'tomorrow') {
          const target = new Date(Date.now() + 86_400_000);
          target.setHours(9, 0, 0, 0);
          dueAt = target.getTime();
        }
        await applyPatch(id, { reminder: { dueAt, snoozeCount: reminder.snoozeCount + 1 } });
      }
      notify('Reminder updated', 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Reminder update failed', 'error');
    }
  }, [applyPatch, notify]);

  const handleSaveView = useCallback(async () => {
    const name = window.prompt('Save current query as view', query || 'Untitled view');
    if (!name) return;
    try {
      await createView({ name, query, sort });
      notify('View saved', 'success');
      await refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save view', 'error');
    }
  }, [query, sort, notify, refresh]);

  const applyView = useCallback((view: SavedView) => {
    setQuery(view.query);
    setSort(view.sort);
    setBucket('all');
    setTag(null);
    setActiveViewId(view.id);
  }, []);

  const toggleJevMode = useCallback(async () => {
    const next = telemetry?.jevMode === 'auto' ? 'off' : 'auto';
    try {
      await setJevMode(next);
      notify(`Jev mode → ${next}`, 'success');
      await refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Mode change failed', 'error');
    }
  }, [telemetry?.jevMode, notify, refresh]);

  const onCreated = useCallback(async (result: CaptureResult) => {
    await refresh();
    if (result.capture) selectCapture(result.capture);
  }, [refresh, selectCapture]);

  if (authed === null) {
    return <div className="flex h-full items-center justify-center text-[var(--muted)]"><LoaderCircle className="animate-spin" size={18} /></div>;
  }
  if (!authed) return <LoginGate onAuthed={() => setAuthed(true)} />;

  const captures = useMemo(() => page?.captures ?? [], [page]);
  const reviewCount = review ? review.uncertain.length + review.unclassified.length : 0;
  const allTags = useMemo(() => (telemetry?.tags ?? []).map((item) => item.name), [telemetry]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar
        mode={mode}
        onMode={setMode}
        onSearch={() => setPaletteOpen(true)}
        onCapture={(next) => { setCaptureMode(next); setCaptureOpen(true); }}
        onLogout={() => void logout().catch(() => undefined).finally(() => { setAuthed(false); setPage(null); setDetail(null); })}
        connected={connected}
        reviewCount={reviewCount}
        jevMode={telemetry?.jevMode ?? 'auto'}
      />

      <div className="flex min-h-0 flex-1">
        <LeftRail
          counts={page?.bucketCounts ?? {}}
          activeBucket={bucket}
          onBucket={(next) => { setBucket(next); setActiveViewId(null); }}
          views={views}
          activeViewId={activeViewId}
          onView={applyView}
          onSaveView={() => void handleSaveView()}
          onDeleteView={(id) => void deleteView(id).then(refresh)}
          tags={telemetry?.tags ?? []}
          activeTag={tag}
          onTag={(next) => { setTag(next); setActiveViewId(null); }}
          telemetry={telemetry}
          onOpenJev={() => setMode('jev')}
          status={status}
          onStatus={setStatus}
        />

        <main className="relative min-w-0 flex-1 bg-[#090b0d]">
          {mode === 'stream' ? (
            <StreamView
              captures={captures}
              total={page?.total ?? 0}
              heads={heads}
              query={query}
              onQuery={(next) => { setQuery(next); setActiveViewId(null); }}
              status={status}
              onStatus={setStatus}
              sort={sort}
              onSort={(next) => { setSort(next); setActiveViewId(null); }}
              order={order}
              onOrder={setOrder}
              onSaveView={() => void handleSaveView()}
              selectedId={selectedId}
              onSelect={selectCapture}
              onBulk={(ids, action) => void handleBulk(ids, action)}
              onDelete={(capture) => setConfirmDelete(capture.id)}
              onJev={(capture) => void handleJev(capture.id)}
              onPin={(capture) => void applyPatch(capture.id, { isPinned: !capture.isPinned })}
              onResolve={(capture) => void applyPatch(capture.id, { status: 'resolved' })}
              notify={notify}
            />
          ) : null}
          {mode === 'agenda' ? (
            agenda ? (
              <AgendaMatrixView
                agenda={agenda}
                captures={captures}
                heads={heads}
                onSelect={selectById}
                onReminderAction={(id, action) => void handleReminderAction(id, action)}
              />
            ) : <div className="flex h-full items-center justify-center text-[var(--muted)]"><LoaderCircle className="animate-spin" size={18} /></div>
          ) : null}
          {mode === 'review' ? (
            review ? (
              <ReviewView
                review={review}
                heads={heads}
                onBucket={(id, next) => void applyPatch(id, { bucket: next as Bucket })}
                onOverride={(id, headId, valueText, valueNum) => void handleOverride(id, headId, valueText, valueNum)}
                onJev={(id) => void handleJev(id)}
                onInspect={selectById}
                onStatus={(id, next) => void applyPatch(id, { status: next })}
                notify={notify}
              />
            ) : <div className="flex h-full items-center justify-center text-[var(--muted)]"><LoaderCircle className="animate-spin" size={18} /></div>
          ) : null}
          {mode === 'jev' ? (
            <JevLabView
              telemetry={telemetry}
              heads={heads}
              sweepProgress={sweepProgress}
              onRefresh={() => void refresh()}
              notify={notify}
            />
          ) : null}
        </main>

        {inspectorOpen ? (
          <Inspector
            detail={detail}
            heads={heads}
            allTags={allTags}
            onPatch={applyPatch}
            onOverride={handleOverride}
            onJev={handleJev}
            onClearDecision={async (id, headId) => { await clearDecision(id, headId); await refresh(); }}
            onDelete={(id) => setConfirmDelete(id)}
            onClose={() => setInspectorOpen(false)}
            onJump={selectById}
            onAddEdge={async (id, targetId, relation: EdgeRelation, note) => { await addEdge(id, targetId, relation, note); await refresh(); }}
            onRemoveEdge={async (id, targetId, relation) => { await removeEdge(id, targetId, relation); await refresh(); }}
            onFetchUrl={async (id) => { await fetchUrl(id); await refresh(); }}
            notify={notify}
          />
        ) : null}
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onSelect={selectCapture}
        onCaptureAuto={() => { setCaptureMode('auto'); setCaptureOpen(true); }}
        onCaptureManual={() => { setCaptureMode('manual'); setCaptureOpen(true); }}
        onMode={setMode}
        onToggleJev={() => void toggleJevMode()}
        onForceJev={(id) => void handleJev(id)}
        selectedId={selectedId}
      />

      <CaptureModal
        open={captureOpen}
        initialMode={captureMode}
        heads={heads}
        tags={allTags}
        notify={notify}
        onClose={() => setCaptureOpen(false)}
        onCreated={(result) => void onCreated(result)}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete capture?"
        description="This hard-deletes the capture, its tags, decisions, edges and reminder. It cannot be undone."
        confirmLabel="Delete"
        danger
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => { if (confirmDelete) void handleDelete(confirmDelete); }}
      />

      {toast ? <Toast key={toast.id} message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}
