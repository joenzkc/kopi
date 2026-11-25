import { useFinancialValues } from '../lib/valueVisibility';
import React, { useCallback, useEffect, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Edit3,
  Play,
  Plus,
  Repeat,
  Trash2,
  Zap,
} from 'lucide-react';
import type { ActualAccount, ActualPayee, EnrichedSchedule, RecurConfig } from '@shared/types';
import { apiFetch, formatDueBadge } from '../lib/api';
import { Sheet } from '../components/Sheet';
import { Button } from '@client/components/ui/button';
import { Input } from '@client/components/ui/input';
import { Label } from '@client/components/ui/label';
import { Select } from '@client/components/ui/select';
import { Badge } from '@client/components/ui/badge';
import { Card } from '@client/components/ui/card';
import { Skeleton } from '@client/components/ui/skeleton';

interface SchedulesPageProps {
  accounts: ActualAccount[];
  payees: ActualPayee[];
  baseCurrency: string;
  onToast: (msg: string, tone?: 'success' | 'error') => void;
}

interface SchedulesRes {
  schedules: EnrichedSchedule[];
  summary: {
    activeCount: number;
    dueSoonCount: number;
    monthlyOutflowCents: number;
    monthlyInflowCents: number;
    monthlyNetCents: number;
  };
}

type Preset = 'monthly' | 'biweekly' | 'weekly' | 'yearly' | 'once';

export function SchedulesPage({ accounts, payees, baseCurrency, onToast }: SchedulesPageProps) {
  const { formatMoney, formatSignedMoney } = useFinancialValues();
  const [data, setData] = useState<SchedulesRes | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'upcoming' | 'all' | 'completed'>('upcoming');

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<EnrichedSchedule | null>(null);
  const [name, setName] = useState('');
  const [direction, setDirection] = useState<'expense' | 'income'>('expense');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [preset, setPreset] = useState<Preset>('monthly');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [postsTransaction, setPostsTransaction] = useState(true);
  const [skipWeekend, setSkipWeekend] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<SchedulesRes>('/api/schedules');
      setData(res);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to load schedules', 'error');
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setName('');
    setDirection('expense');
    setAmount('');
    setAccountId(accounts.find((a) => !a.offbudget)?.id || accounts[0]?.id || '');
    setPayeeName('');
    setPreset('monthly');
    setStartDate(new Date().toISOString().slice(0, 10));
    setPostsTransaction(true);
    setSkipWeekend(false);
    setSheetOpen(true);
  }

  function openEdit(s: EnrichedSchedule) {
    setEditing(s);
    setName(s.name || '');
    setDirection(s.amountCents >= 0 ? 'income' : 'expense');
    setAmount((Math.abs(s.amountCents) / 100).toFixed(2));
    setAccountId(s.account || '');
    setPayeeName(s.payeeName || '');
    setPostsTransaction(Boolean(s.posts_transaction));

    if (typeof s.date === 'string') {
      setPreset('once');
      setStartDate(s.date);
      setSkipWeekend(false);
    } else if (s.date) {
      if (s.date.frequency === 'weekly' && s.date.interval === 2) setPreset('biweekly');
      else if (s.date.frequency === 'weekly') setPreset('weekly');
      else if (s.date.frequency === 'yearly') setPreset('yearly');
      else setPreset('monthly');
      setStartDate(s.date.start || s.next_date || new Date().toISOString().slice(0, 10));
      setSkipWeekend(Boolean(s.date.skipWeekend));
    }
    setSheetOpen(true);
  }

  function buildDatePayload(): string | RecurConfig {
    if (preset === 'once') return startDate;
    return {
      frequency: preset === 'biweekly' ? 'weekly' : preset,
      interval: preset === 'biweekly' ? 2 : 1,
      start: startDate,
      endMode: 'never',
      ...(skipWeekend ? { skipWeekend: true, weekendSolveMode: 'before' as const } : {}),
    };
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const amtNum = Number(amount);
    if (!Number.isFinite(amtNum) || amtNum <= 0) {
      onToast('Enter a valid amount > 0', 'error');
      return;
    }
    if (!accountId) {
      onToast('Select an account', 'error');
      return;
    }

    setSaving(true);
    try {
      const signedAmount = direction === 'expense' ? -Math.abs(amtNum) : Math.abs(amtNum);
      const matchedPayee = payees.find((p) => p.name.toLowerCase() === payeeName.trim().toLowerCase());
      const payload = {
        name: name.trim() || payeeName.trim() || 'Scheduled Bill',
        account: accountId,
        payee: matchedPayee ? matchedPayee.id : null,
        payeeName: !matchedPayee && payeeName.trim() ? payeeName.trim() : undefined,
        amount: signedAmount,
        amountOp: 'is' as const,
        posts_transaction: postsTransaction,
        date: buildDatePayload(),
      };

      if (editing) {
        await apiFetch(`/api/schedules/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        onToast(`Updated "${payload.name}"`);
      } else {
        await apiFetch('/api/schedules', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        onToast(`Created schedule "${payload.name}"`);
      }
      setSheetOpen(false);
      await load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to save schedule', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handlePostNow(s: EnrichedSchedule) {
    if (!confirm(`Post "${s.name || s.payeeName}" (${formatSignedMoney(s.amountCents / 100, baseCurrency)}) into Actual now?`)) {
      return;
    }
    try {
      await apiFetch(`/api/schedules/${s.id}/post-now`, { method: 'POST' });
      onToast(`Posted "${s.name || s.payeeName}" to Actual`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to post transaction', 'error');
    }
  }

  async function handleDelete(s: EnrichedSchedule) {
    if (!confirm(`Delete schedule "${s.name || s.payeeName}"?`)) return;
    try {
      await apiFetch(`/api/schedules/${s.id}`, { method: 'DELETE' });
      onToast('Schedule deleted');
      await load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to delete schedule', 'error');
    }
  }

  const list = (data?.schedules || []).filter((s) => {
    if (tab === 'completed') return Boolean(s.completed);
    if (tab === 'upcoming') return !s.completed && (s.daysUntilNext === null || s.daysUntilNext <= 31);
    return !s.completed;
  });

  return (
    <div className="space-y-5">
      {/* Monthly Recurring Cashflow Card */}
      <Card as="section" className="rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-label" style={{ color: 'var(--text-muted)' }}>
              Est. Monthly Recurring Outflow
            </div>
            <div className="mt-1 text-display tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {data ? formatMoney(data.summary.monthlyOutflowCents / 100, baseCurrency) : '—'}
            </div>
          </div>
          <Button
            type="button"
            onClick={openCreate}
            variant="default" className="flex items-center gap-1.5 rounded-xl px-3.5 py-2.5 text-label"
          >
            <Plus className="h-4 w-4" />
            New Schedule
          </Button>
        </div>

        {data && (
          <div
            className="mt-4 grid grid-cols-3 gap-2.5 pt-3.5 tabular-nums"
            style={{ borderTop: '1px solid var(--border-subtle)' }}
          >
            <div className="surface-subtle rounded-xl p-2.5">
              <div className="text-caption" style={{ color: 'var(--text-muted)' }}>Recurring Income</div>
              <div className="mt-0.5 text-body font-semibold" style={{ color: 'var(--positive)' }}>
                {formatMoney(data.summary.monthlyInflowCents / 100, baseCurrency)}
              </div>
            </div>
            <div className="surface-subtle rounded-xl p-2.5">
              <div className="text-caption" style={{ color: 'var(--text-muted)' }}>Active Rules</div>
              <div className="mt-0.5 text-body font-semibold" style={{ color: 'var(--text-primary)' }}>
                {data.summary.activeCount}
              </div>
            </div>
            <div className="surface-subtle rounded-xl p-2.5">
              <div className="text-caption" style={{ color: 'var(--text-muted)' }}>Due ≤ 7d</div>
              <div className="mt-0.5 text-body font-semibold" style={{ color: 'var(--warning)' }}>
                {data.summary.dueSoonCount}
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Filter Tabs */}
      <div className="flex gap-1.5">
        {(
          [
            ['upcoming', 'Next 30 Days'],
            ['all', 'All Active'],
            ['completed', 'Completed'],
          ] as const
        ).map(([k, label]) => {
          const active = tab === k;
          return (
            <Button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className="rounded-full px-3.5 py-1.5 text-label transition"
              style={{
                backgroundColor: active ? 'var(--text-primary)' : 'var(--bg-surface)',
                color: active ? 'var(--bg-surface)' : 'var(--text-secondary)',
                border: `1px solid ${active ? 'var(--text-primary)' : 'var(--border-subtle)'}`,
              }}
            >
              {label}
            </Button>
          );
        })}
      </div>

      {/* Schedules List */}
      {loading && !data ? (
        <div className="space-y-3">
          <Card asChild>
            <Skeleton className="h-24 rounded-2xl" />
          </Card>
          <Card asChild>
            <Skeleton className="h-24 rounded-2xl" />
          </Card>
        </div>
      ) : list.length === 0 ? (
        <Card className="rounded-2xl p-8 text-center">
          <CalendarClock className="mx-auto h-8 w-8" style={{ color: 'var(--text-muted)' }} />
          <p className="mt-3 text-body" style={{ color: 'var(--text-primary)' }}>
            No schedules in this view
          </p>
          <p className="mt-1 text-caption" style={{ color: 'var(--text-muted)' }}>
            Create recurring bills, subscriptions, or salary rules in seconds.
          </p>
        </Card>
      ) : (
        <Card className="divider-list overflow-hidden rounded-2xl">
          {list.map((s) => {
            const due = formatDueBadge(s.daysUntilNext);
            const dueStyle =
              due.tone === 'rose'
                ? { backgroundColor: 'var(--negative-soft)', color: 'var(--negative)' }
                : due.tone === 'amber'
                  ? { backgroundColor: 'var(--warning-soft)', color: 'var(--warning)' }
                  : { backgroundColor: 'var(--bg-subtle)', color: 'var(--text-secondary)' };

            return (
              <div key={s.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-body" style={{ color: 'var(--text-primary)' }}>
                        {s.name || s.payeeName || 'Untitled Schedule'}
                      </span>
                      {!s.completed && (
                        <Badge className="px-2 py-0.5 text-caption font-semibold" style={dueStyle}>
                          {due.text}
                        </Badge>
                      )}
                      {s.posts_transaction && (
                        <Badge
                          className="inline-flex items-center gap-0.5 px-2 py-0.5 text-caption"
                          style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)' }}
                        >
                          <Zap className="h-2.5 w-2.5" />
                          Auto-post
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-caption" style={{ color: 'var(--text-muted)' }}>
                      <span className="inline-flex items-center gap-1">
                        <Repeat className="h-3 w-3" />
                        {s.recurrenceLabel}
                      </span>
                      {s.next_date && <span>Next: {s.next_date}</span>}
                      {s.accountName && <span>· {s.accountName}</span>}
                    </div>
                  </div>

                  <div
                    className="shrink-0 text-right text-body font-semibold tabular-nums"
                    style={{ color: s.amountCents >= 0 ? 'var(--positive)' : 'var(--text-primary)' }}
                  >
                    {formatSignedMoney(s.amountCents / 100, baseCurrency)}
                  </div>
                </div>

                <div
                  className="mt-3 flex items-center justify-between pt-2.5"
                  style={{ borderTop: '1px solid var(--border-subtle)' }}
                >
                  <span className="text-caption" style={{ color: 'var(--text-muted)' }}>
                    {s.payeeName ? `Payee: ${s.payeeName}` : 'No payee'}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {!s.completed && (
                      <Button
                        type="button"
                        onClick={() => void handlePostNow(s)}
                        variant="secondary" className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-label"
                      >
                        <Play className="h-3 w-3" style={{ color: 'var(--accent-text)' }} />
                        Post Now
                      </Button>
                    )}
                    <Button
                      type="button"
                      onClick={() => openEdit(s)}
                      className="rounded-lg p-1.5 hover:opacity-80"
                      style={{ color: 'var(--text-muted)' }}
                      aria-label="Edit schedule"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void handleDelete(s)}
                      className="rounded-lg p-1.5 hover:opacity-80"
                      style={{ color: 'var(--negative)' }}
                      aria-label="Delete schedule"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {/* Create / Edit Schedule Sheet */}
      <Sheet
        financialForm
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={editing ? 'Edit Schedule' : 'New Scheduled Transaction'}
        subtitle="Saved directly to Actual Budget"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {(['expense', 'income'] as const).map((dir) => {
              const active = direction === dir;
              return (
                <Button
                  key={dir}
                  type="button"
                  onClick={() => setDirection(dir)}
                  className="rounded-xl py-2 text-label capitalize transition"
                  style={{
                    backgroundColor: active
                      ? dir === 'expense'
                        ? 'var(--negative-soft)'
                        : 'var(--positive-soft)'
                      : 'var(--bg-subtle)',
                    color: active
                      ? dir === 'expense'
                        ? 'var(--negative)'
                        : 'var(--positive)'
                      : 'var(--text-secondary)',
                  }}
                >
                  {dir}
                </Button>
              );
            })}
          </div>

          <div>
            <Label className="mb-1 block text-label" style={{ color: 'var(--text-secondary)' }}>Schedule Name</Label>
            <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Rent, Spotify, Salary..." />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1 block text-label" style={{ color: 'var(--text-secondary)' }}>Amount ({baseCurrency})</Label>
              <Input required type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <Label className="mb-1 block text-label" style={{ color: 'var(--text-secondary)' }}>Start / Next Date</Label>
              <Input required type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
          </div>

          <div>
            <Label className="mb-1.5 block text-label" style={{ color: 'var(--text-secondary)' }}>Frequency</Label>
            <div className="grid grid-cols-5 gap-1.5">
              {(
                [
                  ['monthly', 'Monthly'],
                  ['biweekly', '2 Wks'],
                  ['weekly', 'Weekly'],
                  ['yearly', 'Yearly'],
                  ['once', 'Once'],
                ] as const
              ).map(([p, label]) => {
                const active = preset === p;
                return (
                  <Button
                    key={p}
                    type="button"
                    onClick={() => setPreset(p)}
                    className="rounded-xl py-2 text-label transition"
                    style={{
                      backgroundColor: active ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                      color: active ? 'var(--accent-text)' : 'var(--text-secondary)',
                      border: `1px solid ${active ? 'var(--accent-border)' : 'transparent'}`,
                    }}
                  >
                    {label}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="schedule-account" className="mb-1 block text-label" style={{ color: 'var(--text-secondary)' }}>Account</Label>
              <Select
                id="schedule-account"
                required
                value={accountId || null}
                onValueChange={setAccountId}
                placeholder="Select account…"
                options={accounts.map((a) => ({ value: a.id, label: a.name }))}
              />
            </div>
            <div>
              <Label className="mb-1 block text-label" style={{ color: 'var(--text-secondary)' }}>Payee</Label>
              <Input list="actual-payees-list" value={payeeName} onChange={(e) => setPayeeName(e.target.value)} placeholder="Type or pick payee" />
              <datalist id="actual-payees-list">
                {payees.map((p) => (
                  <option key={p.id} value={p.name} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="surface-subtle space-y-2.5 rounded-xl p-3.5">
            <Label className="flex cursor-pointer items-center justify-between text-label" style={{ color: 'var(--text-primary)' }}>
              <span>Auto-post transaction when due</span>
              <Input variant="unstyled" type="checkbox" checked={postsTransaction} onChange={(e) => setPostsTransaction(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
            </Label>
            {preset !== 'once' && (
              <Label className="flex cursor-pointer items-center justify-between text-label" style={{ color: 'var(--text-primary)' }}>
                <span>Move weekend due dates to Friday</span>
                <Input variant="unstyled" type="checkbox" checked={skipWeekend} onChange={(e) => setSkipWeekend(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
              </Label>
            )}
          </div>

          <Button type="submit" disabled={saving} variant="default" className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-body disabled:opacity-50">
            <CheckCircle2 className="h-4 w-4" />
            {saving ? 'Saving...' : editing ? 'Update Schedule' : 'Create Schedule'}
          </Button>
        </form>
      </Sheet>
    </div>
  );
}
