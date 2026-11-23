import { useState } from 'react';
import { FlaskConical, Gauge, Plus, Sparkles, Trash2, Wand2 } from 'lucide-react';
import type { Head, Telemetry } from '../types/capture';
import { createHead, deleteHead, previewSweep, runSweep, testHeads, updateHead, updateSettings } from '../api/client';
import { cn } from '../lib/utils';

interface LocalResult { headId: string; name: string; primitive: string; latencyMs: number; valueText: string | null; valueNum: number | null; confidence: number; entropy: number; probs: Record<string, number> }
interface TestResult { deterministic: Record<string, unknown>; local: LocalResult[]; jev: { predictions: Array<Record<string, unknown>>; latencyMs: number } | null }

export function JevLabView({
  telemetry, heads, onRefresh, notify,
}: {
  telemetry: Telemetry | null;
  heads: Head[];
  onRefresh: () => void;
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
}) {
  const [name, setName] = useState('');
  const [primitive, setPrimitive] = useState<'choice' | 'score' | 'noul'>('score');
  const [instructions, setInstructions] = useState('');
  const [playground, setPlayground] = useState('The local probe should learn this boundary after enough Jev labels.');
  const [useJev, setUseJev] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [sweepHead, setSweepHead] = useState<Head | null>(null);
  const [sweepPreview, setSweepPreview] = useState<{ count: number; estimatedUsd: number } | null>(null);
  const [sweepBusy, setSweepBusy] = useState(false);

  const mode = telemetry?.jevMode ?? 'gated';

  async function setMode(next: string): Promise<void> {
    await updateSettings({ jev_mode: next });
    onRefresh();
    notify(`Jev mode → ${next}`, 'success');
  }

  async function addHead(): Promise<void> {
    if (!name.trim()) return;
    try {
      await createHead({ name: name.trim(), primitive, instructions: instructions.trim() || name.trim() });
      setName(''); setInstructions('');
      onRefresh();
      notify('Decision head created', 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Create head failed', 'error');
    }
  }

  async function runTest(): Promise<void> {
    if (testing) return;
    setTesting(true);
    try {
      setTest(await testHeads(playground, useJev) as unknown as TestResult);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Playground failed', 'error');
    } finally {
      setTesting(false);
    }
  }

  async function openSweep(head: Head): Promise<void> {
    setSweepHead(head); setSweepPreview(null);
    try { setSweepPreview(await previewSweep(head.id, { onlyMissing: true })); }
    catch { setSweepPreview({ count: 0, estimatedUsd: 0 }); }
  }

  async function runSweepNow(): Promise<void> {
    if (!sweepHead) return;
    setSweepBusy(true);
    try {
      const result = await runSweep(sweepHead.id, { onlyMissing: true });
      notify(`Sweep started · ${result.count} captures`, 'success');
      setSweepHead(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Sweep failed', 'error');
    } finally { setSweepBusy(false); }
  }

  const dailyPct = telemetry ? Math.min(100, (telemetry.usageToday / Math.max(1, telemetry.caps.dailyCalls)) * 100) : 0;

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="grid grid-cols-2 gap-4">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--hint)]"><Sparkles size={13} className="text-[var(--amber)]" /> Escalation Mode</h2>
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {(['gated', 'bootstrap', 'off'] as const).map((value) => (
              <button key={value} type="button" onClick={() => void setMode(value)} className={cn('rounded border px-2 py-2 text-[11px] capitalize transition', mode === value ? 'border-[var(--emerald)] bg-[var(--emerald-soft)] text-[var(--emerald)]' : 'border-[var(--border)] text-[var(--hint)] hover:text-[var(--text)]')}>{value}</button>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted)]">
            Gated spends $0 until a local probe is cold, uncertain, or the cosine collision band fires. Bootstrap routes every capture to Jev to collect labels. Off is strict local-only.
          </p>
          <div className="mono mt-3 grid grid-cols-2 gap-2 text-[10.5px] text-[var(--hint)]">
            <label>Daily calls<input type="number" readOnly value={telemetry?.caps.dailyCalls ?? 30} className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[var(--muted)] outline-none" /></label>
            <label>Bootstrap target<input type="number" defaultValue={telemetry?.settings.bootstrap_target ?? '40'} onBlur={(event) => void updateSettings({ bootstrap_target: event.target.value })} className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 outline-none" /></label>
            <label>Collision min cos<input type="number" step="0.01" defaultValue={telemetry?.settings.collision_min_cos ?? '0.68'} onBlur={(event) => void updateSettings({ collision_min_cos: event.target.value })} className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 outline-none" /></label>
            <label>Resonance min cos<input type="number" step="0.01" defaultValue={telemetry?.settings.resonance_min_cos ?? '0.91'} onBlur={(event) => void updateSettings({ resonance_min_cos: event.target.value })} className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 outline-none" /></label>
          </div>
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--hint)]"><Gauge size={13} className="text-[var(--emerald)]" /> Cost & Distillation</h2>
          <div className="mt-3 space-y-2">
            <Bar label={`Daily Jev calls · ${telemetry?.usageToday ?? 0}/${telemetry?.caps.dailyCalls ?? 30}`} value={dailyPct} tone="amber" />
            <Bar label={`Daily USD · $${(telemetry?.usageTodayUsd ?? 0).toFixed(4)} / $${telemetry?.caps.dailyUsd ?? 0.25}`} value={Math.min(100, ((telemetry?.usageTodayUsd ?? 0) / Math.max(0.0001, telemetry?.caps.dailyUsd ?? 0.25)) * 100)} tone="amber" />
            <Bar label={`Month USD · $${(telemetry?.usageMonthUsd ?? 0).toFixed(4)} / $${telemetry?.caps.monthlyUsd ?? 3}`} value={Math.min(100, ((telemetry?.usageMonthUsd ?? 0) / Math.max(0.0001, telemetry?.caps.monthlyUsd ?? 3)) * 100)} tone="rose" />
            <Bar label={`RAM RSS · ${telemetry?.rssMb ?? 0} MB / 400 MB`} value={Math.min(100, ((telemetry?.rssMb ?? 0) / 400) * 100)} tone="emerald" />
            <Bar label={`Local hit rate · ${Math.round((telemetry?.localHitRate ?? 0) * 100)}%`} value={(telemetry?.localHitRate ?? 0) * 100} tone="emerald" />
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2 text-center">
            {(telemetry?.headStats ?? []).map((head) => (
              <div key={head.id} className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-2">
                <div className="mono text-[13px] text-[var(--emerald)]">{Math.round(head.agreement * 100)}%</div>
                <div className="truncate text-[9px] text-[var(--muted)]">{head.name}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--hint)]">Decision Heads</h2>
        <div className="mt-3 flex gap-2">
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="head_name" className="mono w-36 rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-[11px] outline-none" />
          <select value={primitive} onChange={(event) => setPrimitive(event.target.value as typeof primitive)} className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-[11px] outline-none">
            <option value="score">score</option><option value="noul">noul</option><option value="choice">choice</option>
          </select>
          <input value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Instructions for this head…" className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-[11px] outline-none" />
          <button type="button" onClick={() => void addHead()} className="flex items-center gap-1 rounded bg-[var(--emerald)] px-3 py-1.5 text-[11px] font-semibold text-[#05130d]"><Plus size={12} /> Add</button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {heads.map((head) => (
            <div key={head.id} className="flex items-center gap-2 rounded border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11.5px] text-[var(--text)]">{head.name}</span>
                  <span className="mono rounded border border-[var(--border)] px-1 text-[9px] text-[var(--muted)]">{head.primitive}</span>
                  {head.isSystem ? <span className="text-[9px] text-[var(--amber)]">system</span> : null}
                </div>
                <div className="mono mt-0.5 text-[9.5px] text-[var(--muted)]">n={head.sampleCount} · eval={head.evalCount} · acc={head.evalCount > 0 ? `${Math.round((head.agreementCount / head.evalCount) * 100)}%` : '—'}</div>
              </div>
              <button type="button" onClick={() => void updateHead(head.id, { active: !head.active }).then(onRefresh)} className={cn('mono rounded px-1.5 py-0.5 text-[9px]', head.active ? 'bg-[var(--emerald-soft)] text-[var(--emerald)]' : 'bg-[var(--surface-hover)] text-[var(--muted)]')}>{head.active ? 'on' : 'off'}</button>
              <button type="button" onClick={() => void openSweep(head)} title="Targeted sweep" className="text-[var(--amber)] hover:brightness-125"><Wand2 size={12} /></button>
              {!head.isSystem ? <button type="button" onClick={() => void deleteHead(head.id).then(onRefresh)} className="text-[var(--muted)] hover:text-[var(--rose)]"><Trash2 size={12} /></button> : null}
            </div>
          ))}
        </div>
      </section>

      <section className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--hint)]"><FlaskConical size={13} className="text-[var(--cyan)]" /> Live Playground</h2>
        <textarea value={playground} onChange={(event) => setPlayground(event.target.value)} rows={3} className="mt-3 w-full resize-y rounded border border-[var(--border)] bg-[var(--surface-2)] p-2.5 text-[12px] outline-none" />
        <div className="mt-2 flex items-center gap-3">
          <button type="button" onClick={() => void runTest()} disabled={testing} className="rounded bg-[var(--emerald)] px-3 py-1.5 text-[11px] font-semibold text-[#05130d] disabled:opacity-50">{testing ? 'Running…' : 'Run local probe'}</button>
          <label className="flex items-center gap-1.5 text-[11px] text-[var(--hint)]"><input type="checkbox" checked={useJev} onChange={(event) => setUseJev(event.target.checked)} className="accent-[var(--amber)]" /> include Jev</label>
        </div>
        {test ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-2.5">
              <div className="text-[9px] uppercase tracking-wider text-[var(--muted)]">Local probe</div>
              {test.local.map((item) => (
                <div key={item.headId} className="mt-1.5 text-[11px]">
                  <div className="flex justify-between"><span className="text-[var(--hint)]">{item.name}</span><span className="mono text-[var(--emerald)]">{item.valueText ?? item.valueNum?.toFixed(2)} · {(item.confidence * 100).toFixed(0)}% · {item.latencyMs}ms</span></div>
                  <div className="mono text-[9px] text-[var(--muted)]">H {item.entropy.toFixed(2)}</div>
                </div>
              ))}
            </div>
            <div className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-2.5">
              <div className="text-[9px] uppercase tracking-wider text-[var(--muted)]">Jev {test.jev ? `· ${test.jev.latencyMs}ms` : '(disabled / capped)'}</div>
              {test.jev ? test.jev.predictions.map((prediction, index) => (
                <pre key={index} className="mono mt-1.5 overflow-x-auto text-[9px] text-[var(--hint)]">{JSON.stringify(prediction)}</pre>
              )) : <p className="mt-1.5 text-[10px] text-[var(--muted)]">Not requested.</p>}
            </div>
          </div>
        ) : null}
      </section>

      {sweepHead ? (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) setSweepHead(null); }}>
          <div className="w-full max-w-[420px] animate-rise rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] p-5">
            <h3 className="text-[13px] font-semibold text-[var(--text)]">Targeted Sweep · {sweepHead.name}</h3>
            <p className="mt-2 text-[11px] text-[var(--hint)]">Run this head over captures missing a Jev label. The preview is exact before spending.</p>
            <div className="mono mt-3 rounded border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[11px] text-[var(--hint)]">
              {sweepPreview ? <>Items: <span className="text-[var(--text)]">{sweepPreview.count}</span><br />Estimated cost: <span className="text-[var(--amber)]">${sweepPreview.estimatedUsd.toFixed(4)}</span></> : 'Calculating…'}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setSweepHead(null)} className="rounded border border-[var(--border-strong)] px-3 py-1.5 text-[11px] text-[var(--hint)]">Cancel</button>
              <button type="button" disabled={!sweepPreview || sweepPreview.count === 0 || sweepBusy} onClick={() => void runSweepNow()} className="rounded bg-[var(--emerald)] px-3 py-1.5 text-[11px] font-semibold text-[#05130d] disabled:opacity-40">{sweepBusy ? 'Starting…' : 'Run sweep'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Bar({ label, value, tone }: { label: string; value: number; tone: 'amber' | 'rose' | 'emerald' }) {
  const color = tone === 'amber' ? 'bg-[var(--amber)]' : tone === 'rose' ? 'bg-[var(--rose)]' : 'bg-[var(--emerald)]';
  return (
    <div>
      <div className="text-[10px] text-[var(--hint)]">{label}</div>
      <div className="mt-1 h-1.5 overflow-hidden rounded bg-[var(--surface-hover)]"><div className={cn('h-full rounded', color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
    </div>
  );
}
