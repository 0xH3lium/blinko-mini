import type Database from 'better-sqlite3';
import type { Bot } from 'grammy';
import { getCapture, listDueReminders } from '../db/queries.js';
import { sendSchedulerReminder } from '../bot/bot.js';
import { emit } from '../services/events.service.js';

let timer: NodeJS.Timeout | null = null;
let busy = false;

async function tick(db: Database.Database, bot: Bot): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const now = Date.now();
    for (const reminder of listDueReminders(db, now)) {
      const capture = getCapture(db, reminder.captureId);
      if (!capture) continue;
      try {
        await sendSchedulerReminder(bot, capture.id, capture.content, reminder);
        db.prepare(`UPDATE reminders SET state = 'notified', last_notified_at = ? WHERE capture_id = ?`).run(
          Date.now(),
          reminder.captureId,
        );
        emit('reminder.updated', { captureId: reminder.captureId, state: 'notified' });
      } catch (error) {
        console.error('[Scheduler] reminder notify failed:', error);
      }
    }
  } finally {
    busy = false;
  }
}

export function startScheduler(db: Database.Database, bot: Bot): void {
  if (timer) return;
  timer = setInterval(() => {
    void tick(db, bot).catch((error: unknown) => console.error('[Scheduler] tick failed:', error));
  }, 60_000);
  timer.unref?.();
  void tick(db, bot).catch(() => undefined);
}

export function stopScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
