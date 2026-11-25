import { ChevronRight } from 'lucide-react';
import type { PortfolioResponse } from '@shared/types';
import { HIDDEN_VALUE, useFinancialValues } from '../../lib/valueVisibility';
import { Badge } from '@client/components/ui/badge';
import { Button } from '@client/components/ui/button';
import { TYPE_META, tileVars, type AllocationKey, type PortfolioFilter } from './format';

/** Borderless hero like Home: label, display total with muted cents, one change pill. */
export function PortfolioHero({
  totals,
  baseCurrency: cur,
  unvestedRsuValue,
  onShowRsus,
}: {
  totals: PortfolioResponse['totals'] | null;
  baseCurrency: string;
  unvestedRsuValue: number;
  onShowRsus: () => void;
}) {
  const { valuesHidden, formatMoney, formatPct, formatWhole } = useFinancialValues();
  const total = totals?.marketValueBase ?? 0;
  const whole = Math.trunc(total);
  const cents = Math.abs(total - whole).toFixed(2).slice(1);
  const day = totals?.dayChangeBase ?? 0;
  const dayUp = day >= 0;
  const pnl = totals?.unrealizedPnlBase ?? 0;
  const hasCost = (totals?.costBasisBase ?? 0) > 0;

  return (
    <section className="flex flex-col gap-2">
      <span className="text-label" style={{ color: 'var(--text-muted)' }}>
        Investments
      </span>
      <div className="text-display tabular-nums">
        {formatMoney(whole, cur).replace(/\.00$/, '')}
        {!valuesHidden && <span style={{ color: 'var(--text-muted)' }}>{cents}</span>}
      </div>
      {totals && total > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <Badge
            className="px-2.5 py-1 text-caption font-bold tabular-nums"
            style={
              dayUp
                ? { backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }
                : { backgroundColor: 'var(--negative-soft)', color: 'var(--negative)' }
            }
          >
            {dayUp ? '▲' : '▼'} {formatWhole(Math.abs(day), cur)} · {formatPct(totals.dayChangePct).replace(/^[+-]/, '')} today
          </Badge>
          {hasCost && (
            <span className="text-caption tabular-nums" style={{ color: 'var(--text-muted)' }}>
              {pnl >= 0 ? '+' : '−'}
              {formatWhole(Math.abs(pnl), cur)} ({formatPct(totals.unrealizedPnlPct)}) all-time
            </span>
          )}
        </div>
      )}
      {unvestedRsuValue > 0 && (
        <Button
          type="button"
          onClick={onShowRsus}
          className="-mx-1 flex items-center gap-0.5 self-start rounded-lg px-1 text-label tabular-nums transition-opacity duration-150 hover:opacity-80"
          style={{ color: 'var(--text-muted)' }}
        >
          Plus {formatMoney(unvestedRsuValue, cur, true)} in unvested RSUs
          <ChevronRight className="h-4 w-4" />
        </Button>
      )}
    </section>
  );
}

export interface AllocationSlice {
  key: AllocationKey;
  value: number;
}

/** Slim segmented bar plus a two-column legend; each legend item filters the list to that type. */
export function AllocationCard({
  slices,
  baseCurrency: cur,
  filter,
  onFilter,
}: {
  slices: AllocationSlice[];
  baseCurrency: string;
  filter: PortfolioFilter;
  onFilter: (f: PortfolioFilter) => void;
}) {
  const { valuesHidden } = useFinancialValues();
  const compact = (n: number) => {
    if (valuesHidden) return HIDDEN_VALUE;
    try {
      return new Intl.NumberFormat('en-SG', { style: 'currency', currency: cur, notation: 'compact', maximumFractionDigits: 1 }).format(n);
    } catch {
      return `${cur} ${Math.round(n)}`;
    }
  };
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return null;
  const sorted = [...slices].filter((s) => s.value > 0).sort((a, b) => b.value - a.value);

  return (
    <section className="flex flex-col gap-3 rounded-3xl p-4" style={{ backgroundColor: 'var(--bg-surface)' }} aria-label="Allocation">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <span className="text-label" style={{ color: 'var(--text-muted)' }}>
          Allocation
        </span>
        {filter !== 'all' && (
          <Button type="button" onClick={() => onFilter('all')} className="text-label" style={{ color: 'var(--accent-text)' }}>
            Show all
          </Button>
        )}
      </div>
      {!valuesHidden && (
        <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
          {sorted.map((s) => (
            <div
              key={s.key}
              className="h-full transition-opacity duration-200"
              style={{
                width: `${(s.value / total) * 100}%`,
                backgroundColor: tileVars(TYPE_META[s.key].tile).backgroundColor,
                opacity: filter === 'all' || filter === s.key ? 1 : 0.25,
              }}
            />
          ))}
        </div>
      )}
      <div className="-mx-2 grid grid-cols-2 gap-x-3 gap-y-1">
        {sorted.map((s) => {
          const on = filter === s.key;
          const dim = filter !== 'all' && !on;
          const pct = (s.value / total) * 100;
          return (
            <Button
              key={s.key}
              type="button"
              aria-pressed={on}
              onClick={() => onFilter(on ? 'all' : s.key)}
              className="press flex min-w-0 items-start gap-2.5 rounded-xl px-2 py-1.5 text-left transition-[background-color,opacity] duration-150"
              style={{ backgroundColor: on ? 'var(--bg-subtle)' : 'transparent', opacity: dim ? 0.55 : 1 }}
            >
              <span className="mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tileVars(TYPE_META[s.key].tile).backgroundColor }} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-label">{TYPE_META[s.key].label}</span>
                  {!valuesHidden && (
                    <span className="shrink-0 text-label tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                      {pct < 1 ? '<1' : pct.toFixed(0)}%
                    </span>
                  )}
                </span>
                <span className="truncate text-caption tabular-nums" style={{ color: 'var(--text-muted)' }}>
                  {compact(s.value)}
                </span>
              </span>
            </Button>
          );
        })}
      </div>
    </section>
  );
}
