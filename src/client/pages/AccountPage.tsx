import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActualAccount, ActualCategory, ActualPayee, RecentTransaction } from '@shared/types';
import { apiFetch } from '../lib/api';
import { friendlyDate, localISODate } from '../lib/recent';
import { useFinancialValues } from '../lib/valueVisibility';
import { Tile } from '../components/Tile';
import { EditTransactionSheet } from '../components/EditTransactionSheet';
import { Button } from '@client/components/ui/button';
import { Badge } from '@client/components/ui/badge';
import { Card } from '@client/components/ui/card';
import { Skeleton } from '@client/components/ui/skeleton';

const muted = { color: 'var(--text-muted)' };
/** History loads in chunks of this many months, starting with the current month. */
const CHUNK_MONTHS = 3;

/** First day of the month `months - 1` months before this one, e.g. months=3 in November → 1 September. */
function windowStart(months: number): string {
  const now = new Date();
  return localISODate(new Date(now.getFullYear(), now.getMonth() - (months - 1), 1));
}

function monthYear(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-SG', { month: 'short', year: 'numeric' });
}

function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

interface AccountPageProps {
  account: ActualAccount;
  accounts: ActualAccount[];
  categories: ActualCategory[];
  payees: ActualPayee[];
  baseCurrency: string;
  dataVersion: number;
  onChanged: (message: string) => void;
}

/** One account's balance and transaction history, newest first. Rows open the transaction editor. */
export function AccountPage({ account, accounts, categories, payees, baseCurrency, dataVersion, onChanged }: AccountPageProps) {
  const { formatMoney, formatSignedMoney } = useFinancialValues();
  const [months, setMonths] = useState(CHUNK_MONTHS);
  const [txs, setTxs] = useState<RecentTransaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  /** Set when "Show earlier" found nothing in the months it added. */
  const [emptyRange, setEmptyRange] = useState<string | null>(null);
  const [editTx, setEditTx] = useState<RecentTransaction | null>(null);
  const editTrigger = useRef<HTMLElement | null>(null);
  const countBeforeEarlier = useRef<number | null>(null);
  const [retry, setRetry] = useState(0);

  const since = windowStart(months);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    apiFetch<{ transactions: RecentTransaction[] }>(`/api/accounts/${encodeURIComponent(account.id)}/transactions?since=${windowStart(months)}`)
      .then((res) => {
        if (cancelled) return;
        setTxs(res.transactions);
        if (countBeforeEarlier.current !== null) {
          // "Show earlier" added the CHUNK_MONTHS months before the previous start; say so if they were empty.
          const nothingAdded = res.transactions.length <= countBeforeEarlier.current;
          setEmptyRange(nothingAdded ? `${monthYear(windowStart(months))} and ${monthYear(windowStart(months - CHUNK_MONTHS + 1))}` : null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load transactions");
      })
      .finally(() => {
        if (cancelled) return;
        countBeforeEarlier.current = null;
        setLoadingEarlier(false);
      });
    return () => {
      cancelled = true;
    };
  }, [account.id, months, dataVersion, retry]);

  function showEarlier() {
    countBeforeEarlier.current = txs?.length ?? 0;
    setLoadingEarlier(true);
    setMonths((m) => m + CHUNK_MONTHS);
  }

  const days = useMemo(() => {
    const map = new Map<string, RecentTransaction[]>();
    for (const t of txs ?? []) map.set(t.date, [...(map.get(t.date) ?? []), t]);
    return [...map.entries()].map(([date, items]) => ({ date, items, total: items.reduce((s, t) => s + t.amount, 0) / 100 }));
  }, [txs]);

  const thisMonth = useMemo(() => {
    const prefix = localISODate().slice(0, 7);
    return (txs ?? []).filter((t) => t.date.startsWith(prefix)).reduce((s, t) => s + t.amount, 0) / 100;
  }, [txs]);

  const balance = (account.workingBalance ?? 0) / 100;
  const stats = [
    { label: 'Cleared', value: formatMoney((account.clearedBalance ?? 0) / 100, baseCurrency) },
    { label: 'Uncleared', value: formatMoney((account.unclearedBalance ?? 0) / 100, baseCurrency) },
    { label: `${new Date().toLocaleDateString('en-SG', { month: 'long' })} so far`, value: txs ? formatSignedMoney(thisMonth, baseCurrency) : '…' },
  ];

  return (
    // Phones: summary above the history. Wide screens: history in the main column, summary in a rail.
    <div className="flex flex-col gap-6 xl:grid xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start xl:gap-8">
      <Card as="section" variant="flat" aria-label="Balance" className="flex flex-col gap-3 rounded-3xl p-5 pb-2.5 xl:sticky xl:top-8 xl:col-start-2 xl:row-start-1">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-label" style={muted}>
              Balance
            </span>
            <span className="text-display tabular-nums" style={{ color: balance < 0 ? 'var(--negative)' : 'var(--text-primary)' }}>
              {formatMoney(balance, baseCurrency)}
            </span>
          </div>
          <Badge className="px-2.5 py-1 text-caption font-bold" style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}>
            {account.offbudget ? 'Tracking' : 'Budget'}
          </Badge>
        </div>
        {/* Rows rather than tiles: full amounts don't fit three across in a phone-width column. */}
        <dl className="flex flex-col">
          {stats.map((s) => (
            <div key={s.label} className="flex items-baseline justify-between gap-3 border-t py-2.5" style={{ borderColor: 'var(--border-subtle)' }}>
              <dt className="text-body" style={muted}>
                {s.label}
              </dt>
              <dd className="text-body font-semibold tabular-nums">{s.value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <section aria-label="Transactions" className="flex flex-col gap-4 xl:col-start-1 xl:row-start-1">
        {error && (
          <Card variant="flat" className="flex flex-col items-center gap-3 rounded-3xl p-6 text-center">
            <p className="text-body font-semibold" style={{ color: 'var(--negative)' }}>
              {error}
            </p>
            <Button type="button" onClick={() => setRetry((n) => n + 1)} variant="secondary" className="rounded-xl px-4 py-2 text-label">
              Retry
            </Button>
          </Card>
        )}

        {!txs && !error && (
          <div className="flex flex-col gap-2" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 rounded-2xl" />
            ))}
          </div>
        )}

        {txs && txs.length === 0 && (
          <p className="py-6 text-center text-body" style={muted}>
            No transactions since {longDate(since)}.
          </p>
        )}

        {days.map((d) => (
          <div key={d.date} className="flex flex-col">
            <div className="mb-1 flex items-baseline justify-between">
              <h2 className="text-heading">{friendlyDate(d.date)}</h2>
              <span className="text-body tabular-nums" style={muted}>
                {formatSignedMoney(d.total, baseCurrency)}
              </span>
            </div>
            {d.items.map((t) => {
              const category = t.isTransfer ? null : t.categoryName || (t.subtransactions?.length ? 'Split' : 'Uncategorized');
              return (
                <Button
                  key={t.id}
                  type="button"
                  onClick={(event) => {
                    editTrigger.current = event.currentTarget;
                    setEditTx(t);
                  }}
                  className="press flex w-full items-center gap-3 py-2 text-left"
                  title="Edit transaction"
                >
                  <Tile colorKey={t.categoryName || t.payeeName} label={t.payeeName} transfer={t.isTransfer} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-body">{t.payeeName}</span>
                    <span className="truncate text-caption" style={muted}>
                      {[category, t.notes || null, t.cleared === false ? 'uncleared' : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="shrink-0 text-body font-semibold tabular-nums" style={{ color: t.amount > 0 ? 'var(--positive)' : 'var(--text-primary)' }}>
                    {formatSignedMoney(t.amount / 100, baseCurrency)}
                  </span>
                </Button>
              );
            })}
          </div>
        ))}

        {txs && (
          <div className="flex flex-col items-center gap-2 pt-2">
            <span className="text-caption" style={muted}>
              {emptyRange ? `Nothing between ${emptyRange}.` : `Showing since ${longDate(since)}`}
            </span>
            <Button type="button" variant="secondary" disabled={loadingEarlier} onClick={showEarlier} className="h-11 rounded-2xl px-5 text-label disabled:opacity-50">
              {loadingEarlier ? 'Loading…' : 'Show earlier'}
            </Button>
          </div>
        )}
      </section>

      {editTx && (
        <EditTransactionSheet
          key={editTx.id}
          transaction={editTx}
          accounts={accounts}
          categories={categories}
          payees={payees}
          baseCurrency={baseCurrency}
          onClose={() => {
            setEditTx(null);
            editTrigger.current?.focus({ preventScroll: true });
          }}
          onSaved={() => {
            setEditTx(null);
            onChanged('Transaction updated');
          }}
        />
      )}
    </div>
  );
}
