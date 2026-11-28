import { useFinancialValues } from '../lib/valueVisibility';
import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ChevronRight, Mail } from 'lucide-react';
import type { BudgetMonthResponse, OverviewResponse, RecentTransaction, SnapshotPoint } from '@shared/types';
import { apiFetch, formatDueBadge } from '../lib/api';
import { fetchRecent, friendlyDate } from '../lib/recent';
import { WIDE_QUERY, useMediaQuery } from '../lib/useMediaQuery';
import { Tile } from '../components/Tile';
import { ProgressBar, currentMonthKey } from './BudgetPage';
import { Button } from '@client/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@client/components/ui/radio-group';
import { Badge } from '@client/components/ui/badge';
import { Card } from '@client/components/ui/card';
import { Skeleton } from '@client/components/ui/skeleton';

/** Wide screens: a main column beside a phone-width rail. */
const WIDE_GRID = 'grid grid-cols-[minmax(0,1fr)_22rem] items-start gap-8';

export type AppTab ='home' | 'activity' | 'budget' | 'accounts' | 'invest' | 'bills' | 'settings';

interface HomePageProps {
  onNavigate: (tab: AppTab) => void;
  refreshTrigger: number;
  dataVersion: number;
  pendingCount: number;
  /** Account ids hidden from the Home carousel (chosen on the Accounts screen). */
  hiddenAccountIds: string[];
}

function Sparkline({ snapshots }: { snapshots: SnapshotPoint[] }) {
  const values = snapshots.map((s) => s.netWorth);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 390;
  const h = 72;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 6 - ((v - min) / span) * (h - 16)] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const up = values[values.length - 1] >= values[0];
  const stroke = up ? 'var(--accent)' : 'var(--negative)';
  return (
    <svg
      role="img"
      aria-label={`Net worth over the last ${snapshots.length} days, ${up ? 'up' : 'down'}`}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="block h-[72px] w-full xl:h-32"
    >
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill={stroke} fillOpacity={0.14} />
      <path d={line} fill="none" stroke={stroke} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function HomePage({ onNavigate, refreshTrigger, dataVersion, pendingCount, hiddenAccountIds }: HomePageProps) {
  const { valuesHidden, formatMoney, formatPct, formatSignedMoney, formatWhole } = useFinancialValues();
  const wide = useMediaQuery(WIDE_QUERY);
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [recent, setRecent] = useState<RecentTransaction[]>([]);
  const [budget, setBudget] = useState<BudgetMonthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState<string>(() => {
    try {
      return localStorage.getItem('kopi_home_account_group') || 'all';
    } catch {
      return 'all';
    }
  });
  const chooseGroup = (id: string) => {
    setGroupFilter(id);
    try {
      localStorage.setItem('kopi_home_account_group', id);
    } catch {
      // per-device preference only; fine to lose
    }
  };

  const load = useCallback(async (force: boolean) => {
    try {
      const [ov, rc, bg] = await Promise.all([
        apiFetch<OverviewResponse>(`/api/overview${force ? '?refresh=1' : ''}`),
        fetchRecent(force).catch(() => [] as RecentTransaction[]),
        apiFetch<BudgetMonthResponse>(`/api/budget?month=${currentMonthKey()}`).catch(() => null),
      ]);
      setData(ov);
      setRecent(rc);
      setBudget(bg);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load overview');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(refreshTrigger > 0);
  }, [load, refreshTrigger]);

  useEffect(() => {
    if (dataVersion > 0) void load(false);
  }, [load, dataVersion]);

  if (loading && !data) {
    if (wide) {
      return (
        <div className={WIDE_GRID} aria-busy="true">
          <div className="space-y-5">
            <Skeleton className="h-80 rounded-3xl" />
            <Skeleton className="h-56 rounded-3xl" />
          </div>
          <div className="space-y-5">
            <Skeleton className="h-36 rounded-3xl" />
            <Skeleton className="h-72 rounded-3xl" />
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-5" aria-busy="true">
        <Skeleton className="h-28 rounded-3xl" />
        <Skeleton className="h-20 rounded-3xl" />
        <Skeleton className="h-32 rounded-3xl" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <Card className="rounded-3xl p-6 text-center">
        <p className="text-body font-semibold" style={{ color: 'var(--negative)' }}>{error}</p>
        <Button type="button" onClick={() => void load(true)} variant="secondary" className="mt-3 rounded-xl px-4 py-2 text-label">
          Retry
        </Button>
      </Card>
    );
  }
  if (!data) return null;

  const cur = data.baseCurrency;
  const nw = data.netWorth;
  const dayUp = nw.dayChangeBase >= 0;
  const whole = Math.trunc(nw.total);
  const cents = Math.abs(nw.total - whole).toFixed(2).slice(1);

  const hidden = new Set(hiddenAccountIds);
  const accounts = data.accounts.filter((a) => !hidden.has(a.id)).sort((a, b) => {
    if (a.offbudget !== b.offbudget) return a.offbudget ? 1 : -1;
    const av = a.linkedPortfolioValue ?? (a.workingBalance ?? 0) / 100;
    const bv = b.linkedPortfolioValue ?? (b.workingBalance ?? 0) / 100;
    return bv - av;
  });

  // Group chips use Actual's own account groups (Banks, Credit Cards, …).
  const groups = data.accountGroups || [];
  const groupIds = new Set(groups.map((g) => g.id));
  const groupOf = (a: (typeof accounts)[number]) => (a.account_group_id && groupIds.has(a.account_group_id) ? a.account_group_id : 'none');
  const chips = [
    { id: 'all', label: 'All' },
    ...groups.filter((g) => accounts.some((a) => groupOf(a) === g.id)).map((g) => ({ id: g.id, label: g.name })),
    ...(groups.length > 0 && accounts.some((a) => groupOf(a) === 'none') ? [{ id: 'none', label: 'Ungrouped' }] : []),
  ];
  const activeGroup = chips.some((c) => c.id === groupFilter) ? groupFilter : 'all';
  const shownAccounts = activeGroup === 'all' ? accounts : accounts.filter((a) => groupOf(a) === activeGroup);
  const shownTotal = shownAccounts.reduce((sum, a) => sum + (a.linkedPortfolioValue ?? (a.workingBalance ?? 0) / 100), 0);

  const netWorthSection = (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        {/* The budget's name is the page title now, so the label stays plain. */}
        <div className="text-label" style={{ color: 'var(--text-muted)' }}>
          Net worth
        </div>
        <div className="text-display tabular-nums">
          {formatMoney(whole, cur).replace(/\.00$/, '')}
          {!valuesHidden && <span style={{ color: 'var(--text-muted)' }}>{cents}</span>}
        </div>
        <Badge
          className="mt-1 self-start px-2.5 py-1 text-caption font-bold tabular-nums"
          style={
            dayUp
              ? { backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }
              : { backgroundColor: 'var(--negative-soft)', color: 'var(--negative)' }
          }
        >
          {dayUp ? '▲' : '▼'} {formatWhole(Math.abs(nw.dayChangeBase), cur)} · {formatPct(nw.dayChangePct).replace(/^[+-]/, '')} today
        </Badge>
      </section>

      {!valuesHidden && data.snapshots.length >= 2 && (
        <div className="-mx-5 md:mx-0">
          <Sparkline snapshots={data.snapshots} />
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 text-left">
        {[
          { label: 'Cash', value: nw.actualCash, onClick: undefined },
          { label: 'Investments', value: nw.investments, onClick: () => onNavigate('invest') },
          { label: 'Other', value: nw.actualOffBudgetUnlinked, onClick: undefined },
        ].map((s) => {
          const inner = (
            <>
              <span className="whitespace-nowrap text-label" style={{ color: s.onClick ? 'var(--accent-text)' : 'var(--text-muted)' }}>
                {s.label}
                {s.onClick ? ' ›' : ''}
              </span>
              <span className="text-body font-semibold tabular-nums">{formatMoney(s.value, cur, true)}</span>
            </>
          );
          return s.onClick ? (
            <Card key={s.label} asChild variant="flat">
              <Button type="button" onClick={s.onClick} className="press flex flex-col gap-0.5 rounded-2xl p-3 text-left">
                {inner}
              </Button>
            </Card>
          ) : (
            <Card key={s.label} variant="flat" className="flex flex-col gap-0.5 rounded-2xl p-3">
              {inner}
            </Card>
          );
        })}
      </div>
    </div>
  );

  // Only shown when there is something to do: bills and transfers already have homes
  // (Coming up › All bills, and the + button's Transfer tab).
  const pendingCard = pendingCount > 0 && (
    <Button
      type="button"
      onClick={() => onNavigate('activity')}
      className="press flex items-center gap-3 rounded-3xl p-4 text-left"
      style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)' }}>
        <Mail className="h-[18px] w-[18px]" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body font-semibold">
          {pendingCount} {pendingCount === 1 ? 'email' : 'emails'} to review
        </span>
        <span className="truncate text-caption" style={{ color: 'var(--text-muted)' }}>
          Imported from your bank alerts
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5 text-label" style={{ color: 'var(--accent-text)' }}>
        Review
        <ChevronRight className="h-4 w-4" />
      </span>
    </Button>
  );

  const budgetCard = budget && (
    <Card asChild variant="flat">
      <Button
        type="button"
        onClick={() => onNavigate('budget')}
        className="press flex flex-col gap-3 rounded-[26px] p-4 text-left"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-heading">This month&apos;s budget</span>
          <span className="flex items-center gap-1 text-label" style={{ color: 'var(--accent-text)' }}>
            Budget
            <ChevronRight className="h-4 w-4" />
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-stat tabular-nums" style={{ color: budget.totalBalance < 0 ? 'var(--negative)' : undefined }}>
            {formatMoney(budget.totalBalance / 100, cur)}
            <span className="ml-1.5 text-body" style={{ color: 'var(--text-muted)' }}>
              available
            </span>
          </span>
          {budget.toBudget !== 0 && (
            <Badge
              className="px-2.5 py-0.5 text-caption font-bold tabular-nums"
              style={
                budget.toBudget > 0
                  ? { backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }
                  : { backgroundColor: 'var(--negative-soft)', color: 'var(--negative)' }
              }
            >
              {budget.toBudget > 0 ? `${formatWhole(budget.toBudget / 100, cur)} to budget` : `${formatWhole(-budget.toBudget / 100, cur)} overbudgeted`}
            </Badge>
          )}
        </div>
        <ProgressBar
          ratio={budget.totalBudgeted > 0 ? Math.min(1, budget.totalSpent / budget.totalBudgeted) : 0}
          color={budget.totalSpent > budget.totalBudgeted ? 'var(--negative)' : 'var(--accent)'}
          label="Spent of budgeted this month"
        />
        <span className="text-caption tabular-nums" style={{ color: 'var(--text-muted)' }}>
          {formatWhole(budget.totalSpent / 100, cur)} of {formatWhole(budget.totalBudgeted / 100, cur)} spent
          {budget.overspentCount > 0 && (
            <span style={{ color: 'var(--negative)' }}>
              {' '}
              · {budget.overspentCount} overspent
            </span>
          )}
        </span>
      </Button>
    </Card>
  );

  const offlineAlert = !data.actualConnected && (
    <div className="flex items-start gap-3 rounded-3xl p-4 text-body" style={{ backgroundColor: 'var(--warning-soft)', color: 'var(--warning)' }}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <div className="font-bold">Actual HTTP API unreachable</div>
        <p className="mt-0.5 opacity-90">{data.actualError || 'Check ACTUAL_API_URL and ACTUAL_API_KEY in container settings.'}</p>
      </div>
    </div>
  );

  const accountsSection = data.accounts.length > 0 && (
    <section className="@container flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-heading">Accounts</h2>
        <Button type="button" onClick={() => onNavigate('accounts')} className="min-h-11 min-w-11 text-label" style={{ color: 'var(--accent-text)' }}>
          Manage
        </Button>
      </div>
      {accounts.length === 0 && (
        <Button type="button" onClick={() => onNavigate('accounts')} className="rounded-3xl p-4 text-left text-body" style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-muted)' }}>
          All accounts are hidden from Home. Tap to choose which to show.
        </Button>
      )}
      {chips.length > 2 && (
        <div className="flex flex-col gap-2">
          <RadioGroup value={activeGroup} onValueChange={chooseGroup} aria-label="Account group" className="no-scrollbar -mx-5 flex gap-1.5 overflow-x-auto px-5 md:mx-0 md:flex-wrap md:px-0">
            {chips.map((c) => {
              const on = c.id === activeGroup;
              return (
                <RadioGroupItem
                  key={c.id}
                  value={c.id}
                  onClick={on ? () => chooseGroup(c.id) : undefined}
                  className="h-9 shrink-0 rounded-full px-3.5 text-label transition"
                  style={{ backgroundColor: on ? 'var(--accent)' : 'var(--bg-surface)', color: on ? 'var(--accent-fg)' : 'var(--text-muted)' }}
                >
                  {c.label}
                </RadioGroupItem>
              );
            })}
          </RadioGroup>
          {activeGroup !== 'all' && (
            <span className="px-1 text-caption tabular-nums" style={{ color: 'var(--text-muted)' }}>
              {shownAccounts.length} account{shownAccounts.length === 1 ? '' : 's'} ·{' '}
              <span style={{ color: shownTotal < 0 ? 'var(--negative)' : 'var(--text-secondary)' }}>{formatMoney(shownTotal, cur)}</span>
            </span>
          )}
        </div>
      )}
      {/* scroll-px keeps the first card aligned with the heading when the row snaps into place */}
      <div key={activeGroup} className="no-scrollbar -mx-5 flex snap-x scroll-px-5 gap-2.5 overflow-x-auto px-5 pb-1 md:mx-0 md:grid md:scroll-px-0 md:grid-cols-3 md:overflow-visible md:px-0 md:@min-[52rem]:grid-cols-4">
        {shownAccounts.map((acc, i) => {
          const linked = acc.linkedPortfolioValue !== undefined;
          const value = linked ? acc.linkedPortfolioValue! : (acc.workingBalance ?? 0) / 100;
          const style: React.CSSProperties =
            i === 0
              ? { backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }
              : linked
                ? { backgroundColor: 'var(--tile-bg-4)', color: 'var(--tile-fg-4)' }
                : { backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' };
          const tag = linked ? 'LIVE' : acc.offbudget ? 'TRACKING' : 'BUDGET';
          const sub = linked
            ? `Actual ${formatWhole((acc.workingBalance ?? 0) / 100, cur)}`
            : acc.offbudget
              ? 'Off budget'
              : (acc.unclearedBalance ?? 0) !== 0
                ? `${formatMoney((acc.unclearedBalance ?? 0) / 100, cur)} uncleared`
                : 'All cleared';
          return (
            <Card as="article" variant="unstyled" key={acc.id} className="flex h-28 w-[168px] shrink-0 snap-start flex-col justify-between rounded-[22px] p-3.5 md:w-auto" style={style}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-label">{acc.name}</span>
                <span className="shrink-0 text-caption font-bold opacity-75">{tag}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-stat tabular-nums" style={value < 0 && i !== 0 && !linked ? { color: 'var(--negative)' } : undefined}>
                  {formatWhole(value, cur)}
                </span>
                <span className="truncate text-caption opacity-75">{sub}</span>
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );

  const comingUpSection = data.upcomingSchedules.length > 0 && (
    <section className="flex flex-col gap-1">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="text-heading">Coming up</h2>
        <Button type="button" onClick={() => onNavigate('bills')} className="min-h-11 min-w-11 text-label" style={{ color: 'var(--accent-text)' }}>
          All bills
        </Button>
      </div>
      {data.upcomingSchedules.slice(0, 4).map((s) => {
        const badge = formatDueBadge(s.daysUntilNext);
        const name = s.name || s.payeeName || 'Scheduled transaction';
        return (
          <div key={s.id} className="flex items-center gap-3 py-2">
            <Tile colorKey={name} label={name} />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-body">{name}</span>
              <span className="text-caption" style={{ color: badge.tone === 'rose' ? 'var(--negative)' : badge.tone === 'amber' ? 'var(--warning)' : 'var(--text-muted)' }}>
                {badge.text}
                <span style={{ color: 'var(--text-muted)' }}> · {s.accountName || 'No account'}</span>
              </span>
            </div>
            <span className="text-body font-semibold tabular-nums" style={{ color: s.amountCents >= 0 ? 'var(--positive)' : 'var(--text-primary)' }}>
              {formatSignedMoney(s.amountCents / 100, cur)}
            </span>
          </div>
        );
      })}
    </section>
  );

  const recentSection = (
    <section className="flex flex-col gap-1">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="text-heading">Recent</h2>
        <Button type="button" onClick={() => onNavigate('activity')} className="min-h-11 min-w-11 text-label" style={{ color: 'var(--accent-text)' }}>
          All activity
        </Button>
      </div>
      {recent.length === 0 ? (
        <p className="py-4 text-body" style={{ color: 'var(--text-muted)' }}>
          No transactions in the last 60 days.
        </p>
      ) : (
        recent.slice(0, 5).map((t) => (
          <div key={t.id} className="flex items-center gap-3 py-2">
            <Tile colorKey={t.categoryName || t.payeeName} label={t.payeeName} transfer={t.isTransfer} />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-body">{t.payeeName}</span>
              <span className="truncate text-caption" style={{ color: 'var(--text-muted)' }}>
                {t.isTransfer ? t.accountName : t.categoryName || 'Uncategorized'} · {friendlyDate(t.date)}
              </span>
            </div>
            <span className="text-body font-semibold tabular-nums" style={{ color: t.amount > 0 ? 'var(--positive)' : 'var(--text-primary)' }}>
              {formatSignedMoney(t.amount / 100, cur)}
            </span>
          </div>
        ))
      )}
    </section>
  );

  // Wide screens: what you have (net worth, accounts) in the main column, and what's happening
  // (to-dos, this month's budget, bills, recent activity) in a phone-width rail beside it.
  if (wide) {
    return (
      <div className={WIDE_GRID}>
        <div className="flex flex-col gap-8">
          {netWorthSection}
          {accountsSection}
        </div>
        <div className="flex flex-col gap-6">
          {offlineAlert}
          {pendingCard}
          {budgetCard}
          {comingUpSection}
          {recentSection}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {netWorthSection}
      {pendingCard}
      {budgetCard}
      {offlineAlert}
      {accountsSection}
      {comingUpSection}
      {recentSection}
    </div>
  );
}
