import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CalendarClock, Check, ChevronLeft, House, Landmark, LineChart, ListOrdered, Pen, PiggyBank, Plus, RefreshCw, Settings, UserRound } from 'lucide-react';
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
import { AccountPage } from './pages/AccountPage';
import { TransactionFlow, type FlowRequest } from './components/TransactionFlow';
import { ValueVisibilityButton } from './components/ValueVisibilityButton';
import { PullToRefresh } from './components/PullToRefresh';
import { Button } from '@client/components/ui/button';
import { Toggle } from '@client/components/ui/toggle';
import { Badge } from '@client/components/ui/badge';
import { Spinner } from '@client/components/ui/spinner';
import { Toaster, type ToastMessage } from '@client/components/ui/toast';

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
  activeBudgetName?: string | null;
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
  account: 'Account',
};

/** Max width of each page's header and content. Home and Account get a second column on wide
 *  screens (xl), so they may grow; the other pages are still the phone column. */
const PAGE_WIDTH: Record<AppTab, string> = {
  home: 'max-w-3xl xl:max-w-[90rem]',
  activity: 'max-w-3xl',
  budget: 'max-w-3xl xl:max-w-[90rem]',
  accounts: 'max-w-3xl',
  invest: 'max-w-3xl',
  bills: 'max-w-3xl',
  settings: 'max-w-3xl',
  account: 'max-w-3xl xl:max-w-[90rem]',
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
  // The account whose history the Account page shows, and the tab its back link returns to.
  const [account, setAccount] = useState<{ id: string; from: AppTab } | null>(null);
  // A bill to open on the Bills page (tapped in Home's Coming up); nonce lets the same bill open twice.
  const [billRequest, setBillRequest] = useState<{ id: string; nonce: number } | null>(null);
  // Accounts page edit mode; the toggle sits in the page header next to the eye button.
  const [accountsEditing, setAccountsEditing] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  // When Actual data was last fetched; drives the "Synced 2 min ago" line in the page header.
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
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

  const showToast = useCallback((msg: string, tone: 'success' | 'error' = 'success', privateMessage?: string) => {
    setToast({ msg, tone, privateMessage });
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
      setSyncedAt(Date.now());
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

  // Tabs stay mounted once visited (hidden with display:none), so switching is instant instead of
  // remounting into a loading skeleton; each tab keeps its own scroll position.
  const [visited, setVisited] = useState<ReadonlySet<AppTab>>(() => new Set([tab]));
  const scrollByTab = useRef<Partial<Record<AppTab, number>>>({});
  const tabRef = useRef(tab);

  const navigate = useCallback((t: AppTab) => {
    const prev = tabRef.current;
    if (t === prev) {
      window.scrollTo({ top: 0, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      return;
    }
    scrollByTab.current[prev] = window.scrollY;
    if (t === 'settings') beforeSettings.current = prev;
    if (prev === 'accounts') setAccountsEditing(false);
    tabRef.current = t;
    setVisited((v) => (v.has(t) ? v : new Set(v).add(t)));
    setTab(t);
  }, []);

  useLayoutEffect(() => {
    window.scrollTo({ top: scrollByTab.current[tab] ?? 0 });
  }, [tab]);

  const refreshAll = useCallback(async () => {
    setRefreshTrigger((n) => n + 1);
    invalidateRecent();
    setDataVersion((v) => v + 1);
    await Promise.all([loadPending(), loadMeta()]);
  }, [loadPending, loadMeta]);

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

  const openAccount = useCallback(
    (id: string) => {
      const from = tabRef.current;
      setAccount((prev) => ({ id, from: from === 'account' ? prev?.from ?? 'home' : from }));
      scrollByTab.current.account = 0;
      navigate('account');
    },
    [navigate],
  );

  const openBill = useCallback(
    (id: string) => {
      setBillRequest({ id, nonce: Date.now() });
      navigate('bills');
    },
    [navigate],
  );

  const openFlow = useCallback((req: FlowRequest) => {
    setFlowKey((k) => k + 1);
    setFlow(req);
  }, []);

  if (!auth) {
    return (
      <div className="flex min-h-dvh items-center justify-center" style={{ backgroundColor: 'var(--bg-canvas)' }}>
        <Spinner variant="ring" />
      </div>
    );
  }

  if (!auth.authenticated) {
    return <AuthPage needsSetup={auth.needsSetup} hasPasskeys={auth.hasPasskeys} onAuthenticated={() => void loadAuth()} />;
  }

  const showRefresh = tab === 'home' || tab === 'invest' || tab === 'budget';
  // Home's title is the budget it shows (the date is already on the phone); other tabs use their name.
  const shownAccount = account ? meta.accounts.find((a) => a.id === account.id) : undefined;
  const heading = tab === 'home' ? meta.activeBudgetName || 'Kopi' : tab === 'account' ? shownAccount?.name || TITLES.account : TITLES[tab];
  // The Account page isn't in the nav; keep the tab it was opened from highlighted.
  const navTab = tab === 'account' && account ? account.from : tab;
  const offline = syncedAt !== null && !meta.connected;
  const syncLine = syncedAt === null ? 'Syncing…' : offline ? 'Actual offline' : `Synced ${sinceLabel(now - syncedAt)}`;

  return (
    <div className="min-h-dvh md:flex" style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-primary)' }}>
      {/* Desktop sidebar */}
      <aside className="hidden md:sticky md:top-0 md:flex md:h-dvh md:w-64 md:shrink-0 md:flex-col md:gap-6 md:px-4 md:py-6">
        <div className="flex items-center gap-2.5 px-2">
          <img src="/icon.svg" alt="" className="h-9 w-9 rounded-xl" />
          <div>
            <div className="text-heading">kopi</div>
            {/* Desktop's only sync status; the per-page line in the header is for phones. */}
            <div className="flex items-center gap-1.5 text-caption tabular-nums" style={{ color: offline ? 'var(--warning)' : 'var(--text-muted)' }} aria-live="polite">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: offline ? 'var(--warning)' : syncedAt === null ? 'var(--text-muted)' : 'var(--positive)' }}
              />
              {syncLine}
            </div>
          </div>
        </div>
        <Button type="button" onClick={() => openFlow({ mode: 'add' })} variant="default" className="flex h-12 items-center justify-center gap-2 rounded-2xl text-body">
          <Plus className="h-5 w-5" />
          Add transaction
        </Button>
        <nav aria-label="Primary" className="flex flex-1 flex-col gap-1">
          {SIDEBAR_NAV.map((item) => {
            const Icon = item.icon;
            const active = navTab === item.id;
            return (
              <Button
                key={item.id}
                type="button"
                onClick={() => navigate(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-2xl px-3.5 py-3 text-body font-bold transition ${item.id === 'settings' ? 'mt-auto' : ''}`}
                style={{
                  backgroundColor: active ? 'var(--bg-surface)' : 'transparent',
                  color: active ? 'var(--accent-text)' : 'var(--text-muted)',
                }}
              >
                <Icon className="h-5 w-5" />
                <span className="flex-1 text-left">{item.label}</span>
                {item.id === 'activity' && pendingCount > 0 && (
                  <Badge variant="destructive" className="px-2 py-0.5 text-caption font-bold tabular-nums">
                    {pendingCount}
                  </Badge>
                )}
              </Button>
            );
          })}
        </nav>
      </aside>

      <PullToRefresh onRefresh={refreshAll} disabled={Boolean(flow)}>
        {/* Header and main share the page's width so the title lines up with the content. */}
        <header className={`mx-auto flex w-full ${PAGE_WIDTH[tab]} items-end justify-between gap-3 px-5 pb-2 safe-pt md:px-10 md:pt-8`}>
          <div className="min-w-0">
            {/* Hidden (not removed) on Settings so every page's title sits at the same height. */}
            {tab === 'account' && account ? (
              // Back link in the sync line's place; negative margins keep a 44px target without moving the title.
              <Button
                type="button"
                onClick={() => navigate(account.from)}
                className="press -my-3.5 -ml-1 flex min-h-11 items-center gap-0.5 pr-2 text-caption font-semibold"
                style={{ color: 'var(--accent-text)' }}
              >
                <ChevronLeft className="h-4 w-4" />
                {account.from === 'home' && meta.activeBudgetName ? meta.activeBudgetName : TITLES[account.from]}
              </Button>
            ) : (
              <p
                aria-hidden={tab === 'settings' || undefined}
                className={`flex items-center gap-1.5 text-caption tabular-nums md:hidden ${tab === 'settings' ? 'invisible' : ''}`}
                style={{ color: offline ? 'var(--warning)' : 'var(--text-muted)' }}
                aria-live="polite"
              >
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: offline ? 'var(--warning)' : syncedAt === null ? 'var(--text-muted)' : 'var(--positive)' }}
                />
                {syncLine}
              </p>
            )}
            <h1 className="truncate text-title">{heading}</h1>
          </div>
          <div className="flex items-center gap-2">
            {showRefresh && (
              <Button
                type="button"
                onClick={() => setRefreshTrigger((n) => n + 1)}
                aria-label="Refresh prices and balances"
                className="press hidden h-11 w-11 items-center justify-center rounded-full md:flex"
                style={{ backgroundColor: 'var(--bg-surface)' }}
              >
                <RefreshCw className="h-[18px] w-[18px]" />
              </Button>
            )}
            {tab === 'accounts' && (
              <Toggle
                pressed={accountsEditing}
                onPressedChange={setAccountsEditing}
                aria-label={accountsEditing ? 'Done editing accounts' : 'Edit accounts'}
                title={accountsEditing ? 'Done' : 'Edit accounts'}
                className="press relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors duration-200 motion-reduce:transition-none"
                style={{
                  backgroundColor: accountsEditing ? 'var(--accent)' : 'var(--bg-surface)',
                  color: accountsEditing ? 'var(--accent-fg)' : 'var(--text-primary)',
                }}
              >
                {/* Pen and check crossfade as edit mode toggles. */}
                <Pen
                  aria-hidden="true"
                  className={`absolute h-[18px] w-[18px] transition-[opacity,scale] duration-200 ease-[var(--ease-out)] motion-reduce:transition-none ${accountsEditing ? 'scale-50 opacity-0' : ''}`}
                />
                <Check
                  aria-hidden="true"
                  className={`absolute h-[18px] w-[18px] transition-[opacity,scale] duration-200 ease-[var(--ease-out)] motion-reduce:transition-none ${accountsEditing ? '' : 'scale-50 opacity-0'}`}
                />
              </Toggle>
            )}
            <ValueVisibilityButton />
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

        <main className={`mx-auto w-full ${PAGE_WIDTH[tab]} flex-1 px-5 pb-36 pt-3 md:px-10 md:pb-12`}>
          <TabPanel id="home" active={tab} visited={visited}>
            <HomePage
              onNavigate={navigate}
              onOpenAccount={openAccount}
              onOpenBill={openBill}
              accounts={meta.accounts}
              categories={meta.categories}
              payees={meta.payees}
              onChanged={handleChanged}
              refreshTrigger={refreshTrigger}
              dataVersion={dataVersion}
              pendingCount={pendingCount}
              hiddenAccountIds={hiddenHomeAccounts}
            />
          </TabPanel>
          <TabPanel id="activity" active={tab} visited={visited}>
            <ActivityPage
              accounts={meta.accounts}
              categories={meta.categories}
              categoryGroups={meta.categoryGroups}
              payees={meta.payees}
              baseCurrency={baseCurrency}
              dataVersion={dataVersion}
              onOpenFlow={openFlow}
              onChanged={handleChanged}
              onToast={showToast}
            />
          </TabPanel>
          <TabPanel id="budget" active={tab} visited={visited}>
            <BudgetPage baseCurrency={baseCurrency} accounts={meta.accounts} categories={meta.categories} payees={meta.payees} onChanged={handleChanged} refreshTrigger={refreshTrigger} dataVersion={dataVersion} onToast={showToast} />
          </TabPanel>
          <TabPanel id="accounts" active={tab} visited={visited}>
            <AccountsPage
              categories={meta.categories}
              baseCurrency={baseCurrency}
              dataVersion={dataVersion}
              hiddenHomeAccounts={hiddenHomeAccounts}
              onToggleHome={setAccountOnHome}
              onOpenAccount={openAccount}
              editing={accountsEditing}
              onChanged={handleChanged}
              onToast={showToast}
            />
          </TabPanel>
          <TabPanel id="invest" active={tab} visited={visited}>
            <PortfolioPage accounts={meta.accounts} onToast={showToast} refreshTrigger={refreshTrigger} />
          </TabPanel>
          <TabPanel id="bills" active={tab} visited={visited}>
            <SchedulesPage accounts={meta.accounts} payees={meta.payees} baseCurrency={baseCurrency} onToast={showToast} openRequest={billRequest} />
          </TabPanel>
          <TabPanel id="settings" active={tab} visited={visited}>
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
          </TabPanel>
          <TabPanel id="account" active={tab} visited={visited}>
            {shownAccount ? (
              <AccountPage
                key={shownAccount.id}
                account={shownAccount}
                accounts={meta.accounts}
                categories={meta.categories}
                payees={meta.payees}
                baseCurrency={baseCurrency}
                dataVersion={dataVersion}
                onChanged={handleChanged}
              />
            ) : (
              <p className="py-6 text-center text-body" style={{ color: 'var(--text-muted)' }}>
                {syncedAt === null ? 'Loading…' : 'This account is closed or no longer in Actual.'}
              </p>
            )}
          </TabPanel>
        </main>
      </PullToRefresh>

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
          const active = navTab === item.id;
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
                  className="absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center px-1 text-caption font-bold tabular-nums"
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

      <Toaster notification={toast} />
    </div>
  );
}

/** Renders a tab once it has been visited, then keeps it mounted and hides it while inactive.
 *  The enter animation replays each time it is shown (display:none → block restarts CSS animations). */
function TabPanel({ id, active, visited, children }: { id: AppTab; active: AppTab; visited: ReadonlySet<AppTab>; children: React.ReactNode }) {
  if (!visited.has(id) && id !== active) return null;
  return (
    <div className="tab-panel" hidden={id !== active}>
      {children}
    </div>
  );
}

function sinceLabel(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `${hrs} h ago` : `${Math.floor(hrs / 24)} d ago`;
}
