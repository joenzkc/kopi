import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ChevronRight, Landmark, LogOut, Wallet } from 'lucide-react';
import type { ActualAccount, ActualBudget, Appearance } from '@shared/types';
import { apiFetch } from '../lib/api';
import { AppearanceSection } from '../components/AppearanceSection';
import { NotificationsSection } from '../components/NotificationsSection';
import { EmailImportSection } from '../components/settings/EmailImportSection';
import { SecuritySection } from '../components/settings/SecuritySection';
import { SettingsCard, SettingsGroup } from '../components/settings/SettingsUI';

interface SettingsPageProps {
  budgets: ActualBudget[];
  accounts: ActualAccount[];
  webAuthnSupportedOrigin: boolean;
  appearance: Appearance;
  onAppearanceChange: (next: Appearance) => void;
  onOpenAccounts: () => void;
  onSettingsUpdated: () => void;
  onLoggedOut: () => void;
  onToast: (msg: string, tone?: 'success' | 'error') => void;
}

const CURRENCIES = ['SGD', 'USD', 'EUR', 'GBP', 'AUD', 'MYR', 'HKD', 'JPY'];

export function SettingsPage({
  budgets,
  accounts,
  webAuthnSupportedOrigin,
  appearance,
  onAppearanceChange,
  onOpenAccounts,
  onSettingsUpdated,
  onLoggedOut,
  onToast,
}: SettingsPageProps) {
  const [baseCurrency, setBaseCurrency] = useState('SGD');
  const [budgetSyncId, setBudgetSyncId] = useState('');
  const [pendingBudget, setPendingBudget] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await apiFetch<{ baseCurrency: string; budgetSyncId: string }>('/api/settings');
      setBaseCurrency(s.baseCurrency);
      setBudgetSyncId(s.budgetSyncId);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to load settings', 'error');
    }
  }, [onToast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(body: Record<string, unknown>, success: string) {
    setSaving(true);
    try {
      await apiFetch('/api/settings', { method: 'PATCH', body: JSON.stringify(body) });
      onToast(success);
      onSettingsUpdated();
      return true;
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to save', 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function switchBudget() {
    if (!pendingBudget) return;
    const name = budgets.find((b) => b.groupId === pendingBudget)?.name || 'that budget';
    if (await save({ budgetSyncId: pendingBudget }, `Switched to ${name}`)) setBudgetSyncId(pendingBudget);
    setPendingBudget(null);
  }

  async function handleLogout() {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    onLoggedOut();
  }

  const shownBudget = pendingBudget ?? budgetSyncId;

  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup title="General">
        <AppearanceSection appearance={appearance} onChange={onAppearanceChange} />

        <SettingsCard icon={<Wallet className="h-[18px] w-[18px]" />} title="Budget" description="Changes save straight away.">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="base-currency" className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
                Base currency
              </label>
              <select
                id="base-currency"
                value={baseCurrency}
                disabled={saving}
                onChange={(e) => {
                  const v = e.target.value;
                  setBaseCurrency(v);
                  void save({ baseCurrency: v }, `Base currency set to ${v}`);
                }}
                className="input-field"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="active-budget" className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
                Actual budget
              </label>
              <select
                id="active-budget"
                value={shownBudget}
                disabled={saving}
                onChange={(e) => setPendingBudget(e.target.value === budgetSyncId ? null : e.target.value)}
                className="input-field"
              >
                {budgets.map((b) => (
                  <option key={b.groupId} value={b.groupId}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {pendingBudget && (
            <div className="flex flex-col gap-3 rounded-2xl p-3.5" style={{ backgroundColor: 'var(--warning-soft)' }} role="alert">
              <p className="flex gap-2 text-xs leading-relaxed" style={{ color: 'var(--warning)' }}>
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Kopi will show <strong>{budgets.find((b) => b.groupId === pendingBudget)?.name}</strong> everywhere. Linked cards, Home account
                  choices and payee rules belong to the current budget, so emails will ask for accounts again.
                </span>
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setPendingBudget(null)} className="btn-secondary h-10 flex-1 rounded-xl text-sm font-bold">
                  Keep current
                </button>
                <button type="button" disabled={saving} onClick={() => void switchBudget()} className="btn-primary h-10 flex-1 rounded-xl text-sm disabled:opacity-50">
                  Switch budget
                </button>
              </div>
            </div>
          )}
        </SettingsCard>

        <button type="button" onClick={onOpenAccounts} className="card press flex w-full items-center gap-3 rounded-3xl p-5 text-left">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)' }}>
            <Landmark className="h-[18px] w-[18px]" />
          </span>
          <span className="flex flex-1 flex-col">
            <span className="text-base font-extrabold">Accounts</span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Add, group, close or reopen accounts, link cards, and choose what shows on Home
            </span>
          </span>
          <ChevronRight className="h-5 w-5" style={{ color: 'var(--text-muted)' }} />
        </button>
      </SettingsGroup>

      <SettingsGroup title="Connections">
        <NotificationsSection onToast={onToast} />
        <EmailImportSection accounts={accounts} onOpenAccounts={onOpenAccounts} onToast={onToast} />
      </SettingsGroup>

      <SettingsGroup title="Security">
        <SecuritySection webAuthnSupportedOrigin={webAuthnSupportedOrigin} onToast={onToast} />
      </SettingsGroup>

      <button
        type="button"
        onClick={() => void handleLogout()}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-bold transition hover:opacity-90"
        style={{ backgroundColor: 'var(--negative-soft)', color: 'var(--negative)' }}
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </div>
  );
}
