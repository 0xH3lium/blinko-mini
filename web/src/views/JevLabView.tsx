import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, FlaskConical, Gauge, Pencil, Plus, Sparkles, Trash2, Wand2, X } from 'lucide-react';
import {
  createHead, deleteHead, previewSweep, runSweep, setJevMode, testJev, updateHead,
} from '../api/client';
import type { Head, JevResult, Primitive, Telemetry } from '../types/capture';
import { cn } from '../lib/utils';
import type { Notify } from '../types/ui';

interface SweepProgress { headId: string; done: number; total: number }

export function JevLabView({
  telemetry, heads, sweepProgress, onRefresh, notify,
}: {
  telemetry: Telemetry | null;
  heads: Head[];
  sweepProgress: SweepProgress | null;
  onRefresh: () => void;
  notify: Notify;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [primitive, setPrimitive] = useState<Primitive>('score');
  const [instructions, setInstructions] = useState('');
  const [entropyThreshold, setEntropyThreshold] = useState(0.55);
  const [sortOrder, setSortOrder] = useState(0);
  const [active, setActive] = useState(true);
  const [options, setOptions] = useState<Array<{ value: string; description: string }>>([]);
  const [min, setMin] = useState(0);
  const [max, setMax] = useState(3);
  const [rubric, setRubric] = useState<Record<string, string>>({});
  const [sweepHead, setSweepHead] = useState<Head | null>(null);
  const [sweepQuery, setSweepQuery] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [sweepPreview, setSweepPreview] = useState<{ count: number; estimatedUsd: number } | null>(null);
  const [playground, setPlayground] = useState('A concrete mechanism with a falsifiable claim.');
  const [playgroundUrl, setPlaygroundUrl] = useState('');
  const [result, setResult] = useState<JevResult | null>(null);
  const [running, setRunning] = useState(false);

  const mode = telemetry?.jevMode ?? 'auto';

  useEffect(() => {
    if (!sweepHead) return;
    let cancelled = false;
    previewSweep(sweepHead.id, { q: sweepQuery, onlyMissing })
      .then((preview) => { if (!cancelled) setSweepPreview(preview); })
      .catch(() => { if (!cancelled) setSweepPreview({ count: 0, estimatedUsd: 0 }); });
    return () => { cancelled = true; };
  }, [sweepHead, sweepQuery, onlyMissing]);

  function openEditor(head?: Head): void {
    setEditing(head?.id ?? null);
    setName(head?.name ?? '');
    setPrimitive(head?.primitive ?? 'score');
    setInstructions(head?.instructions ?? '');
    setEntropyThreshold(head?.entropyThreshold ?? 0.55);
    setSortOrder(head?.sortOrder ?? heads.length);
    setActive(head?.active ?? true);
    setOptions(head?.config.options?.map((option) => ({ value: option.value, description: option.description ?? '' })) ?? [
      { value: 'yes', description: 'criterion for yes' },
      { value: 'no', description: 'criterion for no' },
    ]);
    setMin(head?.config.min ?? 0);
    setMax(head?.config.max ?? 3);
    setRubric(head?.config.rubric ?? {});
  }

  function configFor(): Record<string, unknown> {
    if (primitive === 'choice') return { options: options.filter((option) => option.value.trim()) };
    if (primitive === 'score') {
      const next: Record<string, string> = {};
      for (let level = min; level <= max; level += 1) next[String(level)] = rubric[String(level)] ?? `score ${level}`;
      return { min, max, rubric: next };
    }
    return {};
  }

  async function saveHead(): Promise<void> {
    const input = {
      name,
      primitive,
      instructions: instructions || name,
      config: configFor(),
      entropyThreshold,
      sortOrder,
      active,
    };
    if (!name.trim()) return notify('Head name is required', 'error');
    try {
      if (editing) await updateHead(editing, input);
      else await createHead(input);
      openEditor();
      onRefresh();
      notify(editing ? 'Head updated' : 'Head created', 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Head save failed', 'error');
    }
  }

  async function toggleMode(next: 'auto' | 'off'): Promise<void> {
    try {
      await setJevMode(next);
      notify(`Jev mode → ${next}`, 'success');
      onRefresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Mode change failed', 'error');
    }
  }

  async function runPlayground(): Promise<void> {
    setRunning(true);
    try {
      const response = await testJev({ text: playground, ...(playgroundUrl ? { url: playgroundUrl } : {}) });
      setResult(response.jev);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Jev playground failed', 'error');
    } finally {
      setRunning(false);
    }
  }

  const dailyPct = telemetry ? Math.min(100, (telemetry.usageToday / Math.max(1, telemetry.caps.dailyCalls)) * 100) : 0;

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="grid grid-cols-2 gap-4">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--hint)]"><Sparkles size={13} className="text-[var(--amber)]" /> Engine Control</h2>
          <div className="mt-3 flex gap-1.5">
            {(['auto', 'off'] as const).map((value) => (
              <button key={value} type="button" onClick={() => void toggleMode(value)} className={cn('flex-1 rounded border px-3 py-2 text-[11px] uppercase', mode === value ? 'border-[var(--emerald)] bg-[var(--emerald-soft)] text-[var(--emerald)]' : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]')}>{value}</button>
            ))}
          </div>
          <div className="mono mt-3 space-y-1.5 text-[10.5px] text-[var(--hint)]">
            <div className="flex justify-between"><span>Model</span><span className="text-[var(--text)]">{telemetry?.jevModel ?? 'typesafe/jev-1.14'}</span></div>
            <div className="flex justify-between"><span>Today</span><span>{telemetry?.usageToday ?? 0}/{telemetry?.caps.dailyCalls ?? 30} · ${(telemetry?.usageTodayUsd ?? 0).toFixed(4)}</span></div>
            <Bar label="Daily calls" value={dailyPct} tone="amber" />
            <Bar label={`Month USD · $${(telemetry?.usageMonthUsd ?? 0).toFixed(4)} / $${telemetry?.caps.monthlyUsd ?? 3}`} value={Math.min(100, ((telemetry?.usageMonthUsd ?? 0) / Math.max(0.0001, telemetry?.caps.monthlyUsd ?? 3)) * 100)} tone="rose" />
            <Bar label={`RAM RSS · ${telemetry?.rssMb ?? 0} MB`} value={Math.min(100, ((telemetry?.rssMb ?? 0) / 400) * 100)} tone="emerald" />
            <div className="flex justify-between"><span>Price</span><span>${telemetry?.caps.priceUsdPerMillion ?? 0.042}/1M input tokens</span></div>
          </div>
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--hint)]"><Gauge size={13} className="text-[var(--emerald)]" /> Budget Firewall</h2>
          <div className="mono mt-3 grid grid-cols-3 gap-2 text-center text-[10px] text-[var(--muted)]">
            <div className="rounded border border-[var(--border)] p-2"><div className="text-[15px] text-[var(--text)]">{telemetry?.usageToday ?? 0}</div>calls today</div>
            <div className="rounded border border-[var(--border)] p-2"><div className="text-[15px] text-[var(--amber)]">${(telemetry?.usageTodayUsd ?? 0).toFixed(4)}</div>today USD</div>
            <div className="rounded border border-[var(--border)] p-2"><div className="text-[15px] text-[var(--rose)]">${(telemetry?.usageMonthUsd ?? 0).toFixed(4)}</div>month USD</div>
          </div>
          <div className="mono mt-3 space-y-1 text-[9.5px] text-[var(--muted)]">
            {(telemetry?.headStats ?? []).map((head) => (
              <div key={head.id} className="flex justify-between"><span>{head.name}</span><span>{head.decisions} decisions · avg H {(head.avgEntropy ?? 0).toFixed(2)}</span></div>
            ))}
          </div>
        </section>
      </div>

      <section className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--hint)]">Head Studio</h2>
          <button type="button" onClick={() => openEditor()} className="flex items-center gap-1 rounded bg-[var(--emerald)] px-2.5 py-1.5 text-[10.5px] font-semibold text-[#05130d]"><Plus size={11} /> New head</button>
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
                <div className="mono mt-0.5 text-[9px] text-[var(--muted)]">H&gt;{head.entropyThreshold.toFixed(2)} · order {head.sortOrder} · {head.active ? 'active' : 'off'}</div>
              </div>
              <button type="button" onClick={() => void updateHead(head.id, { active: !head.active }).then(onRefresh)} className="mono rounded border border-[var(--border)] px-1 py-0.5 text-[9px] text-[var(--hint)]">{head.active ? 'on' : 'off'}</button>
              <button type="button" onClick={() => void updateHead(head.id, { sortOrder: head.sortOrder - 1 }).then(onRefresh)} title="Move up"><ArrowUp size={10} className="text-[var(--muted)]" /></button>
              <button type="button" onClick={() => void updateHead(head.id, { sortOrder: head.sortOrder + 1 }).then(onRefresh)} title="Move down"><ArrowDown size={10} className="text-[var(--muted)]" /></button>
              <button type="button" onClick={() => openEditor(head)} title="Edit"><Pencil size={10} className="text-[var(--hint)]" /></button>
              <button type="button" onClick={() => void previewSweep(head.id, { q: '', onlyMissing: true }).then(() => setSweepHead(head))} title="Sweep"><Wand2 size={11} className="text-[var(--amber)]" /></button>
              <button type="button" onClick={() => void deleteHead(head.id).then(onRefresh)} title="Delete"><Trash2 size={10} className="text-[var(--muted)] hover:text-[var(--rose)]" /></button>
            </div>
          ))}
        </div>
      </section>

      {editing !== null || name ? (
        <section className="mt-4 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[12px] font-semibold text-[var(--text)]">{editing ? `Edit head · ${name}` : 'New head'}</h2>
            <button type="button" onClick={() => openEditor()} className="text-[var(--muted)] hover:text-[var(--text)]"><X size={13} /></button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="head_name" className="mono rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-[11px] outline-none" />
            <select value={primitive} onChange={(event) => setPrimitive(event.target.value as Primitive)} className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-[11px]">
              <option value="score">score</option><option value="noul">noul</option><option value="choice">choice</option>
            </select>
            <input value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Instructions" className="col-span-2 rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-[11px] outline-none" />
            <label className="text-[10px] text-[var(--muted)]">Entropy threshold<input type="number" min={0} max={1} step={0.01} value={entropyThreshold} onChange={(event) => setEntropyThreshold(Number(event.target.value))} className="mono mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 outline-none" /></label>
            <label className="text-[10px] text-[var(--muted)]">Sort order<input type="number" value={sortOrder} onChange={(event) => setSortOrder(Number(event.target.value))} className="mono mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 outline-none" /></label>
          </div>

          {primitive === 'choice' ? (
            <div className="mt-3">
              <div className="text-[10px] text-[var(--hint)]">Choice options</div>
              {options.map((option, index) => (
                <div key={index} className="mt-1 flex gap-1">
                  <input value={option.value} onChange={(event) => setOptions((current) => current.map((item, position) => position === index ? { ...item, value: event.target.value } : item))} placeholder="value" className="mono w-24 rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-1 text-[10px]" />
                  <input value={option.description} onChange={(event) => setOptions((current) => current.map((item, position) => position === index ? { ...item, description: event.target.value } : item))} placeholder="sharp criterion" className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-1 text-[10px]" />
                  <button type="button" onClick={() => setOptions((current) => current.filter((_, position) => position !== index))} className="text-[var(--muted)] hover:text-[var(--rose)]"><X size={11} /></button>
                </div>
              ))}
              <button type="button" onClick={() => setOptions((current) => [...current, { value: '', description: '' }])} className="mt-1.5 rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--hint)]">+ option</button>
            </div>
          ) : null}

          {primitive === 'score' ? (
            <div className="mt-3">
              <div className="flex gap-2 text-[10px] text-[var(--muted)]">
                <label>min <input type="number" value={min} onChange={(event) => setMin(Number(event.target.value))} className="mono w-14 rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-1" /></label>
                <label>max <input type="number" value={max} onChange={(event) => setMax(Number(event.target.value))} className="mono w-14 rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-1" /></label>
              </div>
              <div className="mt-2 space-y-1">
                {Array.from({ length: Math.min(10, Math.max(2, max - min + 1)) }, (_, index) => min + index).map((level) => (
                  <label key={level} className="flex items-center gap-2 text-[10px] text-[var(--muted)]">
                    <span className="mono w-5">{level}</span>
                    <input value={rubric[String(level)] ?? ''} onChange={(event) => setRubric((current) => ({ ...current, [String(level)]: event.target.value }))} placeholder={`rubric for ${level}`} className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-1 text-[10px]" />
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {primitive === 'noul' ? <p className="mt-3 text-[10.5px] text-[var(--muted)]">Noul heads use a crisp yes/no instruction prompt with probabilities.</p> : null}

          <button type="button" onClick={() => void saveHead()} className="mt-3 rounded bg-[var(--emerald)] px-3 py-1.5 text-[10.5px] font-semibold text-[#05130d]">Save head</button>
        </section>
      ) : null}

      <section className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--hint)]"><FlaskConical size={13} className="text-[var(--cyan)]" /> Pure Jev Playground</h2>
        <textarea value={playground} onChange={(event) => setPlayground(event.target.value)} rows={3} className="mt-3 w-full resize-y rounded border border-[var(--border)] bg-[var(--surface-2)] p-2.5 text-[12px] outline-none" />
        <div className="mt-2 flex gap-2">
          <input value={playgroundUrl} onChange={(event) => setPlaygroundUrl(event.target.value)} placeholder="optional https://…" className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-[11px] outline-none" />
          <button type="button" onClick={() => void runPlayground()} disabled={running} className="rounded bg-[var(--emerald)] px-3 py-1.5 text-[11px] font-semibold text-[#05130d] disabled:opacity-50">{running ? 'Running…' : 'Run Jev'}</button>
        </div>
        {result ? (
          <div className="mono mt-3 rounded border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[10px] text-[var(--hint)]">
            <div className="mb-2 text-[var(--emerald)]">{result.modelVersion} · {result.latencyMs}ms · ${result.costUsd.toFixed(6)} · {result.inputTokens} in / {result.outputTokens} out</div>
            {result.predictions.map((prediction) => (
              <div key={prediction.headId} className="mt-1">
                {prediction.headId.slice(-8)} → {prediction.valueText ?? prediction.valueNum} · conf {prediction.confidence.toFixed(2)} · H {prediction.entropy.toFixed(2)}
                <div className="ml-2 text-[var(--muted)]">{Object.entries(prediction.probs).map(([key, value]) => `${key}:${(value * 100).toFixed(0)}%`).join(' · ')}</div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {sweepHead ? (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) setSweepHead(null); }}>
          <div className="w-full max-w-[440px] animate-rise rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-[var(--text)]">Targeted sweep · {sweepHead.name}</h3>
              <button type="button" onClick={() => setSweepHead(null)} className="text-[var(--muted)]"><X size={14} /></button>
            </div>
            <input value={sweepQuery} onChange={(event) => setSweepQuery(event.target.value)} placeholder="Query DSL, e.g. b:idea leverage<2" className="mt-3 w-full rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-[11px] outline-none" />
            <label className="mt-2 flex items-center gap-2 text-[10.5px] text-[var(--hint)]"><input type="checkbox" checked={onlyMissing} onChange={(event) => setOnlyMissing(event.target.checked)} className="accent-[var(--emerald)]" /> only missing this head</label>
            <div className="mono mt-3 rounded border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[11px] text-[var(--hint)]">
              Items: <span className="text-[var(--text)]">{sweepPreview?.count ?? '…'}</span><br />
              Estimated cost: <span className="text-[var(--amber)]">${(sweepPreview?.estimatedUsd ?? 0).toFixed(6)}</span> @ $0.042/1M input tokens
            </div>
            {sweepProgress?.headId === sweepHead.id ? (
              <div className="mt-2">
                <div className="mono text-[10px] text-[var(--muted)]">{sweepProgress.done}/{sweepProgress.total}</div>
                <div className="mt-1 h-1.5 overflow-hidden rounded bg-[var(--surface-hover)]"><div className="h-full bg-[var(--emerald)]" style={{ width: `${(sweepProgress.done / Math.max(1, sweepProgress.total)) * 100}%` }} /></div>
              </div>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setSweepHead(null)} className="rounded border border-[var(--border-strong)] px-3 py-1.5 text-[11px] text-[var(--hint)]">Cancel</button>
              <button type="button" disabled={!sweepPreview || sweepPreview.count === 0} onClick={() => void runSweep(sweepHead.id, { q: sweepQuery, onlyMissing }).then((response) => { notify(`Sweep started · ${response.count} captures`, 'success'); setSweepHead(null); })} className="rounded bg-[var(--emerald)] px-3 py-1.5 text-[11px] font-semibold text-[#05130d] disabled:opacity-40">Run sweep</button>
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
      <div>{label}</div>
      <div className="mt-1 h-1 overflow-hidden rounded bg-[var(--surface-hover)]"><div className={cn('h-full rounded', color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
    </div>
  );
}
