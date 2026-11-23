import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle, Plus, X } from 'lucide-react';
import { TopBar } from './components/TopBar';
import { LeftRail, type SmartFilters } from './components/LeftRail';
import { LoginGate } from './components/LoginGate';
import { Inspector } from './components/Inspector';
import { CommandPalette } from './components/CommandPalette';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Toast } from './components/Toast';
import { StreamView } from './views/StreamView';
import { TopologyView } from './views/TopologyView';
import { TriageView } from './views/TriageView';
import { JevLabView } from './views/JevLabView';
import {
  createCapture, deleteCapture, forceJev, getCapture, getCaptures, getGraph, getHeads, getMe, getTelemetry,
  getTriage, logout, openEvents, overrideDecision, updateCapture, updateSettings,
} from './api/client';
import type {
  Bucket, Capture, CaptureDetail, CapturePage, GraphData, Head, HeadFilter, Mode, Notify, Telemetry, ToastTone, Triage,
} from './types/capture';

interface ToastState { id: number; message: string; tone: ToastTone }

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>('stream');
  const [page, setPage] = useState<CapturePage | null>(null);
  const [heads, setHeads] = useState<Head[]>([]);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [triage, setTriage] = useState<Triage | null>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaptureDetail | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureText, setCaptureText] = useState('');
  const [captureBusy, setCaptureBusy] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [connected, setConnected] = useState(false);
  const [bucket, setBucket] = useState('all');
  const [tag, setTag] = useState<string | null>(null);
  const [smart, setSmart] = useState<SmartFilters>({});
  const [headValues, setHeadValues] = useState<Record<string, number>>({});
  const [heat, setHeat] = useState('bucket');
  const [decayDays, setDecayDays] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
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

  const headFilters = useMemo<HeadFilter[]>(() => {
    return Object.entries(headValues)
      .filter(([, value]) => value > 0)
      .map(([head, min]) => ({ head, min }));
  }, [headValues]);

  const refresh = useCallback(async () => {
    if (!authed) return;
    try {
      const status = smart.sublimated ? 'sublimated' : 'active';
      const [pageResult, telemetryResult, triageResult, headsResult] = await Promise.all([
        getCaptures({
          bucket: bucket === 'all' ? undefined : bucket,
          tag: tag ?? undefined,
          status,
          paradoxOnly: smart.paradoxOnly,
          minResonance: smart.minResonance,
          ...(smart.decaying ? { maxEnergy: 0.4 } : {}),
          headFilters: headFilters.length > 0 ? headFilters : undefined,
          limit: 300,
        }),
        getTelemetry(),
        getTriage(),
        getHeads(),
      ]);
      setPage(pageResult);
      setTelemetry(telemetryResult);
      setTriage(triageResult);
      setHeads(headsResult.heads);
      if (mode === 'topology') setGraph(await getGraph());
      if (selectedId) {
        try { setDetail(await getCapture(selectedId)); } catch { setDetail(null); setSelectedId(null); }
      }
    } catch (error) {
      if (error instanceof Error && 'status' in error && (error as { status: number }).status === 401) {
        setAuthed(false);
        return;
      }
      notify(error instanceof Error ? error.message : 'Refresh failed', 'error');
    }
  }, [authed, bucket, tag, smart, headFilters, mode, selectedId, notify]);

  useEffect(() => {
    getMe().then((result) => setAuthed(result.authenticated)).catch(() => setAuthed(false));
  }, []);

  useEffect(() => {
    if (!authed) return;
    void refresh();
  }, [authed, refresh]);

  useEffect(() => {
    if (!authed) return;
    const close = openEvents((type) => {
      setConnected(true);
      if (type === 'capture.deleted' && confirmDelete) setConfirmDelete(null);
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => { void refresh(); }, 180);
    });
    setConnected(true);
    return () => { close(); setConnected(false); };
  }, [authed, refresh, confirmDelete]);

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
      if (typing) return;
      if (event.key === '/') { event.preventDefault(); setPaletteOpen(true); }
      else if (event.key === '1') setMode('stream');
      else if (event.key === '2') setMode('topology');
      else if (event.key === '3') setMode('triage');
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

  const toggleJevMode = useCallback(async () => {
    const current = telemetry?.jevMode ?? 'gated';
    const next = current === 'gated' ? 'off' : current === 'off' ? 'bootstrap' : 'gated';
    try {
      await updateSettings({ jev_mode: next });
      notify(`Jev mode → ${next}`, 'success');
      void refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Mode change failed', 'error');
    }
  }, [telemetry?.jevMode, notify, refresh]);

  async function submitCapture(): Promise<void> {
    if (!captureText.trim() || captureBusy) return;
    setCaptureBusy(true);
    try {
      const result = await createCapture(captureText);
      setCaptureText('');
      setCaptureOpen(false);
      if (result.kind === 'resonance') notify(`🔁 Resonance ×${result.count} — boosted`, 'success');
      else notify('Capture routed', 'success');
      void refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Capture failed', 'error');
    } finally {
      setCaptureBusy(false);
    }
  }

  async function handleSave(id: string, content: string): Promise<void> {
    try {
      await updateCapture(id, { content } as Partial<Capture>);
      notify('Saved · re-embedded', 'success');
      void refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Save failed', 'error');
    }
  }

  async function handleOverride(id: string, headId: string, valueText?: string, valueNum?: number): Promise<void> {
    try {
      await overrideDecision(id, headId, valueText, valueNum);
      notify('Override trained local probe (+2.5×)', 'success');
      void refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Override failed', 'error');
    }
  }

  async function handlePin(id: string, pinned: boolean): Promise<void> {
    try { await updateCapture(id, { isPinned: pinned }); notify(pinned ? 'Pinned · decay locked' : 'Unpinned', 'success'); void refresh(); }
    catch (error) { notify(error instanceof Error ? error.message : 'Pin failed', 'error'); }
  }

  async function handleResolve(id: string): Promise<void> {
    try { await updateCapture(id, { status: 'resolved' }); notify('Resolved', 'success'); void refresh(); }
    catch (error) { notify(error instanceof Error ? error.message : 'Resolve failed', 'error'); }
  }

  async function handleDelete(id: string): Promise<void> {
    try {
      await deleteCapture(id);
      setConfirmDelete(null);
      setDetail(null);
      setSelectedId(null);
      notify('Capture deleted', 'success');
      void refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Delete failed', 'error');
    }
  }

  async function handleJev(id: string): Promise<void> {
    try {
      await forceJev(id);
      notify('Jev re-evaluation complete', 'success');
      void refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Jev call capped or unavailable', 'error');
    }
  }

  async function handleBucket(id: string, nextBucket: Bucket): Promise<void> {
    try { await updateCapture(id, { bucket: nextBucket }); notify(`Bucket → ${nextBucket} · probe trained`, 'success'); void refresh(); }
    catch (error) { notify(error instanceof Error ? error.message : 'Bucket update failed', 'error'); }
  }

  async function handleReminder(id: string, action: 'done' | 'snooze4' | 'kill'): Promise<void> {
    try {
      if (action === 'done') {
        await updateCapture(id, { status: 'resolved', reminderDueAt: null } as Partial<Capture>);
      } else if (action === 'kill') {
        await updateCapture(id, { reminderDueAt: null });
      } else {
        await updateCapture(id, { reminderDueAt: Date.now() + 4 * 3_600_000 });
      }
      notify('Reminder updated', 'success');
      void refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Reminder update failed', 'error');
    }
  }

  async function handleKeep(id: string): Promise<void> {
    try { await updateCapture(id, { isPinned: true }); notify('Kept · decay locked', 'success'); void refresh(); }
    catch (error) { notify(error instanceof Error ? error.message : 'Keep failed', 'error'); }
  }

  async function handleSublimate(id: string): Promise<void> {
    try { await updateCapture(id, { status: 'sublimated' }); notify('Sublimated', 'success'); void refresh(); }
    catch (error) { notify(error instanceof Error ? error.message : 'Sublimate failed', 'error'); }
  }

  async function handleLogout(): Promise<void> {
    await logout().catch(() => undefined);
    setAuthed(false);
    setPage(null);
    setDetail(null);
  }

  if (authed === null) {
    return <div className="flex h-full items-center justify-center text-[var(--muted)]"><LoaderCircle className="animate-spin" size={18} /></div>;
  }
  if (!authed) return <LoginGate onAuthed={() => setAuthed(true)} />;

  const captures = page?.captures ?? [];
  const triageCount = triage ? triage.uncertain.length + triage.paradoxes.length + triage.zombies.length + triage.expiring.length : 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar
        mode={mode}
        onMode={setMode}
        onSearch={() => setPaletteOpen(true)}
        onCapture={() => setCaptureOpen(true)}
        onLogout={() => void handleLogout()}
        connected={connected}
        triageCount={triageCount}
        jevMode={telemetry?.jevMode ?? 'gated'}
      />

      <div className="flex min-h-0 flex-1">
        <LeftRail
          counts={page?.bucketCounts ?? {}}
          activeBucket={bucket}
          onBucket={(next) => { setBucket(next); setSelectedId(null); setDetail(null); }}
          heads={heads}
          headValues={headValues}
          onHeadValue={(head, value) => setHeadValues((current) => ({ ...current, [head]: value }))}
          tags={telemetry?.tags ?? []}
          activeTag={tag}
          onTag={setTag}
          telemetry={telemetry}
          smart={smart}
          onSmart={setSmart}
          onOpenJev={() => setMode('jev')}
        />

        <main className="relative min-w-0 flex-1 bg-[#090b0d]">
          {mode === 'stream' ? (
            <StreamView
              captures={captures}
              selectedId={selectedId}
              onSelect={selectCapture}
              heads={heads}
              onPin={(capture) => void handlePin(capture.id, !capture.isPinned)}
              onResolve={(capture) => void handleResolve(capture.id)}
              onDelete={(capture) => setConfirmDelete(capture.id)}
              onJev={(capture) => void handleJev(capture.id)}
            />
          ) : null}
          {mode === 'topology' ? (
            graph ? (
              <TopologyView
                graph={graph}
                heads={heads}
                onSelect={(id) => { const capture = captures.find((item) => item.id === id); if (capture) selectCapture(capture); else setSelectedId(id); void loadDetail(id); }}
                heat={heat}
                onHeat={setHeat}
                decayDays={decayDays}
                onDecayDays={setDecayDays}
              />
            ) : <div className="flex h-full items-center justify-center text-[var(--muted)]"><LoaderCircle className="animate-spin" size={18} /></div>
          ) : null}
          {mode === 'triage' && triage ? (
            <TriageView
              triage={triage}
              onSelect={(id) => { setSelectedId(id); void loadDetail(id); }}
              onBucket={(id, nextBucket) => void handleBucket(id, nextBucket)}
              onKeep={(id) => void handleKeep(id)}
              onSublimate={(id) => void handleSublimate(id)}
              onReminderAction={(id, action) => void handleReminder(id, action)}
              onResolve={(capture) => void handleResolve(capture.id)}
              notify={notify}
            />
          ) : null}
          {mode === 'triage' && !triage ? <div className="flex h-full items-center justify-center text-[var(--muted)]"><LoaderCircle className="animate-spin" size={18} /></div> : null}
          {mode === 'jev' ? (
            <JevLabView telemetry={telemetry} heads={heads} onRefresh={() => void refresh()} notify={notify} />
          ) : null}
        </main>

        {inspectorOpen ? (
          <Inspector
            detail={detail}
            heads={heads}
            onClose={() => setInspectorOpen(false)}
            onSave={(id, content) => void handleSave(id, content)}
            onOverride={(id, headId, valueText, valueNum) => void handleOverride(id, headId, valueText, valueNum)}
            onPin={(id, pinned) => void handlePin(id, pinned)}
            onResolve={(id) => void handleResolve(id)}
            onJev={(id) => void handleJev(id)}
            onDelete={(id) => setConfirmDelete(id)}
            onJump={(id) => { setSelectedId(id); void loadDetail(id); }}
          />
        ) : null}
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onSelect={(capture) => selectCapture(capture)}
        onCapture={() => setCaptureOpen(true)}
        onMode={setMode}
        onToggleJev={() => void toggleJevMode()}
        onCollide={() => notify('Run /collide in Telegram for a cost-previewed Jev synthesis pass.', 'info')}
      />

      {captureOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) setCaptureOpen(false); }}>
          <div className="w-full max-w-[560px] animate-rise rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] p-5">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text)]"><Plus size={14} className="text-[var(--emerald)]" /> New Capture</h2>
              <button type="button" onClick={() => setCaptureOpen(false)} className="text-[var(--muted)] hover:text-[var(--text)]"><X size={15} /></button>
            </div>
            <textarea
              value={captureText}
              onChange={(event) => setCaptureText(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submitCapture(); }}
              rows={5}
              autoFocus
              placeholder="Atomic thought, #tag, !rem tomorrow 9am, https://…"
              className="mt-3 w-full resize-y rounded border border-[var(--border-strong)] bg-[#0b0f12] p-3 text-[13px] leading-relaxed outline-none focus:border-[var(--emerald)]"
            />
            <div className="mt-3 flex items-center justify-between">
              <span className="mono text-[10px] text-[var(--muted)]">#hashtags · !rem · mem: · idea: · URL readability</span>
              <button type="button" onClick={() => void submitCapture()} disabled={captureBusy || !captureText.trim()} className="flex items-center gap-1.5 rounded bg-[var(--emerald)] px-3 py-1.5 text-[11px] font-semibold text-[#05130d] disabled:opacity-40">
                {captureBusy ? <LoaderCircle size={12} className="animate-spin" /> : null} Route capture
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete capture?"
        description="This hard-deletes the capture, its edges, decisions, reminder and vector. It cannot be undone."
        confirmLabel="Delete"
        danger
        busy={deleting}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => { if (confirmDelete) { setDeleting(true); void handleDelete(confirmDelete).finally(() => setDeleting(false)); } }}
      />

      {toast ? <Toast key={toast.id} message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}
