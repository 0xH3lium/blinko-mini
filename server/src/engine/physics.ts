import type Database from 'better-sqlite3';
import type { CaptureRow } from '../db/queries.js';
import { hasParadoxEdge } from '../db/queries.js';

const DAY_MS = 86_400_000;

export function decayLambdaForHalfLife(score: number): number {
  const level = Math.max(0, Math.min(3, Math.round(score)));
  const halfLifeDays = [2, 14, 90, Number.POSITIVE_INFINITY][level] ?? 90;
  if (!Number.isFinite(halfLifeDays)) return 0;
  return Math.LN2 / halfLifeDays;
}

export function computeEffectiveEnergy(
  row: Pick<CaptureRow, 'energy' | 'decay_lambda' | 'last_activated_at' | 'is_pinned'>,
  now = Date.now(),
  paradox = false,
): number {
  if (row.is_pinned === 1 || row.decay_lambda === 0 || paradox) return row.energy;
  const elapsedDays = Math.max(0, now - row.last_activated_at) / DAY_MS;
  return row.energy * Math.exp(-row.decay_lambda * elapsedDays);
}

export function effectiveEnergyFor(db: Database.Database, row: CaptureRow, now = Date.now()): number {
  return computeEffectiveEnergy(row, now, hasParadoxEdge(db, row.id));
}

/** Auto-sublimate captures whose effective energy has fallen below the threshold. */
export function sublimationSweep(db: Database.Database, threshold: number, now = Date.now()): number {
  const rows = db
    .prepare(`SELECT * FROM captures WHERE status = 'active' AND is_pinned = 0 AND decay_lambda > 0`)
    .all() as CaptureRow[];
  const update = db.prepare(`UPDATE captures SET status = 'sublimated', updated_at = ? WHERE id = ?`);
  let count = 0;
  for (const row of rows) {
    if (hasParadoxEdge(db, row.id)) continue;
    if (computeEffectiveEnergy(row, now) < threshold) {
      update.run(now, row.id);
      count += 1;
    }
  }
  return count;
}

export function survivalBuckets(db: Database.Database, now = Date.now()): Array<{ bucket: string; active: number; sublimated: number; avgEnergy: number }> {
  const rows = db
    .prepare(`SELECT bucket, status, energy, decay_lambda, last_activated_at, is_pinned FROM captures`)
    .all() as Array<Pick<CaptureRow, 'bucket' | 'status' | 'energy' | 'decay_lambda' | 'last_activated_at' | 'is_pinned'>>;
  const map = new Map<string, { active: number; sublimated: number; totalEnergy: number }>();
  for (const row of rows) {
    const entry = map.get(row.bucket) ?? { active: 0, sublimated: 0, totalEnergy: 0 };
    if (row.status === 'active') entry.active += 1;
    if (row.status === 'sublimated') entry.sublimated += 1;
    entry.totalEnergy += computeEffectiveEnergy(row, now);
    map.set(row.bucket, entry);
  }
  return [...map.entries()].map(([bucket, value]) => ({
    bucket,
    active: value.active,
    sublimated: value.sublimated,
    avgEnergy: value.active > 0 ? value.totalEnergy / (value.active + value.sublimated) : 0,
  }));
}
