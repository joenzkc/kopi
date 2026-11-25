import { useFinancialValues } from '../lib/valueVisibility';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarCheck, CreditCard, FlaskConical, ListFilter, Mail, MoreHorizontal, RefreshCw, Search, X } from 'lucide-react';
import type { ActualAccount, ActualCategory, ActualCategoryGroup, ActualPayee, EmailEventRecord, RecentTransaction } from '@shared/types';
import { ApiError, apiFetch } from '../lib/api';
import { fetchRecent, friendlyDate, localISODate, relativeTime, senderLabel } from '../lib/recent';
import { Sheet } from '../components/Sheet';
import { Tile } from '../components/Tile';
import { LinkPayeeSheet } from '../components/LinkPayeeSheet';
import { BillMatchSheet } from '../components/BillMatchSheet';
import { EditTransactionSheet } from '../components/EditTransactionSheet';
import type { FlowRequest } from '../components/TransactionFlow';
import { ActivityFilterSheet, KIND_LABELS, NO_FILTERS, activeFilterCount, matchesFilters, type ActivityFilters, type ActivityKind } from '../components/activity/ActivityFilterSheet';
import { Button } from '@client/components/ui/button';
import { Menu } from '@client/components/ui/menu';
import { Input } from '@client/components/ui/input';
import { Label } from '@client/components/ui/label';
import { Textarea } from '@client/components/ui/textarea';
import { Badge } from '@client/components/ui/badge';
import { Card } from '@client/components/ui/card';
import { Skeleton } from '@client/components/ui/skeleton';
import { Spinner } from '@client/components/ui/spinner';

interface ActivityPageProps {
  accounts: ActualAccount[];
  categories: ActualCategory[];
  categoryGroups: ActualCategoryGroup[];
  payees: ActualPayee[];
  baseCurrency: string;
  dataVersion: number;
  onOpenFlow: (req: FlowRequest) => void;
  onChanged: (message: string) => void;
  onToast: (msg: string, tone?: 'success' | 'error') => void;
}

export function ActivityPage({ accounts, categories, categoryGroups, payees, baseCurrency, dataVersion, onOpenFlow, onChanged, onToast }: ActivityPageProps) {
  const { valuesHidden, formatMoney, formatSignedMoney } = useFinancialValues();
  const [events, setEvents] = useState<EmailEventRecord[]>([]);
  const [txs, setTxs] = useState<RecentTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [txError, setTxError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ActivityFilters>(NO_FILTERS);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editTx, setEditTx] = useState<RecentTransaction | null>(null);
  const [linkTx, setLinkTx] = useState<RecentTransaction | null>(null);
  const transactionTrigger = useRef<HTMLButtonElement | null>(null);
  const [reviewBillId, setReviewBillId] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState(false);

  const [testOpen, setTestOpen] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [testFrom, setTestFrom] = useState('ibanking.alert@dbs.com');
  const [testSubject, setTestSubject] = useState('Card Transaction Alert');
  const [testBody, setTestBody] = useState(
    'A transaction of SGD 12.34 was charged to your card at SAMPLE MERCHANT on 01 Jan 2026.',
  );

  const load = useCallback(
    async (force: boolean) => {
      const [inbox, recent] = await Promise.allSettled([
        apiFetch<{ events: EmailEventRecord[]; pendingCount: number }>('/api/inbox'),
        fetchRecent(force),
      ]);
      if (inbox.status === 'fulfilled') setEvents(inbox.value.events);
      else onToast(inbox.reason instanceof Error ? inbox.reason.message : 'Failed to load inbox', 'error');
      if (recent.status === 'fulfilled') {
        setTxs(recent.value);
        setTxError(null);
      } else {
        setTxError(recent.reason instanceof Error ? recent.reason.message : 'Could not reach Actual');
      }
      setLoading(false);
    },
    [onToast],
  );

  useEffect(() => {
    void load(dataVersion > 0);
  }, [load, dataVersion]);

  const accountName = useCallback((id: string | null | undefined) => accounts.find((a) => a.id === id)?.name || null, [accounts]);
  const categoryName = useCallback((id: string | null | undefined) => categories.find((c) => c.id === id)?.name || null, [categories]);

  const toReview = events.filter((e) => e.status === 'pending_review' || e.status === 'failed');
  const billEmail = toReview.find((e) => e.id === reviewBillId);
  const resolvedBills = events.filter((e) => e.status === 'imported' && e.parsed?.billReview?.outcome);
  const queued = events.filter((e) => e.status === 'queued').length;

  function closeTransactionSheet() {
    setEditTx(null);
    setLinkTx(null);
    const trigger = transactionTrigger.current;
    transactionTrigger.current = null;
    requestAnimationFrame(() => trigger?.focus({ preventScroll: true }));
  }

  async function decideBill(ev: EmailEventRecord, action: 'link' | 'reject' | 'restore', transactionId?: string, remember = false) {
    setBusyId(ev.id);
    try {
      await apiFetch('/api/inbox/' + ev.id + '/bill-match', {
        method: 'POST',
        body: JSON.stringify({ action, transactionId, remember }),
      });
      setReviewBillId(null);
      onChanged(action === 'link' ? 'Matched to paid bill' : action === 'reject' ? 'Match dismissed. Email kept in review.' : 'Bill match refreshed.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) void load(false);
      onToast(err instanceof Error ? err.message : 'Could not update bill match', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function quickAdd(ev: EmailEventRecord) {
    const p = ev.parsed;
    // Unknown account, missing details or an FX estimate: open the full review instead of guessing.
    if (!p || p.amountBase === null || !p.accountId || (!p.payee && !p.transferAccountId) || p.fxEstimated) {
      onOpenFlow({ mode: 'review', event: ev });
      return;
    }
    setBusyId(ev.id);
    try {
      await apiFetch(`/api/inbox/${ev.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({
          accountId: p.accountId,
          amount: p.amountBase,
          ...(p.transferAccountId ? { transferAccountId: p.transferAccountId } : { payee: p.payee }),
          categoryId: p.transferAccountId ? null : p.categoryId || null,
          date: p.date || ev.received_at.slice(0, 10),
          notes: p.notes || undefined,
        }),
      });
      onChanged(p.transferAccountId ? `Transfer to ${accountName(p.transferAccountId)} recorded` : `Imported "${p.payee}"`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) void load(false);
      onToast(err instanceof Error ? err.message : 'Import failed', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function rescan() {
    setRescanning(true);
    try {
      const res = await apiFetch<{ requeued: number }>('/api/inbox/reparse', { method: 'POST' });
      onToast(res.requeued ? `Re-reading ${res.requeued} email${res.requeued === 1 ? '' : 's'}…` : 'Nothing to re-read');
      setTimeout(() => onChanged(''), 1500);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Re-read failed', 'error');
    } finally {
      setRescanning(false);
    }
  }

  async function skip(ev: EmailEventRecord) {
    setBusyId(ev.id);
    try {
      await apiFetch(`/api/inbox/${ev.id}/dismiss`, { method: 'POST' });
      onChanged('Dismissed');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Dismiss failed', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function runTest(e: React.FormEvent) {
    e.preventDefault();
    setTestBusy(true);
    try {
      await apiFetch('/api/inbox/test-parse', {
        method: 'POST',
        body: JSON.stringify({ from: testFrom, subject: testSubject, text: testBody, enqueue: true }),
      });
      setTestOpen(false);
      onToast('Test email queued and parsed');
      setTimeout(() => onChanged(''), 500);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Test failed', 'error');
    } finally {
      setTestBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return txs.filter((t) => {
      if (!matchesFilters(t, filters)) return false;
      if (!q) return true;
      return [t.payeeName, t.categoryName, t.accountName, t.notes].some((v) => v && v.toLowerCase().includes(q));
    });
  }, [txs, filters, query]);

  const groups = useMemo(() => {
    const map = new Map<string, RecentTransaction[]>();
    for (const t of filtered) {
      const list = map.get(t.date) || [];
      list.push(t);
      map.set(t.date, list);
    }
    return [...map.entries()].map(([date, items]) => ({
      date,
      items,
      total: items.reduce((s, t) => s + t.amount, 0) / 100,
    }));
  }, [filtered]);

  const month = useMemo(() => {
    const prefix = localISODate().slice(0, 7);
    let inc = 0;
    let out = 0;
    for (const t of txs) {
      if (!t.date.startsWith(prefix) || t.isTransfer) continue;
      if (t.amount > 0) inc += t.amount;
      else out += -t.amount;
    }
    return { inc: inc / 100, out: out / 100, label: new Date().toLocaleDateString('en-SG', { month: 'long' }) };
  }, [txs]);

  const filterCount = activeFilterCount(filters);
  const toggleKind = (k: ActivityKind) => setFilters((cur) => ({ ...cur, kind: cur.kind === k ? 'all' : k }));
  const chips: Array<{ key: string; label: string; clear: () => void }> = [
    ...(filters.kind !== 'all' ? [{ key: 'kind', label: KIND_LABELS[filters.kind], clear: () => setFilters((f) => ({ ...f, kind: 'all' as const })) }] : []),
    ...(filters.categoryId !== null
      ? [{ key: 'cat', label: filters.categoryId === '' ? 'Uncategorized' : categoryName(filters.categoryId) || 'Category', clear: () => setFilters((f) => ({ ...f, categoryId: null })) }]
      : []),
    ...(filters.accountId !== null
      ? [{ key: 'acct', label: accountName(filters.accountId) || 'Account', clear: () => setFilters((f) => ({ ...f, accountId: null })) }]
      : []),
  ];
  const summaryLink = 'press -mx-1.5 inline-flex min-h-9 items-center gap-1 rounded-lg px-1.5 transition-colors duration-150';

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <p className="-my-1 flex flex-wrap items-center gap-x-2.5 text-body tabular-nums" style={{ color: 'var(--text-muted)' }}>
          <span>{month.label}</span>
          <span aria-hidden="true">·</span>
          <Button
            type="button"
            aria-pressed={filters.kind === 'in'}
            title="Show money in"
            onClick={() => toggleKind('in')}
            className={summaryLink}
            style={{ backgroundColor: filters.kind === 'in' ? 'var(--positive-soft)' : undefined }}
          >
            in
            <span className="font-semibold" style={{ color: 'var(--positive)' }}>{formatMoney(month.inc, baseCurrency)}</span>
          </Button>
          <span aria-hidden="true">·</span>
          <Button
            type="button"
            aria-pressed={filters.kind === 'out'}
            title="Show money out"
            onClick={() => toggleKind('out')}
            className={summaryLink}
            style={{ backgroundColor: filters.kind === 'out' ? 'var(--bg-subtle)' : undefined }}
          >
            out
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{formatMoney(month.out, baseCurrency)}</span>
          </Button>
        </p>
        <div className="flex h-12 items-center gap-1 rounded-2xl pl-3.5 pr-0.5" style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-muted)' }}>
          <Label className="flex h-full min-w-0 flex-1 items-center gap-2">
            <Search className="h-4 w-4 shrink-0" />
            <Input
              variant="unstyled"
              aria-label="Search transactions"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search payee, category, account, note"
              className="h-full min-w-0 flex-1 bg-transparent text-body outline-none"
              style={{ color: 'var(--text-primary)' }}
            />
          </Label>
          {query && (
            <Button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="flex h-11 w-9 shrink-0 items-center justify-center rounded-full">
              <X className="h-4 w-4" />
            </Button>
          )}
          <span aria-hidden="true" className="h-6 w-px shrink-0" style={{ backgroundColor: 'var(--border-subtle)' }} />
          <Button
            type="button"
            onClick={() => setFilterSheetOpen(true)}
            aria-label={filterCount ? `Filters (${filterCount} active)` : 'Filters'}
            className="press relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors"
            style={filterCount ? { backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)' } : undefined}
          >
            <ListFilter className="h-[18px] w-[18px]" />
            {filterCount > 0 && (
              <span
                className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-caption font-bold tabular-nums"
                style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)', fontSize: '0.625rem', lineHeight: 1 }}
              >
                {filterCount}
              </span>
            )}
          </Button>
        </div>
        {chips.length > 0 && (
          <div className="-my-1.5 flex flex-wrap items-center gap-x-2">
            {chips.map((c) => (
              <Button key={c.key} type="button" onClick={c.clear} aria-label={`Remove filter: ${c.label}`} className="press flex min-h-11 max-w-full items-center">
                <span className="flex h-8 min-w-0 items-center gap-1.5 rounded-full pl-3 pr-2 text-label" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)' }}>
                  <span className="truncate">{c.label}</span>
                  <X className="h-3.5 w-3.5 shrink-0" />
                </span>
              </Button>
            ))}
            {chips.length > 1 && (
              <Button type="button" onClick={() => setFilters(NO_FILTERS)} className="press min-h-11 px-1 text-label" style={{ color: 'var(--text-muted)' }}>
                Clear all
              </Button>
            )}
            <span className="ml-auto text-caption tabular-nums" style={{ color: 'var(--text-muted)' }}>
              {filtered.length} transaction{filtered.length === 1 ? '' : 's'}
            </span>
          </div>
        )}
      </div>

      {/* Review queue (email imports) */}
      <section className="flex flex-col gap-2.5">
        <div className="flex min-h-11 items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-heading">
            To review{toReview.length > 0 ? ` · ${toReview.length}` : ''}
            {rescanning && <Spinner />}
          </h2>
          <Menu
            trigger={
              <Button type="button" aria-label="Review options" className="press -mr-2 flex h-11 w-11 items-center justify-center rounded-full" style={{ color: 'var(--text-muted)' }}>
                <MoreHorizontal className="h-5 w-5" />
              </Button>
            }
            items={[
              ...(toReview.length > 0
                ? [{ label: rescanning ? 'Re-reading…' : 'Re-read emails', icon: <RefreshCw />, disabled: rescanning, onSelect: () => void rescan() }]
                : []),
              { label: 'Test parser', icon: <FlaskConical />, onSelect: () => setTestOpen(true) },
            ]}
          />
        </div>
        {queued > 0 && (
          <p className="flex items-center gap-2 text-body" style={{ color: 'var(--text-muted)' }}>
            <Spinner />
            {queued} email{queued === 1 ? '' : 's'} being parsed…
          </p>
        )}
        {!loading && toReview.length === 0 && queued === 0 && (
          <p className="text-body" style={{ color: 'var(--text-muted)' }}>
            Nothing waiting. Card alerts from your bank show up here.
          </p>
        )}
        {toReview.map((ev) => {
          const p = ev.parsed;
          const failed = ev.status === 'failed';
          const payee = p?.payee || (!valuesHidden && ev.subject) || 'Email transaction';
          const cat = categoryName(p?.categoryId);
          const acct = accountName(p?.accountId);
          const busy = busyId === ev.id;
          const billReview = p?.billReview;
          const candidate = billReview?.candidates[0];
          const checkBill = billReview && !billReview.dismissed && (billReview.waitingForBill || billReview.needsReview);
          const badge: { text: string; bg: string; fg: string } | null = failed
            ? { text: 'Couldn’t parse', bg: 'var(--negative-soft)', fg: 'var(--negative)' }
            : candidate || checkBill || billReview?.dismissed
              ? { text: candidate ? 'Possible match' : billReview?.dismissed ? 'Match dismissed' : 'Check bill', bg: 'var(--accent-soft)', fg: 'var(--accent-text)' }
              : p
                ? { text: p.matchedRuleName ? 'Rule match' : `${Math.round(p.confidence * 100)}% match`, bg: 'var(--positive-soft)', fg: 'var(--positive)' }
                : null;
          const primaryLabel = busy
            ? 'Saving…'
            : billReview?.dismissed
              ? 'Add separately'
              : failed
                ? 'Fix & import'
                : !p?.accountId
                  ? 'Choose account'
                  : p.fxEstimated
                    ? 'Check & add'
                    : p.transferAccountId
                      ? 'Add transfer'
                      : 'Add to Actual';
          const action = 'h-11 rounded-2xl px-2 text-label disabled:opacity-50';
          return (
            <Card
              as="article"
              variant="flat"
              key={ev.id}
              className="flex flex-col gap-3 rounded-3xl p-4"
              style={failed ? { boxShadow: 'inset 0 0 0 1px var(--negative)' } : undefined}
            >
              <div className="flex items-center justify-between gap-2 text-caption" style={{ color: 'var(--text-muted)' }}>
                <span className="flex min-w-0 items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {p?.accountRef?.label.split(' ')[0] || senderLabel(p?.originalSender || ev.sender)} · {relativeTime(ev.received_at)}
                  </span>
                </span>
                {badge && (
                  <Badge className="shrink-0 px-2.5 py-0.5 text-caption font-semibold tabular-nums" style={{ backgroundColor: badge.bg, color: badge.fg }}>
                    {badge.text}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Tile colorKey={cat || payee} label={payee} transfer={Boolean(p?.transferAccountId)} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body">{payee}</span>
                  <span className="truncate text-caption" style={{ color: 'var(--text-muted)' }}>
                    {p?.transferAccountId
                      ? `Transfer · ${acct || 'account'} → ${accountName(p.transferAccountId)}`
                      : [cat || 'Uncategorized', acct || (p?.accountRef ? null : 'No account')].filter(Boolean).join(' · ')}
                  </span>
                  {p?.accountRef && !p.accountId && (
                    <Badge className="mt-1 flex max-w-full items-center gap-1 self-start whitespace-nowrap px-2 py-0.5 text-caption font-semibold" style={{ backgroundColor: 'var(--warning-soft)', color: 'var(--warning)' }}>
                      <CreditCard className="h-3 w-3" />
                      New: {p.accountRef.label}
                    </Badge>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end">
                  <span className="text-body font-semibold tabular-nums" style={{ color: (p?.amountBase ?? 0) > 0 ? 'var(--positive)' : 'var(--text-primary)' }}>
                    {p?.amountBase !== null && p?.amountBase !== undefined ? formatSignedMoney(p.amountBase, baseCurrency) : '—'}
                  </span>
                  {!valuesHidden && p?.fxEstimated && p.amount !== null && (
                    <span className="text-caption tabular-nums" style={{ color: 'var(--text-muted)' }}>
                      ≈ {p.currency} {Math.abs(p.amount).toLocaleString('en-SG')}
                    </span>
                  )}
                </div>
              </div>
              {!valuesHidden && ev.error && (
                <p className="text-caption font-semibold" style={{ color: 'var(--negative)' }}>
                  {ev.error}
                </p>
              )}
              {candidate && (
                <div className="flex items-center gap-2.5 rounded-2xl p-3" style={{ backgroundColor: 'var(--bg-subtle)' }}>
                  <CalendarCheck className="h-4 w-4 shrink-0" style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-body">
                      {billReview!.candidates.length === 1 ? candidate.scheduleName + ' already posted' : 'Several posted bills match'}
                    </p>
                    {billReview!.candidates.length === 1 && (
                      <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
                        Posted by schedule · {friendlyDate(candidate.date)}
                      </p>
                    )}
                  </div>
                </div>
              )}
              {!candidate && checkBill && (
                <p className="rounded-2xl p-3 text-body" style={{ backgroundColor: 'var(--bg-subtle)' }}>
                  {billReview.waitingForBill ? 'Waiting for the scheduled bill in Actual. Kopi will check again.' : 'Check the scheduled bill or confirm this is a separate charge.'}
                </p>
              )}
              {billReview?.dismissed && (
                <div className="flex items-center justify-between gap-2 rounded-2xl py-1 pl-3 pr-1" style={{ backgroundColor: 'var(--bg-subtle)' }}>
                  <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
                    You said the posted bill isn’t a match.
                  </p>
                  <Button type="button" disabled={busy} onClick={() => void decideBill(ev, 'restore')}
                    className="min-h-11 shrink-0 rounded-xl px-3 text-label disabled:opacity-50" style={{ color: 'var(--accent-text)' }}>
                    Undo
                  </Button>
                </div>
              )}
              <div className="grid grid-cols-4 gap-2">
                <Button type="button" disabled={busy} onClick={() => void skip(ev)} variant="secondary" className={action}>
                  Skip
                </Button>
                <Button type="button" disabled={busy} onClick={() => onOpenFlow({ mode: 'review', event: ev })} variant="secondary" className={action}>
                  Edit
                </Button>
                {candidate ? (
                  <Button type="button" disabled={busy} onClick={() => setReviewBillId(ev.id)} variant="default" className={`col-span-2 ${action}`}>
                    Review match
                  </Button>
                ) : checkBill ? (
                  <Button type="button" disabled={busy} onClick={() => void decideBill(ev, 'reject')} variant="secondary" className={`col-span-2 ${action}`}>
                    Not a match
                  </Button>
                ) : (
                  <Button type="button" disabled={busy} onClick={() => void quickAdd(ev)} variant="default" className={`col-span-2 ${action}`}>
                    {primaryLabel}
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </section>

      {resolvedBills.length > 0 && (
        <section className="flex flex-col gap-2.5" aria-label="Resolved bill emails">
          <h2 className="text-heading">Resolved bill emails</h2>
          {resolvedBills.map((event) => {
            const matched = event.parsed?.billReview?.outcome === 'matched';
            const bill = event.parsed?.billReview?.candidates[0];
            return (
              <Card key={event.id} variant="flat" className="flex flex-wrap items-center justify-between gap-2 rounded-3xl p-4">
                <div className="min-w-0">
                  <p className="text-body">{event.parsed?.payee || (valuesHidden ? 'Email transaction' : event.subject)}</p>
                  <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
                    {bill ? bill.scheduleName + ' · ' + friendlyDate(bill.date) : 'Same bank reference · ' + friendlyDate(event.received_at.slice(0, 10))}
                  </p>
                </div>
                <Badge className="px-2.5 py-0.5 text-caption font-semibold" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)' }}>
                  {matched ? 'Matched to paid bill' : 'Repeat alert ignored'}
                </Badge>
              </Card>
            );
          })}
        </section>
      )}

      {/* Transactions */}
      {txError && (
        <p className="rounded-2xl p-4 text-body font-semibold" style={{ backgroundColor: 'var(--warning-soft)', color: 'var(--warning)' }}>
          Couldn't load transactions from Actual: {txError}
        </p>
      )}
      {loading && txs.length === 0 && !txError && (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((k) => (
            <Skeleton key={k} className="h-14 rounded-2xl" />
          ))}
        </div>
      )}
      {!loading && !txError && groups.length === 0 && (
        <p className="py-6 text-center text-body" style={{ color: 'var(--text-muted)' }}>
          {query || filterCount > 0 ? 'No transactions match.' : 'No transactions in the last 60 days.'}
        </p>
      )}
      {groups.map((g) => (
        <section key={g.date} className="flex flex-col">
          <div className="mb-1 flex items-baseline justify-between">
            <h2 className="text-heading">{friendlyDate(g.date)}</h2>
            <span className="text-body tabular-nums" style={{ color: 'var(--text-muted)' }}>
              {formatSignedMoney(g.total, baseCurrency)}
            </span>
          </div>
          {g.items.map((t) => (
            <Button
              key={t.id}
              type="button"
              onClick={(event) => {
                transactionTrigger.current = event.currentTarget;
                setEditTx(t);
              }}
              className="flex w-full items-center gap-3 py-2 text-left"
              title="Edit transaction"
            >
              <Tile colorKey={t.categoryName || t.payeeName} label={t.payeeName} transfer={t.isTransfer} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body">{t.payeeName}</span>
                <span className="truncate text-caption" style={{ color: 'var(--text-muted)' }}>
                  {[t.isTransfer ? null : t.categoryName || 'Uncategorized', t.accountName, t.cleared === false ? 'uncleared' : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              <span className="text-body font-semibold tabular-nums" style={{ color: t.amount > 0 ? 'var(--positive)' : 'var(--text-primary)' }}>
                {formatSignedMoney(t.amount / 100, baseCurrency)}
              </span>
            </Button>
          ))}
        </section>
      ))}

      {billEmail && (
        <BillMatchSheet key={billEmail.id} event={billEmail} accountName={accountName(billEmail.parsed?.accountId)} currency={baseCurrency}
          busy={busyId === billEmail.id} onClose={() => setReviewBillId(null)}
          onDecision={(action, transactionId, remember) => void decideBill(billEmail, action, transactionId, remember)} />
      )}
      <ActivityFilterSheet
        open={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        filters={filters}
        onChange={setFilters}
        transactions={txs}
        categories={categories}
        categoryGroups={categoryGroups}
        accounts={accounts}
        resultCount={filtered.length}
      />
      {editTx && (
        <EditTransactionSheet
          key={editTx.id}
          transaction={editTx}
          accounts={accounts}
          categories={categories}
          payees={payees}
          baseCurrency={baseCurrency}
          onClose={closeTransactionSheet}
          onSaved={() => {
            closeTransactionSheet();
            onChanged('Transaction updated');
          }}
          onLinkPayee={editTx.payee && !editTx.isTransfer ? () => {
            setLinkTx(editTx);
            setEditTx(null);
          } : undefined}
        />
      )}
      <LinkPayeeSheet
        open={Boolean(linkTx)}
        onClose={closeTransactionSheet}
        raw={linkTx ? linkTx.imported_payee || linkTx.payeeName : ''}
        payees={payees}
        mergePayeeId={linkTx?.payee || null}
        onLinked={({ targetName, merged }) =>
          onChanged(merged ? `Merged into “${targetName}”, and future imports will match` : `Future imports will be saved as “${targetName}”`)
        }
      />

      <Sheet financialForm open={testOpen} onClose={() => setTestOpen(false)} title="Test email parser" subtitle="Simulates an incoming bank alert email">
        <form onSubmit={runTest} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="test-from" className="text-label" style={{ color: 'var(--text-muted)' }}>From</Label>
            <Input id="test-from" value={testFrom} onChange={(e) => setTestFrom(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="test-subject" className="text-label" style={{ color: 'var(--text-muted)' }}>Subject</Label>
            <Input id="test-subject" value={testSubject} onChange={(e) => setTestSubject(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="test-body" className="text-label" style={{ color: 'var(--text-muted)' }}>Email body</Label>
            <Textarea id="test-body" rows={4} value={testBody} onChange={(e) => setTestBody(e.target.value)} />
          </div>
          <Button type="submit" disabled={testBusy} variant="default" className="h-12 w-full rounded-2xl text-body disabled:opacity-50">
            {testBusy ? 'Parsing…' : 'Queue & parse test email'}
          </Button>
        </form>
      </Sheet>
    </div>
  );
}
