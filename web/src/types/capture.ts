export type Bucket = 'idea' | 'memory' | 'reminder' | 'question' | 'reference' | 'noise';
export type CaptureStatus = 'active' | 'resolved' | 'archived';
export type EdgeRelation = 'reply' | 'related' | 'refines' | 'supports' | 'blocks' | 'answers';
export type FieldType = 'score' | 'choice' | 'boolean' | 'text';
export type FieldSource = 'rule' | 'syntax' | 'human' | 'patch';
export type ReminderState = 'pending' | 'notified' | 'done' | 'killed';

export interface CustomField {
  id: string;
  name: string;
  alias: string | null;
  fieldType: FieldType;
  description: string;
  config: { options?: Array<{ value: string; label?: string; color?: string }>; min?: number; max?: number; rubric?: Record<string, string> };
  showInStream: boolean;
  active: boolean;
  sortOrder: number;
  createdAt: number;
}

export interface CaptureField {
  captureId: string;
  fieldId: string;
  name: string;
  valueText: string | null;
  valueNum: number | null;
  source: FieldSource;
  locked: boolean;
  updatedAt: number;
}

export interface Reminder {
  captureId: string;
  dueAt: number;
  snoozeCount: number;
  recurrence: string | null;
  state: ReminderState;
  lastNotifiedAt: number | null;
}

export interface Capture {
  id: string;
  content: string;
  bucket: Bucket;
  status: CaptureStatus;
  isPinned: boolean;
  captureMode: 'auto' | 'manual';
  triaged: boolean;
  expiresAt: number | null;
  expireAction: 'archive' | 'trash' | 'delete';
  deletedAt: number | null;
  sourceUrl: string | null;
  urlTitle: string | null;
  urlExcerpt: string | null;
  meta: Record<string, unknown>;
  tags: string[];
  fields: Record<string, CaptureField>;
  reminder: Reminder | null;
  edgeCount: number;
  createdAt: number;
  updatedAt: number;
  snippet?: string;
}

export interface HydratedEdge {
  sourceId: string;
  targetId: string;
  relation: EdgeRelation;
  note: string | null;
  createdAt: number;
  otherId: string;
  otherContent: string;
  otherBucket: Bucket;
  otherStatus: CaptureStatus;
  direction: 'outgoing' | 'incoming';
}

export interface CaptureDetail extends Capture { edges: HydratedEdge[] }

export interface SavedView {
  id: string;
  name: string;
  query: string;
  sort: string;
  sortOrder: number;
  createdAt: number;
}

export interface CapturePage {
  captures: Capture[];
  total: number;
  bucketCounts: Record<string, number>;
}

export interface Rule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  priority: number;
  stopOnMatch: boolean;
  conditions: Record<string, unknown>;
  actions: Record<string, unknown>;
  hitCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ExtractorTemplate {
  id: string;
  name: string;
  slug: string;
  description: string;
  outputMode: 'clipboard' | 'download_md' | 'download_json' | 'obsidian_uri';
  preamble: string;
  itemTemplate: string;
  footer: string;
  includeNeighbors: boolean;
  excludeNoise: boolean;
  isDefault: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface Triage {
  untriaged: Capture[];
  stubs: Capture[];
  bursts: Array<{ captures: Capture[]; spanSec: number }>;
  stale: Capture[];
}

export interface AgendaItem extends Reminder {
  content: string;
  bucket: Bucket;
  status: CaptureStatus;
  isPinned: boolean;
}

export interface Agenda {
  overdue: AgendaItem[];
  today: AgendaItem[];
  upcoming: AgendaItem[];
  snoozed: AgendaItem[];
}

export interface Telemetry {
  rssMb: number;
  heapUsedMb: number;
  activeCaptures: number;
  untriaged: number;
  trashCount: number;
  rules: number;
  ruleHits: number;
  dbSizeMb: number;
  bucketCounts: Record<string, number>;
  fieldCounts: Array<{ name: string; count: number }>;
  settings: Record<string, string>;
  tags: Array<{ name: string; count: number }>;
}

export interface CaptureResult {
  capture?: Capture;
  bucket?: Bucket | null;
  reminderDueAt?: number | null;
  appended: boolean;
}

export interface ManualCaptureInput {
  content: string;
  bucket: Bucket;
  status: CaptureStatus;
  isPinned: boolean;
  triaged?: boolean;
  tags: string[];
  sourceUrl: string | null;
  urlTitle: string | null;
  urlExcerpt: string | null;
  meta: Record<string, unknown>;
  createdAt?: number;
  reminderDueAt: number | null;
  recurrence?: string | null;
  expiresAt?: number | null;
  fields: Record<string, { valueText?: string | null; valueNum?: number | null } | null>;
  links: Array<{ targetId: string; relation: EdgeRelation; note?: string | null }>;
  fetchUrl?: boolean;
}

export interface CapturePatch {
  content?: string;
  bucket?: Bucket;
  status?: CaptureStatus;
  isPinned?: boolean;
  triaged?: boolean;
  touch?: boolean;
  captureMode?: 'auto' | 'manual';
  expiresAt?: number | null;
  expireAction?: 'archive' | 'trash' | 'delete';
  tags?: string[];
  sourceUrl?: string | null;
  urlTitle?: string | null;
  urlExcerpt?: string | null;
  meta?: Record<string, unknown>;
  createdAt?: number;
  reminder?: { dueAt: number; state?: ReminderState; snoozeCount?: number; recurrence?: string | null } | null;
  fields?: Record<string, { valueText?: string | null; valueNum?: number | null; source?: FieldSource } | null>;
}

export type BulkAction =
  | { type: 'bucket'; value: Bucket }
  | { type: 'status'; value: CaptureStatus }
  | { type: 'isPinned'; value: boolean }
  | { type: 'triaged'; value: boolean }
  | { type: 'addTags'; value: string[] }
  | { type: 'removeTags'; value: string[] }
  | { type: 'setField'; name: string; value: string | number | boolean | null }
  | { type: 'trash' }
  | { type: 'restore' };

export type ReminderAction = 'done' | 'snooze1' | 'snooze4' | 'tomorrow' | 'week' | 'kill';
export type Mode = 'stream' | 'agenda' | 'triage' | 'studio';

export interface CompiledExtraction {
  text: string;
  captureCount: number;
  neighborCount: number;
  charCount: number;
  estimatedTokens: number;
  obsidianUri?: string;
  template: ExtractorTemplate;
}

export interface PatchDiff {
  id: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export interface PatchPreview {
  diffs: PatchDiff[];
  warnings: string[];
  errors: string[];
  updateCount: number;
  mergeCount: number;
  newCount: number;
  newItems: Array<{ key: string; content: string; bucket: string; tags: string[] }>;
}
