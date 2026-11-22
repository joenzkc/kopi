import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, CalendarCheck, CreditCard, FlaskConical, Mail, RefreshCw, Search, X } from 'lucide-react';
import type { ActualAccount, ActualCategory, ActualPayee, EmailEventRecord, RecentTransaction } from '@shared/types';
import { ApiError, apiFetch, formatMoney, formatSignedMoney } from '../lib/api';
import { fetchRecent, friendlyDate, localISODate, relativeTime, senderLabel } from '../lib/recent';
import { Sheet } from '../components/Sheet';
import { Tile } from '../components/Tile';
import { LinkPayeeSheet } from '../components/LinkPayeeSheet';
import { BillMatchSheet } from '../components/BillMatchSheet';
import type { FlowRequest } from '../components/TransactionFlow';
import { Button } from '@client/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@client/components/ui/radio-group';
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
  payees: ActualPayee[];
  baseCurrency: string;
  dataVersion: number;
  onOpenFlow: (req: FlowRequest) => void;
  onChanged: (message: string) => void;
  onToast: (msg: string, tone?: 'success' | 'error') => void;
}

type Filter = 'all' | 'out' | 'in' | 'transfers';

export function ActivityPage({ accounts, categories, payees, baseCurrency, dataVersion, onOpenFlow, onChanged, onToast }: ActivityPageProps) {
  const [events, setEvents] = useState<EmailEventRecord[]>([]);
  const [txs, setTxs] = useState<RecentTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [txError, setTxError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [linkTx, setLinkTx] = useState<RecentTransaction | null>(null);
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
      if (filter === 'out' && (t.amount >= 0 || t.isTransfer)) return false;
      if (filter === 'in' && (t.amount <= 0 || t.isTransfer)) return false;
      if (filter === 'transfers' && !t.isTransfer) return false;
      if (!q) return true;
      return [t.payeeName, t.categoryName, t.accountName, t.notes].some((v) => v && v.toLowerCase().includes(q));
    });
  }, [txs, filter, query]);

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

  const filters: Array<{ id: Filter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'out', label: 'Out' },
    { id: 'in', label: 'In' },
    { id: 'transfers', label: 'Transfers' },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <p className="text-sm tabular-nums" style={{ color: 'var(--text-muted)' }}>
          {month.label} · in <span style={{ color: 'var(--positive)' }}>{formatMoney(month.inc, baseCurrency)}</span> · out{' '}
          <span style={{ color: 'var(--text-primary)' }}>{formatMoney(month.out, baseCurrency)}</span>
        </p>
        <Label
          className="flex h-12 items-center gap-2 rounded-2xl px-3.5"
          style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-muted)' }}
        >
          <Search className="h-4 w-4 shrink-0" />
          <Input
            variant="unstyled"
            aria-label="Search transactions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search payee, category, account, note"
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none"
            style={{ color: 'var(--text-primary)' }}
          />
          {query && (
            <Button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="flex h-8 w-8 items-center justify-center rounded-full">
              <X className="h-4 w-4" />
            </Button>
          )}
        </Label>
        <RadioGroup value={filter} onValueChange={(value) => setFilter(value as Filter)} aria-label="Filter" className="grid grid-cols-4 gap-1 rounded-2xl p-1" style={{ backgroundColor: 'var(--bg-surface)' }}>
          {filters.map((f) => {
            const on = filter === f.id;
            return (
              <RadioGroupItem
                key={f.id}
                value={f.id}
                className="h-10 rounded-xl text-sm font-bold transition"
                style={{ backgroundColor: on ? 'var(--accent)' : 'transparent', color: on ? 'var(--accent-fg)' : 'var(--text-muted)' }}
              >
                {f.label}
              </RadioGroupItem>
            );
          })}
        </RadioGroup>
      </div>

      {/* Review queue (email imports) */}
      <section className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-extrabold">
            To review{toReview.length > 0 ? ` · ${toReview.length}` : ''}
          </h2>
          <div className="flex items-center gap-4">
            {toReview.length > 0 && (
              <Button
                type="button"
                onClick={() => void rescan()}
                disabled={rescanning}
                className="flex items-center gap-1 text-sm font-bold disabled:opacity-50"
                style={{ color: 'var(--accent-text)' }}
                title="Read waiting emails again with your latest links and rules"
              >
                <RefreshCw className={`h-4 w-4 ${rescanning ? 'animate-spin' : ''}`} />
                Re-read
              </Button>
            )}
            <Button
              type="button"
              onClick={() => setTestOpen(true)}
              className="flex items-center gap-1 text-sm font-bold"
              style={{ color: 'var(--accent-text)' }}
            >
              <FlaskConical className="h-4 w-4" />
              Test parser
            </Button>
          </div>
        </div>
        {queued > 0 && (
          <p className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            <Spinner />
            {queued} email{queued === 1 ? '' : 's'} being parsed…
          </p>
        )}
        {!loading && toReview.length === 0 && queued === 0 && (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Nothing waiting. Card alerts from your bank show up here.
          </p>
        )}
        {toReview.map((ev, i) => {
          const p = ev.parsed;
          const failed = ev.status === 'failed';
          const payee = p?.payee || ev.subject || 'Email transaction';
          const cat = categoryName(p?.categoryId);
          const acct = accountName(p?.accountId);
          const busy = busyId === ev.id;
          const billReview = p?.billReview;
          const candidate = billReview?.candidates[0];
          const checkBill = billReview && !billReview.dismissed && (billReview.waitingForBill || billReview.needsReview);
          return (
            <Card
              as="article"
              variant="outline"
              key={ev.id}
              className="flex flex-col gap-3.5 rounded-[26px] p-4"
              style={failed ? { borderColor: 'var(--negative)' } : undefined}
            >
              <div className="flex items-center justify-between gap-2 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>
                <span className="flex min-w-0 items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {p?.accountRef?.label.split(' ')[0] || senderLabel(p?.originalSender || ev.sender)} · {relativeTime(ev.received_at)}
                  </span>
                </span>
                {failed ? (
                  <Badge className="shrink-0 px-2.5 py-0.5 text-[11px] font-extrabold" style={{ backgroundColor: 'var(--negative-soft)', color: 'var(--negative)' }}>
                    Couldn't parse
                  </Badge>
                ) : (
                  (candidate || checkBill || billReview?.dismissed) ? (
                    <Badge className="shrink-0 bg-accent px-2.5 py-0.5 text-[11px] font-extrabold">
                      {candidate ? 'Possible match' : billReview?.dismissed ? 'Match dismissed' : 'Check bill'}
                    </Badge>
                  ) : p && (
                    <Badge className="shrink-0 px-2.5 py-0.5 text-[11px] font-extrabold" style={{ backgroundColor: 'var(--positive)', color: 'var(--bg-canvas)' }}>
                      {p.matchedRuleName ? 'Rule match' : `${Math.round(p.confidence * 100)}% match`}
                    </Badge>
                  )
                )}
              </div>
              <div className="flex items-center gap-3.5">
                <Tile colorKey={cat || payee} label={payee} size={i === 0 ? 50 : 42} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className={`truncate font-extrabold ${i === 0 ? 'text-lg' : 'text-[15px]'}`}>{payee}</span>
                  <span className="truncate text-[13px]" style={{ color: 'var(--text-muted)' }}>
                    {p?.transferAccountId
                      ? `Transfer · ${acct || 'account'} → ${accountName(p.transferAccountId)}`
                      : [cat || 'Uncategorized', acct || (p?.accountRef ? null : 'No account')].filter(Boolean).join(' · ')}
                  </span>
                  {p?.accountRef && !p.accountId && (
                    <Badge className="mt-1 flex max-w-full items-center gap-1 self-start whitespace-nowrap px-2 py-0.5 text-[11px] font-extrabold" style={{ backgroundColor: 'var(--warning-soft)', color: 'var(--warning)' }}>
                      <CreditCard className="h-3 w-3" />
                      New: {p.accountRef.label}
                    </Badge>
                  )}
                  {p?.fxEstimated && p.amount !== null && (
                    <span className="mt-0.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      ≈ from {p.currency} {Math.abs(p.amount).toLocaleString('en-SG')} at today’s rate
                    </span>
                  )}
                </div>
                <span className={`shrink-0 font-extrabold tabular-nums ${i === 0 ? 'text-xl' : 'text-base'}`} style={{ color: (p?.amountBase ?? 0) > 0 ? 'var(--positive)' : 'var(--text-primary)' }}>
                  {p?.amountBase !== null && p?.amountBase !== undefined ? formatSignedMoney(p.amountBase, baseCurrency) : '—'}
                </span>
              </div>
              {i === 0 && ev.body_text && (
                <p className="line-clamp-2 rounded-2xl px-3 py-2.5 text-xs leading-relaxed" style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-muted)' }}>
                  “{ev.body_text.replace(/\s+/g, ' ').trim().slice(0, 200)}”
                </p>
              )}
              {ev.error && (
                <p className="text-xs font-semibold" style={{ color: 'var(--negative)' }}>
                  {ev.error}
                </p>
              )}
              {candidate && (
                <div className="flex items-center gap-2.5 rounded-xl bg-secondary p-3">
                  <CalendarCheck className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold">
                      {billReview!.candidates.length === 1 ? candidate.scheduleName + ' already posted' : 'Several posted bills match'}
                    </p>
                    {billReview!.candidates.length === 1 && <p className="text-xs text-muted-foreground">Posted by schedule · {friendlyDate(candidate.date)}</p>}
                  </div>
                </div>
              )}
              {!candidate && checkBill && (
                <p className="rounded-xl bg-secondary p-3 text-sm">
                  {billReview.waitingForBill ? 'Waiting for the scheduled bill in Actual. Kopi will check again.' : 'Check the scheduled bill or confirm this is a separate charge.'}
                </p>
              )}
              <div className="grid grid-cols-4 gap-2">
                <Button type="button" disabled={busy} onClick={() => void skip(ev)} variant="secondary" className="h-12 rounded-2xl text-sm font-bold disabled:opacity-50">
                  Skip
                </Button>
                <Button type="button" disabled={busy} onClick={() => onOpenFlow({ mode: 'review', event: ev })} variant="secondary" className="h-12 rounded-2xl text-sm font-bold disabled:opacity-50">
                  Edit
                </Button>
                {candidate ? (
                  <Button type="button" disabled={busy} onClick={() => setReviewBillId(ev.id)}
                    variant="default" className="col-span-2 h-12 rounded-2xl text-sm disabled:opacity-50">
                    Review match
                  </Button>
                ) : checkBill ? (
                  <Button type="button" disabled={busy} onClick={() => void decideBill(ev, 'reject')}
                    variant="secondary" className="col-span-2 h-12 rounded-2xl text-sm font-bold disabled:opacity-50">
                    Not a match
                  </Button>
                ) : <Button
                  type="button"
                  disabled={busy}
                  onClick={() => void quickAdd(ev)}
                  variant="default" className="col-span-2 h-12 rounded-2xl text-sm disabled:opacity-50"
                >
                  {busy
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
                            : 'Add to Actual'}
                </Button>}
              </div>
              {billReview?.dismissed && (
                <Button type="button" disabled={busy} onClick={() => void decideBill(ev, 'restore')}
                  className="self-start px-1 text-xs font-bold text-primary">
                  Undo dismissal
                </Button>
              )}
            </Card>
          );
        })}
      </section>

      {resolvedBills.length > 0 && (
        <section className="flex flex-col gap-2.5" aria-label="Resolved bill emails">
          <h2 className="text-lg font-extrabold">Resolved bill emails</h2>
          {resolvedBills.map((event) => {
            const matched = event.parsed?.billReview?.outcome === 'matched';
            const bill = event.parsed?.billReview?.candidates[0];
            return (
              <Card key={event.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl p-3.5">
                <div className="min-w-0">
                  <p className="text-sm font-bold">{event.parsed?.payee || event.subject}</p>
                  <p className="text-xs text-muted-foreground">
                    {bill ? bill.scheduleName + ' · ' + friendlyDate(bill.date) : 'Same bank reference · ' + friendlyDate(event.received_at.slice(0, 10))}
                  </p>
                </div>
                <Badge className="bg-accent px-2.5 py-0.5 text-[11px] font-extrabold">
                  {matched ? 'Matched to paid bill' : 'Repeat alert ignored'}
                </Badge>
              </Card>
            );
          })}
        </section>
      )}

      {/* Transactions */}
      {txError && (
        <p className="rounded-2xl p-4 text-sm font-semibold" style={{ backgroundColor: 'var(--warning-soft)', color: 'var(--warning)' }}>
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
        <p className="py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          {query || filter !== 'all' ? 'No transactions match.' : 'No transactions in the last 60 days.'}
        </p>
      )}
      {groups.map((g) => (
        <section key={g.date} className="flex flex-col">
          <div className="mb-1 flex items-baseline justify-between">
            <h2 className="text-[15px] font-extrabold">{friendlyDate(g.date)}</h2>
            <span className="text-sm tabular-nums" style={{ color: 'var(--text-muted)' }}>
              {formatSignedMoney(g.total, baseCurrency)}
            </span>
          </div>
          {g.items.map((t) => (
            <Button
              key={t.id}
              type="button"
              disabled={t.isTransfer || !t.payee}
              onClick={() => setLinkTx(t)}
              className="flex w-full items-center gap-3 py-2 text-left disabled:cursor-default"
              title={t.isTransfer ? undefined : 'Link this payee to another, e.g. “McDonalds JE” → “McDonalds”'}
            >
              <Tile colorKey={t.categoryName || t.payeeName} label={t.payeeName} transfer={t.isTransfer} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[15px] font-semibold">{t.payeeName}</span>
                <span className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                  {[t.isTransfer ? null : t.categoryName || 'Uncategorized', t.accountName, t.cleared === false ? 'uncleared' : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              <span className="text-[15px] font-bold tabular-nums" style={{ color: t.amount > 0 ? 'var(--positive)' : 'var(--text-primary)' }}>
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
      <LinkPayeeSheet
        open={Boolean(linkTx)}
        onClose={() => setLinkTx(null)}
        raw={linkTx ? linkTx.imported_payee || linkTx.payeeName : ''}
        payees={payees}
        mergePayeeId={linkTx?.payee || null}
        onLinked={({ targetName, merged }) =>
          onChanged(merged ? `Merged into “${targetName}”, and future imports will match` : `Future imports will be saved as “${targetName}”`)
        }
      />

      <Sheet open={testOpen} onClose={() => setTestOpen(false)} title="Test email parser" subtitle="Simulates an incoming bank alert email">
        <form onSubmit={runTest} className="space-y-3.5">
          <div>
            <Label htmlFor="test-from" className="mb-1 block text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>From</Label>
            <Input id="test-from" value={testFrom} onChange={(e) => setTestFrom(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="test-subject" className="mb-1 block text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Subject</Label>
            <Input id="test-subject" value={testSubject} onChange={(e) => setTestSubject(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="test-body" className="mb-1 block text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Email body</Label>
            <Textarea id="test-body" rows={4} value={testBody} onChange={(e) => setTestBody(e.target.value)} />
          </div>
          <Button type="submit" disabled={testBusy} variant="default" className="h-12 w-full rounded-2xl text-sm disabled:opacity-50">
            {testBusy ? 'Parsing…' : 'Queue & parse test email'}
          </Button>
        </form>
      </Sheet>
    </div>
  );
}
