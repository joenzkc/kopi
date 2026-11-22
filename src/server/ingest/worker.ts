import crypto from 'node:crypto';
import { db, getSetting } from '../db';
import { parseEmailTransaction } from './parser';
import * as actual from '../actual/client';
import { notifyEmailTransaction } from '../notifications/service';
import type { ParsedEmailTx } from '../../shared/types';
import { claimBankAlert, findBillReview, hasBillRule, linkBill, lockEmail, recordRepeatedAlert } from './billMatches';

let processing = false;

export function enqueueEmailEvent(input: {
  source: string;
  message_id?: string;
  sender: string;
  subject: string;
  body_text: string;
  received_at?: string;
}): { id: string; deduplicated: boolean } {
  const messageId =
    input.message_id?.trim() ||
    crypto
      .createHash('sha256')
      .update(`${input.sender}|${input.subject}|${input.body_text.slice(0, 1000)}`)
      .digest('hex');

  const existing = db
    .query<{ id: string }, [string, string]>(
      'SELECT id FROM email_events WHERE source = ? AND message_id = ?',
    )
    .get(input.source, messageId);

  if (existing) {
    return { id: existing.id, deduplicated: true };
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.query(
    `INSERT INTO email_events (id, source, message_id, sender, subject, body_text, received_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
  ).run(
    id,
    input.source,
    messageId,
    input.sender,
    input.subject,
    input.body_text,
    input.received_at || now,
    now,
  );

  // Trigger async worker immediately
  queueMicrotask(() => {
    void processQueuedEmailEvents();
  });

  return { id, deduplicated: false };
}

export async function processQueuedEmailEvents(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    const queued = db
      .query<
        {
          id: string;
          source: string;
          message_id: string;
          sender: string;
          subject: string;
          body_text: string;
          received_at: string;
          created_at: string;
          notified_at: string | null;
          status: string;
          parsed_json: string | null;
        },
        []
      >(`
        SELECT id, source, message_id, sender, subject, body_text, received_at, created_at, notified_at, status, parsed_json
        FROM email_events
        WHERE status = 'queued' OR (
          status = 'pending_review'
          AND json_extract(parsed_json, '$.billReview.waitingForBill') = 1
          AND julianday(processed_at) < julianday('now', '-5 minutes')
        )
        ORDER BY status = 'queued' DESC, created_at ASC LIMIT 20
      `)
      .all();

    let accountNameById: Map<string, string> | null = null;
    async function lookupAccountName(accountId: string | null | undefined): Promise<string | null> {
      if (!accountId) return null;
      if (!accountNameById) {
        const accts = await actual.getAccounts(false).catch(() => []);
        accountNameById = new Map(accts.map((a) => [a.id, a.name]));
      }
      return accountNameById.get(accountId) ?? null;
    }

    const baseCurrency = (getSetting('base_currency') || 'SGD').toUpperCase();

    for (const ev of queued) {
      const release = lockEmail(ev.id);
      if (!release) continue;
      const shouldNotify = !ev.notified_at;
      try {
        const current = db.query<{ status: string; parsed_json: string | null }, [string]>('SELECT status, parsed_json FROM email_events WHERE id = ?').get(ev.id);
        if (current?.status !== ev.status || current.parsed_json !== ev.parsed_json) continue;
        const previous = ev.parsed_json ? (JSON.parse(ev.parsed_json) as ParsedEmailTx).billReview : undefined;
        const { parsed, autoImport } = await parseEmailTransaction({
          sender: ev.sender,
          subject: ev.subject,
          text: ev.body_text,
          receivedAt: ev.received_at,
        });

        const now = new Date().toISOString();
        const waitExpired = Date.now() - Date.parse(ev.created_at) >= 2 * 86_400_000;
        if (parsed.accountId && (parsed.transactionReference || (parsed.amountBase !== null && parsed.amountBase < 0 && parsed.payee && !parsed.transferAccountId))) {
          let budgetId = previous?.budgetId || '';
          try {
            const activeBudget = (await actual.resolveBudgetSyncId()).syncId;
            if (budgetId && budgetId !== activeBudget) throw new Error('Switch back to the budget that received this email.');
            budgetId = activeBudget;
            const duplicate = claimBankAlert(budgetId, ev.id, ev.source, parsed);
            if (duplicate) {
              recordRepeatedAlert(budgetId, ev.id, duplicate, parsed);
              continue;
            }

            const review = await findBillReview(parsed, budgetId, previous);
            if (review?.waitingForBill && waitExpired) {
              review.waitingForBill = false;
              review.needsReview = true;
            }
            parsed.billReview = review;
            const candidate = review?.candidates[0];
            if (review && candidate && review.candidates.length === 1 && !review.needsReview && ev.source !== 'manual-test' &&
                hasBillRule(parsed, review, candidate)) {
              if (linkBill(ev.id, parsed, review, candidate, false)) continue;
              parsed.billReview = { ...review, candidates: [], needsReview: true };
            }
          } catch (err) {
            console.warn('[email] bill lookup failed:', err instanceof Error ? err.message : String(err));
            parsed.billReview = { ...previous, budgetId, candidates: [], needsReview: true, waitingForBill: !waitExpired && previous?.waitingForBill };
          }
        }

        if (autoImport && !parsed.billReview && !previous && parsed.accountId && parsed.amountBase !== null) {
          const importedId = `email:${crypto
            .createHash('sha256')
            .update(`${ev.source}:${ev.message_id}`)
            .digest('hex')
            .slice(0, 32)}`;

          const res = await actual.importTransactions(parsed.accountId, [
            {
              date: parsed.date,
              amount: Math.round(parsed.amountBase * 100),
              payee_name: parsed.payee || 'Email Transaction',
              imported_payee: parsed.rawPayee || parsed.payee || undefined,
              category: parsed.categoryId || undefined,
              notes: parsed.notes,
              cleared: true,
              imported_id: importedId,
            },
          ]);

          const txId = res.added[0] || res.updated[0] || importedId;
          db.query(
            `UPDATE email_events
             SET status = 'imported', parsed_json = ?, confidence = ?, actual_tx_id = ?, error = NULL, processed_at = ?, notified_at = COALESCE(notified_at, ?)
             WHERE id = ?`,
          ).run(JSON.stringify(parsed), parsed.confidence, txId, now, now, ev.id);

          if (shouldNotify) {
            const [accountName, transferAccountName] = await Promise.all([
              lookupAccountName(parsed.accountId),
              lookupAccountName(parsed.transferAccountId),
            ]);
            void notifyEmailTransaction({
              eventId: ev.id,
              status: 'imported',
              payee: parsed.payee,
              subject: ev.subject,
              amountBase: parsed.amountBase,
              currency: baseCurrency,
              accountName,
              transferAccountName,
            }).catch((err) => console.warn('[notifications] email push failed:', err));
          }
        } else {
          db.query(
            `UPDATE email_events
             SET status = 'pending_review', parsed_json = ?, confidence = ?, error = NULL, processed_at = ?, notified_at = COALESCE(notified_at, ?)
             WHERE id = ?`,
          ).run(JSON.stringify(parsed), parsed.confidence, now, now, ev.id);

          if (shouldNotify) {
            const [accountName, transferAccountName] = await Promise.all([
              lookupAccountName(parsed.accountId),
              lookupAccountName(parsed.transferAccountId),
            ]);
            void notifyEmailTransaction({
              eventId: ev.id,
              status: 'pending_review',
              payee: parsed.payee,
              subject: ev.subject,
              amountBase: parsed.amountBase,
              currency: baseCurrency,
              accountName,
              transferAccountName,
            }).catch((err) => console.warn('[notifications] email push failed:', err));
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const now = new Date().toISOString();
        db.query(
          `UPDATE email_events SET status = 'failed', error = ?, processed_at = ?, notified_at = COALESCE(notified_at, ?) WHERE id = ?`,
        ).run(msg.slice(0, 500), now, now, ev.id);

        if (shouldNotify) {
          void notifyEmailTransaction({
            eventId: ev.id,
            status: 'failed',
            payee: null,
            subject: ev.subject,
            amountBase: null,
            currency: baseCurrency,
            accountName: null,
          }).catch((pushErr) => console.warn('[notifications] email push failed:', pushErr));
        }
      } finally {
        release();
      }
    }
  } finally {
    processing = false;
  }
}

export function startEmailWorker(): void {
  void processQueuedEmailEvents();
  setInterval(() => {
    void processQueuedEmailEvents();
  }, 10_000);
}
