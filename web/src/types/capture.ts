export type Bucket = 'idea' | 'memory' | 'reminder' | 'question' | 'reference' | 'noise';
export type CaptureStatus = 'active' | 'resolved' | 'archived';
export type Primitive = 'choice' | 'score' | 'noul';
export type EdgeRelation = 'reply' | 'related' | 'refines' | 'supports' | 'blocks' | 'answers';
export type DecisionSource = 'deterministic' | 'jev' | 'human';

export interface Decision {
  captureId: string;
  headId: string;
  headName: string;
  primitive: Primitive;
  valueText: string | null;
  valueNum: number | null;
  probs: Record<string, number>;
  confidence: number;
  entropy: number;
  source: DecisionSource;
  modelVersion: string | null;
  latencyMs: number;
  updatedAt: number;
}

export interface Reminder {
  captureId: string;
  dueAt: number;
  snoozeCount: number;
  state: 'pending' | 'notified' | 'done' | 'killed';
  lastNotifiedAt: number | null;
}

export interface Capture {
  id: string;
  content: string;
  bucket: Bucket;
  status: CaptureStatus;
  isPinned: boolean;
  captureMode: 'auto' | 'manual';
  sourceUrl: string | null;
  urlTitle: string | null;
  urlExcerpt: string | null;
  meta: Record<string, unknown>;
  tags: string[];
  decisions: Record<string, Decision>;
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

export interface CaptureDetail extends Capture {
  edges: HydratedEdge[];
}

export interface Head {
  id: string;
  name: string;
  primitive: Primitive;
  instructions: string;
  config: {
    options?: Array<{ value: string; description?: string }>;
    min?: number;
    max?: number;
    rubric?: Record<string, string>;
  };
  entropyThreshold: number;
  active: boolean;
  isSystem: boolean;
  sortOrder: number;
  createdAt: number;
}

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

export interface ReviewCapture extends Capture {
  reviewDecisions: Decision[];
}

export interface Review {
  uncertain: ReviewCapture[];
  unclassified: ReviewCapture[];
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
  jevMode: 'auto' | 'off';
  jevModel: string;
  caps: { dailyCalls: number; dailyUsd: number; monthlyUsd: number; priceUsdPerMillion: number };
  usageToday: number;
  usageTodayUsd: number;
  usageMonthUsd: number;
  totalCaptures: number;
  bucketCounts: Record<string, number>;
  headStats: Array<{
    id: string; name: string; primitive: Primitive; active: boolean; entropyThreshold: number;
    decisions: number; avgEntropy: number; avgConfidence: number;
  }>;
  settings: Record<string, string>;
  tags: Array<{ name: string; count: number }>;
}

export interface JevPrediction {
  headId: string;
  valueText: string | null;
  valueNum: number | null;
  probs: Record<string, number>;
  confidence: number;
  entropy: number;
  modelVersion: string | null;
}

export interface JevResult {
  predictions: JevPrediction[];
  modelVersion: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

export interface CaptureResult {
  capture?: Capture;
  bucketDecision?: Decision | null;
  reminderDueAt?: number | null;
  jevUsed: boolean;
}

export interface ManualCaptureInput {
  content: string;
  bucket: Bucket;
  status: CaptureStatus;
  isPinned: boolean;
  tags: string[];
  sourceUrl: string | null;
  urlTitle: string | null;
  urlExcerpt: string | null;
  meta: Record<string, unknown>;
  createdAt?: number;
  reminderDueAt: number | null;
  decisions: Record<string, { valueText?: string | null; valueNum?: number | null } | null>;
  links: Array<{ targetId: string; relation: EdgeRelation; note?: string | null }>;
  fetchUrl?: boolean;
}

export interface CapturePatch {
  content?: string;
  bucket?: Bucket;
  status?: CaptureStatus;
  isPinned?: boolean;
  captureMode?: 'auto' | 'manual';
  tags?: string[];
  sourceUrl?: string | null;
  urlTitle?: string | null;
  urlExcerpt?: string | null;
  meta?: Record<string, unknown>;
  createdAt?: number;
  reminder?: { dueAt: number; state?: Reminder['state']; snoozeCount?: number } | null;
  decisions?: Record<string, { valueText?: string | null; valueNum?: number | null } | null>;
}

export type BulkAction =
  | { type: 'bucket'; value: Bucket }
  | { type: 'status'; value: CaptureStatus }
  | { type: 'isPinned'; value: boolean }
  | { type: 'addTags'; value: string[] }
  | { type: 'removeTags'; value: string[] }
  | { type: 'delete' }
  | { type: 'runJev' };

export type Mode = 'stream' | 'agenda' | 'review' | 'jev';
