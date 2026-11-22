import { Hono } from 'hono';
import { z } from 'zod';
import { requireSession } from '../auth/service';
import {
  notificationPrefsSchema,
  pushSubscriptionInputSchema,
} from '../../shared/types';
import {
  getNotificationPrefs,
  getVapidDetails,
  listSubscriptions,
  maybeCaptureVapidSubject,
  removeSubscriptionByEndpoint,
  removeSubscriptionById,
  sendPushToSubscribers,
  updateNotificationPrefs,
  upsertSubscription,
} from './service';

export const notificationRoutes = new Hono();

notificationRoutes.get('/status', requireSession, (c) => {
  const { publicKey } = getVapidDetails();
  return c.json({
    vapidPublicKey: publicKey,
    prefs: getNotificationPrefs(),
    subscriptions: listSubscriptions(),
  });
});

notificationRoutes.patch('/prefs', requireSession, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = notificationPrefsSchema.partial().safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid notification settings' }, 400);
  }
  const prefs = updateNotificationPrefs(parsed.data);
  return c.json({ ok: true, prefs });
});

notificationRoutes.post('/subscriptions', requireSession, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = pushSubscriptionInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid push subscription' }, 400);
  }

  maybeCaptureVapidSubject(c.req.header('origin'));
  const userAgent = c.req.header('user-agent') || '';
  const subscription = upsertSubscription({
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
    deviceLabel: parsed.data.deviceLabel,
    userAgent,
  });

  return c.json({ ok: true, subscription, subscriptions: listSubscriptions() }, 201);
});

notificationRoutes.post('/unsubscribe', requireSession, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ endpoint: z.string().url() }).safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Valid endpoint is required' }, 400);
  }
  removeSubscriptionByEndpoint(parsed.data.endpoint);
  return c.json({ ok: true, subscriptions: listSubscriptions() });
});

notificationRoutes.delete('/subscriptions/:id', requireSession, (c) => {
  removeSubscriptionById(c.req.param('id'));
  return c.json({ ok: true, subscriptions: listSubscriptions() });
});

notificationRoutes.post('/test', requireSession, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = z.object({ endpoint: z.string().url().optional() }).safeParse(body ?? {});
  const targetEndpoint = parsed.success ? parsed.data.endpoint : undefined;

  const result = await sendPushToSubscribers(
    {
      title: 'Kopi notifications are working',
      body: 'You’ll be alerted for new email transactions and posted schedules.',
      tag: 'kopi-test',
      url: '/?tab=settings',
      tab: 'settings',
    },
    { ignoreEnabled: true, targetEndpoint },
  );

  return c.json({ ok: true, ...result, subscriptions: listSubscriptions() });
});
