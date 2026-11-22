import { createHash } from 'node:crypto';
import type { EmailBillCandidate, EmailBillReview, ParsedEmailTx } from '../../shared/types';
import * as actual from '../actual/client';
import { db, getSetting } from '../db';
import { postedScheduleId } from '../schedules/occurrence';

const activeEmails = new Set<string>();

export function lockEmail(id: string): (() => void) | undefined {
  if (activeEmails.has(id)) return;
  activeEmails.add(id);
  return () => { activeEmails.delete(id); };
}

function merchantKey(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function dateOffset(date: string, days: number): string {
  return new Date(Date.parse(date + 'T00:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);
}

function ruleScope(parsed: ParsedEmailTx): [string, string, string] | undefined {
  const merchant = parsed.rawPayee || parsed.payee;
  if (!merchant || !parsed.accountId || parsed.accountRef?.kind !== 'card' || parsed.accountSource !== 'link') return;
  return [parsed.accountId, parsed.accountRef.fingerprint, merchantKey(merchant)];
}

/** Returns the first Kopi event for a charge when the bank supplied a charge reference. */
export function claimBankAlert(budgetId: string, eventId: string, source: string, parsed: ParsedEmailTx): string | null {
  const reference = parsed.transactionReference;
  if (!reference || !parsed.accountId || !parsed.accountRef || parsed.amount === null) return null;
  const key = createHash('sha256').update(JSON.stringify([
    source === 'manual-test' ? 'test' : 'bank',
    parsed.accountId, parsed.accountRef.fingerprint, parsed.currency, parsed.amount, reference.toUpperCase(),
  ])).digest('hex');
  db.query('INSERT OR IGNORE INTO email_alert_receipts (budget_id, alert_key, event_id) VALUES (?, ?, ?)').run(budgetId, key, eventId);
  const original = db.query<{ event_id: string }, [string, string]>(
    'SELECT event_id FROM email_alert_receipts WHERE budget_id = ? AND alert_key = ?',
  ).get(budgetId, key);
  return original && original.event_id !== eventId ? original.event_id : null;
}

export function recordRepeatedAlert(budgetId: string, eventId: string, originalId: string, parsed: ParsedEmailTx): void {
  const original = db.query<{ actual_tx_id: string | null }, [string]>('SELECT actual_tx_id FROM email_events WHERE id = ?').get(originalId);
  const resolved: EmailBillReview = { budgetId, candidates: [], outcome: 'repeat' };
  db.query(
    "UPDATE email_events SET status = 'imported', parsed_json = ?, confidence = ?, actual_tx_id = ?, error = NULL, processed_at = ? WHERE id = ?",
  ).run(JSON.stringify({ ...parsed, billReview: resolved }), parsed.confidence, original?.actual_tx_id || null, new Date().toISOString(), eventId);
}

export async function findBillReview(parsed: ParsedEmailTx, budgetId: string, previous?: EmailBillReview): Promise<EmailBillReview | undefined> {
  const prior = previous?.budgetId === budgetId ? previous : undefined;
  const accountId = parsed.accountId;
  const payee = parsed.payee;
  if (prior?.dismissed) return prior;
  if (!accountId || !payee || parsed.amountBase === null || parsed.amountBase >= 0 || parsed.transferAccountId) return;
  if (!Number.isFinite(Date.parse(parsed.date + 'T00:00:00Z'))) return;

  const since = dateOffset(parsed.date, -2);
  const until = dateOffset(parsed.date, 2);
  const [schedules, payees, transactions] = await Promise.all([
    actual.getSchedules(),
    actual.getPayees(),
    actual.getAccountTransactions(accountId, since, until),
  ]);
  if ((await actual.resolveBudgetSyncId()).syncId !== budgetId) throw new Error('Actual budget changed while checking the bill.');

  const names = new Map(payees.map((p) => [p.id, p.name]));
  const transfers = new Set(payees.filter((p) => p.transfer_acct).map((p) => p.id));
  const merchants = new Set([payee, parsed.rawPayee].filter((name): name is string => Boolean(name)).map(merchantKey));
  const sameMerchant = (name: string | undefined) => Boolean(name && merchants.has(merchantKey(name)));
  const posted: EmailBillCandidate[] = [];
  for (const tx of transactions) {
    if (tx.account !== accountId || tx.transfer_id || (tx.payee && transfers.has(tx.payee)) || tx.amount >= 0 || tx.date < since || tx.date > until) continue;
    const scheduleId = postedScheduleId(tx, schedules);
    if (!scheduleId) continue;
    const schedule = schedules.find((entry) => entry.id === scheduleId);
    const name = (tx.payee && names.get(tx.payee)) || tx.payee_name || (schedule?.payee && names.get(schedule.payee)) || schedule?.name;
    if (!name || !sameMerchant(name)) continue;
    posted.push({ transactionId: tx.id, scheduleId, scheduleName: schedule?.name || name, payee: name, date: tx.date, amountCents: tx.amount });
  }

  const rejectedIds = prior?.rejectedIds || [];
  const amountCents = Math.round(parsed.amountBase * 100);
  const possible = posted.filter((candidate) => !rejectedIds.includes(candidate.transactionId));
  const baseCurrency = (getSetting('base_currency') || 'SGD').toUpperCase();
  const exact = parsed.fxEstimated || parsed.currency !== baseCurrency ? [] : possible.filter((candidate) => candidate.amountCents === amountCents);
  const claim = db.query('SELECT 1 FROM email_bill_matches WHERE budget_id = ? AND transaction_id = ?');
  const candidates = exact.filter((candidate) => !claim.get(budgetId, candidate.transactionId));
  const due = schedules.filter((schedule) =>
    schedule.account === accountId && !schedule.completed && schedule.next_date &&
    schedule.next_date >= since && schedule.next_date <= until &&
    sameMerchant((schedule.payee && names.get(schedule.payee)) || schedule.name),
  );
  const awaiting = !posted.length && due.some((schedule) => schedule.posts_transaction);
  if (!candidates.length && !possible.length && !due.length && !rejectedIds.length && !prior?.waitingForBill) return;
  return {
    budgetId,
    candidates,
    canRemember: Boolean(ruleScope(parsed)),
    waitingForBill: !candidates.length && !possible.length && !rejectedIds.length && (awaiting || Boolean(prior?.waitingForBill)),
    needsReview: possible.length > 1 || (!candidates.length && (possible.length > 0 || due.length > 0)),
    rejectedIds,
  };
}

export function hasBillRule(parsed: ParsedEmailTx, review: EmailBillReview, candidate: EmailBillCandidate): boolean {
  const scope = ruleScope(parsed);
  return Boolean(scope && parsed.confidence >= 0.75 && !review.rejectedIds?.length && db.query(
    'SELECT 1 FROM email_bill_rules WHERE budget_id = ? AND account_id = ? AND card_fingerprint = ? AND merchant_key = ? AND schedule_id = ?',
  ).get(review.budgetId, ...scope, candidate.scheduleId));
}

export function linkBill(eventId: string, parsed: ParsedEmailTx, review: EmailBillReview, candidate: EmailBillCandidate, remember: boolean): boolean {
  return db.transaction(() => {
    const claim = db.query('INSERT OR IGNORE INTO email_bill_matches (budget_id, transaction_id, event_id) VALUES (?, ?, ?)')
      .run(review.budgetId, candidate.transactionId, eventId);
    if (!claim.changes) return false;
    const scope = remember && ruleScope(parsed);
    if (scope) {
      db.query('INSERT OR IGNORE INTO email_bill_rules (budget_id, account_id, card_fingerprint, merchant_key, schedule_id) VALUES (?, ?, ?, ?, ?)')
        .run(review.budgetId, ...scope, candidate.scheduleId);
    }
    const resolved: EmailBillReview = { budgetId: review.budgetId, candidates: [candidate], outcome: 'matched' };
    const now = new Date().toISOString();
    db.query(
      "UPDATE email_events SET status = 'imported', parsed_json = ?, confidence = ?, actual_tx_id = ?, error = NULL, processed_at = ?, notified_at = COALESCE(notified_at, ?) WHERE id = ?",
    ).run(JSON.stringify({ ...parsed, billReview: resolved }), parsed.confidence, candidate.transactionId, now, now, eventId);
    return true;
  })();
}
