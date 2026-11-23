import type Database from 'better-sqlite3';
import { getCapture, getSetting, listDueReminders, type Reminder } from '../db/queries.js';
import { sublimationSweep } from './physics.js';
import { emit } from '../services/events.service.js';

export interface SchedulerHooks {
  notifyReminder: (captureId: string, content: string, reminder: Reminder) => Promise<void>;
}

let timer: NodeJS.Timeout | null = null;
let lastSweep = 0;

async function tick(db: Database.Database, hooks: SchedulerHooks): Promise<void> {
  const now = Date.now();
  const due = listDueReminders(db, now);
  for (const reminder of due) {
    const capture = getCapture(db, reminder.captureId);
    if (!capture) continue;
    try {
      await hooks.notifyReminder(capture.id, capture.content, reminder);
      db.prepare(`UPDATE reminders SET state = 'notified', last_notified_at = ? WHERE capture_id = ?`).run(
        now,
        reminder.captureId,
      );
      emit('reminder.updated', { captureId: reminder.captureId, state: 'notified' });
    } catch (error) {
      console.error('[Scheduler] reminder notify failed:', error);
    }
  }

  if (now - lastSweep >= 3_600_000) {
    lastSweep = now;
    const threshold = Number(getSetting(db, 'sublimate_energy', '0.15'));
    const count = sublimationSweep(db, threshold, now);
    if (count > 0) {
      emit('telemetry.updated', { sublimated: count });
      console.log(`[Scheduler] sublimated ${count} low-energy captures`);
    }
  }
}

export function startScheduler(db: Database.Database, hooks: SchedulerHooks): void {
  if (timer) return;
  lastSweep = Date.now() - 3_600_000;
  timer = setInterval(() => {
    void tick(db, hooks).catch((error: unknown) => console.error('[Scheduler] tick failed:', error));
  }, 60_000);
  timer.unref?.();
  void tick(db, hooks).catch(() => undefined);
}

export function stopScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
