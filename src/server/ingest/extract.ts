/**
 * Pure text extraction for bank/card alert emails (no DB, no network) so it can be unit-tested
 * against real samples. parser.ts layers account links, rules, FX and payee rules on top.
 */

export type RefKind = 'card' | 'account' | 'wallet';

export interface AccountRef {
  /** Stable key, e.g. "uob:card:1234". */
  fingerprint: string;
  issuer: string;
  kind: RefKind;
  last4: string;
  /** Human label, e.g. "UOB card ••1234". */
  label: string;
}

export interface Extracted {
  sender: string;
  subject: string;
  body: string;
  /** When the original email was sent (from a forwarded-message header), ISO. */
  sentAt: string | null;
  issuer: string;
  amount: number | null;
  currency: string | null;
  direction: 'expense' | 'income';
  /** Merchant / counterparty exactly as the bank wrote it (used as Actual's imported_payee). */
  rawPayee: string | null;
  /** Tidied display version of rawPayee. */
  payee: string | null;
  date: string | null;
  dateFromText: boolean;
  /** The account this alert is about (yours). */
  ownRef: AccountRef | null;
  /** The other side's account digits, if any (may be another account of yours → transfer). */
  otherRef: AccountRef | null;
  /** Fallback fingerprint for alerts with no digits: sender + normalised subject. */
  alertKey: string;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const ISSUERS: Array<[RegExp, string]> = [
  [/dbs\.com|posb\.com|paylah/i, 'DBS'],
  [/uobgroup\.com|uob\.com/i, 'UOB'],
  [/citibank|citi\.com/i, 'Citi'],
  [/maribank/i, 'MariBank'],
  [/ocbc/i, 'OCBC'],
  [/hsbc/i, 'HSBC'],
  [/sc\.com|standardchartered/i, 'StanChart'],
  [/americanexpress|amex/i, 'Amex'],
  [/trustbank|trust\.bank/i, 'Trust'],
  [/gxs/i, 'GXS'],
  [/grab/i, 'Grab'],
  [/revolut/i, 'Revolut'],
  [/wise\.com|transferwise/i, 'Wise'],
  [/youtrip/i, 'YouTrip'],
];

// Currency code or symbol → ISO code. Order matters: multi-char symbols before "$".
const CURRENCY_TOKENS: Array<[string, string]> = [
  ['SGD', 'SGD'], ['S$', 'SGD'], ['USD', 'USD'], ['US$', 'USD'], ['EUR', 'EUR'], ['€', 'EUR'], ['GBP', 'GBP'], ['£', 'GBP'],
  ['JPY', 'JPY'], ['¥', 'JPY'], ['MYR', 'MYR'], ['RM', 'MYR'], ['HKD', 'HKD'], ['HK$', 'HKD'], ['AUD', 'AUD'], ['A$', 'AUD'],
  ['NZD', 'NZD'], ['CAD', 'CAD'], ['CHF', 'CHF'], ['CNY', 'CNY'], ['RMB', 'CNY'], ['KRW', 'KRW'], ['₩', 'KRW'],
  ['THB', 'THB'], ['฿', 'THB'], ['IDR', 'IDR'], ['TWD', 'TWD'], ['NT$', 'TWD'], ['PHP', 'PHP'], ['₱', 'PHP'],
  ['VND', 'VND'], ['₫', 'VND'], ['INR', 'INR'], ['₹', 'INR'],
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CUR_ALT = CURRENCY_TOKENS.map(([t]) => escapeRe(t)).join('|');
const NUM = '([0-9]{1,3}(?:,[0-9]{3})+(?:\\.[0-9]{1,2})?|[0-9]+(?:\\.[0-9]{1,2})?)';
const MONEY_PREFIX = new RegExp(`(?<![A-Za-z])(${CUR_ALT}|\\$)\\s?${NUM}(?![0-9])`, 'i');
const MONEY_SUFFIX = new RegExp(`(?<![0-9.,])${NUM}\\s?(${CUR_ALT})(?![A-Za-z])`, 'i');

/** Labels whose values we read ("Amount: SGD3.42"). */
const LABELS = [
  'Transaction Ref', 'Transaction Reference', 'Transaction Reference Number', 'Transaction ID', 'Payment Reference',
  'Date & Time', 'Date and Time', 'Transaction date', 'Transaction time',
  'Transaction Time', 'Transaction amount', 'Amount', 'From', 'To', 'Transaction details', 'Merchant', 'Merchant name',
  'Account number', 'Card number', 'Description', 'Payee', 'Recipient', 'Reference',
];
const LABEL_RE = new RegExp(`(?<![A-Za-z])(${LABELS.map(escapeRe).sort((a, b) => b.length - a.length).join('|')})\\s*:`, 'gi');
/** Prose that ends a field value. */
const STOP_RE =
  /\s(?:To view|If unauthori[sz]ed|If you did not|If this was|Please (?:call|contact|do not|login|log in)|Didn['’]t expect|Did not expect|Thank you|For enquiries|Yours faithfully|This is an? (?:auto|system)|We are pleased|To manage)\b/i;

function normaliseText(s: string): string {
  return s
    .replace(/\[image:[^\]]*\]/gi, ' ')
    .replace(/[​-‍⁠﻿ ͏]/g, ' ')
    .replace(/\*+\s*([A-Za-z][A-Za-z &]{0,30}:)\s*\*+/g, ' $1 ') // "* From:*" → "From:"
    .replace(/\*+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function emailAddress(s: string): string {
  const m = s.match(/<([^>\s]+@[^>\s]+)>/) || s.match(/([^\s<>"]+@[^\s<>"]+)/);
  return (m?.[1] || s).trim().toLowerCase();
}

/** Unwraps a hand-forwarded email so the bank, its subject and send date are used instead of the forwarder's. */
export function unwrapForward(sender: string, subject: string, body: string): { sender: string; subject: string; body: string; sentAt: string | null } {
  const text = normaliseText(body);
  const marker = text.search(/-{3,}\s*Forwarded message\s*-{3,}|Begin forwarded message:|-{3,}\s*Original Message\s*-{3,}/i);
  let cleanSubject = subject.replace(/^\s*((?:fwd?|fw|re)\s*:\s*)+/i, '').trim();
  if (marker < 0) return { sender, subject: cleanSubject, body: text, sentAt: null };

  const rest = text.slice(marker).replace(/^.*?(?:-{3,}\s*Forwarded message\s*-{3,}|Begin forwarded message:|-{3,}\s*Original Message\s*-{3,})/i, '').trim();
  const header = rest.match(
    /^From:\s*(.+?)\s+(?:Date|Sent):\s*(.+?)\s+Subject:\s*(.+?)\s+To:\s*(\S+@\S+?|<[^>]+>|\S+)(?:\s+(?:Cc|CC):\s*\S+)?\s+([\s\S]*)$/i,
  );
  if (!header) return { sender, subject: cleanSubject, body: rest, sentAt: null };

  const [, fwdFrom, fwdDate, fwdSubject, , remainder] = header;
  cleanSubject = fwdSubject.replace(/^\s*((?:fwd?|fw|re)\s*:\s*)+/i, '').trim();
  const d = new Date(fwdDate.replace(/\s+at\s+/i, ' ').replace(/\(.*?\)/g, '').trim());
  return {
    sender: emailAddress(fwdFrom),
    subject: cleanSubject,
    body: remainder.trim(),
    sentAt: Number.isNaN(d.getTime()) ? null : d.toISOString(),
  };
}

export function issuerFor(sender: string, text: string): string {
  for (const [re, name] of ISSUERS) if (re.test(sender)) return name;
  for (const [re, name] of ISSUERS) if (re.test(text.slice(0, 400))) return name;
  const domain = emailAddress(sender).split('@')[1] || '';
  const parts = domain.split('.').filter((p) => !['com', 'sg', 'co', 'mail', 'email', 'alerts', 'notifications', 'www'].includes(p));
  const name = parts[parts.length - 1] || 'Bank';
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function fingerprintFor(issuer: string, kind: RefKind, last4: string): string {
  return `${issuer.toLowerCase().replace(/[^a-z0-9]+/g, '')}:${kind}:${last4}`;
}

export function refLabel(issuer: string, kind: RefKind, last4: string, product?: string): string {
  const what = product || (kind === 'card' ? 'card' : kind === 'wallet' ? 'wallet' : 'account');
  return `${issuer} ${what} ••${last4}`;
}

/** Reads "Label: value" pairs; each value runs to the next label or a stop phrase. */
export function readFields(text: string): Array<{ label: string; value: string; start: number; end: number }> {
  const hits: Array<{ label: string; idx: number; valueStart: number }> = [];
  LABEL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LABEL_RE.exec(text))) hits.push({ label: m[1], idx: m.index, valueStart: m.index + m[0].length });
  return hits.map((h, i) => {
    const hardEnd = i + 1 < hits.length ? hits[i + 1].idx : text.length;
    let value = text.slice(h.valueStart, hardEnd);
    const stop = value.search(STOP_RE);
    if (stop >= 0) value = value.slice(0, stop);
    return { label: h.label.toLowerCase(), value: value.trim(), start: h.valueStart, end: h.valueStart + value.length };
  });
}

function parseMoney(s: string): { amount: number; currency: string | null } | null {
  const pre = s.match(MONEY_PREFIX);
  const suf = pre ? null : s.match(MONEY_SUFFIX);
  const token = pre ? pre[1] : suf ? suf[2] : null;
  const num = pre ? pre[2] : suf ? suf[1] : null;
  if (!num) return null;
  const amount = Number(num.replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const up = (token || '').toUpperCase();
  const code = up === '$' ? null : CURRENCY_TOKENS.find(([t]) => t.toUpperCase() === up)?.[1] ?? null;
  return { amount, currency: code };
}

function toIso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Finds a transaction date; a date with no year takes the year that keeps it on or before the reference date. */
export function parseDate(s: string, ref: Date): string | null {
  const iso = s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return toIso(+iso[1], +iso[2], +iso[3]);

  const dmy = s.match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?,?(?:\s+(\d{4}))?\b/i);
  const mdy = dmy ? null : s.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?(?:\s+(\d{4}))?\b/i);
  const slash = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/);

  let y: number | null = null;
  let mo: number | null = null;
  let d: number | null = null;
  if (dmy) {
    d = +dmy[1];
    mo = MONTHS[dmy[2].toLowerCase().slice(0, 3)];
    y = dmy[3] ? +dmy[3] : null;
  } else if (mdy) {
    mo = MONTHS[mdy[1].toLowerCase().slice(0, 3)];
    d = +mdy[2];
    y = mdy[3] ? +mdy[3] : null;
  } else if (slash) {
    // Singapore banks write day/month/year.
    d = +slash[1];
    mo = +slash[2];
    y = slash[3].length === 2 ? 2000 + +slash[3] : +slash[3];
  }
  if (!mo || !d) return null;
  if (y === null) {
    y = ref.getFullYear();
    const candidate = new Date(y, mo - 1, d);
    if (candidate.getTime() - ref.getTime() > 2 * 86_400_000) y -= 1;
  }
  return toIso(y, mo, d);
}

const REF_RE =
  /(card|a\/c|acct|account|mobile|wallet)\b[^.:]{0,40}?\b(?:ending|ends)(?:\s+(?:in|with))?\s*(?:no\.?\s*)?[:#]?\s*(?:[xX*•·]+[\s-]?)*(\d{4})\b|((?:[xX*•]{4}[\s-]?){2,3})(\d{4})\b/gi;

function findRefs(text: string, issuer: string): Array<AccountRef & { idx: number }> {
  const out: Array<AccountRef & { idx: number }> = [];
  REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF_RE.exec(text))) {
    const last4 = m[2] || m[4];
    let kind: RefKind;
    if (m[1]) {
      const w = m[1].toLowerCase();
      kind = w === 'card' ? 'card' : w === 'mobile' || w === 'wallet' ? 'wallet' : 'account';
    } else {
      kind = /card/i.test(text.slice(Math.max(0, m.index - 60), m.index)) || (m[3] || '').replace(/[^xX*•]/g, '').length >= 12 ? 'card' : 'account';
    }
    const ctx = text.slice(Math.max(0, m.index - 50), m.index + m[0].length);
    const product = kind === 'wallet' && /paylah/i.test(ctx) ? 'PayLah!' : undefined;
    out.push({ fingerprint: fingerprintFor(issuer, kind, last4), issuer, kind, last4, label: refLabel(issuer, kind, last4, product), idx: m.index });
  }
  return out;
}

function stripRefWords(s: string): string {
  return s
    .replace(/\((?:[^()]*\bending\b[^()]*)\)/gi, ' ')
    .replace(/\b(?:a\/c|acct|account|card|mobile|wallet)\b[^.]*?\bending\b\s*\S*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Removes legal suffixes, country codes and shouting so payees read nicely. */
export function tidyPayee(raw: string | null): string | null {
  if (!raw) return null;
  let s = raw
    .replace(/\s+/g, ' ')
    .replace(/^[\s:;,.\-]+|[\s:;,\-]+$/g, '')
    .replace(/\s+(?:PTE\.?\s*LTD\.?|PTE\.?|LTD\.?|LIMITED|SDN\.?\s*BHD\.?|INC\.?|LLC)\.?$/i, '')
    .replace(/\s+(?:SINGAPORE\s+)?(?:SGP|SG|SIN)$/i, '')
    .replace(/\s+SINGAPORE$/i, '')
    .replace(/[\s.]+$/, '')
    .trim();
  if (s.length < 2) return null;
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (letters && letters === letters.toUpperCase()) {
    s = s.toLowerCase().replace(/(^|[\s\-/&(])([a-z])/g, (_, p, c) => p + c.toUpperCase());
  }
  return s.slice(0, 80);
}

function cleanRaw(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.replace(/\s+/g, ' ').replace(/^[\s:;,.\-]+|[\s:;,\-.]+$/g, '').trim();
  return s.length >= 2 ? s.slice(0, 80) : null;
}

export function normaliseSubject(subject: string): string {
  return subject
    .toLowerCase()
    .replace(/^\s*((?:fwd?|fw|re)\s*:\s*)+/, '')
    .replace(/[0-9]+([.,][0-9]+)*/g, '#')
    .replace(/[^a-z#]+/g, ' ')
    .trim();
}

export function extractTransaction(input: { sender: string; subject: string; body: string; receivedAt?: string }): Extracted {
  const un = unwrapForward(input.sender, input.subject, input.body);
  const text = un.body;
  const all = `${un.subject}. ${text}`;
  const issuer = issuerFor(un.sender, all);
  const fields = readFields(text);
  const field = (...names: string[]) => fields.find((f) => names.includes(f.label) && f.value);

  // Amount: labelled first, then sentence phrases, then anything money-shaped.
  let money = null as ReturnType<typeof parseMoney>;
  const amtField = field('transaction amount', 'amount');
  if (amtField) money = parseMoney(amtField.value);
  if (!money) {
    const phrase = all.match(
      new RegExp(`\\b(?:transaction of|received|charged(?: with)?|payment of|spent|debited(?: with)?|credited(?: with)?|purchase of|paid|sent|transferred)\\s+((?:${CUR_ALT}|\\$)\\s?${NUM}|${NUM}\\s?(?:${CUR_ALT}))`, 'i'),
    );
    if (phrase) money = parseMoney(phrase[1]);
  }
  if (!money) money = parseMoney(all);

  // Direction
  const incomeHint = /\b(you have received|you've received|received (?:a |an )?(?:transfer|payment|funds)|has been credited|credited to your|incoming|refund(?:ed)?|cashback|reversal)\b/i.test(all);
  const expenseHint = /\b(charged|debited|spent|paid to|payment to|made a payment|purchase|transaction of .* was made|we refer to your|scan & pay|transfer to)\b/i.test(all);
  const direction: 'expense' | 'income' = incomeHint && !/\b(charged|debited|made a payment|payment to)\b/i.test(all) ? 'income' : expenseHint || !incomeHint ? 'expense' : 'income';

  // Account references, and which side is ours.
  const refs = findRefs(text, issuer);
  const fromF = field('from');
  const toF = field('to');
  const inField = (f: typeof fromF) => (r: { idx: number }) => Boolean(f && r.idx >= f.start && r.idx < f.end);
  let ownRef: AccountRef | null = null;
  let otherRef: AccountRef | null = null;
  if (fromF || toF) {
    const fromRef = refs.find(inField(fromF)) || null;
    const toRef = refs.find(inField(toF)) || null;
    const yours = (f: typeof fromF) => Boolean(f && /\byour\b/i.test(f.value));
    if (direction === 'income' || (yours(toF) && !yours(fromF))) {
      ownRef = toRef;
      otherRef = fromRef;
    } else {
      ownRef = fromRef;
      otherRef = toRef;
    }
    if (!ownRef) ownRef = refs.find((r) => r !== otherRef) || null;
  } else {
    ownRef = refs[0] || null;
  }
  const strip = (r: (AccountRef & { idx?: number }) | null): AccountRef | null =>
    r ? { fingerprint: r.fingerprint, issuer: r.issuer, kind: r.kind, last4: r.last4, label: r.label } : null;

  // Payee: the other side of the transaction.
  let rawPayee: string | null = null;
  const sideField = direction === 'income' ? fromF : toF;
  if (sideField) rawPayee = cleanRaw(stripRefWords(sideField.value));
  if (!rawPayee) {
    const detail = field('transaction details', 'merchant', 'merchant name', 'description', 'payee', 'recipient');
    if (detail) rawPayee = cleanRaw(detail.value);
  }
  if (!rawPayee) {
    const sentence =
      text.match(/\b(?:made a payment to|payment to|paid to|transfer(?:red)? to|sent to)\s+(.+?)(?=\s+(?:on|using|with|via|from)\b|\.\s|\.$|$)/i) ||
      text.match(/\b(?:at|@)\s+([A-Z0-9][^.]{1,60}?)(?=\s+(?:on|using|with|via)\b|\.\s|\.$|\s+If\b|$)/) ||
      (direction === 'income' ? text.match(/\bfrom\s+([A-Z][^.]{1,60}?)(?=\s+(?:on|to|via)\b|\.\s|$)/) : null);
    if (sentence) rawPayee = cleanRaw(stripRefWords(sentence[1]));
  }
  if (rawPayee && /^(your|my)\b/i.test(rawPayee)) rawPayee = null;

  // Date: labelled fields, then the body.
  const ref = new Date(un.sentAt || input.receivedAt || Date.now());
  const dateField = field('transaction date', 'date & time', 'date and time', 'transaction time');
  let date = (dateField && parseDate(dateField.value, ref)) || parseDate(text, ref);
  const dateFromText = Boolean(date);
  if (!date) date = un.sentAt ? un.sentAt.slice(0, 10) : null;

  return {
    sender: un.sender,
    subject: un.subject,
    body: text,
    sentAt: un.sentAt,
    issuer,
    amount: money ? money.amount : null,
    currency: money ? money.currency : null,
    direction,
    rawPayee,
    payee: tidyPayee(rawPayee),
    date,
    dateFromText,
    ownRef: strip(ownRef),
    otherRef: strip(otherRef),
    alertKey: `${emailAddress(un.sender)}|${normaliseSubject(un.subject)}`,
  };
}
