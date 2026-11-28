import type Database from 'better-sqlite3';
import type { Bot } from 'grammy';
import { config } from '../config.js';
import {
  deleteCaptureFts, deleteOrphanTags, getAgenda, getCapture, getSetting, listDueReminders, setSetting,
  type Capture, type Reminder,
} from '../db/queries.js';
import { sendSchedulerReminder, sendTacticalDigest } from '../bot/bot.js';
import { emit } from '../services/events.service.js';

let timer: NodeJS.Timeout | null = null;
let busy = false;

export function ttlSweep(db: Database.Database, now = Date.now()): number {
  const expired = db.prepare('SELECT id, expire_action FROM captures WHERE expires_at IS NOT NULL AND expires_at <= ? AND deleted_at IS NULL').all(now) as Array<{ id: string; expire_action: Capture['expireAction'] }>;
  let count = 0;
  for (const row of expired) {
    if (row.expire_action === 'delete') {
      db.prepare('DELETE FROM captures WHERE id = ?').run(row.id);
      deleteCaptureFts(db, row.id);
    } else if (row.expire_action === 'trash') {
      db.prepare('UPDATE captures SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, row.id);
    } else {
      db.prepare("UPDATE captures SET status = 'archived', updated_at = ? WHERE id = ?").run(now, row.id);
    }
    count += 1;
  }
  if (count) emit('capture.bulk', { expired: count });
  return count;
}

export function emptyTrash(db: Database.Database): number {
  const ids = db.prepare('SELECT id FROM captures WHERE deleted_at IS NOT NULL').all() as Array<{ id: string }>;
  const run = db.transaction(() => {
    for (const row of ids) deleteCaptureFts(db, row.id);
    const count = db.prepare('DELETE FROM captures WHERE deleted_at IS NOT NULL').run().changes;
    if (count) deleteOrphanTags(db);
    return count;
  });
  const count = run();
  if (count) emit('capture.bulk', { purged: count });
  return count;
}

export function runTrashPurge(db: Database.Database, now = Date.now()): number {
  const retention = Number(getSetting(db, 'trash_retention_days', '30')) * 86_400_000;
  const cutoff = now - retention;
  const ids = (db.prepare('SELECT id FROM captures WHERE deleted_at IS NOT NULL AND deleted_at <= ?').all(cutoff) as Array<{ id: string }>).map((row) => row.id);
  const count = db.transaction(() => {
    const removed = db.prepare('DELETE FROM captures WHERE deleted_at IS NOT NULL AND deleted_at <= ?').run(cutoff).changes;
    for (const id of ids) deleteCaptureFts(db, id);
    if (removed) deleteOrphanTags(db);
    return removed;
  })();
  if (count) emit('capture.bulk', { trashPurged: count });
  return count;
}

export async function tick(db: Database.Database, bot: Bot): Promise<void> {
  const now = Date.now();
  for (const reminder of listDueReminders(db, now)) {
    const capture = getCapture(db, reminder.captureId);
    if (!capture) continue;
    try {
      await sendSchedulerReminder(bot, capture.id, capture.content, reminder);
      db.prepare("UPDATE reminders SET state = 'notified', last_notified_at = ? WHERE capture_id = ?").run(now, reminder.captureId);
      emit('reminder.updated', { captureId: reminder.captureId, state: 'notified' });
    } catch (error) {
      console.error('[Scheduler] reminder notify failed:', error);
    }
  }
  ttlSweep(db, now);
  runTrashPurge(db, now);

  if (getSetting(db, 'digest_enabled', 'true') === 'true') {
    const clock = zonedClockIn(db, now);
    if (clock.time === getSetting(db, 'digest_time', '07:55') && getSetting(db, 'last_digest_date', '') !== clock.date) {
      try {
        await sendTacticalDigest(bot, getAgenda(db, now));
        setSetting(db, 'last_digest_date', clock.date);
        emit('telemetry.updated', { digest: clock.date });
      } catch (error) {
        console.error('[Scheduler] digest failed:', error);
      }
    }
  }
}

function zonedClockIn(db: Database.Database, now: number): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: getSetting(db, 'owner_timezone', config.OWNER_TIMEZONE),
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(now));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return { date: `${value('year')}-${value('month')}-${value('day')}`, time: `${value('hour')}:${value('minute')}` };
}

export function startScheduler(db: Database.Database, bot: Bot): void {
  if (timer) return;
  timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void tick(db, bot).catch((error: unknown) => console.error('[Scheduler] tick failed:', error)).finally(() => { busy = false; });
  }, 60_000);
  timer.unref?.();
}

export function stopScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

export type { Reminder };
