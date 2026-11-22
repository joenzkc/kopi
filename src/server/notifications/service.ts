import crypto from 'node:crypto';
import { generateVAPIDKeys, sendNotification } from 'web-push';
import { config } from '../config';
import { db, getSetting, setSetting } from '../db';
import {
  DEFAULT_NOTIFICATION_PREFS,
  notificationPrefsSchema,
} from '../../shared/types';
import type {
  NotificationPrefs,
  PushSubscriptionRecord,
} from '../../shared/types';

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  tab?: 'home' | 'activity' | 'bills' | 'settings';
}

interface StoredSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  device_label: string;
  user_agent: string;
  created_at: string;
  last_used_at: string | null;
  last_error: string | null;
}

const DEFAULT_VAPID_SUBJECT = 'mailto:noreply@kopi.app';

function isValidVapidSubject(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (v.startsWith('mailto:') && v.includes('@') && v.includes('.')) return true;
  if (v.startsWith('https://')) {
    try {
      const u = new URL(v);
      return u.hostname !== 'localhost' && !u.hostname.endsWith('.local') && !/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname);
    } catch {
      return false;
    }
  }
  return false;
}

export function getVapidDetails(): { subject: string; publicKey: string; privateKey: string } {
  let publicKey = config.vapidPublicKey || getSetting('vapid_public_key') || '';
  let privateKey = config.vapidPrivateKey || getSetting('vapid_private_key') || '';

  if (!publicKey || !privateKey) {
    const generated = generateVAPIDKeys();
    publicKey = generated.publicKey;
    privateKey = generated.privateKey;
    setSetting('vapid_public_key', publicKey);
    setSetting('vapid_private_key', privateKey);
  }

  const candidates = [
    config.vapidSubject,
    getSetting('vapid_subject') || '',
    config.appOrigin,
    DEFAULT_VAPID_SUBJECT,
  ];
  const subject = candidates.find(isValidVapidSubject) || DEFAULT_VAPID_SUBJECT;

  return { subject, publicKey, privateKey };
}

export function maybeCaptureVapidSubject(originHeader: string | undefined): void {
  if (!originHeader || config.vapidSubject || getSetting('vapid_subject')) return;
  if (isValidVapidSubject(originHeader)) {
    setSetting('vapid_subject', originHeader);
  }
}

export function getNotificationPrefs(): NotificationPrefs {
  const raw = getSetting('notifications');
  if (!raw) return DEFAULT_NOTIFICATION_PREFS;
  try {
    const parsed = notificationPrefsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_NOTIFICATION_PREFS;
  } catch {
    return DEFAULT_NOTIFICATION_PREFS;
  }
}

export function updateNotificationPrefs(patch: Partial<NotificationPrefs>): NotificationPrefs {
  const current = getNotificationPrefs();
  const next = notificationPrefsSchema.parse({ ...current, ...patch });
  setSetting('notifications', JSON.stringify(next));
  return next;
}

export function inferDeviceLabel(userAgent: string): string {
  const ua = userAgent || '';
  let os = 'Browser';
  if (/iPhone/i.test(ua)) os = 'iPhone';
  else if (/iPad/i.test(ua)) os = 'iPad';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let browser = '';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\//i.test(ua)) browser = 'Opera';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/CriOS|Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua)) browser = 'Safari';

  return browser ? `${os} · ${browser}` : os;
}

export function listSubscriptions(): PushSubscriptionRecord[] {
  return db
    .query<PushSubscriptionRecord, []>(
      `SELECT id, endpoint, device_label, created_at, last_used_at, last_error
       FROM push_subscriptions
       ORDER BY created_at DESC`,
    )
    .all();
}

export function upsertSubscription(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  deviceLabel?: string;
  userAgent: string;
}): PushSubscriptionRecord {
  const now = new Date().toISOString();
  const label = input.deviceLabel?.trim() || inferDeviceLabel(input.userAgent);
  const existing = db
    .query<{ id: string }, [string]>('SELECT id FROM push_subscriptions WHERE endpoint = ?')
    .get(input.endpoint);

  if (existing) {
    db.query(
      `UPDATE push_subscriptions
       SET p256dh = ?, auth = ?, device_label = ?, user_agent = ?, last_error = NULL
       WHERE id = ?`,
    ).run(input.p256dh, input.auth, label, input.userAgent.slice(0, 300), existing.id);
    return db
      .query<PushSubscriptionRecord, [string]>(
        'SELECT id, endpoint, device_label, created_at, last_used_at, last_error FROM push_subscriptions WHERE id = ?',
      )
      .get(existing.id)!;
  }

  const id = crypto.randomUUID();
  db.query(
    `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, device_label, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.endpoint, input.p256dh, input.auth, label, input.userAgent.slice(0, 300), now);

  return {
    id,
    endpoint: input.endpoint,
    device_label: label,
    created_at: now,
    last_used_at: null,
    last_error: null,
  };
}

export function removeSubscriptionById(id: string): boolean {
  const res = db.query('DELETE FROM push_subscriptions WHERE id = ?').run(id);
  return res.changes > 0;
}

export function removeSubscriptionByEndpoint(endpoint: string): boolean {
  const res = db.query('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  return res.changes > 0;
}

function formatSignedAmount(amountMajor: number, currency: string): string {
  const abs = Math.abs(amountMajor);
  const sign = amountMajor < 0 ? '−' : amountMajor > 0 ? '+' : '';
  try {
    const formatted = new Intl.NumberFormat('en-SG', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(abs);
    return `${sign}${formatted}`;
  } catch {
    return `${sign}${currency.toUpperCase()} ${abs.toFixed(2)}`;
  }
}

export async function sendPushToSubscribers(
  payload: PushPayload,
  opts: { ignoreEnabled?: boolean; targetEndpoint?: string } = {},
): Promise<{ sent: number; failed: number; removed: number; errors: string[] }> {
  const prefs = getNotificationPrefs();
  if (!opts.ignoreEnabled && !prefs.enabled) {
    return { sent: 0, failed: 0, removed: 0, errors: [] };
  }

  const subs = opts.targetEndpoint
    ? db
        .query<StoredSubscription, [string]>('SELECT * FROM push_subscriptions WHERE endpoint = ?')
        .all(opts.targetEndpoint)
    : db.query<StoredSubscription, []>('SELECT * FROM push_subscriptions').all();

  if (subs.length === 0) {
    return { sent: 0, failed: 0, removed: 0, errors: [] };
  }

  const vapidDetails = getVapidDetails();
  const bodyStr = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  let removed = 0;
  const errors: string[] = [];

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          bodyStr,
          {
            vapidDetails,
            TTL: 86_400,
          },
        );
        sent++;
        db.query('UPDATE push_subscriptions SET last_used_at = ?, last_error = NULL WHERE id = ?').run(
          new Date().toISOString(),
          sub.id,
        );
      } catch (err) {
        const statusCode =
          err && typeof err === 'object' && 'statusCode' in err
            ? Number((err as { statusCode?: number }).statusCode)
            : 0;
        const msg = err instanceof Error ? err.message : String(err);

        if (statusCode === 404 || statusCode === 410) {
          db.query('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
          removed++;
        } else {
          failed++;
          errors.push(`${sub.device_label}: ${msg.slice(0, 140)}`);
          db.query('UPDATE push_subscriptions SET last_error = ? WHERE id = ?').run(msg.slice(0, 300), sub.id);
        }
      }
    }),
  );

  return { sent, failed, removed, errors };
}

export async function notifyEmailTransaction(input: {
  eventId: string;
  status: 'imported' | 'pending_review' | 'failed';
  payee: string | null;
  subject: string;
  amountBase: number | null;
  currency: string;
  accountName: string | null;
  transferAccountName?: string | null;
}): Promise<void> {
  const prefs = getNotificationPrefs();
  if (!prefs.enabled || !prefs.emailTransactions) return;

  if (prefs.emailMode === 'imported_only' && input.status !== 'imported') return;
  if (prefs.emailMode === 'review_only' && input.status === 'imported') return;

  const amtText = input.amountBase !== null ? formatSignedAmount(input.amountBase, input.currency) : null;
  const label = input.transferAccountName
    ? `Transfer → ${input.transferAccountName}`
    : input.payee || input.subject || 'Email transaction';

  let title: string;
  let body: string;

  if (input.status === 'imported') {
    title = amtText ? `${label} · ${amtText}` : `Imported · ${label}`;
    body = input.accountName ? `Auto-imported to ${input.accountName}` : 'Auto-imported from email';
  } else {
    title = amtText ? `Review: ${label} · ${amtText}` : `Review email: ${label}`;
    body = input.accountName ? `${input.accountName} · Tap to review` : 'Tap to review in Activity';
  }

  await sendPushToSubscribers({
    title,
    body,
    tag: `email-${input.eventId}`,
    url: '/?tab=activity',
    tab: 'activity',
  });
}

export async function notifyScheduledPosted(input: {
  scheduleId: string;
  name: string | null;
  payeeName: string | null;
  amountCents: number;
  accountName: string | null;
  postedDate: string;
}): Promise<void> {
  const prefs = getNotificationPrefs();
  if (!prefs.enabled || !prefs.scheduledPosted) return;

  const baseCurrency = (getSetting('base_currency') || 'SGD').toUpperCase();
  const label = input.name || input.payeeName || 'Scheduled transaction';
  const amtText = formatSignedAmount(input.amountCents / 100, baseCurrency);

  const parts = [label, amtText];
  if (input.accountName) parts.push(input.accountName);

  await sendPushToSubscribers({
    title: 'Scheduled transaction posted',
    body: parts.join(' · '),
    tag: `schedule-${input.scheduleId}-${input.postedDate}`,
    url: '/?tab=bills',
    tab: 'bills',
  });
}
