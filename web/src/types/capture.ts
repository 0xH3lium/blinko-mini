export type Bucket = 'idea' | 'memory' | 'reminder' | 'question' | 'reference' | 'noise';
export type CaptureStatus = 'active' | 'resolved' | 'sublimated';
export type Primitive = 'choice' | 'score' | 'noul';
export type EdgeRelation =
  | 'refines' | 'reinforces' | 'contradicts' | 'paradox' | 'answers' | 'duplicate_of' | 'reply';

export interface Capture {
  id: string;
  content: string;
  bucket: Bucket;
  status: CaptureStatus;
  isPinned: boolean;
  energy: number;
  decayLambda: number;
  resonanceCount: number;
  lastActivatedAt: number;
  simhash: string | null;
  meta: Record<string, unknown>;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Decision {
  id: number;
  captureId: string;
  headId: string;
  headName: string;
  primitive: Primitive;
  valueText: string | null;
  valueNum: number | null;
  probs: Record<string, number>;
  confidence: number;
  entropy: number;
  source: 'deterministic' | 'local_probe' | 'local_knn' | 'jev' | 'human';
  latencyMs: number;
  createdAt: number;
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
  autoEscalate: boolean;
  localThreshold: number;
  sampleCount: number;
  agreementCount: number;
  evalCount: number;
  active: boolean;
  isSystem: boolean;
  createdAt: number;
}

export interface Edge {
  sourceId: string;
  targetId: string;
  relation: EdgeRelation;
  weight: number;
  meta: Record<string, unknown>;
  createdAt: number;
}

export interface Reminder {
  captureId: string;
  dueAt: number;
  snoozeCount: number;
  state: 'pending' | 'notified' | 'done' | 'killed';
  lastNotifiedAt: number | null;
  content?: string;
}

export interface CaptureDetail extends Capture {
  decisions: Decision[];
  edges: Edge[];
  reminder: Reminder | null;
  effectiveEnergy: number;
}

export interface HeadFilter { head: string; min?: number; max?: number }

export interface CapturePage {
  captures: Capture[];
  total: number;
  bucketCounts: Record<string, number>;
}

export interface Triage {
  uncertain: Array<Capture & { decisions?: Array<{ entropy: number; head_name: string }> }>;
  paradoxes: Capture[];
  zombies: Reminder[];
  expiring: Array<Capture & { effectiveEnergy?: number }>;
}

export interface GraphNode extends Capture {
  effectiveEnergy: number;
  decisions: Array<Decision & { head_name?: string }>;
  x?: number; y?: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null;
}

export interface GraphData { nodes: GraphNode[]; edges: Array<Edge & { source: string; target: string }> }

export interface HeadStat {
  id: string; name: string; primitive: Primitive; sampleCount: number;
  evalCount: number; agreement: number; active: boolean;
}

export interface Telemetry {
  rssMb: number;
  heapUsedMb: number;
  vectorCount: number;
  jevMode: 'gated' | 'bootstrap' | 'off';
  caps: { dailyCalls: number; dailyUsd: number; monthlyUsd: number };
  usageToday: number;
  usageTodayUsd: number;
  usageMonthUsd: number;
  localHitRate: number;
  headStats: HeadStat[];
  survivalBuckets: Array<{ bucket: string; active: number; sublimated: number; avgEnergy: number }>;
  settings: Record<string, string>;
  tags: Array<{ name: string; count: number }>;
}

export interface IngestResult {
  kind: 'resonance' | 'capture';
  targetId?: string;
  targetContent?: string;
  count?: number;
  firstSeenAt?: number;
  captureReturn?: Capture;
  bucketPrediction?: { valueText: string | null; probs: Record<string, number>; confidence: number } | null;
  collision?: unknown;
  reminderDueAt?: number | null;
  jevUsed?: boolean;
}

export type Mode = 'stream' | 'topology' | 'triage' | 'jev';
export type ToastTone = 'success' | 'error' | 'info';
export type Notify = (message: string, tone?: ToastTone) => void;
