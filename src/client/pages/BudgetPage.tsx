import { useFinancialValues } from '../lib/valueVisibility';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, PiggyBank, Plus, Repeat } from 'lucide-react';
import type { ActualAccount, ActualCategory, ActualPayee, BudgetCategory, BudgetHistoryResponse, BudgetMonthResponse } from '@shared/types';
import { apiFetch } from '../lib/api';
import { WIDE_QUERY, useMediaQuery } from '../lib/useMediaQuery';
import { Tile } from '../components/Tile';
import { BudgetCategorySheet } from '../components/BudgetCategorySheet';
import { ProgressBar, barColor, spentRatio } from '../components/budget/ProgressBar';
import { NewBudgetItemSheet, type NewBudgetItem } from '../components/budget/NewBudgetItemSheet';
import { Button } from '@client/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@client/components/ui/radio-group';
import { Badge } from '@client/components/ui/badge';
import { Card } from '@client/components/ui/card';
import { Skeleton } from '@client/components/ui/skeleton';

export { ProgressBar, spentRatio };

interface BudgetPageProps {
  baseCurrency: string;
  accounts: ActualAccount[];
  categories: ActualCategory[];
  payees: ActualPayee[];
  /** A transaction was edited from a category sheet. */
  onChanged: (message: string) => void;
  refreshTrigger: number;
  dataVersion: number;
  onToast: (msg: string, tone?: 'success' | 'error', privateMessage?: string) => void;
}

type Filter = 'all' | 'overspent' | 'available';

export function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-SG', { month: 'long', year: 'numeric' });
}

function shortMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-SG', { month: 'short' });
}

function isEmpty(c: BudgetCategory): boolean {
  return c.budgeted === 0 && c.spent === 0 && c.balance === 0;
}

export function BudgetPage({ baseCurrency, accounts, categories, payees, onChanged, refreshTrigger, dataVersion, onToast }: BudgetPageProps) {
  const { formatMoney } = useFinancialValues();
  const [month, setMonth] = useState(currentMonthKey);
  const [data, setData] = useState<BudgetMonthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [showEmpty, setShowEmpty] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState<NewBudgetItem | null>(null);
  // Categories created here stay listed even while empty, so they don't vanish behind "Show empty".
  const [keepVisible, setKeepVisible] = useState<ReadonlySet<string>>(() => new Set());
  // Wide screens: categories as a table with the selected one in a side panel, plus recent months' history.
  const wide = useMediaQuery(WIDE_QUERY);
  const [history, setHistory] = useState<BudgetHistoryResponse | null>(null);

  const money = useCallback((cents: number) => formatMoney(cents / 100, baseCurrency), [baseCurrency, formatMoney]);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    try {
      const res = await apiFetch<BudgetMonthResponse>(`/api/budget?month=${m}`);
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load budget');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(month);
  }, [load, month, refreshTrigger, dataVersion]);

  // Refetched whenever the month's data reloads, so edits show up in the history too.
  useEffect(() => {
    if (!wide || !data) return;
    let cancelled = false;
    apiFetch<BudgetHistoryResponse>(`/api/budget/history?month=${data.month}&count=6`)
      .then((res) => {
        if (!cancelled) setHistory(res);
      })
      .catch(() => {
        if (!cancelled) setHistory(null);
      });
    return () => {
      cancelled = true;
    };
  }, [wide, data]);

  const months = data?.months ?? [];
  const canPrev = months.length === 0 || months.includes(shiftMonth(month, -1));
  const canNext = months.length === 0 || months.includes(shiftMonth(month, 1));
  const isCurrent = month === currentMonthKey();

  const expenseGroups = useMemo(() => {
    if (!data) return [];
    return data.groups
      .filter((g) => !g.isIncome)
      .map((g) => ({
        ...g,
        visible: g.categories.filter((c) => {
          if (filter === 'overspent') return c.balance < 0;
          if (filter === 'available') return c.balance > 0;
          return showEmpty || !isEmpty(c) || keepVisible.has(c.id);
        }),
      }))
      // A group with no categories at all still shows under "All" so it can get its first one.
      .filter((g) => g.visible.length > 0 || (filter === 'all' && g.categories.length === 0));
  }, [data, filter, showEmpty, keepVisible]);

  const groupOptions = useMemo(() => (data ? data.groups.filter((g) => !g.isIncome).map((g) => ({ id: g.id, name: g.name })) : []), [data]);

  const emptyTotal = useMemo(
    () =>
      data
        ? data.groups.filter((g) => !g.isIncome).reduce((s, g) => s + g.categories.filter((c) => isEmpty(c) && !keepVisible.has(c.id)).length, 0)
        : 0,
    [data, keepVisible],
  );
  const incomeGroups = data?.groups.filter((g) => g.isIncome) ?? [];

  // Looked up from fresh data so the sheet reflects reloads while open.
  const editing = useMemo(() => {
    if (!data || !editingId) return null;
    for (const g of data.groups) {
      if (g.isIncome) continue;
      const category = g.categories.find((c) => c.id === editingId);
      if (category) return { category, groupName: g.name };
    }
    return null;
  }, [data, editingId]);

  const closeEditor = useCallback(() => setEditingId(null), []);
  const handleSaved = useCallback(
    (message: string, close: boolean) => {
      if (close) setEditingId(null);
      onToast(message, 'success', 'Budget updated');
      void load(month);
    },
    [load, month, onToast],
  );

  const handleCreated = useCallback(
    (message: string, created: { kind: NewBudgetItem['kind']; id: string | null }) => {
      setCreating(null);
      onToast(message, 'success', 'Budget updated');
      if (created.kind === 'category' && created.id) {
        const id = created.id;
        setKeepVisible((prev) => new Set(prev).add(id));
        // Open the new bucket so money can go into it straight away (shows once the reload lands).
        setEditingId(id);
      }
      void load(month);
    },
    [load, month, onToast],
  );

  const monthNav = (
    <div className="flex items-center justify-between gap-2">
      <Button
        type="button"
        onClick={() => setMonth((m) => shiftMonth(m, -1))}
        disabled={!canPrev}
        aria-label="Previous month"
        className="press flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-30"
        style={{ backgroundColor: 'var(--bg-surface)' }}
      >
        <ChevronLeft className="h-5 w-5" />
      </Button>
      <div className="flex flex-col items-center">
        <span className="text-heading">{monthLabel(month)}</span>
        {!isCurrent && (
          <Button type="button" onClick={() => setMonth(currentMonthKey())} className="text-label" style={{ color: 'var(--accent-text)' }}>
            Back to this month
          </Button>
        )}
      </div>
      <Button
        type="button"
        onClick={() => setMonth((m) => shiftMonth(m, 1))}
        disabled={!canNext}
        aria-label="Next month"
        className="press flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-30"
        style={{ backgroundColor: 'var(--bg-surface)' }}
      >
        <ChevronRight className="h-5 w-5" />
      </Button>
    </div>
  );

  if (error && !data) {
    return (
      <div className="flex flex-col gap-5">
        {monthNav}
        <Card className="rounded-3xl p-6 text-center">
          <p className="text-body font-semibold" style={{ color: 'var(--negative)' }}>{error}</p>
          <Button type="button" onClick={() => void load(month)} variant="secondary" className="mt-3 rounded-xl px-4 py-2 text-label">
            Retry
          </Button>
        </Card>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-5" aria-busy="true">
        {monthNav}
        <Skeleton className="h-44 rounded-3xl" />
        <Skeleton className="h-64 rounded-3xl" />
      </div>
    );
  }

  const overallRatio = data.totalBudgeted > 0 ? Math.min(1, data.totalSpent / data.totalBudgeted) : 0;
  const tb = data.toBudget;

  const summaryCard = (
    <>
      {/* Summary */}
      <Card as="section" variant="flat" className="flex flex-col gap-4 rounded-3xl p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-label" style={{ color: 'var(--text-muted)' }}>
              {tb < 0 ? 'Overbudgeted' : 'To budget'}
            </span>
            <span className="text-display tabular-nums" style={{ color: tb < 0 ? 'var(--negative)' : 'var(--text-primary)' }}>
              {money(Math.abs(tb))}
            </span>
          </div>
          <Badge
            className="px-2.5 py-1 text-caption font-bold"
            style={
              tb > 0
                ? { backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }
                : tb < 0
                  ? { backgroundColor: 'var(--negative-soft)', color: 'var(--negative)' }
                  : { backgroundColor: 'var(--bg-subtle)', color: 'var(--text-secondary)' }
            }
          >
            {tb > 0 ? 'Ready to assign' : tb < 0 ? 'Lower a budget' : 'All assigned'}
          </Badge>
        </div>
        <div className="flex flex-col gap-2">
          <ProgressBar ratio={overallRatio} color={overallRatio >= 1 ? 'var(--negative)' : 'var(--accent)'} label="Spent of budgeted this month" />
          <span className="text-caption tabular-nums" style={{ color: 'var(--text-muted)' }}>
            {money(data.totalSpent)} spent of {money(data.totalBudgeted)} budgeted
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Budgeted', value: data.totalBudgeted },
            { label: 'Spent', value: data.totalSpent },
            { label: 'Available', value: data.totalBalance },
          ].map((s) => (
            <Card key={s.label} variant="subtle" className="flex flex-col gap-0.5 rounded-2xl p-3">
              <span className="text-label" style={{ color: 'var(--text-muted)' }}>{s.label}</span>
              <span className="text-body font-semibold tabular-nums" style={{ color: s.value < 0 ? 'var(--negative)' : undefined }}>
                {formatMoney(s.value / 100, baseCurrency, Math.abs(s.value) >= 1_000_000)}
              </span>
            </Card>
          ))}
        </div>
      </Card>
    </>
  );

  const overspentBanner = (
    <>
      {/* Stays put while filtering (only its action flips) so the filter control never jumps. */}
      {data.overspentCount > 0 && (
        <Button
          type="button"
          onClick={() => setFilter((f) => (f === 'overspent' ? 'all' : 'overspent'))}
          className="press flex items-center gap-3 rounded-3xl p-4 text-left"
          style={{ backgroundColor: 'var(--negative-soft)', color: 'var(--negative)' }}
        >
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span className="flex-1 text-body font-semibold">
            {data.overspentCount} categor{data.overspentCount === 1 ? 'y is' : 'ies are'} overspent
          </span>
          <span className="shrink-0 text-label">{filter === 'overspent' ? 'Show all' : 'Show'}</span>
        </Button>
      )}
    </>
  );

  const filterControl = (
    <>
      <RadioGroup value={filter} onValueChange={(value) => setFilter(value as Filter)} aria-label="Filter categories" className="grid grid-cols-3 gap-1 rounded-2xl p-1" style={{ backgroundColor: 'var(--bg-surface)' }}>
        {(
          [
            ['all', 'All'],
            ['overspent', `Overspent${data.overspentCount ? ` · ${data.overspentCount}` : ''}`],
            ['available', 'Money left'],
          ] as const
        ).map(([id, label]) => {
          const on = filter === id;
          return (
            <RadioGroupItem
              key={id}
              value={id}
              className="h-10 rounded-xl text-label transition"
              style={{ backgroundColor: on ? 'var(--accent)' : 'transparent', color: on ? 'var(--accent-fg)' : 'var(--text-muted)' }}
            >
              {label}
            </RadioGroupItem>
          );
        })}
      </RadioGroup>
    </>
  );

  const emptyMessage = (
    <>
      {expenseGroups.length === 0 && (
        <p className="py-6 text-center text-body" style={{ color: 'var(--text-muted)' }}>
          {filter === 'overspent' ? 'Nothing overspent this month.' : filter === 'available' ? 'No categories have money left.' : 'No budget categories this month.'}
        </p>
      )}
    </>
  );

  // Phones: each group is a card of category rows that open a sheet.
  const groupCards = (
    <>
      {expenseGroups.map((g) => (
        <section key={g.id} className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between px-1">
            <h2 className="text-heading">{g.name}</h2>
            <span className="text-body font-semibold tabular-nums" style={{ color: g.balance < 0 ? 'var(--negative)' : 'var(--text-muted)' }}>
              {g.balance < 0 ? `${money(-g.balance)} over` : `${money(g.balance)} left`}
            </span>
          </div>
          <div className="flex flex-col rounded-3xl px-4" style={{ backgroundColor: 'var(--bg-surface)' }}>
            {g.visible.map((c, i) => {
              const ratio = spentRatio(c.spent, c.balance);
              const over = c.balance < 0;
              return (
                <Button
                  key={c.id}
                  type="button"
                  onClick={() => setEditingId(c.id)}
                  aria-label={`Edit ${c.name} budget`}
                  className="press flex w-full items-center gap-3 py-3 text-left"
                  style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)' }}
                >
                  <Tile colorKey={c.name} label={c.name} size={38} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5 truncate text-body">
                        <span className="truncate">{c.name}</span>
                        {c.carryover && <Repeat className="h-3.5 w-3.5 shrink-0" aria-label="Rolls over" style={{ color: 'var(--text-muted)' }} />}
                      </span>
                      <span
                        className="shrink-0 text-body font-semibold tabular-nums"
                        style={{ color: over ? 'var(--negative)' : c.balance === 0 ? 'var(--text-muted)' : 'var(--text-primary)' }}
                      >
                        {over ? `−${money(-c.balance)}` : money(c.balance)}
                      </span>
                    </div>
                    <ProgressBar ratio={ratio} color={barColor(c.balance, ratio)} label={`${c.name}: ${Math.round(ratio * 100)}% spent`} />
                    <span className="text-caption tabular-nums" style={{ color: 'var(--text-muted)' }}>
                      {money(c.spent)} spent · {money(c.budgeted)} budgeted{over ? ' · overspent' : ''}
                    </span>
                  </div>
                </Button>
              );
            })}
            {filter === 'all' && (
              <Button
                type="button"
                onClick={() => setCreating({ kind: 'category', groupId: g.id })}
                className="press flex min-h-12 w-full items-center gap-3 py-3 text-left text-label"
                style={{ borderTop: g.visible.length === 0 ? 'none' : '1px solid var(--border-subtle)', color: 'var(--accent-text)' }}
              >
                <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center">
                  <Plus className="h-4 w-4" />
                </span>
                Add category
              </Button>
            )}
          </div>
        </section>
      ))}
    </>
  );

  const addGroupButton = (
    <>
      {filter === 'all' && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => setCreating({ kind: 'group' })}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-body"
        >
          <Plus className="h-4 w-4" />
          Add group
        </Button>
      )}
    </>
  );

  const showEmptyToggle = (
    <>
      {filter === 'all' && emptyTotal > 0 && (
        <Button type="button" onClick={() => setShowEmpty((v) => !v)} className="self-center text-label" style={{ color: 'var(--accent-text)' }}>
          {showEmpty ? 'Hide empty categories' : `Show ${emptyTotal} empty categor${emptyTotal === 1 ? 'y' : 'ies'}`}
        </Button>
      )}
    </>
  );

  const incomeSection = (
    <>
      {filter === 'all' && incomeGroups.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between px-1">
            <h2 className="text-heading">Income</h2>
            <span className="text-body font-semibold tabular-nums" style={{ color: 'var(--positive)' }}>
              {money(data.totalIncome)} received
            </span>
          </div>
          <div className="flex flex-col rounded-3xl px-4" style={{ backgroundColor: 'var(--bg-surface)' }}>
            {incomeGroups
              .flatMap((g) => g.categories)
              .filter((c) => showEmpty || c.spent !== 0)
              .map((c, i) => (
                <div key={c.id} className="flex items-center gap-3 py-3" style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)' }}>
                  <Tile colorKey={c.name} label={c.name} size={38} />
                  <span className="flex-1 truncate text-body">{c.name}</span>
                  <span className="text-body font-semibold tabular-nums" style={{ color: 'var(--positive)' }}>
                    {money(c.spent)}
                  </span>
                </div>
              ))}
          </div>
        </section>
      )}
    </>
  );

  const creatingSheet = (
    <>
      {creating && (
        <NewBudgetItemSheet
          key={creating.kind === 'category' ? `category:${creating.groupId}` : 'group'}
          item={creating}
          groups={groupOptions}
          onClose={() => setCreating(null)}
          onCreated={handleCreated}
        />
      )}
    </>
  );

  if (wide) {
    const muted = { color: 'var(--text-muted)' };
    // Ignore history still loading for the previous month: it must end at the month on screen.
    const hist = history && history.months[history.months.length - 1] === data.month ? history : null;
    // Columns: category, budgeted, spent, balance, [bar when there's room], last 3 months.
    const cols =
      'grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_5.5rem_3.5rem] items-center gap-3 @min-[40rem]:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_5.5rem_6rem_3.5rem]';
    const signed = (cents: number) => (cents < 0 ? `−${money(-cents)}` : money(cents));

    /** Spending in the three months before this one; red where the month ended overspent. Details are in the panel's chart. */
    const lastThree = (id: string) => {
      const end = hist ? hist.months.length - 1 : 0;
      const idx = [end - 3, end - 2, end - 1].filter((i) => i >= 0);
      if (!hist || idx.length === 0) return <span />;
      const pts = idx.map((i) => ({ m: hist.months[i], p: hist.categories[id]?.[i] ?? null }));
      const scale = Math.max(1, ...pts.map(({ p }) => Math.max(p?.spent ?? 0, p?.budgeted ?? 0)));
      return (
        <span
          aria-hidden="true"
          title={pts.map(({ m, p }) => `${shortMonth(m)}: ${p ? `${money(p.spent)} of ${money(p.budgeted)}${p.balance < 0 ? ', overspent' : ''}` : 'no data'}`).join(' · ')}
          className="flex h-5 items-end gap-1"
        >
          {pts.map(({ m, p }) => (
            <span
              key={m}
              className="w-1.5 rounded-sm"
              style={{
                height: `${p && p.spent > 0 ? Math.max(15, (p.spent / scale) * 100) : 15}%`,
                backgroundColor: !p || p.spent <= 0 ? 'var(--bg-subtle)' : p.balance < 0 ? 'var(--negative)' : 'var(--text-muted)',
              }}
            />
          ))}
        </span>
      );
    };

    return (
      <div className="grid grid-cols-[minmax(0,1fr)_23rem] items-start gap-8" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 150ms' }}>
        <div className="flex min-w-0 flex-col gap-5">
          {monthNav}
          {summaryCard}
          {overspentBanner}
          {filterControl}
          {emptyMessage}
          {expenseGroups.length > 0 && (
            <div className="@container flex flex-col gap-2">
              <div aria-hidden="true" className={`${cols} px-4 text-caption`} style={muted}>
                <span>Category</span>
                <span className="text-right">Budgeted</span>
                <span className="text-right">Spent</span>
                <span className="text-right">Balance</span>
                <span className="hidden @min-[40rem]:block" />
                <span>Last 3 mo</span>
              </div>
              <div className="flex flex-col gap-4">
                {expenseGroups.map((g) => (
                  <section key={g.id} aria-label={g.name} className="flex flex-col overflow-hidden rounded-3xl" style={{ backgroundColor: 'var(--bg-surface)' }}>
                    <div className={`${cols} px-4 py-3`}>
                      <h2 className="truncate text-heading">{g.name}</h2>
                      <span className="text-right text-label tabular-nums" style={muted}>
                        {money(g.budgeted)}
                      </span>
                      <span className="text-right text-label tabular-nums" style={muted}>
                        {money(g.spent)}
                      </span>
                      <span className="text-right text-label tabular-nums" style={{ color: g.balance < 0 ? 'var(--negative)' : 'var(--text-muted)' }}>
                        {signed(g.balance)}
                      </span>
                    </div>
                    {g.visible.map((c) => {
                      const ratio = spentRatio(c.spent, c.balance);
                      const selected = c.id === editingId;
                      return (
                        <Button
                          key={c.id}
                          type="button"
                          onClick={() => setEditingId(c.id)}
                          aria-current={selected ? 'true' : undefined}
                          className={`${cols} w-full px-4 py-2.5 text-left transition-colors duration-150 ${selected ? '' : 'hover:bg-[var(--bg-hover)]'}`}
                          style={{ borderTop: '1px solid var(--border-subtle)', backgroundColor: selected ? 'var(--accent-soft)' : undefined }}
                        >
                          <span className="flex min-w-0 items-center gap-2.5">
                            <Tile colorKey={c.name} label={c.name} size={30} />
                            <span className="truncate text-body">{c.name}</span>
                            {c.carryover && <Repeat className="h-3.5 w-3.5 shrink-0" aria-label="Rolls over" style={muted} />}
                          </span>
                          <span className="text-right text-body tabular-nums">{money(c.budgeted)}</span>
                          <span className="text-right text-body tabular-nums">{money(c.spent)}</span>
                          <span
                            className="text-right text-body font-semibold tabular-nums"
                            style={{ color: c.balance < 0 ? 'var(--negative)' : c.balance === 0 ? 'var(--text-muted)' : 'var(--text-primary)' }}
                          >
                            {signed(c.balance)}
                          </span>
                          <span className="hidden @min-[40rem]:block">
                            <ProgressBar ratio={ratio} color={barColor(c.balance, ratio)} label={`${c.name}: ${Math.round(ratio * 100)}% spent`} />
                          </span>
                          {lastThree(c.id)}
                        </Button>
                      );
                    })}
                    {filter === 'all' && (
                      <Button
                        type="button"
                        onClick={() => setCreating({ kind: 'category', groupId: g.id })}
                        className="flex min-h-11 w-full items-center gap-2 px-4 text-left text-label transition-colors duration-150 hover:bg-[var(--bg-hover)]"
                        style={{ borderTop: '1px solid var(--border-subtle)', color: 'var(--accent-text)' }}
                      >
                        <Plus className="h-4 w-4" />
                        Add category
                      </Button>
                    )}
                  </section>
                ))}
              </div>
            </div>
          )}
          {addGroupButton}
          {showEmptyToggle}
          {incomeSection}
        </div>

        <div className="sticky top-6">
          {editing ? (
            <BudgetCategorySheet
              inline
              history={hist ? { months: hist.months, points: hist.months.map((_, i) => hist.categories[editing.category.id]?.[i] ?? null) } : undefined}
              key={editing.category.id}
              category={editing.category}
              groupName={editing.groupName}
              data={data}
              monthName={monthLabel(month)}
              baseCurrency={baseCurrency}
              accounts={accounts}
              categories={categories}
              payees={payees}
              onClose={closeEditor}
              onSaved={handleSaved}
              onTransactionChanged={onChanged}
              
            />
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-3xl border border-dashed px-6 py-12 text-center" style={{ borderColor: 'var(--border-strong)', color: 'var(--text-muted)' }}>
              <PiggyBank className="h-6 w-6" />
              <p className="text-body">No category selected</p>
            </div>
          )}
        </div>
        {creatingSheet}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 150ms' }}>
      {monthNav}
      {summaryCard}
      {overspentBanner}
      {filterControl}
      {emptyMessage}
      {groupCards}
      {addGroupButton}
      {showEmptyToggle}
      {incomeSection}

      <p className="text-center text-caption" style={{ color: 'var(--text-muted)' }}>
        Tap a category to change its budget, move money or rename it. Changes save to Actual.
      </p>

      {editing && (
        <BudgetCategorySheet
          key={editing.category.id}
          category={editing.category}
          groupName={editing.groupName}
          data={data}
          monthName={monthLabel(month)}
          baseCurrency={baseCurrency}
          accounts={accounts}
          categories={categories}
          payees={payees}
          onClose={closeEditor}
          onSaved={handleSaved}
          onTransactionChanged={onChanged}
        />
      )}

      {creatingSheet}
    </div>
  );
}
