import { useEffect, useMemo, useState } from 'react';
import type { RecentTransaction } from '@shared/types';
import { apiFetch } from '../../lib/api';
import { friendlyDate } from '../../lib/recent';
import { useFinancialValues } from '../../lib/valueVisibility';
import { Tile } from '../Tile';
import { Button } from '@client/components/ui/button';
import { Skeleton } from '@client/components/ui/skeleton';

const muted = { color: 'var(--text-muted)' };

/** A category's transactions for one budget month, grouped by day. Rows open the transaction editor. */
export function CategoryTransactions({
  month,
  monthName,
  categoryId,
  categoryName,
  baseCurrency,
  reloadKey,
  onSelect,
}: {
  month: string;
  monthName: string;
  categoryId: string;
  categoryName: string;
  baseCurrency: string;
  /** Changes whenever budget data reloads, so edits elsewhere show up here too. */
  reloadKey: unknown;
  onSelect: (t: RecentTransaction, trigger: HTMLElement) => void;
}) {
  const { formatSignedMoney } = useFinancialValues();
  const [txs, setTxs] = useState<RecentTransaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    apiFetch<{ transactions: RecentTransaction[] }>(`/api/budget/${month}/categories/${encodeURIComponent(categoryId)}/transactions`)
      .then((res) => {
        if (!cancelled) setTxs(res.transactions);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load transactions");
      });
    return () => {
      cancelled = true;
    };
  }, [month, categoryId, reloadKey]);

  const days = useMemo(() => {
    const map = new Map<string, RecentTransaction[]>();
    for (const t of txs ?? []) map.set(t.date, [...(map.get(t.date) ?? []), t]);
    return [...map.entries()].map(([date, items]) => ({ date, items, total: items.reduce((s, t) => s + t.amount, 0) / 100 }));
  }, [txs]);

  const total = (txs ?? []).reduce((s, t) => s + t.amount, 0) / 100;

  return (
    <section className="flex flex-col gap-1" aria-labelledby="category-tx-heading">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="category-tx-heading" className="text-label" style={muted}>
          {monthName} transactions
        </h3>
        {txs && txs.length > 0 && (
          <span className="text-caption tabular-nums" style={muted}>
            {txs.length} · {formatSignedMoney(total, baseCurrency)}
          </span>
        )}
      </div>

      {error && (
        <p className="py-3 text-label" style={{ color: 'var(--negative)' }}>
          {error}
        </p>
      )}

      {!txs && !error && (
        <div className="flex flex-col gap-2 py-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 rounded-2xl" />
          ))}
        </div>
      )}

      {txs && txs.length === 0 && (
        <p className="py-6 text-center text-body" style={muted}>
          No {categoryName} spending in {monthName} yet.
        </p>
      )}

      {days.map((d) => (
        <div key={d.date} className="flex flex-col">
          <div className="flex items-baseline justify-between pb-0.5 pt-3">
            <span className="text-label">{friendlyDate(d.date)}</span>
            <span className="text-caption tabular-nums" style={muted}>
              {formatSignedMoney(d.total, baseCurrency)}
            </span>
          </div>
          {d.items.map((t) => (
            <Button
              key={t.id}
              type="button"
              onClick={(event) => onSelect(t, event.currentTarget)}
              className="press flex w-full items-center gap-3 py-2 text-left"
              title="Edit transaction"
            >
              <Tile colorKey={categoryName} label={t.payeeName} size={38} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body">{t.payeeName}</span>
                <span className="truncate text-caption" style={muted}>
                  {[t.accountName, t.notes || null, t.cleared === false ? 'uncleared' : null].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="shrink-0 text-body font-semibold tabular-nums" style={{ color: t.amount > 0 ? 'var(--positive)' : 'var(--text-primary)' }}>
                {formatSignedMoney(t.amount / 100, baseCurrency)}
              </span>
            </Button>
          ))}
        </div>
      ))}
    </section>
  );
}
