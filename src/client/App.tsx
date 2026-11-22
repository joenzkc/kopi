import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarClock, House, Landmark, LineChart, ListOrdered, PiggyBank, Plus, RefreshCw, Settings, UserRound } from 'lucide-react';
import type { ActualAccount, ActualBudget, ActualCategory, ActualCategoryGroup, ActualPayee, Appearance } from '@shared/types';
import { apiFetch } from './lib/api';
import { applyAppearance, loadCachedAppearance } from './lib/theme';
import { invalidateRecent } from './lib/recent';
import { AuthPage } from './pages/AuthPage';
import { HomePage, type AppTab } from './pages/HomePage';
import { ActivityPage } from './pages/ActivityPage';
import { BudgetPage } from './pages/BudgetPage';
import { AccountsPage } from './pages/AccountsPage';
import { PortfolioPage } from './pages/PortfolioPage';
import { SchedulesPage } from './pages/SchedulesPage';
import { SettingsPage } from './pages/SettingsPage';
import { TransactionFlow, type FlowRequest } from './components/TransactionFlow';
import { Button } from '@client/components/ui/button';
import { Toggle } from '@client/components/ui/toggle';
import { Badge } from '@client/components/ui/badge';

interface AuthStatus {
  needsSetup: boolean;
  authenticated: boolean;
  user: { id: string; username: string } | null;
  hasPasskeys: boolean;
  webAuthnSupportedOrigin: boolean;
}

interface ActualMeta {
  connected: boolean;
  budgets: ActualBudget[];
  accounts: ActualAccount[];
  categories: ActualCategory[];
  categoryGroups: ActualCategoryGroup[];
  payees: ActualPayee[];
}

type NavItem = { id: AppTab; label: string; icon: React.ComponentType<{ className?: string }> };

const HOME: NavItem = { id: 'home', label: 'Home', icon: House };
const ACTIVITY: NavItem = { id: 'activity', label: 'Activity', icon: ListOrdered };
const BUDGET: NavItem = { id: 'budget', label: 'Budget', icon: PiggyBank };
const ACCOUNTS: NavItem = { id: 'accounts', label: 'Accounts', icon: Landmark };
const INVEST: NavItem = { id: 'invest', label: 'Invest', icon: LineChart };
const BILLS: NavItem = { id: 'bills', label: 'Bills', icon: CalendarClock };
const SETTINGS: NavItem = { id: 'settings', label: 'Settings', icon: Settings };

/** Desktop sidebar shows everything; the phone pill keeps 4 tabs + Add (Bills lives on Home). */
const SIDEBAR_NAV: NavItem[] = [HOME, ACTIVITY, BUDGET, ACCOUNTS, INVEST, BILLS, SETTINGS];
const MOBILE_NAV: Array<NavItem | null> = [HOME, ACTIVITY, null, BUDGET, INVEST];

const TITLES: Record<AppTab, string> = {
  home: 'Home',
  activity: 'Activity',
  budget: 'Budget',
  accounts: 'Accounts',
  invest: 'Invest',
  bills: 'Bills',
  settings: 'Settings',
};

const VALID_TABS = new Set<AppTab>(['home', 'activity', 'budget', 'accounts', 'invest', 'bills', 'settings']);

function readInitialTab(): AppTab {
  if (typeof window === 'undefined') return 'home';
  const param = new URLSearchParams(window.location.search).get('tab');
  if (param && VALID_TABS.has(param as AppTab)) {
    const cleanUrl = `${window.location.pathname}${window.location.hash}`;
    window.history.replaceState(null, '', cleanUrl);
    return param as AppTab;
  }
  return 'home';
}

export function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [tab, setTab] = useState<AppTab>(() => readInitialTab());
  const [meta, setMeta] = useState<ActualMeta>({
    connected: false,
    budgets: [],
    accounts: [],
    categories: [],
    categoryGroups: [],
    payees: [],
  });
  const [baseCurrency, setBaseCurrency] = useState('SGD');
  const [appearance, setAppearance] = useState<Appearance>(() => loadCachedAppearance());
  const [hiddenHomeAccounts, setHiddenHomeAccounts] = useState<string[]>([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [dataVersion, setDataVersion] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [flow, setFlow] = useState<FlowRequest | null>(null);
  const [flowKey, setFlowKey] = useState(0);
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- appearance ---
  useEffect(() => {
    applyAppearance(appearance);
    if (!appearance.followSystem || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => applyAppearance(appearance);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [appearance]);

  const showToast = useCallback((msg: string, tone: 'success' | 'error' = 'success') => {
    setToast({ msg, tone });
    setTimeout(() => {
      setToast((prev) => (prev?.msg === msg ? null : prev));
    }, 3400);
  }, []);

  const changeAppearance = useCallback(
    (next: Appearance) => {
      setAppearance(next);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        apiFetch('/api/settings', { method: 'PATCH', body: JSON.stringify({ appearance: next }) }).catch((err) =>
          showToast(err instanceof Error ? `Couldn't save appearance: ${err.message}` : "Couldn't save appearance", 'error'),
        );
      }, 500);
    },
    [showToast],
  );

  const setAccountOnHome = useCallback(
    (accountId: string, show: boolean) => {
      const prev = hiddenHomeAccounts;
      const next = show ? prev.filter((id) => id !== accountId) : [...new Set([...prev, accountId])];
      setHiddenHomeAccounts(next);
      apiFetch('/api/settings', { method: 'PATCH', body: JSON.stringify({ hiddenHomeAccounts: next }) }).catch((err) => {
        setHiddenHomeAccounts(prev);
        showToast(err instanceof Error ? `Couldn't save: ${err.message}` : "Couldn't save", 'error');
      });
    },
    [hiddenHomeAccounts, showToast],
  );

  // --- data ---
  const loadAuth = useCallback(async () => {
    try {
      setAuth(await apiFetch<AuthStatus>('/api/auth/status'));
    } catch {
      setAuth({ needsSetup: false, authenticated: false, user: null, hasPasskeys: false, webAuthnSupportedOrigin: false });
    }
  }, []);

  const loadMeta = useCallback(async () => {
    try {
      const [m, s] = await Promise.all([
        apiFetch<ActualMeta>('/api/actual/meta'),
        apiFetch<{ baseCurrency: string; appearance?: Appearance; hiddenHomeAccounts?: string[] }>('/api/settings'),
      ]);
      setMeta({ ...m, categoryGroups: m.categoryGroups || [] });
      setBaseCurrency(s.baseCurrency || 'SGD');
      if (s.appearance) setAppearance(s.appearance);
      setHiddenHomeAccounts(s.hiddenHomeAccounts || []);
    } catch {
      // ignore while unauthenticated
    }
  }, []);

  const loadPending = useCallback(async () => {
    try {
      const res = await apiFetch<{ pendingCount: number }>('/api/inbox?status=pending_review');
      setPendingCount(res.pendingCount);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void loadAuth();
  }, [loadAuth]);

  useEffect(() => {
    if (auth?.authenticated) {
      void loadMeta();
      void loadPending();
    }
  }, [auth?.authenticated, loadMeta, loadPending]);

  const handleChanged = useCallback(
    (message: string) => {
      invalidateRecent();
      setDataVersion((v) => v + 1);
      void loadPending();
      void loadMeta();
      if (message) showToast(message);
    },
    [loadPending, loadMeta, showToast],
  );

  // Remembers where Settings was opened from, so the profile button can toggle back to it.
  const beforeSettings = useRef<AppTab>('home');

  const navigate = useCallback((t: AppTab) => {
    setTab((prev) => {
      if (t === 'settings' && prev !== 'settings') beforeSettings.current = prev;
      return t;
    });
    window.scrollTo({ top: 0 });
  }, []);

  // Handle tap on a Web Push notification while Kopi is already open
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; tab?: string } | null;
      if (data?.type === 'kopi:navigate' && data.tab && VALID_TABS.has(data.tab as AppTab)) {
        navigate(data.tab as AppTab);
        invalidateRecent();
        setDataVersion((v) => v + 1);
        void loadPending();
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigate, loadPending]);

  const toggleSettings = useCallback(() => {
    navigate(tab === 'settings' ? beforeSettings.current : 'settings');
  }, [navigate, tab]);

  const openFlow = useCallback((req: FlowRequest) => {
    setFlowKey((k) => k + 1);
    setFlow(req);
  }, []);

  if (!auth) {
    return (
      <div className="flex min-h-dvh items-center justify-center" style={{ backgroundColor: 'var(--bg-canvas)' }}>
        <div className="h-7 w-7 animate-spin rounded-full border-2" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  if (!auth.authenticated) {
    return <AuthPage needsSetup={auth.needsSetup} hasPasskeys={auth.hasPasskeys} onAuthenticated={() => void loadAuth()} />;
  }

  const showRefresh = tab === 'home' || tab === 'invest' || tab === 'budget';
  const heading =
    tab === 'home'
      ? new Date().toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'short' })
      : TITLES[tab];

  return (
    <div className="min-h-dvh md:flex" style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-primary)' }}>
      {/* Desktop sidebar */}
      <aside className="hidden md:sticky md:top-0 md:flex md:h-dvh md:w-64 md:shrink-0 md:flex-col md:gap-6 md:px-4 md:py-6">
        <div className="flex items-center gap-2.5 px-2">
          <img src="/icon.svg" alt="" className="h-9 w-9 rounded-xl" />
          <div>
            <div className="text-[17px] font-extrabold tracking-tight">kopi</div>
            <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.connected ? 'var(--positive)' : 'var(--warning)' }} />
              {meta.connected ? 'Actual synced' : 'Actual offline'}
            </div>
          </div>
        </div>
        <Button type="button" onClick={() => openFlow({ mode: 'add' })} variant="default" className="flex h-12 items-center justify-center gap-2 rounded-2xl text-[15px]">
          <Plus className="h-5 w-5" />
          Add transaction
        </Button>
        <nav aria-label="Primary" className="flex flex-1 flex-col gap-1">
          {SIDEBAR_NAV.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <Button
                key={item.id}
                type="button"
                onClick={() => navigate(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-2xl px-3.5 py-3 text-[15px] font-bold transition ${item.id === 'settings' ? 'mt-auto' : ''}`}
                style={{
                  backgroundColor: active ? 'var(--bg-surface)' : 'transparent',
                  color: active ? 'var(--accent-text)' : 'var(--text-muted)',
                }}
              >
                <Icon className="h-5 w-5" />
                <span className="flex-1 text-left">{item.label}</span>
                {item.id === 'activity' && pendingCount > 0 && (
                  <Badge variant="destructive" className="px-2 py-0.5 text-[11px] font-extrabold">
                    {pendingCount}
                  </Badge>
                )}
              </Button>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 px-5 pb-2 safe-pt md:px-10 md:pt-8">
          <h1
            className={tab === 'home' ? 'text-sm font-bold' : 'text-[30px] font-extrabold tracking-[-0.03em]'}
            style={{ color: tab === 'home' ? 'var(--text-muted)' : 'var(--text-primary)' }}
          >
            {heading}
          </h1>
          <div className="flex items-center gap-2">
            {showRefresh && (
              <Button
                type="button"
                onClick={() => setRefreshTrigger((n) => n + 1)}
                aria-label="Refresh prices and balances"
                className="press flex h-11 w-11 items-center justify-center rounded-full"
                style={{ backgroundColor: 'var(--bg-surface)' }}
              >
                <RefreshCw className="h-[18px] w-[18px]" />
              </Button>
            )}
            <Toggle
              onPressedChange={toggleSettings}
              aria-label={tab === 'settings' ? 'Close settings' : 'Settings'}
              pressed={tab === 'settings'}
              className="press flex h-11 w-11 items-center justify-center rounded-full md:hidden"
              style={{ backgroundColor: tab === 'settings' ? 'var(--accent)' : 'var(--bg-surface)', color: tab === 'settings' ? 'var(--accent-fg)' : 'var(--text-primary)' }}
            >
              <UserRound className="h-[18px] w-[18px]" />
            </Toggle>
          </div>
        </header>

        <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-36 pt-3 md:px-10 md:pb-12">
          {tab === 'home' && (
            <HomePage onNavigate={navigate} onOpenFlow={openFlow} refreshTrigger={refreshTrigger} dataVersion={dataVersion} pendingCount={pendingCount} hiddenAccountIds={hiddenHomeAccounts} />
          )}
          {tab === 'activity' && (
            <ActivityPage
              accounts={meta.accounts}
              categories={meta.categories}
              payees={meta.payees}
              baseCurrency={baseCurrency}
              dataVersion={dataVersion}
              onOpenFlow={openFlow}
              onChanged={handleChanged}
              onToast={showToast}
            />
          )}
          {tab === 'budget' && <BudgetPage baseCurrency={baseCurrency} refreshTrigger={refreshTrigger} dataVersion={dataVersion} onToast={showToast} />}
          {tab === 'accounts' && (
            <AccountsPage
              categories={meta.categories}
              baseCurrency={baseCurrency}
              dataVersion={dataVersion}
              hiddenHomeAccounts={hiddenHomeAccounts}
              onToggleHome={setAccountOnHome}
              onChanged={handleChanged}
              onToast={showToast}
            />
          )}
          {tab === 'invest' && <PortfolioPage accounts={meta.accounts} onToast={showToast} refreshTrigger={refreshTrigger} />}
          {tab === 'bills' && <SchedulesPage accounts={meta.accounts} payees={meta.payees} baseCurrency={baseCurrency} onToast={showToast} />}
          {tab === 'settings' && (
            <SettingsPage
              budgets={meta.budgets}
              accounts={meta.accounts}
              webAuthnSupportedOrigin={auth.webAuthnSupportedOrigin}
              appearance={appearance}
              onAppearanceChange={changeAppearance}
              onOpenAccounts={() => navigate('accounts')}
              onSettingsUpdated={() => void loadMeta()}
              onLoggedOut={() => setAuth((prev) => (prev ? { ...prev, authenticated: false, user: null } : null))}
              onToast={showToast}
            />
          )}
        </main>
      </div>

      {/* Mobile floating pill nav */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-4 z-30 mx-auto grid h-[68px] max-w-md grid-cols-5 items-center rounded-full border px-1.5 md:hidden"
        style={{
          bottom: 'max(16px, calc(env(safe-area-inset-bottom) + 8px))',
          backgroundColor: 'var(--bg-glass)',
          borderColor: 'var(--border-subtle)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
        }}
      >
        {MOBILE_NAV.map((item) => {
          if (!item) {
            return (
              <Button
                key="add"
                type="button"
                onClick={() => openFlow({ mode: 'add' })}
                aria-label="Add transaction"
                className="press mx-auto flex h-[54px] w-[54px] items-center justify-center rounded-full"
                style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
              >
                <Plus className="h-6 w-6" strokeWidth={2.6} />
              </Button>
            );
          }
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <Button
              key={item.id}
              type="button"
              onClick={() => navigate(item.id)}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              className="relative mx-auto flex h-12 w-12 items-center justify-center rounded-full"
              style={{ color: active ? 'var(--accent-text)' : 'var(--text-muted)' }}
            >
              <Icon className="h-[22px] w-[22px]" />
              {item.id === 'activity' && pendingCount > 0 && (
                <Badge
                  variant="destructive"
                  className="absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center px-1 text-[10px] font-extrabold"
                >
                  {pendingCount}
                </Badge>
              )}
            </Button>
          );
        })}
      </nav>

      {flow && (
        <TransactionFlow
          key={flowKey}
          request={flow}
          accounts={meta.accounts}
          categories={meta.categories}
          categoryGroups={meta.categoryGroups}
          payees={meta.payees}
          baseCurrency={baseCurrency}
          onClose={() => setFlow(null)}
          onChanged={handleChanged}
        />
      )}

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-28 z-[60] flex justify-center px-4 md:bottom-8" role="status" aria-live="polite">
          <div
            className="rounded-full px-4 py-2.5 text-sm font-bold shadow-lg"
            style={{
              backgroundColor: toast.tone === 'error' ? 'var(--negative)' : 'var(--text-primary)',
              color: 'var(--bg-canvas)',
            }}
          >
            {toast.msg}
          </div>
        </div>
      )}
    </div>
  );
}
