import { useEffect, useState } from 'react';
import {
  ArrowDown, ArrowUp, Check, Database, Download, FileJson, LayoutGrid, Play, Plus, RefreshCw, Save, SlidersHorizontal, Trash2, WandSparkles,
} from 'lucide-react';
import {
  createExtractor, createField, createRule, deleteExtractor, deleteField, deleteRule, exportUrl,
  extract, getCaptures, importBackup, maintenance, previewSweep, runSweep, testRules, updateExtractor,
  updateField, updateRule, updateSettings,
} from '../api/client';
import type { Capture, CustomField, ExtractorTemplate, Rule } from '../types/capture';
import { cn, downloadText } from '../lib/utils';
import type { Notify } from '../types/ui';

type Tab = 'rules' | 'fields' | 'extractors' | 'system';

const FIELD_CONFIG: Record<CustomField['fieldType'], string> = {
  score: '{"min":0,"max":3,"rubric":{"0":"noise","3":"lever"}}',
  choice: '{"options":[{"value":"general","label":"General","color":"#34d399"}]}',
  boolean: '{}',
  text: '{}',
};

const PLACEHOLDERS = ['{{id}}', '{{content}}', '{{bucket}}', '{{tags}}', '{{fields}}', '{{links}}', '{{sourceUrl}}', '{{urlExcerpt}}', '{{createdAtIso}}', '{{dueAtIso}}'];

export function StudioView({
  fields, rules, templates, settings, captures, onRefresh, notify,
}: {
  fields: CustomField[];
  rules: Rule[];
  templates: ExtractorTemplate[];
  settings: Record<string, string>;
  captures: Capture[];
  onRefresh: () => Promise<void>;
  notify: Notify;
}) {
  const [tab, setTab] = useState<Tab>('rules');
  const [ruleId, setRuleId] = useState<string | null>(rules[0]?.id ?? null);
  const rule = rules.find((item) => item.id === ruleId);
  const [ruleDraft, setRuleDraft] = useState({ name: '', priority: 100, enabled: true, stopOnMatch: false, conditions: '{}', actions: '{}' });
  const [jsonMode, setJsonMode] = useState(false);
  const parsePart = (raw: string): Record<string, unknown> => { try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; } };
  const cond = parsePart(ruleDraft.conditions);
  const act = parsePart(ruleDraft.actions);

  const [simText, setSimText] = useState('!L3 tomorrow 8am #reservoir Solve chapter 1 practices');
  const [simResult, setSimResult] = useState<unknown>(null);
  const [sweepQ, setSweepQ] = useState('');
  const [sweepPreview, setSweepPreview] = useState<Awaited<ReturnType<typeof previewSweep>> | null>(null);
  const [overwriteLocked, setOverwriteLocked] = useState(false);

  const [fieldId, setFieldId] = useState<string | null>(null);
  const editingField = fields.find((item) => item.id === fieldId);
  const [fieldDraft, setFieldDraft] = useState({ name: '', alias: '', fieldType: 'score' as CustomField['fieldType'], description: '', config: FIELD_CONFIG.score, showInStream: true, sortOrder: 0 });

  const [templateId, setTemplateId] = useState<string | null>(templates[0]?.id ?? null);
  const editingTemplate = templates.find((item) => item.id === templateId);
  const [templateDraft, setTemplateDraft] = useState({ name: '', slug: '', description: '', outputMode: 'clipboard' as ExtractorTemplate['outputMode'], preamble: '', itemTemplate: '{{content}}', footer: '', includeNeighbors: true, excludeNoise: true, isDefault: false, sortOrder: 0 });
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof extract>> | null>(null);

  const [settingsDraft, setSettingsDraft] = useState<Record<string, string>>(settings);

  useEffect(() => setSettingsDraft(settings), [settings]);
  useEffect(() => { if (!ruleId && rules[0]) setRuleId(rules[0].id); }, [rules, ruleId]);
  useEffect(() => { if (!templateId && templates[0]) setTemplateId(templates[0].id); }, [templates, templateId]);

  function editRulePart(part: 'conditions' | 'actions', key: string, value: unknown): void {
    let object: Record<string, unknown> = {};
    try { object = JSON.parse(ruleDraft[part]) as Record<string, unknown>; } catch { /* keep empty */ }
    if (value === undefined || value === '') delete object[key]; else object[key] = value;
    setRuleDraft({ ...ruleDraft, [part]: JSON.stringify(object, null, 2) });
  }
  useEffect(() => {
    setRuleDraft(rule ? {
      name: rule.name, priority: rule.priority, enabled: rule.enabled, stopOnMatch: rule.stopOnMatch,
      conditions: JSON.stringify(rule.conditions, null, 2), actions: JSON.stringify(rule.actions, null, 2),
    } : { name: '', priority: 100, enabled: true, stopOnMatch: false, conditions: '{}', actions: '{}' });
  }, [rule?.id, rule?.name, rule?.priority, rule?.enabled, rule?.stopOnMatch]);

  useEffect(() => {
    setFieldDraft(editingField ? {
      name: editingField.name, alias: editingField.alias ?? '', fieldType: editingField.fieldType,
      description: editingField.description, config: JSON.stringify(editingField.config, null, 2),
      showInStream: editingField.showInStream, sortOrder: editingField.sortOrder,
    } : { name: '', alias: '', fieldType: 'score', description: '', config: FIELD_CONFIG.score, showInStream: true, sortOrder: 0 });
  }, [editingField?.id]);

  useEffect(() => {
    setTemplateDraft(editingTemplate ? {
      name: editingTemplate.name, slug: editingTemplate.slug, description: editingTemplate.description,
      outputMode: editingTemplate.outputMode, preamble: editingTemplate.preamble, itemTemplate: editingTemplate.itemTemplate,
      footer: editingTemplate.footer, includeNeighbors: editingTemplate.includeNeighbors,
      excludeNoise: editingTemplate.excludeNoise, isDefault: editingTemplate.isDefault, sortOrder: editingTemplate.sortOrder,
    } : { name: '', slug: '', description: '', outputMode: 'clipboard', preamble: '', itemTemplate: '{{content}}', footer: '', includeNeighbors: true, excludeNoise: true, isDefault: false, sortOrder: 0 });
  }, [editingTemplate?.id]);

  async function saveRule(): Promise<void> {
    try {
      const conditions = JSON.parse(ruleDraft.conditions) as Record<string, unknown>;
      const actions = JSON.parse(ruleDraft.actions) as Record<string, unknown>;
      const payload = { name: ruleDraft.name, priority: ruleDraft.priority, enabled: ruleDraft.enabled, stopOnMatch: ruleDraft.stopOnMatch, conditions, actions };
      if (rule) await updateRule(rule.id, payload);
      else await createRule(payload);
      notify('Rule saved', 'success');
      await onRefresh();
    } catch (error) { notify(error instanceof Error ? error.message : 'Invalid rule JSON', 'error'); }
  }

  async function saveField(): Promise<void> {
    try {
      const config = JSON.parse(fieldDraft.config) as Record<string, unknown>;
      const payload = {
        name: fieldDraft.name, alias: fieldDraft.alias || null, fieldType: fieldDraft.fieldType,
        description: fieldDraft.description, config, showInStream: fieldDraft.showInStream, sortOrder: fieldDraft.sortOrder,
      };
      if (editingField) await updateField(editingField.id, payload);
      else await createField(payload);
      notify('Field saved', 'success');
      await onRefresh();
    } catch (error) { notify(error instanceof Error ? error.message : 'Invalid field config', 'error'); }
  }

  async function saveTemplate(): Promise<void> {
    try {
      const payload = { ...templateDraft, id: undefined };
      if (editingTemplate) await updateExtractor(editingTemplate.id, payload);
      else await createExtractor(payload);
      notify('Extractor saved', 'success');
      await onRefresh();
    } catch (error) { notify(error instanceof Error ? error.message : 'Template save failed', 'error'); }
  }

  async function runPreview(): Promise<void> {
    try {
      const result = await extract({
        templateId: editingTemplate?.id, captureIds: captures.slice(0, 5).map((capture) => capture.id),
        includeNeighbors: templateDraft.includeNeighbors,
      });
      setPreview(result);
    } catch (error) { notify(error instanceof Error ? error.message : 'Preview failed', 'error'); }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--border)] bg-[#0b0e11] px-3 py-2">
        {([
          ['rules', 'Rules Engine', SlidersHorizontal], ['fields', 'Custom Fields', LayoutGrid],
          ['extractors', 'AI Extractors', WandSparkles], ['system', 'System Config', Database],
        ] as const).map(([key, label, Icon]) => (
          <button key={key} type="button" onClick={() => setTab(key)}
            className={cn('flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[11px] font-medium',
              tab === key ? 'bg-[var(--surface-hover)] text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]')}>
            <Icon size={12} /> {label}
          </button>
        ))}
        <span className="mono ml-auto text-[9.5px] text-[var(--muted)]">everything editable · zero code edits</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'rules' ? (
          <div className="mx-auto grid max-w-[1250px] grid-cols-[300px_minmax(0,1fr)] gap-4">
            <section className="space-y-1.5">
              <div className="flex items-center justify-between">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Rules · {rules.length}</h2>
                <button type="button" onClick={() => setRuleId(null)} title="New rule" className="text-[var(--emerald)]"><Plus size={14} /></button>
              </div>
              {[...rules].sort((a, b) => a.priority - b.priority).map((item) => (
                <div key={item.id} className={cn('flex items-center gap-1 rounded border bg-[var(--surface)] p-1.5', ruleId === item.id ? 'border-[var(--emerald)]' : 'border-[var(--border)]')}>
                  <button type="button" onClick={() => setRuleId(item.id)} className="min-w-0 flex-1 text-left">
                    <div className="truncate text-[11px] text-[var(--text)]">{item.name}</div>
                    <div className="mono text-[9px] text-[var(--muted)]">#{item.priority} · {item.hitCount} hits{item.enabled ? '' : ' · off'}</div>
                  </button>
                  <button type="button" title="Move up" onClick={() => void updateRule(item.id, { priority: Math.max(1, item.priority - 1) }).then(onRefresh)} className="text-[var(--muted)] hover:text-[var(--emerald)]"><ArrowUp size={11} /></button>
                  <button type="button" title="Move down" onClick={() => void updateRule(item.id, { priority: item.priority + 1 }).then(onRefresh)} className="text-[var(--muted)] hover:text-[var(--emerald)]"><ArrowDown size={11} /></button>
                  <button type="button" title="Toggle" onClick={() => void updateRule(item.id, { enabled: !item.enabled }).then(onRefresh)} className={cn('text-[var(--muted)]', item.enabled ? 'text-[var(--emerald)]' : '')}><Check size={11} /></button>
                  <button type="button" title="Delete" onClick={() => void deleteRule(item.id).then(onRefresh)} className="text-[var(--muted)] hover:text-[var(--rose)]"><Trash2 size={11} /></button>
                </div>
              ))}
            </section>
            <section className="space-y-3">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="flex items-center gap-2">
                  <input value={ruleDraft.name} onChange={(event) => setRuleDraft({ ...ruleDraft, name: event.target.value })} dir="auto" placeholder="Rule name" className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[11px] outline-none focus:border-[var(--emerald)]" />
                  <input type="number" value={ruleDraft.priority} onChange={(event) => setRuleDraft({ ...ruleDraft, priority: Number(event.target.value) })} title="Priority" className="mono w-16 rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-1 text-[10px] outline-none" />
                  <label className="mono flex items-center gap-1 text-[9.5px] text-[var(--muted)]"><input type="checkbox" checked={ruleDraft.enabled} onChange={(event) => setRuleDraft({ ...ruleDraft, enabled: event.target.checked })} /> enabled</label>
                  <label className="mono flex items-center gap-1 text-[9.5px] text-[var(--muted)]"><input type="checkbox" checked={ruleDraft.stopOnMatch} onChange={(event) => setRuleDraft({ ...ruleDraft, stopOnMatch: event.target.checked })} /> stopOnMatch</label>
                  <button type="button" onClick={() => void saveRule()} className="flex items-center gap-1 rounded bg-[var(--emerald)] px-2 py-1 text-[10px] font-semibold text-[#05130d]"><Save size={11} /> Save</button>
                </div>
                {/* shortcut: visual builder covers common fields; JSON toggle exposes the full rule schema. */}
                {jsonMode ? (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="mono text-[9px] uppercase text-[var(--muted)]">Conditions JSON</span>
                      <textarea value={ruleDraft.conditions} onChange={(event) => setRuleDraft({ ...ruleDraft, conditions: event.target.value })} dir="auto" rows={11} spellCheck={false} className="mono mt-1 w-full resize-y rounded border border-[var(--border)] bg-[#0b0f12] p-2 text-[10px] outline-none focus:border-[var(--emerald)]" />
                    </label>
                    <label className="block">
                      <span className="mono text-[9px] uppercase text-[var(--muted)]">Actions JSON</span>
                      <textarea value={ruleDraft.actions} onChange={(event) => setRuleDraft({ ...ruleDraft, actions: event.target.value })} dir="auto" rows={11} spellCheck={false} className="mono mt-1 w-full resize-y rounded border border-[var(--border)] bg-[#0b0f12] p-2 text-[10px] outline-none focus:border-[var(--emerald)]" />
                    </label>
                  </div>
                ) : (
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <div className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-2">
                      <div className="mono text-[9px] uppercase text-[var(--emerald)]">Conditions</div>
                      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                        <RuleInput label="regex" dir="auto" value={String(cond.regex ?? '')} onChange={(value) => editRulePart('conditions', 'regex', value)} />
                        <RuleInput label="flags" value={String(cond.regexFlags ?? '')} onChange={(value) => editRulePart('conditions', 'regexFlags', value)} />
                        <RuleInput label="keywords (comma)" dir="auto" value={(cond.keywords as string[] | undefined)?.join(', ') ?? ''} onChange={(value) => editRulePart('conditions', 'keywords', value.split(',').map((part) => part.trim()).filter(Boolean))} />
                        <RuleInput label="domain contains" dir="auto" value={String(cond.urlDomainContains ?? '')} onChange={(value) => editRulePart('conditions', 'urlDomainContains', value)} />
                        <RuleInput label="min length" type="number" value={cond.minLength === undefined ? '' : String(cond.minLength)} onChange={(value) => editRulePart('conditions', 'minLength', value === '' ? undefined : Number(value))} />
                        <RuleInput label="max length" type="number" value={cond.maxLength === undefined ? '' : String(cond.maxLength)} onChange={(value) => editRulePart('conditions', 'maxLength', value === '' ? undefined : Number(value))} />
                        <label className="mono text-[9px] text-[var(--muted)]">script
                          <select value={String(cond.script ?? '')} onChange={(event) => editRulePart('conditions', 'script', event.target.value)} className="mt-0.5 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-1 py-1 text-[9px]"><option value="">any</option><option>persian</option><option>latin</option><option>mixed</option></select>
                        </label>
                        <label className="mono text-[9px] text-[var(--muted)]">bucket
                          <select value={String((cond.bucketIn as string[] | undefined)?.[0] ?? '')} onChange={(event) => editRulePart('conditions', 'bucketIn', event.target.value ? [event.target.value] : undefined)} className="mt-0.5 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-1 py-1 text-[9px]"><option value="">any</option>{['idea', 'memory', 'reminder', 'question', 'reference', 'noise'].map((bucket) => <option key={bucket}>{bucket}</option>)}</select>
                        </label>
                        <label className="mono flex items-center gap-1 text-[9px] text-[var(--muted)]"><input type="checkbox" checked={cond.hasUrl === true} onChange={(event) => editRulePart('conditions', 'hasUrl', event.target.checked ? true : undefined)} /> has URL</label>
                        <label className="mono flex items-center gap-1 text-[9px] text-[var(--muted)]"><input type="checkbox" checked={cond.hasDue === true} onChange={(event) => editRulePart('conditions', 'hasDue', event.target.checked ? true : undefined)} /> has due</label>
                      </div>
                    </div>
                    <div className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-2">
                      <div className="mono text-[9px] uppercase text-[var(--emerald)]">Actions</div>
                      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                        <label className="mono text-[9px] text-[var(--muted)]">set bucket
                          <select value={String(act.setBucket ?? '')} onChange={(event) => editRulePart('actions', 'setBucket', event.target.value || undefined)} className="mt-0.5 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-1 py-1 text-[9px]"><option value="">unchanged</option>{['idea', 'memory', 'reminder', 'question', 'reference', 'noise'].map((bucket) => <option key={bucket}>{bucket}</option>)}</select>
                        </label>
                        <RuleInput label="add tags (comma)" dir="auto" value={(act.addTags as string[] | undefined)?.join(', ') ?? ''} onChange={(value) => editRulePart('actions', 'addTags', value.split(',').map((part) => part.trim()).filter(Boolean))} />
                        <RuleInput label="remove tags" dir="auto" value={(act.removeTags as string[] | undefined)?.join(', ') ?? ''} onChange={(value) => editRulePart('actions', 'removeTags', value.split(',').map((part) => part.trim()).filter(Boolean))} />
                        <RuleInput label="TTL minutes" type="number" value={act.ttlMinutes === undefined ? '' : String(act.ttlMinutes)} onChange={(value) => editRulePart('actions', 'ttlMinutes', value === '' ? undefined : Number(value))} />
                        <label className="mono text-[9px] text-[var(--muted)]">expire action
                          <select value={String(act.expireAction ?? '')} onChange={(event) => editRulePart('actions', 'expireAction', event.target.value || undefined)} className="mt-0.5 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-1 py-1 text-[9px]"><option value="">unchanged</option><option>archive</option><option>trash</option><option>delete</option></select>
                        </label>
                        <label className="mono flex items-center gap-1 text-[9px] text-[var(--muted)]"><input type="checkbox" checked={act.setTriaged === true} onChange={(event) => editRulePart('actions', 'setTriaged', event.target.checked ? true : undefined)} /> mark triaged</label>
                        <label className="mono flex items-center gap-1 text-[9px] text-[var(--muted)]"><input type="checkbox" checked={act.setPin === true} onChange={(event) => editRulePart('actions', 'setPin', event.target.checked ? true : undefined)} /> pin</label>
                      </div>
                    </div>
                  </div>
                )}
                <button type="button" onClick={() => setJsonMode(!jsonMode)} className="mono mt-1 text-[9px] text-[var(--hint)] hover:text-[var(--emerald)]">{jsonMode ? 'visual builder' : 'JSON toggle'}</button>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Live Rule Simulator</h3>
                <div className="mt-2 flex gap-1.5">
                  <input value={simText} onChange={(event) => setSimText(event.target.value)} dir="auto" placeholder="Paste a sample note…" className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-[11px] outline-none focus:border-[var(--emerald)]" />
                  <button type="button" onClick={() => void testRules({ text: simText }).then(setSimResult).catch((error: unknown) => notify(error instanceof Error ? error.message : 'Simulation failed', 'error'))} className="flex items-center gap-1 rounded border border-[var(--emerald)] px-2 py-1.5 text-[10px] text-[var(--emerald)]"><Play size={11} /> Simulate</button>
                </div>
                {simResult ? <pre dir="auto" className="mono mt-2 max-h-52 overflow-auto rounded border border-[var(--border)] bg-[#0b0f12] p-2 text-[10px] leading-relaxed text-[var(--hint)]">{JSON.stringify(simResult, null, 2)}</pre> : null}
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Retroactive Rule Sweep</h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <input value={sweepQ} onChange={(event) => setSweepQ(event.target.value)} dir="auto" placeholder="Query DSL filter (optional)" className="min-w-[180px] flex-1 rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[10px] outline-none" />
                  <label className="mono flex items-center gap-1 text-[9.5px] text-[var(--muted)]"><input type="checkbox" checked={overwriteLocked} onChange={(event) => setOverwriteLocked(event.target.checked)} /> overwrite locked human fields</label>
                  <button type="button" onClick={() => void previewSweep({ ruleId: rule?.id, q: sweepQ }).then(setSweepPreview)} className="rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--hint)]">Preview diffs</button>
                  <button type="button" onClick={() => void runSweep({ ruleId: rule?.id, q: sweepQ, overwriteLocked }).then((result) => { notify(`${result.affected} captures swept`, 'success'); void onRefresh(); })} className="rounded border border-[var(--emerald)] px-2 py-1 text-[10px] text-[var(--emerald)]">Apply sweep</button>
                </div>
                {sweepPreview ? (
                  <div className="mono mt-2 max-h-52 overflow-auto rounded border border-[var(--border)] bg-[#0b0f12] p-2 text-[10px] text-[var(--hint)]">
                    <div className="text-[var(--emerald)]">{sweepPreview.affectedCount} affected</div>
                    {sweepPreview.sampleDiffs.slice(0, 10).map((diff) => (
                      <div key={diff.id} className="border-b border-[var(--border)] py-1">
                        <span className="text-[var(--text)]">{diff.id.slice(0, 8)}</span> {JSON.stringify(diff.before)} → {JSON.stringify(diff.after)}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        ) : null}

        {tab === 'fields' ? (
          <div className="mx-auto grid max-w-[1150px] grid-cols-[280px_minmax(0,1fr)] gap-4">
            <section className="space-y-1.5">
              <div className="flex items-center justify-between">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Fields · {fields.length}</h2>
                <button type="button" onClick={() => setFieldId(null)} className="text-[var(--emerald)]"><Plus size={14} /></button>
              </div>
              {fields.map((field) => (
                <div key={field.id} className={cn('flex items-center gap-2 rounded border bg-[var(--surface)] p-2', fieldId === field.id ? 'border-[var(--emerald)]' : 'border-[var(--border)]')}>
                  <button type="button" onClick={() => setFieldId(field.id)} className="min-w-0 flex-1 text-left">
                    <div className="text-[11px] text-[var(--text)]">{field.name} <span className="mono text-[9px] text-[var(--emerald)]">{field.alias ?? '—'}</span></div>
                    <div className="mono text-[9px] text-[var(--muted)]">{field.fieldType} · #{field.sortOrder}</div>
                  </button>
                  <button type="button" onClick={() => void deleteField(field.id).then(onRefresh)} className="text-[var(--muted)] hover:text-[var(--rose)]"><Trash2 size={11} /></button>
                </div>
              ))}
            </section>
            <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="grid grid-cols-2 gap-2">
                <Input label="name (snake_case)" value={fieldDraft.name} onChange={(value) => setFieldDraft({ ...fieldDraft, name: value })} />
                <Input label="alias (shorthand)" value={fieldDraft.alias} onChange={(value) => setFieldDraft({ ...fieldDraft, alias: value })} />
                <label className="block">
                  <span className="mono text-[9px] uppercase text-[var(--muted)]">type</span>
                  <select value={fieldDraft.fieldType} onChange={(event) => { const fieldType = event.target.value as CustomField['fieldType']; setFieldDraft({ ...fieldDraft, fieldType, config: FIELD_CONFIG[fieldType] }); }} className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[10px] outline-none">
                    {(['score', 'choice', 'boolean', 'text'] as const).map((type) => <option key={type}>{type}</option>)}
                  </select>
                </label>
                <Input label="sort order" value={String(fieldDraft.sortOrder)} onChange={(value) => setFieldDraft({ ...fieldDraft, sortOrder: Number(value) || 0 })} />
                <Input label="description" value={fieldDraft.description} onChange={(value) => setFieldDraft({ ...fieldDraft, description: value })} />
                <label className="mono flex items-center gap-1 pt-4 text-[9.5px] text-[var(--muted)]"><input type="checkbox" checked={fieldDraft.showInStream} onChange={(event) => setFieldDraft({ ...fieldDraft, showInStream: event.target.checked })} /> showInStream</label>
              </div>
              <label className="mt-2 block">
                <span className="mono text-[9px] uppercase text-[var(--muted)]">config JSON</span>
                <textarea value={fieldDraft.config} onChange={(event) => setFieldDraft({ ...fieldDraft, config: event.target.value })} dir="auto" rows={8} spellCheck={false} className="mono mt-1 w-full resize-y rounded border border-[var(--border)] bg-[#0b0f12] p-2 text-[10px] outline-none focus:border-[var(--emerald)]" />
              </label>
              <div className="mt-2 flex justify-end">
                <button type="button" onClick={() => void saveField()} className="flex items-center gap-1 rounded bg-[var(--emerald)] px-3 py-1.5 text-[10px] font-semibold text-[#05130d]"><Save size={11} /> Save field</button>
              </div>
            </section>
          </div>
        ) : null}

        {tab === 'extractors' ? (
          <div className="mx-auto grid max-w-[1250px] grid-cols-[280px_minmax(0,1fr)] gap-4">
            <section className="space-y-1.5">
              <div className="flex items-center justify-between">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Templates · {templates.length}</h2>
                <button type="button" onClick={() => setTemplateId(null)} className="text-[var(--emerald)]"><Plus size={14} /></button>
              </div>
              {templates.map((template) => (
                <div key={template.id} className={cn('flex items-center gap-2 rounded border bg-[var(--surface)] p-2', templateId === template.id ? 'border-[var(--emerald)]' : 'border-[var(--border)]')}>
                  <button type="button" onClick={() => setTemplateId(template.id)} className="min-w-0 flex-1 text-left">
                    <div className="truncate text-[11px] text-[var(--text)]">{template.name}</div>
                    <div className="mono text-[9px] text-[var(--muted)]">/{template.slug}{template.isDefault ? ' · default' : ''}</div>
                  </button>
                  <button type="button" onClick={() => void deleteExtractor(template.id).then(onRefresh)} className="text-[var(--muted)] hover:text-[var(--rose)]"><Trash2 size={11} /></button>
                </div>
              ))}
            </section>
            <section className="space-y-3">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="grid grid-cols-2 gap-2">
                  <Input label="name" value={templateDraft.name} onChange={(value) => setTemplateDraft({ ...templateDraft, name: value })} />
                  <Input label="slug" value={templateDraft.slug} onChange={(value) => setTemplateDraft({ ...templateDraft, slug: value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} />
                  <Input label="description" value={templateDraft.description} onChange={(value) => setTemplateDraft({ ...templateDraft, description: value })} />
                  <label className="block">
                    <span className="mono text-[9px] uppercase text-[var(--muted)]">output mode</span>
                    <select value={templateDraft.outputMode} onChange={(event) => setTemplateDraft({ ...templateDraft, outputMode: event.target.value as ExtractorTemplate['outputMode'] })} className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[10px] outline-none">
                      {(['clipboard', 'download_md', 'download_json', 'obsidian_uri'] as const).map((mode) => <option key={mode}>{mode}</option>)}
                    </select>
                  </label>
                </div>
                <div className="mono mt-2 flex flex-wrap gap-1 text-[9px] text-[var(--muted)]">
                  {PLACEHOLDERS.map((token) => (
                    <button key={token} type="button" onClick={() => setTemplateDraft({ ...templateDraft, itemTemplate: `${templateDraft.itemTemplate} ${token}` })} className="rounded border border-[var(--border)] px-1 py-0.5 text-[var(--hint)] hover:border-[var(--emerald)] hover:text-[var(--emerald)]">{token}</button>
                  ))}
                </div>
                <textarea value={templateDraft.preamble} onChange={(event) => setTemplateDraft({ ...templateDraft, preamble: event.target.value })} dir="auto" rows={5} placeholder="preamble — supports {{buckets_schema}}, {{fields_schema}}, {{top_tags}}, {{date}}, {{count}}" className="mono mt-2 w-full resize-y rounded border border-[var(--border)] bg-[#0b0f12] p-2 text-[10px] outline-none focus:border-[var(--emerald)]" />
                <textarea value={templateDraft.itemTemplate} onChange={(event) => setTemplateDraft({ ...templateDraft, itemTemplate: event.target.value })} dir="auto" rows={4} spellCheck={false} className="mono mt-2 w-full resize-y rounded border border-[var(--border)] bg-[#0b0f12] p-2 text-[10px] outline-none focus:border-[var(--emerald)]" />
                <textarea value={templateDraft.footer} onChange={(event) => setTemplateDraft({ ...templateDraft, footer: event.target.value })} dir="auto" rows={2} className="mono mt-2 w-full resize-y rounded border border-[var(--border)] bg-[#0b0f12] p-2 text-[10px] outline-none focus:border-[var(--emerald)]" />
                <div className="mono mt-2 flex flex-wrap items-center gap-3 text-[9.5px] text-[var(--muted)]">
                  <label className="flex items-center gap-1"><input type="checkbox" checked={templateDraft.includeNeighbors} onChange={(event) => setTemplateDraft({ ...templateDraft, includeNeighbors: event.target.checked })} /> include 1-hop neighbors</label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={templateDraft.excludeNoise} onChange={(event) => setTemplateDraft({ ...templateDraft, excludeNoise: event.target.checked })} /> exclude noise</label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={templateDraft.isDefault} onChange={(event) => setTemplateDraft({ ...templateDraft, isDefault: event.target.checked })} /> default</label>
                  <button type="button" onClick={() => void saveTemplate()} className="ml-auto flex items-center gap-1 rounded bg-[var(--emerald)] px-2 py-1 text-[10px] font-semibold text-[#05130d]"><Save size={11} /> Save template</button>
                  <button type="button" onClick={() => void runPreview()} className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--hint)]"><Play size={11} /> Live preview (latest 5)</button>
                </div>
              </div>
              {preview ? (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="mono flex items-center gap-3 text-[10px] text-[var(--muted)]"><span>{preview.captureCount} captures</span><span>{preview.neighborCount} neighbors</span><span>{preview.charCount} chars</span><span className="text-[var(--emerald)]">~{preview.estimatedTokens} tokens</span></div>
                  <pre dir="auto" className="mono mt-2 max-h-72 overflow-auto rounded border border-[var(--border)] bg-[#0b0f12] p-2 text-[10px] leading-relaxed text-[var(--hint)]">{preview.text}</pre>
                </div>
              ) : null}
            </section>
          </div>
        ) : null}

        {tab === 'system' ? (
          <div className="mx-auto max-w-[900px] space-y-3">
            <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">System Config</h2>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {Object.keys(settingsDraft).filter((key) => key !== 'last_digest_date').sort().map((key) => (
                  <label key={key} className="block">
                    <span className="mono text-[9px] uppercase text-[var(--muted)]">{key}</span>
                    <input value={settingsDraft[key] ?? ''} onChange={(event) => setSettingsDraft({ ...settingsDraft, [key]: event.target.value })} dir="auto" className="mono mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[10px] outline-none focus:border-[var(--emerald)]" />
                  </label>
                ))}
              </div>
              <button type="button" onClick={() => void updateSettings(settingsDraft).then(() => { notify('Settings saved', 'success'); void onRefresh(); })} className="mt-3 flex items-center gap-1 rounded bg-[var(--emerald)] px-3 py-1.5 text-[10px] font-semibold text-[#05130d]"><Save size={11} /> Save all settings</button>
            </section>
            <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Maintenance & Backup</h2>
              <div className="mono mt-2 flex flex-wrap gap-1.5 text-[10px]">
                {([
                  ['rebuild_fts', 'Rebuild FTS5 Index'], ['vacuum', 'SQLite VACUUM'], ['run_ttl', 'Run TTL Sweep Now'], ['empty_trash', 'Empty Trash'],
                ] as const).map(([action, label]) => (
                  <button key={action} type="button" onClick={() => void maintenance(action).then((result) => { notify(`${label}: ${JSON.stringify(result)}`, 'success'); void onRefresh(); })} className="rounded border border-[var(--border)] px-2 py-1 text-[var(--hint)] hover:border-[var(--emerald)] hover:text-[var(--emerald)]">{label}</button>
                ))}
                <a href={exportUrl('json')} className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[var(--hint)] hover:text-[var(--emerald)]"><Download size={11} /> Full JSON Backup</a>
                <a href={exportUrl('md')} className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[var(--hint)] hover:text-[var(--emerald)]"><Download size={11} /> Full Markdown</a>
                <label className="flex cursor-pointer items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[var(--hint)] hover:text-[var(--emerald)]">
                  <FileJson size={11} /> Import JSON Backup
                  <input type="file" accept="application/json" className="hidden" onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    void file.text().then((text) => { try { return importBackup(JSON.parse(text) as unknown); } catch { throw new Error('Invalid backup JSON'); } })
                      .then((result) => { notify(`Imported ${result.imported} captures`, 'success'); void onRefresh(); })
                      .catch((error: unknown) => notify(error instanceof Error ? error.message : 'Import failed', 'error'));
                  }} />
                </label>
                <button type="button" onClick={() => void getCaptures({ status: 'all', limit: 500 }).then((page) => {
                  downloadText(page.captures.map((capture) => `# ${new Date(capture.createdAt).toISOString()}\n\n${capture.content}`).join('\n\n'), 'blinko.md');
                })} className="rounded border border-[var(--border)] px-2 py-1 text-[var(--hint)] hover:text-[var(--emerald)]">Download Markdown (view)</button>
                <button type="button" onClick={() => void onRefresh()} className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[var(--hint)]"><RefreshCw size={11} /> Refresh telemetry</button>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RuleInput({ label, value, onChange, type = 'text', dir }: {
  label: string; value: string; onChange: (value: string) => void; type?: string; dir?: string;
}) {
  return (
    <label className="mono text-[9px] text-[var(--muted)]">
      {label}
      <input type={type} value={value} dir={dir} onChange={(event) => onChange(event.target.value)} className="mt-0.5 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-1 py-1 text-[9px] text-[var(--hint)] outline-none focus:border-[var(--emerald)]" />
    </label>
  );
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mono text-[9px] uppercase text-[var(--muted)]">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} dir="auto" className="mono mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[10px] outline-none focus:border-[var(--emerald)]" />
    </label>
  );
}
