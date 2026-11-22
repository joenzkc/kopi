import React, { useCallback, useEffect, useState } from 'react';
import { Fingerprint, KeyRound, LockKeyhole, Monitor, Plus, Trash2, Workflow } from 'lucide-react';
import { startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import type { ApiKeyRecord } from '@shared/types';
import { apiFetch } from '../../lib/api';
import { relativeTime } from '../../lib/recent';
import { ConfirmAction, CopyField, Disclosure, SettingsCard, describeDevice } from './SettingsUI';
import { Button } from '@client/components/ui/button';
import { Input } from '@client/components/ui/input';
import { Label } from '@client/components/ui/label';
import { Alert } from '@client/components/ui/alert';
import { Badge } from '@client/components/ui/badge';

interface SecuritySectionProps {
  webAuthnSupportedOrigin: boolean;
  onToast: (msg: string, tone?: 'success' | 'error') => void;
}

type Passkey = { id: string; device_name: string; created_at: string };
type Session = { id: string; user_agent: string; ip_address: string; created_at: string; last_seen_at: string; current: boolean };

const rowStyle: React.CSSProperties = { borderTop: '1px solid var(--border-subtle)' };

export function SecuritySection({ webAuthnSupportedOrigin, onToast }: SecuritySectionProps) {
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyRecord[]>([]);
  const [passkeyName, setPasskeyName] = useState(() => describeDevice(navigator.userAgent));
  const [newKeyName, setNewKeyName] = useState('');
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [pk, ss, ak] = await Promise.allSettled([
      apiFetch<{ passkeys: Passkey[] }>('/api/auth/passkeys'),
      apiFetch<{ sessions: Session[] }>('/api/auth/sessions'),
      apiFetch<{ keys: ApiKeyRecord[] }>('/api/auth/api-keys'),
    ]);
    if (pk.status === 'fulfilled') setPasskeys(pk.value.passkeys);
    if (ss.status === 'fulfilled') setSessions(ss.value.sessions);
    if (ak.status === 'fulfilled') setApiKeys(ak.value.keys.filter((k) => !k.revoked_at));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await fn();
      if (success) onToast(success);
      await load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Something went wrong', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function addPasskey(e: React.FormEvent) {
    e.preventDefault();
    const deviceName = passkeyName.trim() || 'Passkey';
    await act(async () => {
      const { challengeId, options } = await apiFetch<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }>(
        '/api/auth/passkey/register/options',
        { method: 'POST' },
      );
      const response = await startRegistration({ optionsJSON: options });
      await apiFetch('/api/auth/passkey/register/verify', { method: 'POST', body: JSON.stringify({ challengeId, deviceName, response }) });
    }, `Passkey “${deviceName}” added`);
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    if (pw.next.length < 8) return setPwError('The new password needs at least 8 characters.');
    if (pw.next !== pw.confirm) return setPwError('The new passwords don’t match.');
    setBusy(true);
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: pw.current, newPassword: pw.next }),
      });
      setPw({ current: '', next: '', confirm: '' });
      setPwOpen(false);
      onToast('Password changed');
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Could not change the password');
    } finally {
      setBusy(false);
    }
  }

  async function createKey(e: React.FormEvent) {
    e.preventDefault();
    const name = newKeyName.trim();
    if (!name) return;
    await act(async () => {
      const res = await apiFetch<{ rawKey: string }>('/api/auth/api-keys', {
        method: 'POST',
        body: JSON.stringify({ name, scopes: ['ingest:write', 'portfolio:read', 'schedules:write'] }),
      });
      setRevealedKey(res.rawKey);
      setNewKeyName('');
    }, 'API key created. Copy it now, it’s only shown once.');
  }

  const others = sessions.filter((s) => !s.current);

  return (
    <>
      {/* Passkeys */}
      <SettingsCard
        icon={<Fingerprint className="h-[18px] w-[18px]" />}
        title="Passkeys"
        description="Sign in with Face ID, Touch ID or Windows Hello instead of your password."
      >
        {!webAuthnSupportedOrigin && (
          <p className="rounded-xl px-3 py-2.5 text-xs" style={{ backgroundColor: 'var(--warning-soft)', color: 'var(--warning)' }}>
            Passkeys only work over HTTPS. Open Kopi at its https:// address to add one.
          </p>
        )}
        {passkeys.length > 0 && (
          <div className="flex flex-col">
            {passkeys.map((pk, i) => (
              <div key={pk.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5" style={i === 0 ? undefined : rowStyle}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-bold">{pk.device_name}</span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Added {pk.created_at.slice(0, 10)}
                  </span>
                </span>
                <ConfirmAction
                  label={<Trash2 className="h-4 w-4" />}
                  ariaLabel={`Remove passkey ${pk.device_name}`}
                  confirmLabel="Remove"
                  message={`Remove “${pk.device_name}”? That device will need your password to sign in.`}
                  busy={busy}
                  onConfirm={() => act(() => apiFetch(`/api/auth/passkeys/${encodeURIComponent(pk.id)}`, { method: 'DELETE' }), 'Passkey removed')}
                />
              </div>
            ))}
          </div>
        )}
        <form onSubmit={addPasskey} className="flex flex-col gap-1.5">
          <Label htmlFor="passkey-name" className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
            Add a passkey for this device
          </Label>
          <div className="flex gap-2">
            <Input id="passkey-name" value={passkeyName} onChange={(e) => setPasskeyName(e.target.value)} maxLength={60} className="min-w-0 flex-1" />
            <Button type="submit" disabled={busy || !webAuthnSupportedOrigin} variant="default" className="flex shrink-0 items-center gap-1.5 rounded-xl px-4 text-sm disabled:opacity-40">
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </div>
        </form>
      </SettingsCard>

      {/* Password */}
      <SettingsCard
        icon={<LockKeyhole className="h-[18px] w-[18px]" />}
        title="Password"
        description="You stay signed in on this device after changing it."
        right={
          !pwOpen ? (
            <Button type="button" onClick={() => setPwOpen(true)} variant="secondary" className="h-10 shrink-0 rounded-xl px-3 text-sm font-bold">
              Change…
            </Button>
          ) : undefined
        }
      >
        {pwOpen && (
        <form onSubmit={changePassword} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pw-current" className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
              Current password
            </Label>
            <Input id="pw-current" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pw-new" className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
                New password
              </Label>
              <Input id="pw-new" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pw-confirm" className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
                Repeat new password
              </Label>
              <Input id="pw-confirm" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            </div>
          </div>
          {pwError && (
            <Alert as="p" variant="destructive">
              {pwError}
            </Alert>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() => {
                setPwOpen(false);
                setPw({ current: '', next: '', confirm: '' });
                setPwError(null);
              }}
              variant="secondary" className="h-11 flex-1 rounded-xl text-sm font-bold"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy || !pw.current || !pw.next || !pw.confirm}
              variant="default" className="h-11 flex-1 rounded-xl text-sm disabled:opacity-40"
            >
              Change password
            </Button>
          </div>
        </form>
        )}
      </SettingsCard>

      {/* Devices */}
      <SettingsCard
        icon={<Monitor className="h-[18px] w-[18px]" />}
        title="Signed-in devices"
        description="Where Kopi is currently signed in."
      >
        <div className="flex flex-col">
          {sessions.map((s, i) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5" style={i === 0 ? undefined : rowStyle}>
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-2 text-sm font-bold">
                  {describeDevice(s.user_agent)}
                  {s.current && (
                    <Badge variant="accent" className="px-2 py-0.5 text-[11px] font-extrabold">
                      This device
                    </Badge>
                  )}
                </span>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {s.current ? 'Active now' : `Last active ${relativeTime(s.last_seen_at)}`}
                  {s.ip_address ? ` · ${s.ip_address}` : ''}
                </span>
              </span>
              {!s.current && (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(() => apiFetch(`/api/auth/sessions/${encodeURIComponent(s.id)}`, { method: 'DELETE' }), 'Signed out that device')}
                  variant="secondary" className="h-10 shrink-0 rounded-xl px-3 text-sm font-bold disabled:opacity-50"
                >
                  Sign out
                </Button>
              )}
            </div>
          ))}
        </div>
        {others.length > 1 && (
          <ConfirmAction
            label="Sign out all other devices"
            confirmLabel="Sign them out"
            message={`Sign out ${others.length} other devices? They’ll need your password or a passkey to get back in.`}
            busy={busy}
            onConfirm={() =>
              act(async () => {
                for (const s of others) await apiFetch(`/api/auth/sessions/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
              }, 'Signed out all other devices')
            }
          />
        )}
      </SettingsCard>

      {/* Automation */}
      <Disclosure title="Automation (Shortcuts, n8n)" description="API keys for adding transactions from other tools">
        <CopyField label="Add-transaction endpoint (POST with Bearer API key)" value={`${window.location.origin}/api/v1/transactions/ingest`} />
        <form onSubmit={createKey} className="flex flex-col gap-1.5">
          <Label htmlFor="api-key-name" className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
            New API key
          </Label>
          <div className="flex gap-2">
            <Input
              id="api-key-name"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="e.g. Apple Shortcuts"
              className="min-w-0 flex-1"
            />
            <Button type="submit" disabled={busy || !newKeyName.trim()} variant="default" className="flex shrink-0 items-center gap-1.5 rounded-xl px-4 text-sm disabled:opacity-40">
              <KeyRound className="h-4 w-4" />
              Create
            </Button>
          </div>
        </form>
        {revealedKey && (
          <div className="flex flex-col gap-2 rounded-2xl p-3" style={{ backgroundColor: 'var(--positive-soft)' }}>
            <CopyField label="Your new key, shown only once" value={revealedKey} />
            <Button type="button" onClick={() => setRevealedKey(null)} className="self-start text-xs font-bold" style={{ color: 'var(--accent-text)' }}>
              I’ve copied it
            </Button>
          </div>
        )}
        {apiKeys.length > 0 && (
          <div className="flex flex-col">
            {apiKeys.map((k, i) => (
              <div key={k.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5" style={i === 0 ? undefined : rowStyle}>
                <span className="flex min-w-0 items-center gap-2.5">
                  <Workflow className="h-4 w-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-bold">{k.name}</span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {k.key_prefix}… · {k.last_used_at ? `last used ${relativeTime(k.last_used_at)}` : 'never used'}
                    </span>
                  </span>
                </span>
                <ConfirmAction
                  label="Revoke"
                  confirmLabel="Revoke key"
                  message={`Revoke “${k.name}”? Anything using it stops working immediately.`}
                  busy={busy}
                  onConfirm={() => act(() => apiFetch(`/api/auth/api-keys/${k.id}`, { method: 'DELETE' }), 'API key revoked')}
                />
              </div>
            ))}
          </div>
        )}
      </Disclosure>
    </>
  );
}
