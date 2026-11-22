import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, Eye, EyeOff, Mail, RefreshCw } from 'lucide-react';
import type { AccountLink, ActualAccount, EmailRuleRecord } from '@shared/types';
import { apiFetch } from '../../lib/api';
import { relativeTime } from '../../lib/recent';
import { ConfirmAction, CopyField, Disclosure, SettingsCard } from './SettingsUI';
import { Button } from '@client/components/ui/button';

interface EmailImportSectionProps {
  accounts: ActualAccount[];
  onOpenAccounts: () => void;
  onToast: (msg: string, tone?: 'success' | 'error') => void;
}

interface Summary {
  lastReceivedAt: string | null;
  lastSender: string | null;
  total: number;
  pending: number;
  imported: number;
  senders: string[];
}

/** Gmail search clauses for bank alerts Kopi knows, so the filter only forwards transaction emails. */
const KNOWN_SENDER_CLAUSES: Record<string, string[]> = {
  'alerts@citibank.com.sg': ['(from:alerts@citibank.com.sg subject:"Credit Card/Ready Credit Transaction")'],
  'unialerts@uobgroup.com': ['(from:unialerts@uobgroup.com subject:"UOB - Transaction Alert")'],
  'notifications@maribank.sg': ['(from:notifications@maribank.sg "You have made a payment to")'],
  'ibanking.alert@dbs.com': [
    '(from:ibanking.alert@dbs.com subject:"You\'ve received a transfer")',
    '(from:ibanking.alert@dbs.com subject:"iBanking Alerts" "transaction was completed")',
  ],
  'paylah.alert@dbs.com': ['(from:paylah.alert@dbs.com "transaction was completed")'],
};

const BANK_NAMES: Array<[RegExp, string]> = [
  [/dbs|posb|paylah/i, 'DBS'],
  [/uob/i, 'UOB'],
  [/citi/i, 'Citi'],
  [/maribank/i, 'MariBank'],
  [/ocbc/i, 'OCBC'],
];

function bankName(sender: string | null): string | null {
  if (!sender) return null;
  return BANK_NAMES.find(([re]) => re.test(sender))?.[1] ?? sender;
}

export function EmailImportSection({ accounts, onOpenAccounts, onToast }: EmailImportSectionProps) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [forwarding, setForwarding] = useState('');
  const [savedForwarding, setSavedForwarding] = useState('');
  const [defaultAccount, setDefaultAccount] = useState('');
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [linkCount, setLinkCount] = useState<number | null>(null);
  const [rules, setRules] = useState<EmailRuleRecord[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [s, sum, acc, rl] = await Promise.allSettled([
      apiFetch<{ forwardingAddress?: string; defaultEmailAccountId: string; webhookSecret: string }>('/api/settings'),
      apiFetch<Summary>('/api/inbox/summary'),
      apiFetch<{ accounts: Array<{ links?: AccountLink[] }> }>('/api/accounts'),
      apiFetch<{ rules: EmailRuleRecord[] }>('/api/email-rules'),
    ]);
    if (s.status === 'fulfilled') {
      setForwarding(s.value.forwardingAddress || '');
      setSavedForwarding(s.value.forwardingAddress || '');
      setDefaultAccount(s.value.defaultEmailAccountId || '');
      setSecret(s.value.webhookSecret || '');
    }
    if (sum.status === 'fulfilled') setSummary(sum.value);
    if (acc.status === 'fulfilled') {
      setLinkCount(acc.value.accounts.reduce((n, a) => n + (a.links || []).filter((l) => l.kind !== 'alert').length, 0));
    }
    if (rl.status === 'fulfilled') setRules(rl.value.rules);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function patchSettings(body: Record<string, unknown>, success: string) {
    try {
      await apiFetch('/api/settings', { method: 'PATCH', body: JSON.stringify(body) });
      onToast(success);
      return true;
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not save', 'error');
      return false;
    }
  }

  async function saveForwarding() {
    const value = forwarding.trim();
    if (value === savedForwarding) return;
    if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      onToast('That doesn’t look like an email address', 'error');
      return;
    }
    if (await patchSettings({ forwardingAddress: value }, value ? 'Forwarding address saved' : 'Forwarding address cleared')) setSavedForwarding(value);
  }

  async function rotateSecret() {
    setBusy(true);
    try {
      const res = await apiFetch<{ webhookSecret: string }>('/api/settings', { method: 'PATCH', body: JSON.stringify({ rotateWebhookSecret: true }) });
      setSecret(res.webhookSecret);
      setShowSecret(true);
      onToast('New secret created. Update WEBHOOK_SECRET in your Cloudflare worker now.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not rotate the secret', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function updateRule(rule: EmailRuleRecord, patch: Partial<Pick<EmailRuleRecord, 'actual_account_id' | 'auto_import'>>) {
    try {
      await apiFetch(`/api/email-rules/${rule.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      setRules((rs) => rs.map((r) => (r.id === rule.id ? { ...r, ...patch } : r)));
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not update the rule', 'error');
    }
  }

  const gmailQuery = useMemo(() => {
    const seen = summary?.senders ?? [];
    const keys = new Set([...Object.keys(KNOWN_SENDER_CLAUSES), ...seen]);
    return [...keys].flatMap((s) => KNOWN_SENDER_CLAUSES[s] ?? [`from:${s}`]).join(' OR ');
  }, [summary]);

  const lastAgeDays = summary?.lastReceivedAt ? (Date.now() - new Date(summary.lastReceivedAt).getTime()) / 86_400_000 : null;
  const live = lastAgeDays !== null && lastAgeDays < 7;
  const openAccounts = accounts.filter((a) => !a.closed);
  const origin = window.location.origin;

  return (
    <SettingsCard
      icon={<Mail className="h-[18px] w-[18px]" />}
      title="Email import"
      description="Bank alert emails become transactions to review."
    >
      {/* Status */}
      <div className="flex items-center gap-2.5 rounded-2xl px-3.5 py-3 text-sm" style={{ backgroundColor: 'var(--bg-subtle)' }}>
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: live ? 'var(--positive)' : 'var(--text-muted)' }} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          {summary === null
            ? 'Checking…'
            : summary.lastReceivedAt
              ? <>Last email <strong>{relativeTime(summary.lastReceivedAt)}</strong>{summary.lastSender ? ` from ${bankName(summary.lastSender)}` : ''}</>
              : 'No emails received yet'}
          {summary && summary.pending > 0 && (
            <span style={{ color: 'var(--text-muted)' }}> · {summary.pending} waiting for review</span>
          )}
        </span>
      </div>

      {/* Forwarding address */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="fwd-address" className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
          Forwarding address
        </label>
        <div className="flex gap-2">
          <input
            id="fwd-address"
            type="email"
            inputMode="email"
            autoComplete="off"
            value={forwarding}
            onChange={(e) => setForwarding(e.target.value)}
            onBlur={() => void saveForwarding()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveForwarding();
            }}
            placeholder="e.g. payments@yourdomain.com"
            className="input-field min-w-0 flex-1"
          />
          {forwarding.trim() !== savedForwarding && (
            <Button type="button" onClick={() => void saveForwarding()} variant="default" className="shrink-0 rounded-xl px-4 text-sm">
              Save
            </Button>
          )}
        </div>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          The address your bank alerts are forwarded to (Cloudflare Email Routing → Kopi). Saved for reference.
        </p>
      </div>

      {/* Gmail filter */}
      <CopyField label="Gmail filter (paste into Gmail search, then Create filter → Forward)" value={gmailQuery} clamp />

      {/* Fallback account */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="default-import-account" className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
          If Kopi can’t tell the account
        </label>
        <select
          id="default-import-account"
          value={defaultAccount}
          onChange={(e) => {
            const v = e.target.value;
            setDefaultAccount(v);
            void patchSettings({ defaultEmailAccountId: v }, v ? 'Fallback account saved' : 'No fallback account');
          }}
          className="input-field"
        >
          <option value="">Ask me each time (recommended)</option>
          {openAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Used only for emails from a card Kopi hasn’t learned yet. Leaving it empty means those always ask.
        </p>
      </div>

      {/* Linked cards */}
      <Button
        type="button"
        onClick={onOpenAccounts}
        className="flex min-h-[52px] items-center justify-between gap-3 rounded-2xl px-3.5 text-left text-sm"
        style={{ backgroundColor: 'var(--bg-subtle)' }}
      >
        <span>
          <strong>{linkCount === null ? '…' : linkCount}</strong> card{linkCount === 1 ? '' : 's'} and accounts linked
          <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
            Kopi learns each card the first time you review one of its emails.
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-sm font-bold" style={{ color: 'var(--accent-text)' }}>
          Manage
          <ChevronRight className="h-4 w-4" />
        </span>
      </Button>

      <Disclosure title="Advanced" description="Cloudflare worker connection and legacy per-bank rules">
        <CopyField label="Worker endpoint (INGEST_URL)" value={`${origin}/api/v1/events/email`} />

        <div className="flex flex-col gap-1.5">
          <CopyField label="Webhook secret (WEBHOOK_SECRET)" value={secret} display={showSecret ? secret : '•'.repeat(24)} />
          <Button
            type="button"
            onClick={() => setShowSecret((v) => !v)}
            aria-pressed={showSecret}
            className="flex min-h-[44px] items-center gap-1.5 self-start px-1 text-sm font-bold"
            style={{ color: 'var(--accent-text)' }}
          >
            {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {showSecret ? 'Hide secret' : 'Show secret'}
          </Button>
          <ConfirmAction
            label={
              <>
                <RefreshCw className="h-4 w-4" /> Rotate secret
              </>
            }
            confirmLabel="Rotate"
            message="Kopi will reject emails until you run `npx.cmd wrangler secret put WEBHOOK_SECRET` with the new value."
            busy={busy}
            onConfirm={rotateSecret}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
            Per-bank rules (legacy)
          </span>
          <p className="flex gap-2 rounded-xl px-3 py-2.5 text-xs leading-relaxed" style={{ backgroundColor: 'var(--warning-soft)', color: 'var(--warning)' }}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              These apply to a whole bank, not a card. With several cards at one bank, leave them on “No account” and use linked cards
              instead, or emails from every card could go to one account.
            </span>
          </p>
          {rules.map((r) => (
            <div key={r.id} className="flex flex-col gap-2 rounded-xl p-3" style={{ backgroundColor: 'var(--bg-canvas)' }}>
              <span className="text-sm font-bold">{r.name}</span>
              <div className="flex items-center gap-2">
                <select
                  aria-label={`Account for ${r.name}`}
                  value={r.actual_account_id || ''}
                  onChange={(e) => void updateRule(r, { actual_account_id: e.target.value || null })}
                  className="input-field min-w-0 flex-1"
                >
                  <option value="">No account</option>
                  {openAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <label className="flex min-h-[44px] shrink-0 cursor-pointer items-center gap-2 px-1 text-xs font-bold">
                  <input
                    type="checkbox"
                    checked={r.auto_import}
                    onChange={() => void updateRule(r, { auto_import: !r.auto_import })}
                    className="h-[18px] w-[18px]"
                    style={{ accentColor: 'var(--accent)' }}
                  />
                  Auto-import
                </label>
              </div>
            </div>
          ))}
        </div>
      </Disclosure>
    </SettingsCard>
  );
}
