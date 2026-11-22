import { config } from '../config';
import { db, getSetting } from '../db';
import { getFxRate } from '../portfolio/prices';
import type { EmailRuleRecord, ParsedEmailTx } from '../../shared/types';
import * as actual from '../actual/client';
import { resolvePayeeByRules } from '../actual/payeeRules';
import { extractTransaction, readFields, tidyPayee } from './extract';
import { findLink, getAutoImportAccounts } from './links';

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeRegex(pattern: string, flags = 'i'): RegExp | null {
  if (!pattern.trim()) return null;
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

export function getEnabledRules(): EmailRuleRecord[] {
  const rows = db
    .query<
      Omit<EmailRuleRecord, 'auto_import' | 'enabled'> & { auto_import: number; enabled: number },
      []
    >('SELECT * FROM email_rules WHERE enabled = 1 ORDER BY created_at ASC')
    .all();

  return rows.map((r) => ({
    ...r,
    auto_import: Boolean(r.auto_import),
    enabled: Boolean(r.enabled),
  }));
}

async function tryLlmParse(input: {
  sender: string;
  subject: string;
  body: string;
  baseCurrency: string;
}): Promise<Partial<ParsedEmailTx> | null> {
  if (!config.llmApiUrl || !config.llmApiKey || !config.llmModel) return null;
  try {
    const res = await fetch(`${config.llmApiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llmApiKey}`,
      },
      body: JSON.stringify({
        model: config.llmModel,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'Extract financial transaction details from this email. Return JSON only: {"amount": number|null, "currency": "SGD"|"USD"|..., "direction": "expense"|"income", "payee": string|null, "date": "YYYY-MM-DD"|null, "confidence": 0..1}. Amount should be positive; direction indicates sign.',
          },
          {
            role: 'user',
            content: `From: ${input.sender}\nSubject: ${input.subject}\nBody:\n${input.body.slice(0, 4000)}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return null;
    const json = JSON.parse(raw) as {
      amount?: number | null;
      currency?: string;
      direction?: 'expense' | 'income';
      payee?: string | null;
      date?: string | null;
      confidence?: number;
    };
    if (typeof json.amount !== 'number' || !Number.isFinite(json.amount)) return null;
    const dir = json.direction === 'income' ? 'income' : 'expense';
    const signed = dir === 'expense' ? -Math.abs(json.amount) : Math.abs(json.amount);
    return {
      amount: signed,
      currency: (json.currency || input.baseCurrency).toUpperCase(),
      payee: json.payee || null,
      date: json.date || undefined,
      direction: dir,
      confidence: typeof json.confidence === 'number' ? Math.min(0.95, Math.max(0.2, json.confidence)) : 0.7,
    };
  } catch {
    return null;
  }
}

/** Accounts that exist and are open, so stale links to closed accounts are ignored. */
async function openAccountIds(): Promise<Set<string> | null> {
  try {
    const accounts = await actual.getAccounts(false);
    return new Set(accounts.filter((a) => !a.closed).map((a) => a.id));
  } catch {
    return null; // Actual unreachable: trust links rather than drop them
  }
}

export async function parseEmailTransaction(input: {
  sender: string;
  subject: string;
  text: string;
  html?: string;
  receivedAt?: string;
}): Promise<{ parsed: ParsedEmailTx; autoImport: boolean }> {
  const baseCurrency = (getSetting('base_currency') || 'SGD').toUpperCase();
  const body = (input.text || (input.html ? stripHtml(input.html) : '')).trim();
  const x = extractTransaction({ sender: input.sender, subject: input.subject, body, receivedAt: input.receivedAt });
  const combined = `${x.subject}\n${x.body}`;
  const reference = readFields(x.body).find((field) =>
    ['transaction ref', 'transaction reference', 'transaction reference number', 'transaction id', 'payment reference'].includes(field.label),
  )?.value.match(/^([a-z0-9][a-z0-9-]{5,63})\b/i)?.[1];

  // Optional user rules (matched on the bank's own sender/subject, not the forwarder's).
  let matchedRule: EmailRuleRecord | null = null;
  for (const rule of getEnabledRules()) {
    const senderRe = safeRegex(rule.sender_pattern);
    const subjectRe = safeRegex(rule.subject_pattern);
    const senderOk = !senderRe || senderRe.test(x.sender);
    const subjectOk = !subjectRe || subjectRe.test(x.subject);
    if (senderOk && subjectOk && (senderRe || subjectRe)) {
      matchedRule = rule;
      break;
    }
  }

  let amount = x.amount;
  let currency = (x.currency || matchedRule?.default_currency || baseCurrency).toUpperCase();
  let rawPayee = x.rawPayee;
  let payee = x.payee;
  let direction = x.direction;
  let date = x.date;

  // Rule regexes only fill gaps; the structured extractor is more reliable than the seeded patterns.
  if (matchedRule && amount === null) {
    const m = safeRegex(matchedRule.amount_regex)?.exec(combined);
    const val = m?.[1] ? Number(m[1].replace(/,/g, '')) : NaN;
    if (Number.isFinite(val) && val > 0) amount = val;
  }
  if (matchedRule && !rawPayee) {
    const m = safeRegex(matchedRule.payee_regex)?.exec(combined);
    if (m?.[1]) {
      rawPayee = m[1].trim().slice(0, 80);
      payee = tidyPayee(rawPayee);
    }
  }

  let confidence = 0.1 + (amount !== null ? 0.4 : 0) + (rawPayee ? 0.2 : 0) + (x.ownRef ? 0.2 : 0) + (x.dateFromText ? 0.1 : 0);

  // AI fallback when the essentials are still missing.
  if ((amount === null || !rawPayee) && config.llmApiUrl && config.llmApiKey) {
    const llm = await tryLlmParse({ sender: x.sender, subject: x.subject, body: x.body, baseCurrency });
    if (llm) {
      if (llm.amount !== undefined && llm.amount !== null && amount === null) {
        amount = Math.abs(llm.amount);
        direction = llm.direction || direction;
      }
      if (llm.currency && !x.currency) currency = llm.currency.toUpperCase();
      if (llm.payee && !rawPayee) {
        rawPayee = llm.payee;
        payee = tidyPayee(llm.payee);
      }
      if (llm.date && !x.dateFromText) date = llm.date;
      if (llm.confidence) confidence = Math.max(confidence, llm.confidence);
    }
  }

  // Which account? Card/account digits → learned alert type → rule → default.
  const open = await openAccountIds();
  const usable = (id: string | null | undefined): id is string => Boolean(id && (!open || open.has(id)));
  let accountId: string | null = null;
  let accountSource: ParsedEmailTx['accountSource'] = null;
  let alertAmbiguous = false;
  const own = findLink(x.ownRef?.fingerprint);
  if (own && usable(own.accountId)) {
    accountId = own.accountId;
    accountSource = 'link';
  } else if (!x.ownRef) {
    const alert = findLink(x.alertKey);
    if (alert && usable(alert.accountId)) {
      accountId = alert.accountId;
      accountSource = 'alert';
      alertAmbiguous = alert.conflicts > 0;
    }
  }
  const ruleAccount = matchedRule?.actual_account_id;
  if (!accountId && usable(ruleAccount)) {
    accountId = ruleAccount;
    accountSource = 'rule';
  }
  const defaultAccountId = getSetting('default_email_account_id');
  if (!accountId && usable(defaultAccountId)) {
    accountId = defaultAccountId;
    accountSource = 'default';
  }

  // Money moving to/from another of your own accounts is a transfer, not spending.
  const other = findLink(x.otherRef?.fingerprint);
  const transferAccountId = other && usable(other.accountId) && other.accountId !== accountId ? other.accountId : null;

  // Actual's payee rename rules (e.g. "McDonalds JE" → "McDonalds"), previewed so review shows the final name.
  let payeeFromRule = false;
  if (rawPayee && !transferAccountId) {
    try {
      const renamed = await resolvePayeeByRules(rawPayee);
      if (renamed) {
        payee = renamed.payeeName;
        payeeFromRule = true;
      }
    } catch {
      // Actual unreachable: keep the bank's name
    }
  }

  const signedAmount = amount !== null ? (direction === 'expense' ? -Math.abs(amount) : Math.abs(amount)) : null;
  let amountBase: number | null = signedAmount;
  const fxEstimated = signedAmount !== null && currency !== baseCurrency;
  if (fxEstimated && signedAmount !== null) {
    const fx = await getFxRate(currency, baseCurrency, false);
    amountBase = Number((signedAmount * fx).toFixed(2));
  }

  const parsed: ParsedEmailTx = {
    amount: signedAmount,
    currency,
    amountBase,
    payee: payee || null,
    date: date || (input.receivedAt ? input.receivedAt.slice(0, 10) : new Date().toISOString().slice(0, 10)),
    accountId,
    categoryId: matchedRule?.actual_category_id || null,
    notes: [x.ownRef?.label, fxEstimated && signedAmount !== null ? `${currency} ${Math.abs(signedAmount).toLocaleString('en-SG')}` : null]
      .filter(Boolean)
      .join(' · ')
      .slice(0, 240),
    confidence: Number(Math.min(0.99, confidence).toFixed(2)),
    matchedRuleName: matchedRule?.name ?? null,
    direction,
    accountRef: x.ownRef ? { fingerprint: x.ownRef.fingerprint, kind: x.ownRef.kind, label: x.ownRef.label } : null,
    counterRef: x.otherRef ? { fingerprint: x.otherRef.fingerprint, kind: x.otherRef.kind, label: x.otherRef.label } : null,
    alertKey: x.alertKey,
    accountSource,
    transferAccountId,
    fxEstimated,
    rawPayee,
    payeeFromRule,
    originalSender: x.sender,
    transactionReference: reference,
  };

  const essentials = parsed.amountBase !== null && Boolean(parsed.accountId) && Boolean(parsed.payee) && parsed.confidence >= 0.75;
  // Auto-import only when the account is certain (card/account digits, or an alert type that never varied),
  // the amount is exact (not an FX estimate), and it isn't a transfer, which needs Actual's transfer handling.
  const trustedAccount = accountSource === 'link' || (accountSource === 'alert' && !alertAmbiguous);
  const accountOptedIn = Boolean(parsed.accountId && getAutoImportAccounts().has(parsed.accountId));
  const canAutoImport =
    essentials &&
    !fxEstimated &&
    !transferAccountId &&
    ((trustedAccount && accountOptedIn) || (Boolean(matchedRule?.auto_import) && accountSource !== 'default'));

  return { parsed, autoImport: canAutoImport };
}
