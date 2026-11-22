import { Hono } from 'hono';
import * as actual from '../actual/client';
import { requireApiKeyOrSession } from '../auth/service';
import { notifyScheduledPosted } from '../notifications/service';
import { postedScheduleId, scheduleImportId } from './occurrence';
import {
  deleteScheduleWatchState,
  recordSchedulePostNotified,
  syncScheduleWatchState,
} from './watcher';
import { scheduleCreateSchema } from '../../shared/types';
import type { ActualSchedule, EnrichedSchedule, RecurConfig } from '../../shared/types';

export const scheduleRoutes = new Hono();

function extractAmountCents(amount: ActualSchedule['amount']): number {
  if (typeof amount === 'number') return amount;
  if (amount && typeof amount === 'object') {
    return Math.round((amount.num1 + amount.num2) / 2);
  }
  return 0;
}

function formatRecurrenceLabel(date: ActualSchedule['date']): string {
  if (!date) return 'One-time';
  if (typeof date === 'string') return `Once on ${date}`;
  const interval = date.interval && date.interval > 1 ? `Every ${date.interval} ` : '';
  switch (date.frequency) {
    case 'daily':
      return interval ? `${interval}days` : 'Daily';
    case 'weekly':
      return date.interval === 2 ? 'Bi-weekly' : interval ? `${interval}weeks` : 'Weekly';
    case 'monthly':
      return interval ? `${interval}months` : 'Monthly';
    case 'yearly':
      return interval ? `${interval}years` : 'Yearly';
    default:
      return 'Recurring';
  }
}

function toMonthlyEquivalentCents(amountCents: number, date: ActualSchedule['date']): number {
  if (!date || typeof date === 'string') return 0;
  const interval = Math.max(1, date.interval || 1);
  switch (date.frequency) {
    case 'daily':
      return Math.round((amountCents * 30.4375) / interval);
    case 'weekly':
      return Math.round((amountCents * 4.345) / interval);
    case 'monthly':
      return Math.round(amountCents / interval);
    case 'yearly':
      return Math.round(amountCents / (12 * interval));
    default:
      return 0;
  }
}

function computeDaysUntil(nextDate?: string): number | null {
  if (!nextDate) return null;
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayMs = new Date(`${todayStr}T00:00:00Z`).getTime();
  const nextMs = new Date(`${nextDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(nextMs)) return null;
  return Math.round((nextMs - todayMs) / (24 * 60 * 60 * 1000));
}

export async function getEnrichedSchedules(): Promise<EnrichedSchedule[]> {
  const [schedules, accounts, payees] = await Promise.all([
    actual.getSchedules(),
    actual.getAccounts(false),
    actual.getPayees(),
  ]);

  const accountMap = new Map(accounts.map((a) => [a.id, a.name]));
  const payeeMap = new Map(payees.map((p) => [p.id, p.name]));

  const enriched: EnrichedSchedule[] = schedules.map((s) => {
    const amountCents = extractAmountCents(s.amount);
    const daysUntilNext = computeDaysUntil(s.next_date);
    let status: EnrichedSchedule['status'] = 'upcoming';
    if (s.completed) {
      status = 'completed';
    } else if (daysUntilNext !== null && daysUntilNext < 0) {
      status = 'overdue';
    } else if (daysUntilNext !== null && daysUntilNext <= 7) {
      status = 'due_soon';
    }

    return {
      ...s,
      accountName: s.account ? accountMap.get(s.account) ?? null : null,
      payeeName: s.payee ? payeeMap.get(s.payee) ?? null : null,
      amountCents,
      recurrenceLabel: formatRecurrenceLabel(s.date),
      daysUntilNext,
      status,
      monthlyEquivalentCents: s.completed ? 0 : toMonthlyEquivalentCents(amountCents, s.date),
    };
  });

  enriched.sort((a, b) => {
    if (Boolean(a.completed) !== Boolean(b.completed)) return a.completed ? 1 : -1;
    const da = a.next_date || '9999-12-31';
    const db = b.next_date || '9999-12-31';
    return da.localeCompare(db);
  });

  return enriched;
}

scheduleRoutes.get('/', requireApiKeyOrSession('schedules:write'), async (c) => {
  const schedules = await getEnrichedSchedules();
  let monthlyOutflowCents = 0;
  let monthlyInflowCents = 0;

  for (const s of schedules) {
    if (s.completed) continue;
    if (s.monthlyEquivalentCents < 0) monthlyOutflowCents += Math.abs(s.monthlyEquivalentCents);
    else monthlyInflowCents += s.monthlyEquivalentCents;
  }

  return c.json({
    schedules,
    summary: {
      activeCount: schedules.filter((s) => !s.completed).length,
      dueSoonCount: schedules.filter((s) => s.status === 'due_soon' || s.status === 'overdue').length,
      monthlyOutflowCents,
      monthlyInflowCents,
      monthlyNetCents: monthlyInflowCents - monthlyOutflowCents,
    },
  });
});

scheduleRoutes.post('/', requireApiKeyOrSession('schedules:write'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = scheduleCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid schedule input' }, 400);
  }

  const d = parsed.data;
  let payeeId: string | null = d.payee || null;
  if (!payeeId && d.payeeName?.trim()) {
    payeeId = await actual.ensurePayeeByName(d.payeeName);
  }

  const amountCents = Math.round(d.amount * 100);
  const id = await actual.createSchedule({
    name: d.name,
    account: d.account,
    payee: payeeId,
    amount: amountCents,
    amountOp: d.amountOp,
    posts_transaction: d.posts_transaction,
    date: d.date as string | RecurConfig,
  });

  void syncScheduleWatchState(id);
  return c.json({ id, ok: true }, 201);
});

scheduleRoutes.patch('/:id', requireApiKeyOrSession('schedules:write'), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const parsed = scheduleCreateSchema.partial().safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid schedule update' }, 400);
  }

  const d = parsed.data;
  const payload: Parameters<typeof actual.updateSchedule>[1] = {};
  if (d.name !== undefined) payload.name = d.name;
  if (d.account !== undefined) payload.account = d.account;
  if (d.payee !== undefined) payload.payee = d.payee;
  if (!d.payee && d.payeeName?.trim()) {
    payload.payee = await actual.ensurePayeeByName(d.payeeName);
  }
  if (d.amount !== undefined) payload.amount = Math.round(d.amount * 100);
  if (d.amountOp !== undefined) payload.amountOp = d.amountOp;
  if (d.posts_transaction !== undefined) payload.posts_transaction = d.posts_transaction;
  if (d.date !== undefined) payload.date = d.date as string | RecurConfig;

  const updated = await actual.updateSchedule(id, payload, d.date !== undefined);
  void syncScheduleWatchState(id);
  return c.json({ ok: true, schedule: updated });
});

scheduleRoutes.delete('/:id', requireApiKeyOrSession('schedules:write'), async (c) => {
  const id = c.req.param('id');
  await actual.deleteSchedule(id);
  deleteScheduleWatchState(id);
  return c.json({ ok: true });
});

const postingOccurrences = new Set<string>();

scheduleRoutes.post('/:id/post-now', requireApiKeyOrSession('schedules:write'), async (c) => {
  const id = c.req.param('id');
  const schedules = await getEnrichedSchedules();
  const target = schedules.find((s) => s.id === id);
  if (!target) return c.json({ error: 'Schedule not found' }, 404);
  if (!target.account) return c.json({ error: 'Schedule has no account assigned' }, 400);

  const date = target.next_date || new Date().toISOString().slice(0, 10);
  const { syncId } = await actual.resolveBudgetSyncId();
  const importedId = scheduleImportId(id, date);
  const occurrence = syncId + ':' + importedId;
  if (postingOccurrences.has(occurrence)) return c.json({ error: 'This bill is already being posted.' }, 409);
  postingOccurrences.add(occurrence);
  try {
    const transactions = await actual.getAccountTransactions(target.account, date, date);
    const existing = transactions.find((tx) => tx.date === date && postedScheduleId(tx, schedules) === id);
    if (existing) return c.json({ ok: true, alreadyPosted: true, postedDate: date, amountCents: existing.amount });
    if ((await actual.resolveBudgetSyncId()).syncId !== syncId) return c.json({ error: 'Actual budget changed while posting the bill.' }, 409);
    await actual.addTransaction(target.account, {
      date,
      amount: target.amountCents,
      payee: target.payee || undefined,
      payee_name: !target.payee ? target.name || 'Scheduled Transaction' : undefined,
      notes: 'Posted from schedule: ' + (target.name || target.id),
      cleared: true,
      imported_id: importedId,
    });
  } finally {
    postingOccurrences.delete(occurrence);
  }

  recordSchedulePostNotified({
    scheduleId: target.id,
    postedDate: date,
    source: 'kopi_post_now',
  });

  void notifyScheduledPosted({
    scheduleId: target.id,
    name: target.name ?? null,
    payeeName: target.payeeName,
    amountCents: target.amountCents,
    accountName: target.accountName,
    postedDate: date,
  }).catch((err) => console.warn('[notifications] schedule post-now push failed:', err));

  return c.json({ ok: true, postedDate: date, amountCents: target.amountCents });
});
