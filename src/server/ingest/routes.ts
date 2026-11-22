import crypto from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { db, getSetting } from '../db';
import {
  checkRateLimit,
  getClientIp,
  requireApiKeyOrSession,
  requireSession,
  verifyApiKey,
  verifyWebhookSignature,
} from '../auth/service';
import {
  directTransactionIngestSchema,
  emailEventIngestSchema,
  emailRuleInputSchema,
} from '../../shared/types';
import type { EmailEventRecord, EmailRuleRecord, ParsedEmailTx } from '../../shared/types';
import { enqueueEmailEvent, processQueuedEmailEvents } from './worker';
import { upsertLink } from './links';
import { parseEmailTransaction } from './parser';
import { getFxRate } from '../portfolio/prices';
import * as actual from '../actual/client';

export const ingestRoutes = new Hono();

// --- Public/Automation Event Endpoints (mounted under /api/v1) ---

// 1. Email Event Topic Push Consumer (Cloudflare Email Worker / Gmail PubSub / Resend / Generic)
ingestRoutes.post('/events/email', async (c) => {
  const ip = getClientIp(c);
  if (!checkRateLimit(`email-ingest:${ip}`, 120, 60_000)) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  const rawBody = await c.req.text();
  const sigHeader = c.req.header('x-webhook-signature') || c.req.header('x-hub-signature-256');
  const authHeader = c.req.header('authorization') || '';
  const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  const apiKeyHeader = c.req.header('x-api-key') || bearer;

  const authedBySig = verifyWebhookSignature(rawBody, sigHeader);
  const authedByKey = apiKeyHeader ? Boolean(verifyApiKey(apiKeyHeader, 'ingest:write')) : false;

  if (!authedBySig && !authedByKey) {
    return c.json({ error: 'Unauthorized: valid X-Webhook-Signature or Bearer API key required' }, 401);
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'Invalid JSON payload' }, 400);
  }

  // Support Google Cloud Pub/Sub push envelope automatically: { message: { data: base64, messageId } }
  let payload = json as Record<string, unknown>;
  if (payload && typeof payload === 'object' && payload.message && typeof (payload.message as Record<string, unknown>).data === 'string') {
    const pubsubMsg = payload.message as { data: string; messageId?: string; publishTime?: string };
    try {
      const decoded = JSON.parse(Buffer.from(pubsubMsg.data, 'base64').toString('utf8')) as Record<string, unknown>;
      payload = {
        source: 'pubsub',
        message_id: pubsubMsg.messageId || (decoded.message_id as string | undefined),
        received_at: pubsubMsg.publishTime,
        ...decoded,
      };
    } catch {
      payload = {
        source: 'pubsub',
        message_id: pubsubMsg.messageId,
        text: Buffer.from(pubsubMsg.data, 'base64').toString('utf8'),
      };
    }
  }

  const parsed = emailEventIngestSchema.safeParse(payload);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid email event payload' }, 400);
  }

  const bodyText =
    parsed.data.text ||
    (parsed.data.html
      ? parsed.data.html
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      : '');

  const result = enqueueEmailEvent({
    source: parsed.data.source,
    message_id: parsed.data.message_id,
    sender: parsed.data.from,
    subject: parsed.data.subject,
    body_text: bodyText,
    received_at: parsed.data.received_at,
  });

  return c.json({ ok: true, eventId: result.id, deduplicated: result.deduplicated }, 202);
});

// 2. Direct Structured Transaction Ingest API (for Shortcuts, n8n, scripts, custom consumers)
ingestRoutes.post('/transactions/ingest', requireApiKeyOrSession('ingest:write'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = directTransactionIngestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid transaction payload' }, 400);
  }

  const d = parsed.data;
  const accounts = await actual.getAccounts(false);

  let accountId = d.account_id;
  if (!accountId && d.account_name) {
    const match = accounts.find((a) => a.name.toLowerCase() === d.account_name!.toLowerCase() && !a.closed);
    accountId = match?.id;
  }
  if (!accountId) {
    accountId = getSetting('default_email_account_id') || accounts.find((a) => !a.offbudget && !a.closed)?.id;
  }
  if (!accountId) {
    return c.json({ error: 'Could not resolve target Actual account' }, 400);
  }

  let categoryId = d.category_id;
  if (!categoryId && d.category_name) {
    const cats = await actual.getCategories();
    categoryId = cats.find((cat) => cat.name.toLowerCase() === d.category_name!.toLowerCase())?.id;
  }

  const baseCurrency = (getSetting('base_currency') || 'SGD').toUpperCase();
  const txCurrency = (d.currency || baseCurrency).toUpperCase();
  let amountInBase = d.amount;
  let fxNote = '';
  if (txCurrency !== baseCurrency) {
    const rate = await getFxRate(txCurrency, baseCurrency, false);
    amountInBase = Number((d.amount * rate).toFixed(2));
    fxNote = ` [${txCurrency} ${Math.abs(d.amount).toFixed(2)} @ ${rate.toFixed(4)}]`;
  }

  const date = d.date || new Date().toISOString().slice(0, 10);
  const amountCents = Math.round(amountInBase * 100);
  const notes = `${d.notes || ''}${fxNote}`.trim() || undefined;

  if (d.external_id) {
    const res = await actual.importTransactions(accountId, [
      {
        date,
        amount: amountCents,
        payee_name: d.payee,
        imported_payee: d.payee,
        category: categoryId || undefined,
        notes,
        cleared: d.cleared,
        imported_id: d.external_id,
      },
    ]);
    return c.json({ ok: true, mode: 'import', accountId, amountCents, ...res }, 201);
  }

  await actual.addTransaction(accountId, {
    date,
    amount: amountCents,
    payee_name: d.payee,
    category: categoryId || undefined,
    notes,
    cleared: d.cleared,
  });

  return c.json({ ok: true, mode: 'add', accountId, amountCents }, 201);
});

// --- UI Inbox & Email Rules Routes (mounted under /api) ---

export const inboxRoutes = new Hono();

inboxRoutes.get('/summary', requireSession, (c) => {
  const last = db
    .query<{ received_at: string; sender: string; parsed_json: string | null }, []>(
      'SELECT received_at, sender, parsed_json FROM email_events ORDER BY received_at DESC LIMIT 1',
    )
    .get();
  const counts = db
    .query<{ status: string; n: number }, []>('SELECT status, COUNT(*) AS n FROM email_events GROUP BY status')
    .all();
  const rows = db.query<{ sender: string; parsed_json: string | null }, []>('SELECT sender, parsed_json FROM email_events').all();
  const senders = new Set<string>();
  const bankSender = (r: { sender: string; parsed_json: string | null }) => {
    let s = r.sender;
    try {
      s = (r.parsed_json ? (JSON.parse(r.parsed_json) as ParsedEmailTx).originalSender : null) || r.sender;
    } catch {
      // keep the envelope sender
    }
    const m = s.match(/[^\s<>"]+@[^\s<>"]+/);
    return (m ? m[0] : s).toLowerCase();
  };
  for (const r of rows) {
    const s = bankSender(r);
    // Skip Gmail's own confirmation mail and personal addresses (hand-forwarded tests).
    if (/@(gmail|googlemail|outlook|hotmail|icloud|yahoo)\.|google\.com$/.test(s)) continue;
    senders.add(s);
  }
  const by = Object.fromEntries(counts.map((x) => [x.status, x.n]));
  return c.json({
    lastReceivedAt: last?.received_at ?? null,
    lastSender: last ? bankSender(last) : null,
    total: counts.reduce((sum, x) => sum + x.n, 0),
    pending: (by.pending_review || 0) + (by.failed || 0),
    imported: by.imported || 0,
    senders: [...senders].sort(),
  });
});

inboxRoutes.get('/', requireSession, (c) => {
  const statusFilter = c.req.query('status');
  const rows = statusFilter
    ? db
        .query<
          Omit<EmailEventRecord, 'parsed'> & { parsed_json: string | null },
          [string]
        >('SELECT * FROM email_events WHERE status = ? ORDER BY created_at DESC LIMIT 100')
        .all(statusFilter)
    : db
        .query<
          Omit<EmailEventRecord, 'parsed'> & { parsed_json: string | null },
          []
        >('SELECT * FROM email_events ORDER BY created_at DESC LIMIT 100')
        .all();

  const events: EmailEventRecord[] = rows.map((r) => ({
    id: r.id,
    source: r.source,
    message_id: r.message_id,
    sender: r.sender,
    subject: r.subject,
    body_text: r.body_text,
    received_at: r.received_at,
    status: r.status,
    parsed: r.parsed_json ? (JSON.parse(r.parsed_json) as ParsedEmailTx) : null,
    confidence: r.confidence,
    actual_tx_id: r.actual_tx_id,
    error: r.error,
    created_at: r.created_at,
    processed_at: r.processed_at,
  }));

  const pendingCount =
    db.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM email_events WHERE status = 'pending_review'").get()?.c ?? 0;

  return c.json({ events, pendingCount });
});

inboxRoutes.post('/test-parse', requireSession, async (c) => {
  const body = await c.req.json().catch(() => null);
  const schema = z.object({
    from: z.string().default(''),
    subject: z.string().default(''),
    text: z.string().min(1),
    enqueue: z.boolean().default(false),
  });
  const parsedBody = schema.safeParse(body);
  if (!parsedBody.success) {
    return c.json({ error: 'Provide email text to test parsing' }, 400);
  }

  if (parsedBody.data.enqueue) {
    const queued = enqueueEmailEvent({
      source: 'manual-test',
      sender: parsedBody.data.from,
      subject: parsedBody.data.subject,
      body_text: parsedBody.data.text,
    });
    return c.json({ ok: true, queued });
  }

  const result = await parseEmailTransaction({
    sender: parsedBody.data.from,
    subject: parsedBody.data.subject,
    text: parsedBody.data.text,
  });
  return c.json(result);
});

inboxRoutes.post('/:id/approve', requireSession, async (c) => {
  const id = c.req.param('id');
  const ev = db
    .query<{ id: string; source: string; message_id: string; parsed_json: string | null }, [string]>(
      'SELECT id, source, message_id, parsed_json FROM email_events WHERE id = ?',
    )
    .get(id);
  if (!ev) return c.json({ error: 'Email event not found' }, 404);
  const parsedEvent = ev.parsed_json ? (JSON.parse(ev.parsed_json) as ParsedEmailTx) : null;

  const body = await c.req.json().catch(() => null);
  const schema = z
    .object({
      accountId: z.string().min(1),
      amount: z.number(), // major units in base currency (signed)
      payee: z.string().trim().optional(),
      transferAccountId: z.string().trim().min(1).optional(),
      categoryId: z.string().nullable().optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      notes: z.string().optional(),
      /** Remember this card/account (or alert type) → accountId for next time. */
      remember: z.boolean().default(true),
    })
    .refine((d) => Boolean(d.transferAccountId) || Boolean(d.payee), { message: 'Payee is required' })
    .refine((d) => d.transferAccountId !== d.accountId, { message: 'Pick a different account to transfer to' });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid approval payload' }, 400);
  }

  const d = parsed.data;
  const importedId = `email:${crypto
    .createHash('sha256')
    .update(`${ev.source}:${ev.message_id}`)
    .digest('hex')
    .slice(0, 32)}`;

  let txId: string = importedId;
  if (d.transferAccountId) {
    const payees = await actual.getPayees();
    const transferPayee = payees.find((p) => p.transfer_acct === d.transferAccountId);
    if (!transferPayee) return c.json({ error: 'Could not find the transfer payee for that account in Actual' }, 400);
    await actual.addTransaction(
      d.accountId,
      {
        date: d.date,
        amount: Math.round(d.amount * 100),
        payee: transferPayee.id,
        notes: d.notes || undefined,
        cleared: true,
        imported_id: importedId,
      },
      { runTransfers: true },
    );
  } else {
    // imported_payee carries the bank's original text so Actual's payee rename rules match it.
    const rawPayee = parsedEvent?.rawPayee && parsedEvent.payee === d.payee ? parsedEvent.rawPayee : d.payee!;
    const res = await actual.importTransactions(d.accountId, [
      {
        date: d.date,
        amount: Math.round(d.amount * 100),
        payee_name: d.payee!,
        imported_payee: rawPayee,
        category: d.categoryId || undefined,
        notes: d.notes || undefined,
        cleared: true,
        imported_id: importedId,
      },
    ]);
    txId = res.added[0] || res.updated[0] || importedId;
  }

  if (d.remember && parsedEvent) {
    if (parsedEvent.accountRef) {
      upsertLink({ ...parsedEvent.accountRef, accountId: d.accountId, source: 'learned' });
    } else if (parsedEvent.alertKey) {
      const sender = parsedEvent.originalSender || 'email';
      upsertLink({ fingerprint: parsedEvent.alertKey, kind: 'alert', label: `${sender} alerts`, accountId: d.accountId, source: 'learned' });
    }
    // Choosing a transfer target teaches Kopi which of your accounts the other side's digits belong to.
    if (d.transferAccountId && parsedEvent.counterRef) {
      upsertLink({ ...parsedEvent.counterRef, accountId: d.transferAccountId, source: 'learned' });
    }
  }

  db.query(
    `UPDATE email_events SET status = 'imported', actual_tx_id = ?, error = NULL, processed_at = ? WHERE id = ?`,
  ).run(txId, new Date().toISOString(), id);

  return c.json({ ok: true, actualTxId: txId });
});

/** Re-reads every email still waiting for review (e.g. after the parser or your links improve). */
inboxRoutes.post('/reparse', requireSession, (c) => {
  const res = db
    .query("UPDATE email_events SET status = 'queued', error = NULL WHERE status IN ('pending_review', 'failed')")
    .run();
  queueMicrotask(() => {
    void processQueuedEmailEvents();
  });
  return c.json({ ok: true, requeued: res.changes });
});

inboxRoutes.post('/:id/dismiss', requireSession, (c) => {
  db.query("UPDATE email_events SET status = 'dismissed', processed_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    c.req.param('id'),
  );
  return c.json({ ok: true });
});

// --- Email Rules CRUD ---

export const emailRulesRoutes = new Hono();

emailRulesRoutes.get('/', requireSession, (c) => {
  const rows = db
    .query<
      Omit<EmailRuleRecord, 'auto_import' | 'enabled'> & { auto_import: number; enabled: number },
      []
    >('SELECT * FROM email_rules ORDER BY created_at DESC')
    .all();

  return c.json({
    rules: rows.map((r) => ({
      ...r,
      auto_import: Boolean(r.auto_import),
      enabled: Boolean(r.enabled),
    })),
  });
});

emailRulesRoutes.post('/', requireSession, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = emailRuleInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid rule' }, 400);
  }
  const d = parsed.data;
  const id = crypto.randomUUID();
  db.query(
    `INSERT INTO email_rules (id, name, sender_pattern, subject_pattern, amount_regex, payee_regex, default_currency, actual_account_id, actual_category_id, auto_import, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    d.name,
    d.sender_pattern,
    d.subject_pattern,
    d.amount_regex,
    d.payee_regex,
    d.default_currency.toUpperCase(),
    d.actual_account_id || null,
    d.actual_category_id || null,
    d.auto_import ? 1 : 0,
    d.enabled ? 1 : 0,
    new Date().toISOString(),
  );
  return c.json({ id, ok: true }, 201);
});

emailRulesRoutes.patch('/:id', requireSession, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const parsed = emailRuleInputSchema.partial().safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid rule update' }, 400);
  }
  const d = parsed.data;
  const fields: string[] = [];
  const values: unknown[] = [];

  if (d.name !== undefined) {
    fields.push('name = ?');
    values.push(d.name);
  }
  if (d.sender_pattern !== undefined) {
    fields.push('sender_pattern = ?');
    values.push(d.sender_pattern);
  }
  if (d.subject_pattern !== undefined) {
    fields.push('subject_pattern = ?');
    values.push(d.subject_pattern);
  }
  if (d.amount_regex !== undefined) {
    fields.push('amount_regex = ?');
    values.push(d.amount_regex);
  }
  if (d.payee_regex !== undefined) {
    fields.push('payee_regex = ?');
    values.push(d.payee_regex);
  }
  if (d.default_currency !== undefined) {
    fields.push('default_currency = ?');
    values.push(d.default_currency.toUpperCase());
  }
  if (d.actual_account_id !== undefined) {
    fields.push('actual_account_id = ?');
    values.push(d.actual_account_id || null);
  }
  if (d.actual_category_id !== undefined) {
    fields.push('actual_category_id = ?');
    values.push(d.actual_category_id || null);
  }
  if (d.auto_import !== undefined) {
    fields.push('auto_import = ?');
    values.push(d.auto_import ? 1 : 0);
  }
  if (d.enabled !== undefined) {
    fields.push('enabled = ?');
    values.push(d.enabled ? 1 : 0);
  }

  if (fields.length > 0) {
    values.push(id);
    db.query(`UPDATE email_rules SET ${fields.join(', ')} WHERE id = ?`).run(...(values as never[]));
  }
  return c.json({ ok: true });
});

emailRulesRoutes.delete('/:id', requireSession, (c) => {
  db.query('DELETE FROM email_rules WHERE id = ?').run(c.req.param('id'));
  return c.json({ ok: true });
});
