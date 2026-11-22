import { config } from '../config';
import { db, getSetting, setSetting } from '../db';
import * as actual from '../actual/client';
import { notifyScheduledPosted } from '../notifications/service';
import type { ActualSchedule, ActualTransaction } from '../../shared/types';

let polling = false;

function localISODate(offsetDays = 0): string {
  const d = new Date();
  if (offsetDays !== 0) d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function extractAmountCents(amount: ActualSchedule['amount']): number {
  if (typeof amount === 'number') return amount;
  if (amount && typeof amount === 'object') {
    return Math.round((amount.num1 + amount.num2) / 2);
  }
  return 0;
}

function daysBetween(dateA: string, dateB: string): number {
  const a = new Date(`${dateA}T00:00:00Z`).getTime();
  const b = new Date(`${dateB}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 999;
  return Math.abs(Math.round((a - b) / (24 * 60 * 60 * 1000)));
}

export function recordSchedulePostNotified(input: {
  scheduleId: string;
  postedDate: string;
  source: 'kopi_post_now' | 'actual_watcher' | 'baseline';
  txId?: string | null;
}): void {
  const now = new Date().toISOString();
  const insert = db.query(
    `INSERT OR IGNORE INTO notified_schedule_posts (dedupe_key, schedule_id, posted_date, tx_id, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  insert.run(`schedule:${input.scheduleId}:${input.postedDate}`, input.scheduleId, input.postedDate, input.txId || null, input.source, now);
  if (input.txId) {
    insert.run(`tx:${input.txId}`, input.scheduleId, input.postedDate, input.txId, input.source, now);
  }
}

function isAlreadyNotified(scheduleId: string, postedDate: string, txId?: string | null): boolean {
  const slotKey = `schedule:${scheduleId}:${postedDate}`;
  if (txId) {
    const row = db
      .query<{ dedupe_key: string }, [string, string]>(
        'SELECT dedupe_key FROM notified_schedule_posts WHERE dedupe_key = ? OR dedupe_key = ? LIMIT 1',
      )
      .get(slotKey, `tx:${txId}`);
    return Boolean(row);
  }
  const row = db
    .query<{ dedupe_key: string }, [string]>(
      'SELECT dedupe_key FROM notified_schedule_posts WHERE dedupe_key = ? LIMIT 1',
    )
    .get(slotKey);
  return Boolean(row);
}

function upsertWatchState(scheduleId: string, nextDate: string | null, completed: boolean): void {
  db.query(
    `INSERT INTO schedule_watch_state (schedule_id, last_next_date, completed, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(schedule_id) DO UPDATE SET
       last_next_date = excluded.last_next_date,
       completed = excluded.completed,
       updated_at = excluded.updated_at`,
  ).run(scheduleId, nextDate, completed ? 1 : 0, new Date().toISOString());
}

/**
 * Syncs the stored baseline for one schedule (or all schedules) after Kopi creates/edits it,
 * so user edits to a schedule's date in Kopi are never misread as a posted transaction.
 */
export async function syncScheduleWatchState(scheduleId?: string): Promise<void> {
  try {
    const schedules = await actual.getSchedules();
    const list = scheduleId ? schedules.filter((s) => s.id === scheduleId) : schedules;
    for (const s of list) {
      upsertWatchState(s.id, s.next_date ?? null, Boolean(s.completed));
    }
  } catch {
    // Best-effort; next poll will reconcile.
  }
}

export function deleteScheduleWatchState(scheduleId: string): void {
  db.query('DELETE FROM schedule_watch_state WHERE schedule_id = ?').run(scheduleId);
}

export async function pollScheduledPosts(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const { syncId } = await actual.resolveBudgetSyncId();
    const [schedules, accounts, payees] = await Promise.all([
      actual.getSchedules(),
      actual.getAccounts(false),
      actual.getPayees(),
    ]);

    const accountMap = new Map(accounts.map((a) => [a.id, a.name]));
    const payeeMap = new Map(payees.map((p) => [p.id, p.name]));
    const scheduleMap = new Map(schedules.map((s) => [s.id, s]));

    const openAccountIds = new Set(accounts.filter((a) => !a.closed).map((a) => a.id));
    const watchedAccountIds = Array.from(
      new Set(
        schedules
          .map((s) => s.account)
          .filter((id): id is string => Boolean(id && openAccountIds.has(id))),
      ),
    );

    const sinceDate = localISODate(-14);
    const todayStr = localISODate(0);

    const txByAccount = new Map<string, ActualTransaction[]>();
    await Promise.all(
      watchedAccountIds.map(async (accountId) => {
        const txs = await actual.getAccountTransactions(accountId, sinceDate).catch(() => []);
        txByAccount.set(accountId, txs);
      }),
    );

    const watchedBudget = getSetting('schedule_watcher_budget_id');
    const isBaseline = watchedBudget !== syncId;

    if (isBaseline) {
      db.query('DELETE FROM schedule_watch_state').run();
      for (const s of schedules) {
        upsertWatchState(s.id, s.next_date ?? null, Boolean(s.completed));
      }
      for (const txs of txByAccount.values()) {
        for (const tx of txs) {
          if (tx.schedule) {
            recordSchedulePostNotified({
              scheduleId: tx.schedule,
              postedDate: tx.date,
              source: 'baseline',
              txId: tx.id,
            });
          }
        }
      }
      setSetting('schedule_watcher_budget_id', syncId);
      return;
    }

    const prevRows = db
      .query<{ schedule_id: string; last_next_date: string | null; completed: number }, []>(
        'SELECT schedule_id, last_next_date, completed FROM schedule_watch_state',
      )
      .all();
    const prevMap = new Map(prevRows.map((r) => [r.schedule_id, r]));

    // Pass 1: Detect transactions explicitly linked to a schedule in Actual (tx.schedule)
    for (const [accountId, txs] of txByAccount.entries()) {
      for (const tx of txs) {
        if (!tx.schedule || tx.date < sinceDate) continue;
        if (isAlreadyNotified(tx.schedule, tx.date, tx.id)) continue;

        const sched = scheduleMap.get(tx.schedule);
        const payeeId = tx.payee || sched?.payee || null;
        const payeeName = payeeId ? payeeMap.get(payeeId) ?? null : tx.imported_payee ?? null;
        const accountName = accountMap.get(accountId) ?? null;

        recordSchedulePostNotified({
          scheduleId: tx.schedule,
          postedDate: tx.date,
          source: 'actual_watcher',
          txId: tx.id,
        });

        await notifyScheduledPosted({
          scheduleId: tx.schedule,
          name: sched?.name ?? null,
          payeeName,
          amountCents: tx.amount,
          accountName,
          postedDate: tx.date,
        }).catch((err) => console.warn('[notifications] schedule push failed:', err));
      }
    }

    // Pass 2: Detect schedule next_date advancement or completion (fallback when tx.schedule is absent)
    for (const s of schedules) {
      const prev = prevMap.get(s.id);
      if (prev) {
        const nextDateAdvanced = Boolean(prev.last_next_date && s.next_date && s.next_date > prev.last_next_date);
        const justCompleted = !prev.completed && Boolean(s.completed);

        if (nextDateAdvanced || justCompleted) {
          const candidateDate = prev.last_next_date || todayStr;
          const expectedCents = extractAmountCents(s.amount);
          const acctTxs = s.account ? txByAccount.get(s.account) || [] : [];

          const tolerance = Math.max(100, Math.round(Math.abs(expectedCents) * 0.1));
          const matchedTx = acctTxs.find((tx) => {
            if (tx.schedule === s.id && daysBetween(tx.date, candidateDate) <= 7) return true;
            if (daysBetween(tx.date, candidateDate) > 7) return false;
            const amountClose = Math.abs(tx.amount - expectedCents) <= tolerance;
            if (s.payee && tx.payee === s.payee && amountClose) return true;
            if (!s.payee && amountClose && s.name && tx.notes?.includes(s.name)) return true;
            return false;
          });

          const likelyAutoPosted = Boolean(s.posts_transaction && candidateDate <= todayStr);

          if (matchedTx || likelyAutoPosted) {
            const postedDate = matchedTx?.date || candidateDate;
            if (!isAlreadyNotified(s.id, postedDate, matchedTx?.id)) {
              recordSchedulePostNotified({
                scheduleId: s.id,
                postedDate,
                source: 'actual_watcher',
                txId: matchedTx?.id ?? null,
              });

              await notifyScheduledPosted({
                scheduleId: s.id,
                name: s.name ?? null,
                payeeName: s.payee ? payeeMap.get(s.payee) ?? null : null,
                amountCents: matchedTx ? matchedTx.amount : expectedCents,
                accountName: s.account ? accountMap.get(s.account) ?? null : null,
                postedDate,
              }).catch((err) => console.warn('[notifications] schedule push failed:', err));
            }
          }
        }
      }

      upsertWatchState(s.id, s.next_date ?? null, Boolean(s.completed));
    }

    // Prune watch state for deleted schedules
    for (const prev of prevRows) {
      if (!scheduleMap.has(prev.schedule_id)) {
        db.query('DELETE FROM schedule_watch_state WHERE schedule_id = ?').run(prev.schedule_id);
      }
    }

    // Prune old notification dedupe records (> 90 days)
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    db.query('DELETE FROM notified_schedule_posts WHERE created_at < ?').run(cutoff);
  } catch (err) {
    // Actual may be offline or restarting; silently skip this tick.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[schedule-watcher] poll skipped: ${msg.slice(0, 160)}`);
  } finally {
    polling = false;
  }
}

export function startScheduleWatcher(): void {
  // Delay initial poll slightly so server startup stays instant
  setTimeout(() => {
    void pollScheduledPosts();
  }, 15_000);

  setInterval(() => {
    void pollScheduledPosts();
  }, config.scheduleWatchIntervalMs);
}
