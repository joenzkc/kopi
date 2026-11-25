import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, CreditCard, Delete, Link2, Mail, MoreHorizontal, Pencil, Plus, Search, X } from 'lucide-react';
import type {
  ActualAccount,
  ActualCategory,
  ActualCategoryGroup,
  ActualPayee,
  EmailEventRecord,
  RecentTransaction,
} from '@shared/types';
import { apiFetch } from '../lib/api';
import { HIDDEN_VALUE, useFinancialValues } from '../lib/valueVisibility';
import { ValueVisibilityButton } from './ValueVisibilityButton';
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
import { Select } from '@client/components/ui/select';
import { Menu } from '@client/components/ui/menu';
import { Alert } from '@client/components/ui/alert';
import { Dialog } from '@base-ui/react/dialog';

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

  const { valuesHidden, formatMoney, formatSignedMoney } = useFinancialValues();
  const [step, setStep] = useState<Step>(review ? 'details' : 'amount');
  const [direction, setDirection] = useState<'expense' | 'income'>(() => {
    if (review) {
      const amount = review.parsed?.amountBase ?? review.parsed?.amount;
      if (!amount) return review.parsed?.direction || 'expense';
      return amount > 0 ? 'income' : 'expense';
    }
    return request.mode === 'add' && request.kind === 'income' ? 'income' : 'expense';
  });
  const [isTransfer, setIsTransfer] = useState(() =>
    request.mode === 'review' ? Boolean(request.event.parsed?.transferAccountId) : request.kind === 'transfer',
  );
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
  const [done, setDone] = useState<{ title: string; line1: string; line2: string } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const payeeInputRef = useRef<HTMLInputElement>(null);
  const linkPayeeOpenerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    fetchRecent()
      .then(setRecent)
      .catch(() => setRecent([]));
  }, []);

  const n = Number.parseFloat(amt) || 0;
  const kind: FlowKind = isTransfer ? 'transfer' : direction;
  const incomingReview = Boolean(review && direction === 'income');
  const transferIncoming = isTransfer && incomingReview;
  const pickingTransferAccount = isTransfer;
  const transferAccounts = openAccounts.filter((a) => a.id !== accountId);
  const accountOptions = openAccounts.map((a) => ({ value: a.id, label: a.name, hint: a.offbudget ? 'Off budget' : undefined }));
  const transferOptions = transferAccounts.map((a) => ({ value: a.id, label: a.name, hint: a.offbudget ? 'Off budget' : undefined }));
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

  function handleAmountKey(e: React.KeyboardEvent) {
    if (step !== 'amount' || (review && valuesHidden) || e.defaultPrevented || e.nativeEvent.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target;
    if (!(target instanceof HTMLElement) || target.isContentEditable || target.closest('input, textarea, select')) return;

    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === '.' || e.key === ',') press('.');
    else if (e.key === 'Backspace') press('back');
    else if (e.key === 'Enter' && !target.closest('button, a, [role="button"]')) goFromAmount();
    else return;
    e.preventDefault();
  }

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (step === 'amount' && dialog && document.activeElement === document.body) {
      dialog.focus({ preventScroll: true });
    }
  }, [step]);

  useEffect(() => {
    if (step === 'payee' && !pickingTransferAccount) payeeInputRef.current?.focus();
  }, [step, pickingTransferAccount]);

  useLayoutEffect(() => {
    if (!linkOpen) return;
    // Return to the parent dialog before the next keystroke when the child closes.
    return () => linkPayeeOpenerRef.current?.focus({ preventScroll: true });
  }, [linkOpen]);

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
    if (busy) return;
    setError(null);
    if (n <= 0) {
      setStep('amount');
      return;
    }
    if (!accountId) {
      setError(parsedRef ? `Pick which account ${parsedRef.label} belongs to.` : 'Pick an account first.');
      return;
    }
    if (isTransfer && !transferAccounts.some((a) => a.id === toAccountId)) {
      // Review picks the other account in the details card; the add flow uses the account list.
      if (review) setError(transferIncoming ? 'Choose the account this transfer came from.' : 'Choose the account this transfer goes to.');
      else setStep('payee');
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
      const who = isTransfer
        ? `${accountName(transferIncoming ? toAccountId : accountId)} → ${accountName(transferIncoming ? accountId : toAccountId)}`
        : payeeName.trim();
      setDone({
        title,
        line1: isTransfer ? who : `${who} · ${catName}`,
        line2: `${isTransfer ? '' : accountName(accountId) + ' · '}${friendlyDate(date)}${!review && !cleared ? ' · Uncleared' : ''}`,
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
    setDirection('expense');
    setIsTransfer(false);
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
    setIsTransfer(k === 'transfer');
    if (!review || (k !== 'transfer' && k !== direction)) {
      setCategoryId('');
      setSuggested(false);
    }
    if (k !== 'transfer') setDirection(k);
    if (!review) {
      setPayeeName('');
      setToAccountId('');
    }
  }

  function selectAccount(id: string) {
    setAccountId(id);
    if (id === toAccountId) setToAccountId('');
  }

  // --- small building blocks ---
  const iconBtn =
    'press flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition';
  const sectionLabel = 'px-1 text-label';
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
        <Dialog.Close
          render={
            <Button type="button" aria-label="Close" className={iconBtn} style={{ backgroundColor: 'var(--bg-surface)' }}>
            <X className="h-5 w-5" />
          </Button>
          }
        />
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-heading">{title}</h1>
        {sub && (
          <p className="truncate text-body tabular-nums" style={{ color: 'var(--text-muted)' }}>
            {sub}
          </p>
        )}
      </div>
      <ValueVisibilityButton />
      {onBack && (
        <Dialog.Close
          render={
            <Button type="button" aria-label="Close" className={iconBtn} style={{ color: 'var(--text-muted)' }}>
            <X className="h-5 w-5" />
          </Button>
          }
        />
      )}
    </header>
  );

  const chip = (on: boolean): React.CSSProperties => ({
    backgroundColor: on ? 'var(--accent)' : 'var(--bg-surface)',
    color: on ? 'var(--accent-fg)' : 'var(--text-primary)',
    borderColor: on ? 'var(--accent)' : 'var(--border-subtle)',
  });

  /** Segmented type control, shared by the keypad and the review screen. */
  const kindControl = (options: Array<{ id: FlowKind; label: string }>) => (
    <RadioGroup
      value={kind}
      onValueChange={(value) => chooseKind(value as FlowKind)}
      aria-label="Transaction type"
      className="grid shrink-0 gap-1 rounded-2xl p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`, backgroundColor: 'var(--bg-surface)' }}
    >
      {options.map((k) => {
        const on = kind === k.id;
        return (
          <RadioGroupItem
            key={k.id}
            value={k.id}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.altKey && !event.ctrlKey && !event.metaKey) {
                event.preventDefault();
                event.currentTarget.click();
              }
            }}
            className="h-10 rounded-xl text-label transition-colors duration-150"
            style={{ backgroundColor: on ? 'var(--accent)' : 'transparent', color: on ? 'var(--accent-fg)' : 'var(--text-muted)' }}
          >
            {k.label}
          </RadioGroupItem>
        );
      })}
    </RadioGroup>
  );
  // Review: an email is either a payment in one direction or a move between your own accounts.
  const reviewKinds: Array<{ id: FlowKind; label: string }> = [
    { id: direction, label: direction === 'income' ? 'Income' : 'Expense' },
    { id: 'transfer', label: 'Transfer' },
  ];
  const reviewTransfer = Boolean(review) && isTransfer;
  const showPayeeMenu = Boolean(review && !isTransfer && rawPayee && !review.parsed?.payeeFromRule);
  const accountLabel = kind === 'income' || transferIncoming ? 'Into account' : isTransfer ? 'From account' : 'Account';

  const amountSummary = isTransfer ? formatMoney(n, baseCurrency) : formatSignedMoney(signed, baseCurrency);
  const transferAction = incomingReview ? 'Transfer from account' : 'Transfer to account';
  const intoAccount = kind === 'income' || transferIncoming;
  const dialogTitle = review ? 'Review email transaction' : 'New transaction';
  const visibleStep = review && valuesHidden ? 'privateReview' : step;

  const panel = (
    <Dialog.Portal>
      <Dialog.Backdrop className="fixed inset-0 z-50 hidden bg-black/60 md:block" />
      <Dialog.Viewport className="fixed inset-0 z-50 flex items-stretch justify-center md:items-center md:p-6">
      <Dialog.Popup
        ref={dialogRef}
        // Focus the panel itself (not the first field) so opening the flow doesn't summon a touch keyboard.
        initialFocus={dialogRef}
        onKeyDown={handleAmountKey}
        aria-label={dialogTitle}
        className="rise-in relative flex h-full w-full flex-col overflow-hidden md:h-[min(860px,92dvh)] md:max-w-[440px] md:rounded-[28px] md:border"
        style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-primary)', borderColor: 'var(--border-subtle)' }}
      >
        <Dialog.Title className="sr-only">{dialogTitle}</Dialog.Title>
        {/* ---------- AMOUNT ---------- */}
        {visibleStep === 'privateReview' && header('Review import', null, 'Show financial values to review this email.')}
        {visibleStep === 'amount' && (
          <div className="flex min-h-0 flex-1 flex-col">
            {header(review ? 'Edit amount' : 'New transaction', review || payeeName ? () => setStep('details') : null)}
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-5 safe-pb">
              {kindControl(kinds)}

              <div className="flex min-h-[140px] flex-1 flex-col items-center justify-center gap-4">
                <span className="text-label" style={{ color: 'var(--text-muted)' }}>
                  {kind === 'income' ? 'Received' : isTransfer ? 'Moving' : 'Spent'}
                </span>
                <div
                  aria-live="polite"
                  className="flex max-w-full items-baseline gap-1 tabular-nums"
                  style={{ color: kind === 'income' ? 'var(--positive)' : 'var(--text-primary)' }}
                >
                  <span className="text-title">
                    {kind === 'income' ? '+' : kind === 'expense' ? '−' : ''}
                    {sym}
                  </span>
                  <span className="truncate text-entry">{valuesHidden ? HIDDEN_VALUE : displayAmount(amt)}</span>
                </div>
                <Select
                  variant="inline"
                  aria-label={intoAccount ? 'Into account' : 'From account'}
                  value={accountId || null}
                  onValueChange={selectAccount}
                  options={accountOptions}
                  placeholder="Choose account"
                  prefix={<span style={{ color: 'var(--text-muted)' }}>{intoAccount ? 'Into' : 'From'}</span>}
                  className="mx-0 h-10 max-w-full justify-center gap-1.5 rounded-full bg-[var(--bg-surface)] pl-4 pr-3 text-label font-semibold"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                {KEYS.map((k) => (
                  <Button
                    key={k}
                    type="button"
                    onClick={() => press(k)}
                    aria-label={k === 'back' ? 'Delete digit' : k === '.' ? 'Decimal point' : k}
                    className="press flex h-14 items-center justify-center rounded-2xl text-stat tabular-nums transition"
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
                variant="default" className="h-14 shrink-0 rounded-2xl text-body disabled:opacity-40"
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {/* ---------- PAYEE / DESTINATION ---------- */}
        {visibleStep === 'payee' && (
          <div className="flex min-h-0 flex-1 flex-col">
            {header(
              pickingTransferAccount ? transferAction : kind === 'income' ? 'Who paid you?' : 'Who was it?',
              () => setStep(review || payeeName || toAccountId ? 'details' : 'amount'),
              amountSummary,
            )}
            <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-5 safe-pb">
              {!pickingTransferAccount && (
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
                    className="h-full flex-1 bg-transparent text-body outline-none"
                    style={{ color: 'var(--text-primary)' }}
                  />
                </Label>
              )}
              <span className={sectionLabel} style={{ color: 'var(--text-muted)' }}>
                {pickingTransferAccount ? review?.parsed?.counterRef?.label || 'Your accounts' : query.trim() ? 'Matches' : 'Recent payees'}
              </span>
              <div className="no-scrollbar -mx-1 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-1">
                {!pickingTransferAccount && query.trim() && !exactPayee && (
                  <Button
                    type="button"
                    onClick={() => pickPayee(query.trim())}
                    className="press flex w-full items-center gap-3 rounded-2xl border border-dashed p-3 text-left text-body"
                    style={{ borderColor: 'var(--accent-text)', backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)' }}
                  >
                    <Plus className="h-5 w-5" />
                    Create “{query.trim()}”
                  </Button>
                )}
                {pickingTransferAccount
                  ? transferAccounts.map((a) => (
                      <Button
                        key={a.id}
                        type="button"
                        onClick={() => {
                          chooseKind('transfer');
                          setToAccountId(a.id);
                          setStep('details');
                        }}
                        className="press flex w-full items-center gap-3 rounded-2xl border p-2.5 text-left"
                        style={{ backgroundColor: 'var(--bg-surface)', borderColor: a.id === toAccountId ? 'var(--accent-text)' : 'var(--border-subtle)' }}
                      >
                        <Tile colorKey={a.name} label={a.name} size={40} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-body">{a.name}</span>
                          <span className="text-caption tabular-nums" style={{ color: 'var(--text-muted)' }}>
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
                          <span className="truncate text-body">{p.name}</span>
                          <span className="truncate text-caption" style={{ color: 'var(--text-muted)' }}>
                            {p.sub}
                          </span>
                        </span>
                        <ChevronRight className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
                      </Button>
                    ))}
                {pickingTransferAccount && transferAccounts.length === 0 && (
                  <p className="px-1 py-6 text-center text-body" style={{ color: 'var(--text-muted)' }}>
                    A transfer needs two open accounts.
                  </p>
                )}
                {!pickingTransferAccount && !query.trim() && payeeOptions.length === 0 && (
                  <p className="px-1 py-6 text-center text-body" style={{ color: 'var(--text-muted)' }}>
                    Type a payee name to search or create one.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ---------- DETAILS ---------- */}
        {visibleStep === 'details' && (
          <div className="flex min-h-0 flex-1 flex-col">
            {header(review ? 'Review import' : 'Details', review ? null : () => setStep('payee'))}
            <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6">
              {review && kindControl(reviewKinds)}

              {review && (
                <Collapsible
                  open={showEmail}
                  onOpenChange={setShowEmail}
                  className="flex flex-col gap-1 rounded-3xl px-4 pb-3 pt-1.5"
                  style={{ backgroundColor: 'var(--bg-surface)' }}
                >
                  {(() => {
                    const summary = (
                      <>
                        <Mail className="h-4 w-4 shrink-0" style={{ color: 'var(--accent-text)' }} />
                        <span className="min-w-0 flex-1 truncate text-body font-semibold">
                          {parsedRef?.label.split(' ')[0] || (review.sender ? senderLabel(review.parsed?.originalSender || review.sender) : review.source)}
                        </span>
                        {review.parsed && (
                          <span className="shrink-0 text-caption tabular-nums" style={{ color: 'var(--text-muted)' }}>
                            {review.parsed.matchedRuleName ? 'Rule match' : `${Math.round(review.parsed.confidence * 100)}% match`}
                          </span>
                        )}
                      </>
                    );
                    return review.body_text ? (
                      <CollapsibleTrigger className="-mx-2 flex min-h-11 items-center gap-2 rounded-xl px-2 text-left">
                        {summary}
                        <span className="sr-only">{showEmail ? 'Hide email' : 'Show email'}</span>
                        <ChevronDown
                          className="h-4 w-4 shrink-0 transition-transform duration-200"
                          style={{ color: 'var(--text-muted)', transform: showEmail ? 'rotate(180deg)' : 'none', transitionTimingFunction: 'var(--ease-out)' }}
                        />
                      </CollapsibleTrigger>
                    ) : (
                      <div className="flex min-h-11 items-center gap-2">{summary}</div>
                    );
                  })()}
                  {parsedRef && (
                    <span className="flex flex-wrap items-center gap-1.5 text-caption" style={{ color: 'var(--text-muted)' }}>
                      <CreditCard className="h-3.5 w-3.5" />
                      <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{parsedRef.label}</span>
                      {review.parsed?.accountSource === 'link' && review.parsed.accountId
                        ? `· linked to ${accountName(review.parsed.accountId)}`
                        : '· new card: choose its account below'}
                    </span>
                  )}
                  {review.parsed?.fxEstimated && review.parsed.amount !== null && (
                    <span className="text-caption tabular-nums" style={{ color: 'var(--warning)' }}>
                      {review.parsed.currency} {Math.abs(review.parsed.amount).toLocaleString('en-SG')} converted at today’s rate. Adjust the amount if your statement differs.
                    </span>
                  )}
                  {review.parsed?.matchedRuleName && (
                    <span className="text-caption" style={{ color: 'var(--text-muted)' }}>
                      Rule: {review.parsed.matchedRuleName}
                    </span>
                  )}
                  {review.error && (
                    <p className="text-caption font-semibold" style={{ color: 'var(--negative)' }}>
                      {review.error}
                    </p>
                  )}
                  {review.body_text && (
                    <CollapsibleContent
                      className="mt-1.5 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-2xl p-3 text-caption leading-relaxed [overflow-wrap:anywhere]"
                      style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}
                    >
                      {review.subject && (
                        <div className="mb-2 font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {review.subject}
                        </div>
                      )}
                      <EmailText text={review.body_text} />
                    </CollapsibleContent>
                  )}
                </Collapsible>
              )}

              <div className="flex items-stretch gap-2">
                {!reviewTransfer && (
                  <div className="relative flex min-w-0 flex-1">
                    <Button
                      type="button"
                      onClick={() => setStep('payee')}
                      className={`press flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-3xl p-4 text-left ${showPayeeMenu ? 'pr-12' : ''}`}
                      style={{ backgroundColor: 'var(--bg-surface)' }}
                    >
                      <span className="text-label" style={{ color: 'var(--text-muted)' }}>
                        {isTransfer ? (transferIncoming ? 'Transfer from' : 'Transfer to') : kind === 'income' ? 'From' : 'Paid to'}
                      </span>
                      <span className="w-full truncate text-heading">
                        {isTransfer ? (toAccountId ? accountName(toAccountId) : 'Pick account') : payeeName || 'Add payee'}
                      </span>
                      {!isTransfer && review?.parsed?.payeeFromRule && rawPayee && payeeName === review.parsed.payee && (
                        <span className="w-full truncate text-caption" style={{ color: 'var(--text-muted)' }}>
                          Renamed by your Actual rule from “{rawPayee}”
                        </span>
                      )}
                      {showPayeeMenu && rawPayee && rawPayee !== payeeName && (
                        <span className="w-full truncate text-caption" style={{ color: 'var(--text-muted)' }}>
                          Email says “{rawPayee}”
                        </span>
                      )}
                    </Button>
                    {showPayeeMenu && (
                      <Menu
                        trigger={
                          <Button
                            type="button"
                            ref={linkPayeeOpenerRef}
                            aria-label="Payee options"
                            className="press absolute right-1.5 top-1.5 flex h-11 w-11 items-center justify-center rounded-full"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            <MoreHorizontal className="h-5 w-5" />
                          </Button>
                        }
                        items={[
                          { label: 'Change payee', icon: <Pencil />, onSelect: () => setStep('payee') },
                          { label: 'Always rename to a payee…', icon: <Link2 />, onSelect: () => setLinkOpen(true) },
                        ]}
                      />
                    )}
                  </div>
                )}
                <Button
                  type="button"
                  onClick={() => setStep('amount')}
                  className={`press flex flex-col justify-center gap-0.5 rounded-3xl px-4 ${reviewTransfer ? 'flex-1 items-start py-4 text-left' : 'shrink-0 items-end text-right'}`}
                  style={{ backgroundColor: 'var(--bg-surface)' }}
                  aria-label={`Amount ${amountSummary}, tap to edit`}
                >
                  <span className="text-label" style={{ color: 'var(--text-muted)' }}>
                    {kind === 'income' ? 'Income' : isTransfer ? 'Amount' : 'Expense'}
                  </span>
                  <span
                    className="text-heading tabular-nums"
                    style={{ color: kind === 'income' ? 'var(--positive)' : 'var(--text-primary)' }}
                  >
                    {n > 0 ? amountSummary : 'Add amount'}
                  </span>
                </Button>
              </div>
              {review && n <= 0 && (
                <p className="-mt-2 px-1 text-caption" style={{ color: 'var(--warning)' }}>
                  No amount found in this email. If it isn’t a transaction, Dismiss it.
                </p>
              )}

              {!isTransfer && (
                <section className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between">
                    <h2 className={sectionLabel} style={{ color: 'var(--text-muted)' }}>
                      Category
                    </h2>
                    {suggested && categoryId && (
                      <span className="text-caption font-semibold" style={{ color: 'var(--accent-text)' }}>
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
                          className="press h-10 rounded-xl border px-3 text-label"
                          style={chip(on)}
                        >
                          {catMap.get(id)?.name}
                        </Toggle>
                      );
                    })}
                    <Button
                      type="button"
                      onClick={() => setStep('category')}
                      className="press flex h-10 items-center gap-1 rounded-xl border px-3 text-label"
                      style={{ borderColor: 'var(--border-subtle)', color: 'var(--accent-text)' }}
                    >
                      All categories
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </section>
              )}

              <section className="flex flex-col gap-2">
                <div className="flex flex-col rounded-3xl px-4" style={{ backgroundColor: 'var(--bg-surface)' }}>
                  <div className="flex min-h-[54px] items-center justify-between gap-3">
                    <span className="shrink-0 text-body" style={{ color: 'var(--text-muted)' }}>
                      {accountLabel}
                    </span>
                    <Select
                      variant="inline"
                      aria-label={accountLabel}
                      value={accountId || null}
                      onValueChange={(id) => {
                        selectAccount(id);
                        setError(null);
                      }}
                      options={accountOptions}
                      placeholder="Choose account"
                    />
                  </div>
                  {reviewTransfer && (
                    <div className="flex min-h-[54px] items-center justify-between gap-3 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                      <span className="shrink-0 text-body" style={{ color: 'var(--text-muted)' }}>
                        {transferIncoming ? 'From account' : 'To account'}
                      </span>
                      <Select
                        variant="inline"
                        aria-label={transferIncoming ? 'Transfer from account' : 'Transfer to account'}
                        value={toAccountId || null}
                        onValueChange={(id) => {
                          setToAccountId(id);
                          setError(null);
                        }}
                        options={transferOptions}
                        placeholder="Choose account"
                        disabled={transferOptions.length === 0}
                      />
                    </div>
                  )}
                  {review && rememberLabel && accountId && (
                    <Label className="flex min-h-11 items-center gap-2.5 border-t py-3 text-caption" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                      <Input
                        variant="unstyled"
                        type="checkbox"
                        checked={remember}
                        onChange={(e) => setRemember(e.target.checked)}
                        className="h-[18px] w-[18px] shrink-0"
                        style={{ accentColor: 'var(--accent)' }}
                      />
                      <span>
                        Remember: <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{rememberLabel}</span> → {accountName(accountId)}
                      </span>
                    </Label>
                  )}
                  <div className="flex min-h-[54px] flex-wrap items-center justify-between gap-2 border-t py-2" style={{ borderColor: 'var(--border-subtle)' }}>
                    <span className="text-body" style={{ color: 'var(--text-muted)' }}>
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
                            className="press h-9 rounded-xl border px-3 text-label"
                            style={chip(on)}
                          >
                            {friendlyDate(d)}
                          </Toggle>
                        );
                      })}
                      <Label
                        className="relative flex h-9 items-center rounded-xl border px-3 text-label"
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
                    <span className="text-body" style={{ color: 'var(--text-muted)' }}>
                      Notes
                    </span>
                    <Input
                      variant="unstyled"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Optional"
                      maxLength={500}
                      className="min-w-0 flex-1 bg-transparent text-right text-body outline-none"
                    />
                  </Label>
                  {!review && (
                    <Switch
                      checked={cleared}
                      onCheckedChange={setCleared}
                      className="flex min-h-[54px] items-center justify-between border-t text-body"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      <span style={{ color: 'var(--text-muted)' }}>Cleared</span>
                      <SwitchThumb />
                    </Switch>
                  )}
                </div>
                {isTransfer && (
                  <p className="px-1 text-caption" style={{ color: 'var(--text-muted)' }}>
                    Actual creates the matching entry in {toAccountId ? accountName(toAccountId) : 'the other account'}.
                  </p>
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
                  <Button type="button" onClick={() => void dismiss()} disabled={busy} variant="secondary" className="h-12 flex-1 rounded-2xl text-body disabled:opacity-50">
                    Dismiss
                  </Button>
                )}
                <Button type="button" onClick={() => void save()} disabled={busy} variant="default" className="h-12 flex-[2] rounded-2xl text-body disabled:opacity-50">
                  {busy ? 'Saving…' : review ? 'Import to Actual' : 'Add to Actual'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ---------- CATEGORY PICKER ---------- */}
        {visibleStep === 'category' && (
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
                  className="h-full flex-1 bg-transparent text-body outline-none"
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
                  className="press flex items-center justify-between rounded-2xl border px-4 py-3 text-left text-body"
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
                          className="flex min-h-[50px] items-center gap-3 px-3 text-left text-body transition hover:opacity-90"
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

        {/* ---------- DONE ---------- */}
        {visibleStep === 'done' && done && (
          <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center safe-pb">
            <span className="flex h-20 w-20 items-center justify-center rounded-full" style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}>
              <Check className="h-10 w-10" strokeWidth={2.6} />
            </span>
            <h1 className="text-title">{done.title}</h1>
            <div className="flex flex-col gap-1">
              <span
                className="text-display tabular-nums"
                style={{ color: kind === 'income' ? 'var(--positive)' : 'var(--text-primary)' }}
              >
                {amountSummary}
              </span>
              <span className="text-body font-bold">{done.line1}</span>
              <span className="text-body" style={{ color: 'var(--text-muted)' }}>
                {done.line2}
              </span>
            </div>
            <div className="mt-3 flex w-full gap-2">
              {!review && (
                <Button type="button" onClick={addAnother} variant="secondary" className="h-14 flex-1 rounded-2xl text-body">
                  Add another
                </Button>
              )}
              <Dialog.Close
                render={
                  <Button type="button" variant="default" className="h-14 flex-1 rounded-2xl text-body">
                  Done
                </Button>
                }
              />
            </div>
          </div>
        )}
      </Dialog.Popup>
      </Dialog.Viewport>
      {review && !valuesHidden && rawPayee && (
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
    </Dialog.Portal>
  );

  return (
    // Outside presses don't dismiss: on desktop the backdrop is visible but a stray click shouldn't lose the entry.
    <Dialog.Root open disablePointerDismissal onOpenChange={(next) => { if (!next) onClose(); }}>
      {panel}
    </Dialog.Root>
  );
}
