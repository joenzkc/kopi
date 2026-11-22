import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Repeat } from 'lucide-react';
import type { BudgetCategory, BudgetMonthResponse } from '@shared/types';
import { apiFetch, formatMoney } from '../lib/api';
import { Tile } from '../components/Tile';
import { BudgetCategorySheet } from '../components/BudgetCategorySheet';
import { Button } from '@client/components/ui/button';

interface BudgetPageProps {
  baseCurrency: string;
  refreshTrigger: number;
  dataVersion: number;
  onToast: (msg: string, tone?: 'success' | 'error') => void;
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

/** Share of what was available this month that has been spent (0–1). */
export function spentRatio(spent: number, balance: number): number {
  if (balance < 0) return 1;
  const available = spent + balance;
  if (available <= 0) return spent > 0 ? 1 : 0;
  return Math.max(0, Math.min(1, spent / available));
}

function barColor(balance: number, ratio: number): string {
  if (balance < 0) return 'var(--negative)';
  if (ratio >= 0.9) return 'var(--warning)';
  return 'var(--accent)';
}

function isEmpty(c: BudgetCategory): boolean {
  return c.budgeted === 0 && c.spent === 0 && c.balance === 0;
}

export function ProgressBar({ ratio, color, label }: { ratio: number; color: string; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
      className="h-1.5 w-full overflow-hidden rounded-full"
      style={{ backgroundColor: 'var(--bg-hover)' }}
    >
      <div className="h-full rounded-full transition-[width]" style={{ width: `${Math.max(ratio * 100, ratio > 0 ? 3 : 0)}%`, backgroundColor: color }} />
    </div>
  );
}

export function BudgetPage({ baseCurrency, refreshTrigger, dataVersion, onToast }: BudgetPageProps) {
  const [month, setMonth] = useState(currentMonthKey);
  const [data, setData] = useState<BudgetMonthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [showEmpty, setShowEmpty] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const money = useCallback((cents: number) => formatMoney(cents / 100, baseCurrency), [baseCurrency]);

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
          return showEmpty || !isEmpty(c);
        }),
        emptyCount: g.categories.filter(isEmpty).length,
      }))
      .filter((g) => g.visible.length > 0);
  }, [data, filter, showEmpty]);

  const emptyTotal = useMemo(
    () => (data ? data.groups.filter((g) => !g.isIncome).reduce((s, g) => s + g.categories.filter(isEmpty).length, 0) : 0),
    [data],
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
      onToast(message);
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
        <span className="text-[17px] font-extrabold">{monthLabel(month)}</span>
        {!isCurrent && (
          <Button type="button" onClick={() => setMonth(currentMonthKey())} className="text-xs font-bold" style={{ color: 'var(--accent-text)' }}>
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
        <div className="card rounded-3xl p-6 text-center">
          <p className="text-sm font-semibold" style={{ color: 'var(--negative)' }}>{error}</p>
          <Button type="button" onClick={() => void load(month)} variant="secondary" className="mt-3 rounded-xl px-4 py-2 text-sm font-bold">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-5" aria-busy="true">
        {monthNav}
        <div className="h-44 animate-pulse rounded-3xl" style={{ backgroundColor: 'var(--bg-surface)' }} />
        <div className="h-64 animate-pulse rounded-3xl" style={{ backgroundColor: 'var(--bg-surface)' }} />
      </div>
    );
  }

  const overallRatio = data.totalBudgeted > 0 ? Math.min(1, data.totalSpent / data.totalBudgeted) : 0;
  const tb = data.toBudget;

  return (
    <div className="flex flex-col gap-5" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 150ms' }}>
      {monthNav}

      {/* Summary */}
      <section className="flex flex-col gap-4 rounded-[28px] p-5" style={{ backgroundColor: 'var(--bg-surface)' }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>
              {tb < 0 ? 'Overbudgeted' : 'To budget'}
            </span>
            <span className="text-[34px] font-extrabold leading-none tracking-[-0.03em] tabular-nums" style={{ color: tb < 0 ? 'var(--negative)' : 'var(--text-primary)' }}>
              {money(Math.abs(tb))}
            </span>
          </div>
          <span
            className="rounded-full px-2.5 py-1 text-xs font-extrabold"
            style={
              tb > 0
                ? { backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }
                : tb < 0
                  ? { backgroundColor: 'var(--negative-soft)', color: 'var(--negative)' }
                  : { backgroundColor: 'var(--bg-subtle)', color: 'var(--text-secondary)' }
            }
          >
            {tb > 0 ? 'Ready to assign' : tb < 0 ? 'Lower a budget' : 'All assigned'}
          </span>
        </div>
        <div className="flex flex-col gap-2">
          <ProgressBar ratio={overallRatio} color={overallRatio >= 1 ? 'var(--negative)' : 'var(--accent)'} label="Spent of budgeted this month" />
          <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
            {money(data.totalSpent)} spent of {money(data.totalBudgeted)} budgeted
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Budgeted', value: data.totalBudgeted },
            { label: 'Spent', value: data.totalSpent },
            { label: 'Available', value: data.totalBalance },
          ].map((s) => (
            <div key={s.label} className="flex flex-col gap-0.5 rounded-2xl p-3" style={{ backgroundColor: 'var(--bg-subtle)' }}>
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{s.label}</span>
              <span className="text-[15px] font-extrabold tabular-nums" style={{ color: s.value < 0 ? 'var(--negative)' : undefined }}>
                {formatMoney(s.value / 100, baseCurrency, Math.abs(s.value) >= 1_000_000)}
              </span>
            </div>
          ))}
        </div>
      </section>

      {data.overspentCount > 0 && filter !== 'overspent' && (
        <Button
          type="button"
          onClick={() => setFilter('overspent')}
          className="press flex items-center gap-3 rounded-3xl p-4 text-left"
          style={{ backgroundColor: 'var(--negative-soft)', color: 'var(--negative)' }}
        >
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span className="flex-1 text-sm font-bold">
            {data.overspentCount} categor{data.overspentCount === 1 ? 'y is' : 'ies are'} overspent
          </span>
          <span className="text-sm font-bold">Show</span>
        </Button>
      )}

      <div role="radiogroup" aria-label="Filter categories" className="grid grid-cols-3 gap-1 rounded-2xl p-1" style={{ backgroundColor: 'var(--bg-surface)' }}>
        {(
          [
            ['all', 'All'],
            ['overspent', `Overspent${data.overspentCount ? ` · ${data.overspentCount}` : ''}`],
            ['available', 'Money left'],
          ] as const
        ).map(([id, label]) => {
          const on = filter === id;
          return (
            <Button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setFilter(id)}
              className="h-10 rounded-xl text-sm font-bold transition"
              style={{ backgroundColor: on ? 'var(--accent)' : 'transparent', color: on ? 'var(--accent-fg)' : 'var(--text-muted)' }}
            >
              {label}
            </Button>
          );
        })}
      </div>

      {expenseGroups.length === 0 && (
        <p className="py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          {filter === 'overspent' ? 'Nothing overspent this month.' : filter === 'available' ? 'No categories have money left.' : 'No budget categories this month.'}
        </p>
      )}

      {expenseGroups.map((g) => (
        <section key={g.id} className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between px-1">
            <h2 className="text-[15px] font-extrabold">{g.name}</h2>
            <span className="text-sm font-semibold tabular-nums" style={{ color: g.balance < 0 ? 'var(--negative)' : 'var(--text-muted)' }}>
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
                      <span className="flex min-w-0 items-center gap-1.5 truncate text-[15px] font-semibold">
                        <span className="truncate">{c.name}</span>
                        {c.carryover && <Repeat className="h-3.5 w-3.5 shrink-0" aria-label="Rolls over" style={{ color: 'var(--text-muted)' }} />}
                      </span>
                      <span
                        className="shrink-0 text-[15px] font-extrabold tabular-nums"
                        style={{ color: over ? 'var(--negative)' : c.balance === 0 ? 'var(--text-muted)' : 'var(--text-primary)' }}
                      >
                        {over ? `−${money(-c.balance)}` : money(c.balance)}
                      </span>
                    </div>
                    <ProgressBar ratio={ratio} color={barColor(c.balance, ratio)} label={`${c.name}: ${Math.round(ratio * 100)}% spent`} />
                    <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                      {money(c.spent)} spent · {money(c.budgeted)} budgeted{over ? ' · overspent' : ''}
                    </span>
                  </div>
                </Button>
              );
            })}
          </div>
        </section>
      ))}

      {filter === 'all' && emptyTotal > 0 && (
        <Button type="button" onClick={() => setShowEmpty((v) => !v)} className="self-center text-sm font-bold" style={{ color: 'var(--accent-text)' }}>
          {showEmpty ? 'Hide empty categories' : `Show ${emptyTotal} empty categor${emptyTotal === 1 ? 'y' : 'ies'}`}
        </Button>
      )}

      {filter === 'all' && incomeGroups.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between px-1">
            <h2 className="text-[15px] font-extrabold">Income</h2>
            <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--positive)' }}>
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
                  <span className="flex-1 truncate text-[15px] font-semibold">{c.name}</span>
                  <span className="text-[15px] font-extrabold tabular-nums" style={{ color: 'var(--positive)' }}>
                    {money(c.spent)}
                  </span>
                </div>
              ))}
          </div>
        </section>
      )}

      <p className="text-center text-xs" style={{ color: 'var(--text-muted)' }}>
        Tap a category to change its budget or move money. Changes save to Actual.
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
    </div>
  );
}
