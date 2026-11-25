import { useFinancialValues } from '../lib/valueVisibility';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Plus, Repeat } from 'lucide-react';
import type { BudgetCategory, BudgetMonthResponse } from '@shared/types';
import { apiFetch } from '../lib/api';
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

function isEmpty(c: BudgetCategory): boolean {
  return c.budgeted === 0 && c.spent === 0 && c.balance === 0;
}

export function BudgetPage({ baseCurrency, refreshTrigger, dataVersion, onToast }: BudgetPageProps) {
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

  return (
    <div className="flex flex-col gap-5" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 150ms' }}>
      {monthNav}

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

      {expenseGroups.length === 0 && (
        <p className="py-6 text-center text-body" style={{ color: 'var(--text-muted)' }}>
          {filter === 'overspent' ? 'Nothing overspent this month.' : filter === 'available' ? 'No categories have money left.' : 'No budget categories this month.'}
        </p>
      )}

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

      {filter === 'all' && emptyTotal > 0 && (
        <Button type="button" onClick={() => setShowEmpty((v) => !v)} className="self-center text-label" style={{ color: 'var(--accent-text)' }}>
          {showEmpty ? 'Hide empty categories' : `Show ${emptyTotal} empty categor${emptyTotal === 1 ? 'y' : 'ies'}`}
        </Button>
      )}

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
          onClose={closeEditor}
          onSaved={handleSaved}
        />
      )}

      {creating && (
        <NewBudgetItemSheet
          key={creating.kind === 'category' ? `category:${creating.groupId}` : 'group'}
          item={creating}
          groups={groupOptions}
          onClose={() => setCreating(null)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
