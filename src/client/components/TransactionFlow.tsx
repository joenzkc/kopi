import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, Check, ChevronDown, ChevronLeft, ChevronRight, CreditCard, Delete, Mail, Plus, Search, X } from 'lucide-react';
import type {
  ActualAccount,
  ActualCategory,
  ActualCategoryGroup,
  ActualPayee,
  EmailEventRecord,
  RecentTransaction,
} from '@shared/types';
import { apiFetch, formatMoney } from '../lib/api';
import { fetchRecent, friendlyDate, invalidateRecent, localISODate, senderLabel, shiftDays } from '../lib/recent';
import { Tile } from './Tile';
import { LinkPayeeSheet } from './LinkPayeeSheet';
import { Button } from '@client/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@client/components/ui/radio-group';
import { Switch, SwitchThumb } from '@client/components/ui/switch';
import { Toggle } from '@client/components/ui/toggle';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@client/components/ui/collapsible';
import { Input } from '@client/components/ui/input';
import { Label } from '@client/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@client/components/ui/native-select';
import { Alert } from '@client/components/ui/alert';

export type FlowKind = 'expense' | 'income' | 'transfer';
export type FlowRequest = { mode: 'add'; kind?: FlowKind } | { mode: 'review'; event: EmailEventRecord };

type Step = 'amount' | 'payee' | 'details' | 'category' | 'done';

interface TransactionFlowProps {
  request: FlowRequest;
  accounts: ActualAccount[];
  categories: ActualCategory[];
  categoryGroups: ActualCategoryGroup[];
  payees: ActualPayee[];
  baseCurrency: string;
  onClose: () => void;
  /** Called after anything is written to Actual or the inbox, so pages can refresh. */
  onChanged: (message: string) => void;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'] as const;

function displayAmount(raw: string): string {
  if (!raw) return '0';
  const [int, dec] = raw.split('.');
  const grouped = (int || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dec !== undefined ? `${grouped}.${dec}` : grouped;
}

/** Email text with web links made clickable (opened in a new tab, without passing Kopi's address along). */
function EmailText({ text }: { text: string }) {
  const parts = text.trim().split(/(https?:\/\/[^\s<>"]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="font-semibold underline" style={{ color: 'var(--accent-text)' }}>
            {part}
          </a>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}

function currencySymbol(currency: string): string {
  try {
    const parts = new Intl.NumberFormat('en-SG', { style: 'currency', currency }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value || currency;
  } catch {
    return currency;
  }
}

export function TransactionFlow({
  request,
  accounts,
  categories,
  categoryGroups,
  payees,
  baseCurrency,
  onClose,
  onChanged,
}: TransactionFlowProps) {
  const review = request.mode === 'review' ? request.event : null;
  const openAccounts = useMemo(() => accounts.filter((a) => !a.closed), [accounts]);
  const defaultAccountId = openAccounts.find((a) => !a.offbudget)?.id || openAccounts[0]?.id || '';
  const today = localISODate();

  const [step, setStep] = useState<Step>(review ? 'details' : 'amount');
  const [kind, setKind] = useState<FlowKind>(() => {
    if (review) {
      if (review.parsed?.transferAccountId) return 'transfer';
      return (review.parsed?.amountBase ?? -1) >= 0 ? 'income' : 'expense';
    }
    return request.mode === 'add' ? request.kind || 'expense' : 'expense';
  });
  const [amt, setAmt] = useState(() => {
    const v = review?.parsed?.amountBase;
    return v !== null && v !== undefined ? Math.abs(v).toFixed(2) : '';
  });
  const [payeeName, setPayeeName] = useState(() => review?.parsed?.payee || review?.subject || '');
  const [categoryId, setCategoryId] = useState(() => review?.parsed?.categoryId || '');
  const [suggested, setSuggested] = useState(Boolean(review?.parsed?.categoryId));
  // For an email from an unrecognised card, leave the account blank rather than guessing.
  const [accountId, setAccountId] = useState(() => (review ? review.parsed?.accountId || '' : defaultAccountId));
  const [toAccountId, setToAccountId] = useState(() => review?.parsed?.transferAccountId || '');
  const [remember, setRemember] = useState(true);
  const [linkOpen, setLinkOpen] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [date, setDate] = useState(() => review?.parsed?.date || review?.received_at.slice(0, 10) || today);
  const [notes, setNotes] = useState(() => review?.parsed?.notes || '');
  const [cleared, setCleared] = useState(true);
  const [query, setQuery] = useState('');
  const [catQuery, setCatQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentTransaction[]>([]);
  const [done, setDone] = useState<{ title: string; line1: string; line2: string; amount: string } | null>(null);
  const payeeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchRecent()
      .then(setRecent)
      .catch(() => setRecent([]));
  }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const n = Number.parseFloat(amt) || 0;
  const isTransfer = kind === 'transfer';
  const transferIncoming = Boolean(review && isTransfer && (review.parsed?.amount ?? -1) > 0);
  const signed = kind === 'income' || transferIncoming ? n : -n;
  const parsedRef = review?.parsed?.accountRef || null;
  const rememberLabel = parsedRef?.label || (review?.parsed?.alertKey ? `${senderLabel(review.parsed.originalSender || review.sender)} alerts like this` : null);
  const rawPayee = review?.parsed?.rawPayee || null;
  const sym = currencySymbol(baseCurrency);
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name || 'Account';
  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const catName = categoryId ? catMap.get(categoryId)?.name || 'Category' : 'Uncategorized';

  // --- keypad ---
  const press = useCallback((k: string) => {
    setAmt((a) => {
      if (k === 'back') return a.slice(0, -1);
      if (k === '.') return a.includes('.') ? a : (a || '0') + '.';
      const dot = a.indexOf('.');
      if (dot >= 0 && a.length - dot > 2) return a;
      if (a.replace('.', '').length >= 9) return a;
      if (a === '0') return k;
      return a + k;
    });
  }, []);

  const goFromAmount = useCallback(() => {
    if (n <= 0) return;
    if (review) setStep('details');
    else if (payeeName || (isTransfer && toAccountId)) setStep('details');
    else setStep('payee');
  }, [n, review, payeeName, isTransfer, toAccountId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (step !== 'amount') return;
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === '.' || e.key === ',') press('.');
      else if (e.key === 'Backspace') press('back');
      else if (e.key === 'Enter') goFromAmount();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, press, goFromAmount, onClose]);

  useEffect(() => {
    if (step === 'payee' && !isTransfer) payeeInputRef.current?.focus();
  }, [step, isTransfer]);

  // --- payee suggestions ---
  const lastCategoryFor = useCallback(
    (name: string): string => {
      const hit = recent.find((t) => !t.isTransfer && t.payeeName.toLowerCase() === name.toLowerCase() && t.category);
      if (hit?.category) return hit.category;
      const p = payees.find((x) => x.name.toLowerCase() === name.toLowerCase());
      return p?.category || '';
    },
    [recent, payees],
  );

  const payeeOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      const seen = new Set<string>();
      const out: Array<{ name: string; sub: string; colorKey: string | null }> = [];
      for (const t of recent) {
        if (t.isTransfer) continue;
        if (kind === 'income' ? t.amount <= 0 : t.amount >= 0) continue;
        const key = t.payeeName.toLowerCase();
        if (seen.has(key) || t.payeeName === 'Unknown') continue;
        seen.add(key);
        out.push({ name: t.payeeName, sub: t.categoryName ? `Usually ${t.categoryName}` : 'Recent', colorKey: t.categoryName });
        if (out.length >= 8) break;
      }
      return out;
    }
    return payees
      .filter((p) => !p.transfer_acct && p.name.toLowerCase().includes(q))
      .slice(0, 20)
      .map((p) => {
        const cid = lastCategoryFor(p.name);
        const cname = cid ? catMap.get(cid)?.name : null;
        return { name: p.name, sub: cname ? `Usually ${cname}` : 'Payee', colorKey: cname || null };
      });
  }, [query, recent, payees, kind, lastCategoryFor, catMap]);

  const exactPayee = payees.some((p) => p.name.toLowerCase() === query.trim().toLowerCase());

  function pickPayee(name: string) {
    const cid = lastCategoryFor(name);
    setPayeeName(name);
    setCategoryId(cid);
    setSuggested(Boolean(cid));
    setQuery('');
    setStep('details');
  }

  // --- category chips ---
  const quickCats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of recent) {
      if (!t.category || t.isTransfer) continue;
      if (kind === 'income' ? t.amount <= 0 : t.amount >= 0) continue;
      counts.set(t.category, (counts.get(t.category) || 0) + 1);
    }
    const ids = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    if (ids.length < 6) {
      for (const c of categories) {
        if (ids.length >= 6) break;
        if (Boolean(c.is_income) === (kind === 'income') && !ids.includes(c.id)) ids.push(c.id);
      }
    }
    const top = ids.filter((id) => catMap.has(id)).slice(0, 6);
    if (categoryId && !top.includes(categoryId) && catMap.has(categoryId)) top.unshift(categoryId);
    return top.slice(0, 7);
  }, [recent, categories, kind, categoryId, catMap]);

  const groupedCategories = useMemo(() => {
    const q = catQuery.trim().toLowerCase();
    const groups = categoryGroups.length
      ? categoryGroups.map((g) => ({
          id: g.id,
          name: g.name,
          isIncome: Boolean(g.is_income),
          cats: (g.categories && g.categories.length ? g.categories : categories.filter((c) => c.group_id === g.id)).filter(
            (c) => !c.hidden,
          ),
        }))
      : [{ id: 'all', name: 'Categories', isIncome: false, cats: categories }];
    return groups
      .map((g) => ({ ...g, cats: g.cats.filter((c) => !q || c.name.toLowerCase().includes(q)) }))
      .filter((g) => g.cats.length > 0)
      .sort((a, b) => (a.isIncome === (kind === 'income') ? -1 : 0) - (b.isIncome === (kind === 'income') ? -1 : 0));
  }, [categoryGroups, categories, catQuery, kind]);

  // --- save ---
  async function save() {
    setError(null);
    if (n <= 0) {
      setStep('amount');
      return;
    }
    if (!accountId) {
      setError(parsedRef ? `Pick which account ${parsedRef.label} belongs to.` : 'Pick an account first.');
      return;
    }
    if (isTransfer && !toAccountId) {
      setStep('payee');
      return;
    }
    if (!isTransfer && !payeeName.trim()) {
      setStep('payee');
      return;
    }
    setBusy(true);
    try {
      if (review) {
        await apiFetch(`/api/inbox/${review.id}/approve`, {
          method: 'POST',
          body: JSON.stringify({
            accountId,
            amount: signed,
            ...(isTransfer ? { transferAccountId: toAccountId } : { payee: payeeName.trim() }),
            categoryId: isTransfer ? null : categoryId || null,
            date,
            notes: notes.trim() || undefined,
            remember: Boolean(rememberLabel) && remember,
          }),
        });
      } else {
        await apiFetch('/api/transactions', {
          method: 'POST',
          body: JSON.stringify({
            accountId,
            amount: signed,
            ...(isTransfer ? { transferAccountId: toAccountId } : { payee: payeeName.trim() }),
            categoryId: isTransfer ? null : categoryId || null,
            date,
            notes: notes.trim() || undefined,
            cleared,
          }),
        });
      }
      invalidateRecent();
      const title = review ? 'Imported to Actual' : isTransfer ? 'Transfer recorded' : 'Added to Actual';
      const who = isTransfer ? `${accountName(accountId)} → ${accountName(toAccountId)}` : payeeName.trim();
      setDone({
        title,
        amount: isTransfer ? formatMoney(n, baseCurrency) : `${signed > 0 ? '+' : ''}${formatMoney(signed, baseCurrency)}`,
        line1: isTransfer ? who : `${who} · ${catName}`,
        line2: `${isTransfer ? 'From ' : ''}${accountName(accountId)} · ${friendlyDate(date)}${!review && !cleared ? ' · Uncleared' : ''}`,
      });
      setStep('done');
      onChanged(''); // the done screen already confirms it; no toast needed
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save to Actual');
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    if (!review) return;
    setBusy(true);
    try {
      await apiFetch(`/api/inbox/${review.id}/dismiss`, { method: 'POST' });
      onChanged('Dismissed');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dismiss failed');
    } finally {
      setBusy(false);
    }
  }

  function addAnother() {
    setKind('expense');
    setAmt('');
    setPayeeName('');
    setCategoryId('');
    setSuggested(false);
    setToAccountId('');
    setNotes('');
    setCleared(true);
    setDate(today);
    setDone(null);
    setError(null);
    setStep('amount');
  }

  function chooseKind(k: FlowKind) {
    if (k === kind) return;
    setKind(k);
    setCategoryId('');
    setSuggested(false);
    if (!review) setPayeeName('');
    setToAccountId('');
  }

  // --- small building blocks ---
  const iconBtn =
    'press flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition';
  const sectionLabel = 'px-1 text-xs font-bold';
  const kinds: Array<{ id: FlowKind; label: string }> = [
    { id: 'expense', label: 'Expense' },
    { id: 'income', label: 'Income' },
    { id: 'transfer', label: 'Transfer' },
  ];

  const header = (title: string, onBack: (() => void) | null, sub?: string) => (
    <header className="flex items-center gap-3 px-4 pb-2 pt-4 safe-pt">
      {onBack ? (
        <Button type="button" onClick={onBack} aria-label="Back" className={iconBtn} style={{ backgroundColor: 'var(--bg-surface)' }}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
      ) : (
        <Button type="button" onClick={onClose} aria-label="Close" className={iconBtn} style={{ backgroundColor: 'var(--bg-surface)' }}>
          <X className="h-5 w-5" />
        </Button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl font-extrabold tracking-tight">{title}</h1>
        {sub && (
          <p className="truncate text-sm tabular-nums" style={{ color: 'var(--text-muted)' }}>
            {sub}
          </p>
        )}
      </div>
      {onBack && (
        <Button type="button" onClick={onClose} aria-label="Close" className={iconBtn} style={{ color: 'var(--text-muted)' }}>
          <X className="h-5 w-5" />
        </Button>
      )}
    </header>
  );

  const chip = (on: boolean): React.CSSProperties => ({
    backgroundColor: on ? 'var(--accent)' : 'var(--bg-surface)',
    color: on ? 'var(--accent-fg)' : 'var(--text-primary)',
    borderColor: on ? 'var(--accent)' : 'var(--border-subtle)',
  });

  const amountSummary = isTransfer ? formatMoney(n, baseCurrency) : `${signed > 0 ? '+' : ''}${formatMoney(signed, baseCurrency)}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center md:items-center md:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={review ? 'Review email transaction' : 'New transaction'}
    >
      <div className="absolute inset-0 hidden bg-black/60 md:block" onClick={onClose} />
      <div
        className="rise-in relative flex h-full w-full flex-col overflow-hidden md:h-[min(860px,92dvh)] md:max-w-[440px] md:rounded-[28px] md:border"
        style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-primary)', borderColor: 'var(--border-subtle)' }}
      >
        {/* ---------- AMOUNT ---------- */}
        {step === 'amount' && (
          <div className="flex min-h-0 flex-1 flex-col">
            {header(review ? 'Edit amount' : 'New transaction', review || payeeName ? () => setStep('details') : null)}
            <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-5 safe-pb">
              <RadioGroup value={kind} onValueChange={(value) => chooseKind(value as FlowKind)} aria-label="Transaction type" className="grid gap-1 rounded-2xl p-1" style={{ gridTemplateColumns: `repeat(${kinds.length}, minmax(0, 1fr))`, backgroundColor: 'var(--bg-surface)' }}>
                {kinds.map((k) => {
                  const on = kind === k.id;
                  return (
                    <RadioGroupItem
                      key={k.id}
                      value={k.id}
                      className="h-10 rounded-xl text-sm font-bold transition"
                      style={{ backgroundColor: on ? 'var(--accent)' : 'transparent', color: on ? 'var(--accent-fg)' : 'var(--text-muted)' }}
                    >
                      {k.label}
                    </RadioGroupItem>
                  );
                })}
              </RadioGroup>

              <div className="flex min-h-[140px] flex-1 flex-col items-center justify-center gap-4">
                <span className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {kind === 'income' ? 'Received' : isTransfer ? 'Moving' : 'Spent'}
                </span>
                <div
                  aria-live="polite"
                  className="flex max-w-full items-baseline gap-1 tabular-nums"
                  style={{ color: kind === 'income' ? 'var(--positive)' : 'var(--text-primary)' }}
                >
                  <span className="text-2xl font-bold">
                    {kind === 'income' ? '+' : kind === 'expense' ? '−' : ''}
                    {sym}
                  </span>
                  <span className="truncate text-6xl font-extrabold tracking-tight">{displayAmount(amt)}</span>
                </div>
                <Label
                  className="relative flex h-10 items-center gap-1.5 rounded-full border pl-4 pr-3 text-sm font-semibold"
                  style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
                >
                  <span style={{ color: 'var(--text-muted)' }}>{kind === 'income' ? 'Into' : 'From'}</span>
                  <span>{accountName(accountId)}</span>
                  <ChevronDown className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
                  <NativeSelect
                    variant="unstyled"
                    aria-label={kind === 'income' ? 'Into account' : 'From account'}
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    className="absolute inset-0 cursor-pointer opacity-0"
                  >
                    {openAccounts.map((a) => (
                      <NativeSelectOption key={a.id} value={a.id}>
                        {a.name}
                        {a.offbudget ? ' (off budget)' : ''}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Label>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {KEYS.map((k) => (
                  <Button
                    key={k}
                    type="button"
                    onClick={() => press(k)}
                    aria-label={k === 'back' ? 'Delete digit' : k === '.' ? 'Decimal point' : k}
                    className="press flex h-14 items-center justify-center rounded-2xl text-2xl font-bold tabular-nums transition"
                    style={{ backgroundColor: 'var(--bg-surface)' }}
                  >
                    {k === 'back' ? <Delete className="h-6 w-6" /> : k}
                  </Button>
                ))}
              </div>
              <Button
                type="button"
                onClick={goFromAmount}
                disabled={n <= 0}
                variant="default" className="h-14 rounded-2xl text-base disabled:opacity-40"
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {/* ---------- PAYEE / DESTINATION ---------- */}
        {step === 'payee' && (
          <div className="flex min-h-0 flex-1 flex-col">
            {header(
              isTransfer ? 'Move to which account?' : kind === 'income' ? 'Who paid you?' : 'Who was it?',
              () => setStep(review || payeeName || toAccountId ? 'details' : 'amount'),
              amountSummary,
            )}
            <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-5 safe-pb">
              {!isTransfer && (
                <Label
                  className="flex h-12 items-center gap-2 rounded-2xl border-2 px-3.5"
                  style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--accent-text)', color: 'var(--text-muted)' }}
                >
                  <Search className="h-4 w-4 shrink-0" />
                  <Input
                    variant="unstyled"
                    ref={payeeInputRef}
                    aria-label="Payee"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      e.preventDefault();
                      const q = query.trim();
                      if (!q) return;
                      const match = payees.find((p) => !p.transfer_acct && p.name.toLowerCase() === q.toLowerCase());
                      pickPayee(match ? match.name : q);
                    }}
                    placeholder="Search or type a new payee"
                    className="h-full flex-1 bg-transparent text-[15px] outline-none"
                    style={{ color: 'var(--text-primary)' }}
                  />
                </Label>
              )}
              <span className={sectionLabel} style={{ color: 'var(--text-muted)' }}>
                {isTransfer ? 'Your accounts' : query.trim() ? 'Matches' : 'Recent payees'}
              </span>
              <div className="no-scrollbar -mx-1 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-1">
                {!isTransfer && query.trim() && !exactPayee && (
                  <Button
                    type="button"
                    onClick={() => pickPayee(query.trim())}
                    className="press flex w-full items-center gap-3 rounded-2xl border border-dashed p-3 text-left text-[15px] font-bold"
                    style={{ borderColor: 'var(--accent-text)', backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)' }}
                  >
                    <Plus className="h-5 w-5" />
                    Create “{query.trim()}”
                  </Button>
                )}
                {isTransfer
                  ? openAccounts
                      .filter((a) => a.id !== accountId)
                      .map((a) => (
                        <Button
                          key={a.id}
                          type="button"
                          onClick={() => {
                            setToAccountId(a.id);
                            setStep('details');
                          }}
                          className="press flex w-full items-center gap-3 rounded-2xl border p-2.5 text-left"
                          style={{ backgroundColor: 'var(--bg-surface)', borderColor: a.id === toAccountId ? 'var(--accent-text)' : 'var(--border-subtle)' }}
                        >
                          <Tile colorKey={a.name} label={a.name} size={40} />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-[15px] font-bold">{a.name}</span>
                            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                              {a.offbudget ? 'Off budget' : 'Budget account'} · {formatMoney((a.workingBalance ?? 0) / 100, baseCurrency)}
                            </span>
                          </span>
                          <ChevronRight className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
                        </Button>
                      ))
                  : payeeOptions.map((p) => (
                      <Button
                        key={p.name}
                        type="button"
                        onClick={() => pickPayee(p.name)}
                        className="press flex w-full items-center gap-3 rounded-2xl border p-2.5 text-left"
                        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
                      >
                        <Tile colorKey={p.colorKey} label={p.name} size={40} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-[15px] font-bold">{p.name}</span>
                          <span className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                            {p.sub}
                          </span>
                        </span>
                        <ChevronRight className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
                      </Button>
                    ))}
                {!isTransfer && !query.trim() && payeeOptions.length === 0 && (
                  <p className="px-1 py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                    Type a payee name to search or create one.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ---------- DETAILS ---------- */}
        {step === 'details' && (
          <div className="flex min-h-0 flex-1 flex-col">
            {header(review ? 'Review import' : 'Details', review ? null : () => setStep('payee'))}
            <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6">
              {review && (
                <div className="flex flex-col gap-2 rounded-3xl p-4" style={{ backgroundColor: 'var(--accent-soft)' }}>
                  <span className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--accent-text)' }}>
                    <Mail className="h-4 w-4" />
                    <span className="truncate">{review.sender ? senderLabel(review.sender) : review.source}</span>
                    {review.parsed && (
                      <span className="ml-auto shrink-0 text-xs">{Math.round(review.parsed.confidence * 100)}% match</span>
                    )}
                  </span>
                  {parsedRef && (
                    <span className="flex flex-wrap items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      <CreditCard className="h-3.5 w-3.5" />
                      <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{parsedRef.label}</span>
                      {review.parsed?.accountSource === 'link' && review.parsed.accountId
                        ? `· linked to ${accountName(review.parsed.accountId)}`
                        : '· new: pick its account below'}
                    </span>
                  )}
                  {review.parsed?.fxEstimated && review.parsed.amount !== null && (
                    <span className="text-xs" style={{ color: 'var(--warning)' }}>
                      {review.parsed.currency} {Math.abs(review.parsed.amount).toLocaleString('en-SG')} converted at today’s rate. Adjust the amount if your statement differs.
                    </span>
                  )}
                  {review.parsed?.counterRef && !isTransfer && (
                    <Button
                      type="button"
                      onClick={() => chooseKind('transfer')}
                      className="flex items-center gap-1.5 self-start text-xs font-bold"
                      style={{ color: 'var(--accent-text)' }}
                    >
                      <ArrowLeftRight className="h-3.5 w-3.5" />
                      Other side is {review.parsed.counterRef.label}. Is it one of your accounts? Make it a transfer
                    </Button>
                  )}
                  {review.parsed?.matchedRuleName && (
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      Rule: {review.parsed.matchedRuleName}
                    </span>
                  )}
                  {review.body_text && (
                    <Collapsible open={showEmail} onOpenChange={setShowEmail} className="flex flex-col gap-1.5">
                      {showEmail ? (
                        <CollapsibleContent
                          className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-2xl p-3 text-xs leading-relaxed [overflow-wrap:anywhere]"
                          style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-secondary)' }}
                        >
                          {review.subject && (
                            <div className="mb-2 font-bold" style={{ color: 'var(--text-primary)' }}>
                              {review.subject}
                            </div>
                          )}
                          <EmailText text={review.body_text} />
                        </CollapsibleContent>
                      ) : (
                        <p className="line-clamp-3 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                          “{review.body_text.replace(/\s+/g, ' ').trim().slice(0, 240)}”
                        </p>
                      )}
                      <CollapsibleTrigger
                        className="flex items-center gap-1 self-start text-xs font-bold"
                        style={{ color: 'var(--accent-text)' }}
                      >
                        <ChevronDown className="h-3.5 w-3.5 transition-transform" style={{ transform: showEmail ? 'rotate(180deg)' : 'none' }} />
                        {showEmail ? 'Hide full email' : 'Show full email'}
                      </CollapsibleTrigger>
                    </Collapsible>
                  )}
                  {review.error && (
                    <p className="text-xs font-semibold" style={{ color: 'var(--negative)' }}>
                      {review.error}
                    </p>
                  )}
                </div>
              )}

              <div className="flex items-stretch gap-2">
                <Button
                  type="button"
                  onClick={() => setStep('payee')}
                  className="press flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-3xl border p-4 text-left"
                  style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
                >
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                    {isTransfer ? 'Transfer to' : kind === 'income' ? 'From' : 'Paid to'}
                  </span>
                  <span className="w-full truncate text-lg font-extrabold">
                    {isTransfer ? (toAccountId ? accountName(toAccountId) : 'Pick account') : payeeName || 'Add payee'}
                  </span>
                  {!isTransfer && review?.parsed?.payeeFromRule && rawPayee && payeeName === review.parsed.payee && (
                    <span className="w-full truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                      Renamed by your Actual rule from “{rawPayee}”
                    </span>
                  )}
                </Button>
                <Button
                  type="button"
                  onClick={() => setStep('amount')}
                  className="press flex shrink-0 flex-col items-end justify-center gap-0.5 rounded-3xl border px-4 text-right"
                  style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
                  aria-label={`Amount ${amountSummary}, tap to edit`}
                >
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                    {kind === 'income' ? 'Income' : isTransfer ? 'Amount' : 'Expense'}
                  </span>
                  <span
                    className="text-lg font-extrabold tabular-nums"
                    style={{ color: kind === 'income' ? 'var(--positive)' : 'var(--text-primary)' }}
                  >
                    {n > 0 ? amountSummary : 'Add amount'}
                  </span>
                </Button>
              </div>
              {review && n <= 0 && (
                <p className="-mt-2 px-1 text-xs" style={{ color: 'var(--warning)' }}>
                  No amount found in this email. If it isn’t a transaction, Dismiss it.
                </p>
              )}

              {!isTransfer && review && rawPayee && !review.parsed?.payeeFromRule && (
                <Button
                  type="button"
                  onClick={() => setLinkOpen(true)}
                  className="-mt-2 self-start px-1 text-xs font-bold"
                  style={{ color: 'var(--accent-text)' }}
                >
                  Always rename “{rawPayee}” to an existing payee…
                </Button>
              )}

              {!isTransfer && (
                <section className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between">
                    <h2 className={sectionLabel} style={{ color: 'var(--text-muted)' }}>
                      Category
                    </h2>
                    {suggested && categoryId && (
                      <span className="text-xs font-semibold" style={{ color: 'var(--accent-text)' }}>
                        {review && categoryId === (review.parsed?.categoryId || '') ? 'From email' : 'Suggested from payee'}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {quickCats.map((id) => {
                      const on = id === categoryId;
                      return (
                        <Toggle
                          key={id}
                          pressed={on}
                          onPressedChange={(pressed) => {
                            setCategoryId(pressed ? id : '');
                            setSuggested(false);
                          }}
                          className="press h-10 rounded-xl border px-3 text-sm font-bold"
                          style={chip(on)}
                        >
                          {catMap.get(id)?.name}
                        </Toggle>
                      );
                    })}
                    <Button
                      type="button"
                      onClick={() => setStep('category')}
                      className="press flex h-10 items-center gap-1 rounded-xl border px-3 text-sm font-bold"
                      style={{ borderColor: 'var(--border-subtle)', color: 'var(--accent-text)' }}
                    >
                      All categories
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </section>
              )}
              {isTransfer && (
                <p className="px-1 text-sm" style={{ color: 'var(--text-muted)' }}>
                  Moving money between your own accounts needs no category. Actual creates the matching entry in{' '}
                  {toAccountId ? accountName(toAccountId) : 'the other account'}.
                </p>
              )}

              <section
                className="flex flex-col rounded-3xl border px-4"
                style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
              >
                <Label className="relative flex min-h-[54px] items-center justify-between gap-3">
                  <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    {kind === 'income' ? 'Into account' : isTransfer ? 'From account' : 'Account'}
                  </span>
                  <span className="flex min-w-0 items-center gap-1 text-sm font-bold" style={{ color: accountId ? undefined : 'var(--accent-text)' }}>
                    <span className="truncate">{accountId ? accountName(accountId) : 'Choose account'}</span>
                    <ChevronDown className="h-4 w-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
                  </span>
                  <NativeSelect
                    variant="unstyled"
                    aria-label="Account"
                    value={accountId}
                    onChange={(e) => {
                      setAccountId(e.target.value);
                      if (e.target.value === toAccountId) setToAccountId('');
                    }}
                    className="absolute inset-0 cursor-pointer opacity-0"
                  >
                    {!accountId && <NativeSelectOption value="">Choose an account…</NativeSelectOption>}
                    {openAccounts.map((a) => (
                      <NativeSelectOption key={a.id} value={a.id}>
                        {a.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Label>
                {review && rememberLabel && accountId && (
                  <Label className="flex items-center gap-2.5 border-t py-3 text-xs" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                    <Input
                      variant="unstyled"
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                      className="h-[18px] w-[18px] shrink-0"
                      style={{ accentColor: 'var(--accent)' }}
                    />
                    <span>
                      Remember: <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{rememberLabel}</span> → {accountName(accountId)}
                    </span>
                  </Label>
                )}
                <div className="flex min-h-[54px] flex-wrap items-center justify-between gap-2 border-t py-2" style={{ borderColor: 'var(--border-subtle)' }}>
                  <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    Date
                  </span>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {[today, shiftDays(today, -1)].map((d) => {
                      const on = d === date;
                      return (
                        <Toggle
                          key={d}
                          pressed={on}
                          onPressedChange={() => setDate(d)}
                          className="press h-9 rounded-xl border px-3 text-xs font-bold"
                          style={chip(on)}
                        >
                          {friendlyDate(d)}
                        </Toggle>
                      );
                    })}
                    <Label
                      className="relative flex h-9 items-center rounded-xl border px-3 text-xs font-bold"
                      style={chip(date !== today && date !== shiftDays(today, -1))}
                    >
                      {date !== today && date !== shiftDays(today, -1) ? friendlyDate(date) : 'Other'}
                      <Input
                        variant="unstyled"
                        type="date"
                        aria-label="Pick a date"
                        value={date}
                        max={today}
                        onChange={(e) => e.target.value && setDate(e.target.value)}
                        className="absolute inset-0 cursor-pointer opacity-0"
                      />
                    </Label>
                  </div>
                </div>
                <Label className="flex min-h-[54px] items-center justify-between gap-3 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    Notes
                  </span>
                  <Input
                    variant="unstyled"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Optional"
                    maxLength={500}
                    className="min-w-0 flex-1 bg-transparent text-right text-sm outline-none"
                  />
                </Label>
                {!review && (
                  <Switch
                    checked={cleared}
                    onCheckedChange={setCleared}
                    className="flex min-h-[54px] items-center justify-between border-t text-sm"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <span style={{ color: 'var(--text-muted)' }}>Cleared</span>
                    <SwitchThumb />
                  </Switch>
                )}
              </section>
            </div>
            <div className="flex flex-col gap-2 border-t px-4 pt-3 safe-pb" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-canvas)' }}>
              {error && (
                <Alert as="p" variant="destructive">
                  {error}
                </Alert>
              )}
              <div className="flex gap-2">
                {review && (
                  <Button type="button" onClick={() => void dismiss()} disabled={busy} variant="secondary" className="h-14 flex-1 rounded-2xl text-[15px] font-bold disabled:opacity-50">
                    Dismiss
                  </Button>
                )}
                <Button type="button" onClick={() => void save()} disabled={busy} variant="default" className="h-14 flex-[2] rounded-2xl text-base disabled:opacity-50">
                  {busy ? 'Saving…' : review ? 'Import to Actual' : 'Add to Actual'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ---------- CATEGORY PICKER ---------- */}
        {step === 'category' && (
          <div className="flex min-h-0 flex-1 flex-col">
            {header('Category', () => setStep('details'))}
            <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-5 safe-pb">
              <Label
                className="flex h-12 items-center gap-2 rounded-2xl border px-3.5"
                style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
              >
                <Search className="h-4 w-4 shrink-0" />
                <Input
                  variant="unstyled"
                  autoFocus
                  aria-label="Search categories"
                  value={catQuery}
                  onChange={(e) => setCatQuery(e.target.value)}
                  placeholder="Search categories"
                  className="h-full flex-1 bg-transparent text-[15px] outline-none"
                  style={{ color: 'var(--text-primary)' }}
                />
              </Label>
              <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
                <Button
                  type="button"
                  onClick={() => {
                    setCategoryId('');
                    setSuggested(false);
                    setStep('details');
                  }}
                  className="press flex items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm font-bold"
                  style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
                >
                  Uncategorized
                  {!categoryId && <Check className="h-4 w-4" style={{ color: 'var(--accent-text)' }} />}
                </Button>
                {groupedCategories.map((g) => (
                  <section key={g.id} className="flex flex-col gap-1.5">
                    <h2 className={sectionLabel} style={{ color: 'var(--text-muted)' }}>
                      {g.name}
                    </h2>
                    <div className="flex flex-col overflow-hidden rounded-2xl border" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
                      {g.cats.map((c, i) => (
                        <Button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setCategoryId(c.id);
                            setSuggested(false);
                            setStep('details');
                          }}
                          className="flex min-h-[50px] items-center gap-3 px-3 text-left text-sm font-semibold transition hover:opacity-90"
                          style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)' }}
                        >
                          <Tile colorKey={c.name} label={c.name} size={30} />
                          <span className="flex-1 truncate">{c.name}</span>
                          {c.id === categoryId && <Check className="h-4 w-4" style={{ color: 'var(--accent-text)' }} />}
                        </Button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </div>
        )}

        {review && rawPayee && (
          <LinkPayeeSheet
            open={linkOpen}
            onClose={() => setLinkOpen(false)}
            raw={rawPayee}
            payees={payees}
            onLinked={({ targetName }) => {
              if (targetName) setPayeeName(targetName);
              onChanged(`Future “${rawPayee}” will be saved as “${targetName}”`);
            }}
          />
        )}

        {/* ---------- DONE ---------- */}
        {step === 'done' && done && (
          <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center safe-pb">
            <span className="flex h-20 w-20 items-center justify-center rounded-full" style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}>
              <Check className="h-10 w-10" strokeWidth={2.6} />
            </span>
            <h1 className="text-2xl font-extrabold tracking-tight">{done.title}</h1>
            <div className="flex flex-col gap-1">
              <span
                className="text-3xl font-extrabold tabular-nums"
                style={{ color: kind === 'income' ? 'var(--positive)' : 'var(--text-primary)' }}
              >
                {done.amount}
              </span>
              <span className="text-[15px] font-bold">{done.line1}</span>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {done.line2}
              </span>
            </div>
            <div className="mt-3 flex w-full gap-2">
              {!review && (
                <Button type="button" onClick={addAnother} variant="secondary" className="h-14 flex-1 rounded-2xl text-[15px] font-bold">
                  Add another
                </Button>
              )}
              <Button type="button" onClick={onClose} variant="default" className="h-14 flex-1 rounded-2xl text-base">
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
