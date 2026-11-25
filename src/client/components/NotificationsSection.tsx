import React, { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, BellRing, Send, Smartphone, Trash2 } from 'lucide-react';
import { DEFAULT_NOTIFICATION_PREFS } from '@shared/types';
import type {
  NotificationPrefs,
  NotificationsStatusResponse,
  PushSubscriptionRecord,
} from '@shared/types';
import { apiFetch } from '../lib/api';
import { Button } from '@client/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@client/components/ui/radio-group';
import { Switch, SwitchThumb } from '@client/components/ui/switch';
import { Badge } from '@client/components/ui/badge';
import { Card } from '@client/components/ui/card';

interface NotificationsSectionProps {
  onToast: (msg: string, tone?: 'success' | 'error') => void;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

function detectIosNonStandalone(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIos = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!isIos) return false;
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return !standalone;
}

async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing?.active) return existing;

  return new Promise<ServiceWorkerRegistration | null>((resolve) => {
    const timer = setTimeout(() => resolve(existing ?? null), 6000);
    navigator.serviceWorker.ready
      .then((reg) => {
        clearTimeout(timer);
        resolve(reg);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(existing ?? null);
      });
  });
}

function SwitchRow({
  title,
  subtitle,
  checked,
  disabled,
  borderTop,
  onToggle,
}: {
  title: string;
  subtitle: string;
  checked: boolean;
  disabled?: boolean;
  borderTop?: boolean;
  onToggle: () => void;
}) {
  return (
    <Switch
      checked={checked}
      disabled={disabled}
      onCheckedChange={onToggle}
      className={`flex min-h-[60px] w-full items-center justify-between gap-3 py-2.5 text-left disabled:opacity-45 ${borderTop ? 'border-t' : ''}`}
      style={borderTop ? { borderColor: 'var(--border-subtle)' } : undefined}
    >
      <span className="flex flex-col">
        <span className="text-body font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</span>
        <span className="text-caption" style={{ color: 'var(--text-muted)' }}>{subtitle}</span>
      </span>
      <SwitchThumb className="shrink-0" />
    </Switch>
  );
}

export function NotificationsSection({ onToast }: NotificationsSectionProps) {
  const [vapidPublicKey, setVapidPublicKey] = useState('');
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  const [subscriptions, setSubscriptions] = useState<PushSubscriptionRecord[]>([]);
  const [localEndpoint, setLocalEndpoint] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'default',
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const isSecure = typeof window !== 'undefined' && window.isSecureContext;
  const iosNonStandalone = detectIosNonStandalone();
  const pushSupported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;

  const syncLocalSubscription = useCallback(async () => {
    if (!pushSupported) {
      setLocalEndpoint(null);
      return;
    }
    setPermission(Notification.permission);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setLocalEndpoint(sub?.endpoint ?? null);
    } catch {
      setLocalEndpoint(null);
    }
  }, [pushSupported]);

  const loadStatus = useCallback(async () => {
    try {
      const data = await apiFetch<NotificationsStatusResponse>('/api/notifications/status');
      setVapidPublicKey(data.vapidPublicKey);
      setPrefs(data.prefs);
      setSubscriptions(data.subscriptions);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to load notification settings', 'error');
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    void loadStatus();
    void syncLocalSubscription();
  }, [loadStatus, syncLocalSubscription]);

  const isThisDeviceRegistered = Boolean(
    localEndpoint && subscriptions.some((s) => s.endpoint === localEndpoint),
  );

  async function enableOnThisDevice() {
    if (!pushSupported || !isSecure || !vapidPublicKey) return;
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        onToast(
          perm === 'denied'
            ? 'Notifications are blocked in your browser settings'
            : 'Notification permission was not granted',
          'error',
        );
        return;
      }

      const reg = await getServiceWorkerRegistration();
      if (!reg) {
        onToast('Service worker is not ready yet — refresh the page and try again', 'error');
        return;
      }

      let sub = await reg.pushManager.getSubscription();
      const serverKey = urlBase64ToUint8Array(vapidPublicKey);

      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: serverKey,
        });
      } else {
        // Re-subscribe if server VAPID key rotated or existing keys are missing
        const json = sub.toJSON();
        if (!json.keys?.p256dh || !json.keys?.auth) {
          await sub.unsubscribe();
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: serverKey,
          });
        }
      }

      const json = sub.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error('Browser returned an incomplete push subscription');
      }

      const res = await apiFetch<{ subscriptions: PushSubscriptionRecord[] }>('/api/notifications/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: {
            p256dh: json.keys.p256dh,
            auth: json.keys.auth,
          },
        }),
      });

      setLocalEndpoint(json.endpoint);
      setSubscriptions(res.subscriptions);
      onToast('Push notifications enabled on this device');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to enable notifications', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function disableOnThisDevice() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      const endpoint = sub?.endpoint || localEndpoint;

      if (sub) {
        await sub.unsubscribe().catch(() => undefined);
      }
      if (endpoint) {
        const res = await apiFetch<{ subscriptions: PushSubscriptionRecord[] }>('/api/notifications/unsubscribe', {
          method: 'POST',
          body: JSON.stringify({ endpoint }),
        });
        setSubscriptions(res.subscriptions);
      }
      setLocalEndpoint(null);
      onToast('Notifications disabled on this device');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to disable notifications', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removeDevice(sub: PushSubscriptionRecord) {
    try {
      if (sub.endpoint === localEndpoint && 'serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        const existing = await reg?.pushManager.getSubscription();
        if (existing?.endpoint === sub.endpoint) {
          await existing.unsubscribe().catch(() => undefined);
        }
        setLocalEndpoint(null);
      }
      const res = await apiFetch<{ subscriptions: PushSubscriptionRecord[] }>(
        `/api/notifications/subscriptions/${encodeURIComponent(sub.id)}`,
        { method: 'DELETE' },
      );
      setSubscriptions(res.subscriptions);
      onToast(`Removed ${sub.device_label}`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to remove device', 'error');
    }
  }

  async function sendTest() {
    setTesting(true);
    try {
      const res = await apiFetch<{
        sent: number;
        failed: number;
        removed: number;
        errors: string[];
        subscriptions: PushSubscriptionRecord[];
      }>('/api/notifications/test', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setSubscriptions(res.subscriptions);
      if (res.sent > 0) {
        onToast(`Test notification sent to ${res.sent} device${res.sent === 1 ? '' : 's'}`);
      } else if (res.errors.length > 0) {
        onToast(res.errors[0], 'error');
      } else {
        onToast('No active devices to notify', 'error');
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to send test notification', 'error');
    } finally {
      setTesting(false);
    }
  }

  async function updatePrefs(patch: Partial<NotificationPrefs>) {
    const prev = prefs;
    const optimistic = { ...prev, ...patch };
    setPrefs(optimistic);
    try {
      const res = await apiFetch<{ prefs: NotificationPrefs }>('/api/notifications/prefs', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setPrefs(res.prefs);
    } catch (err) {
      setPrefs(prev);
      onToast(err instanceof Error ? err.message : 'Failed to update notification preferences', 'error');
    }
  }

  const statusBadge = !prefs.enabled
    ? { label: 'Paused', bg: 'var(--bg-subtle)', fg: 'var(--text-muted)' }
    : isThisDeviceRegistered
      ? { label: 'Active', bg: 'var(--positive-soft)', fg: 'var(--positive)' }
      : subscriptions.length > 0
        ? { label: `${subscriptions.length} device${subscriptions.length === 1 ? '' : 's'}`, bg: 'var(--accent-soft)', fg: 'var(--accent-text)' }
        : { label: 'Off', bg: 'var(--bg-subtle)', fg: 'var(--text-muted)' };

  return (
    <Card as="section" className="space-y-4 rounded-3xl p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4" style={{ color: 'var(--accent-text)' }} />
          <h2 className="text-heading" style={{ color: 'var(--text-primary)' }}>
            Notifications
          </h2>
        </div>
        <Badge
          className="px-2.5 py-1 text-caption font-bold"
          style={{ backgroundColor: statusBadge.bg, color: statusBadge.fg }}
        >
          {statusBadge.label}
        </Badge>
      </div>

      {/* Browser / Device Push Controls */}
      <div className="surface-subtle space-y-3 rounded-2xl p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <div className="text-body font-semibold" style={{ color: 'var(--text-primary)' }}>
              Push notifications on this device
            </div>
            <p className="text-caption leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              {isThisDeviceRegistered
                ? 'This device is subscribed and ready to receive push alerts.'
                : 'Get native alerts on your phone or desktop even when Kopi is closed.'}
            </p>
          </div>
        </div>

        {!isSecure ? (
          <p className="rounded-xl px-3 py-2 text-caption" style={{ backgroundColor: 'var(--warning-soft)', color: 'var(--warning)' }}>
            Web Push requires HTTPS (your Cloudflare Tunnel domain) or localhost.
          </p>
        ) : iosNonStandalone ? (
          <p className="rounded-xl px-3 py-2 text-caption" style={{ backgroundColor: 'var(--warning-soft)', color: 'var(--warning)' }}>
            On iPhone &amp; iPad, tap Share → <strong>Add to Home Screen</strong>, then open Kopi from your Home Screen to enable push notifications.
          </p>
        ) : !pushSupported ? (
          <p className="rounded-xl px-3 py-2 text-caption" style={{ backgroundColor: 'var(--warning-soft)', color: 'var(--warning)' }}>
            This browser does not support Web Push notifications.
          </p>
        ) : permission === 'denied' ? (
          <p className="rounded-xl px-3 py-2 text-caption" style={{ backgroundColor: 'var(--negative-soft)', color: 'var(--negative)' }}>
            Notifications are blocked for this site. Re-enable them in your browser or device settings, then reload Kopi.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {isThisDeviceRegistered ? (
              <>
                <Button
                  type="button"
                  disabled={testing}
                  onClick={() => void sendTest()}
                  variant="default" className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-label disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" />
                  {testing ? 'Sending...' : 'Send test'}
                </Button>
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => void disableOnThisDevice()}
                  variant="secondary" className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-label disabled:opacity-50"
                >
                  <BellOff className="h-3.5 w-3.5" style={{ color: 'var(--text-muted)' }} />
                  {busy ? 'Disabling...' : 'Disable on this device'}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                disabled={busy || loading || !vapidPublicKey}
                onClick={() => void enableOnThisDevice()}
                variant="default" className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-label disabled:opacity-50"
              >
                <BellRing className="h-3.5 w-3.5" />
                {busy ? 'Enabling...' : 'Enable on this device'}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Event Preferences */}
      <div className="flex flex-col rounded-2xl px-4" style={{ backgroundColor: 'var(--bg-subtle)' }}>
        <SwitchRow
          title="All push notifications"
          subtitle="Master switch across all your subscribed devices"
          checked={prefs.enabled}
          onToggle={() => void updatePrefs({ enabled: !prefs.enabled })}
        />

        <SwitchRow
          title="New email transactions"
          subtitle="Alert when a transaction arrives via your email pipeline"
          checked={prefs.emailTransactions}
          disabled={!prefs.enabled}
          borderTop
          onToggle={() => void updatePrefs({ emailTransactions: !prefs.emailTransactions })}
        />

        {prefs.emailTransactions && (
          <div className={`pb-3.5 ${!prefs.enabled ? 'opacity-45' : ''}`}>
            <RadioGroup
              value={prefs.emailMode}
              onValueChange={(value) => void updatePrefs({ emailMode: value as NotificationPrefs['emailMode'] })}
              aria-label="Email notification filter"
              disabled={!prefs.enabled}
              className="grid grid-cols-3 gap-1 rounded-xl p-1"
              style={{ backgroundColor: 'var(--bg-surface)' }}
            >
              {(
                [
                  ['all', 'All'],
                  ['review_only', 'Needs review'],
                  ['imported_only', 'Auto-imported'],
                ] as const
              ).map(([mode, label]) => {
                const on = prefs.emailMode === mode;
                return (
                  <RadioGroupItem
                    key={mode}
                    value={mode}
                    onClick={on ? () => void updatePrefs({ emailMode: mode }) : undefined}
                    className="h-8 rounded-lg text-label transition"
                    style={{
                      backgroundColor: on ? 'var(--accent)' : 'transparent',
                      color: on ? 'var(--accent-fg)' : 'var(--text-muted)',
                    }}
                  >
                    {label}
                  </RadioGroupItem>
                );
              })}
            </RadioGroup>
          </div>
        )}

        <SwitchRow
          title="Scheduled transactions posted"
          subtitle="Alert when a scheduled bill or income posts via Kopi or Actual"
          checked={prefs.scheduledPosted}
          disabled={!prefs.enabled}
          borderTop
          onToggle={() => void updatePrefs({ scheduledPosted: !prefs.scheduledPosted })}
        />
      </div>

      {/* Subscribed Devices */}
      {subscriptions.length > 0 && (
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-label" style={{ color: 'var(--text-secondary)' }}>
              <Smartphone className="h-3.5 w-3.5" style={{ color: 'var(--accent-text)' }} />
              Subscribed devices ({subscriptions.length})
            </div>
            {!isThisDeviceRegistered && (
              <Button
                type="button"
                disabled={testing}
                onClick={() => void sendTest()}
                className="inline-flex items-center gap-1 text-label"
                style={{ color: 'var(--accent-text)' }}
              >
                <Send className="h-3 w-3" />
                {testing ? 'Sending...' : 'Send test'}
              </Button>
            )}
          </div>

          <div className="divider-list">
            {subscriptions.map((sub) => {
              const isCurrent = sub.endpoint === localEndpoint;
              return (
                <div key={sub.id} className="flex items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-body" style={{ color: 'var(--text-primary)' }}>
                      <span className="truncate">{sub.device_label}</span>
                      {isCurrent && (
                        <Badge
                          className="shrink-0 px-1.5 py-0.5 text-caption font-bold"
                          style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)' }}
                        >
                          This device
                        </Badge>
                      )}
                    </div>
                    <div className="truncate text-caption" style={{ color: sub.last_error ? 'var(--negative)' : 'var(--text-muted)' }}>
                      {sub.last_error
                        ? `Last error: ${sub.last_error}`
                        : sub.last_used_at
                          ? `Added ${sub.created_at.slice(0, 10)} · Last alert ${sub.last_used_at.slice(0, 10)}`
                          : `Added ${sub.created_at.slice(0, 10)}`}
                    </div>
                  </div>
                  <Button
                    type="button"
                    onClick={() => void removeDevice(sub)}
                    aria-label={`Remove ${sub.device_label}`}
                    className="shrink-0 rounded-lg p-1.5"
                    style={{ color: 'var(--negative)' }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}
