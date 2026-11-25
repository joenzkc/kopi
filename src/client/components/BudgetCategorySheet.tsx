import React, { useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, ChevronLeft, PencilLine } from 'lucide-react';
import type { ActualAccount, ActualCategory, ActualPayee, BudgetCategory, BudgetMonthResponse, RecentTransaction } from '@shared/types';
import { apiFetch, formatMoney } from '../lib/api';
import { Sheet } from './Sheet';
import { ProgressBar, barColor, spentRatio } from './budget/ProgressBar';
import { CategoryTransactions } from './budget/CategoryTransactions';
import { EditTransactionSheet } from './EditTransactionSheet';
import { Button } from '@client/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@client/components/ui/radio-group';
import { Switch, SwitchThumb } from '@client/components/ui/switch';
import { Input } from '@client/components/ui/input';
import { Label } from '@client/components/ui/label';
import { Select, type SelectGroup } from '@client/components/ui/select';
import { Alert } from '@client/components/ui/alert';

interface BudgetCategorySheetProps {
  category: BudgetCategory | null;
  groupName: string;
  data: BudgetMonthResponse;
  monthName: string;
  baseCurrency: string;
  accounts: ActualAccount[];
  categories: ActualCategory[];
  payees: ActualPayee[];
  onClose: () => void;
  /** Called after Actual accepted a change. `close` is false for edits that keep the sheet open. */
  onSaved: (message: string, close: boolean) => void;
  /** A transaction was edited from this sheet (refreshes the rest of the app). */
  onTransactionChanged: (message: string) => void;
}

type MoveDir = 'in' | 'out';
/** The sheet opens on what was spent; changing the budget or moving money are one tap away. */
type View = 'overview' | 'budget' | 'move';

/** Parses a typed amount like "1,234.50" or "-20" into cents; null when it isn't a number. */
export function parseCents(input: string): number | null {
  const cleaned = input.replace(/[,\s]/g, '').replace(/[^\d.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  if (!/^-?\d*\.?\d*$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

const centsToInput = (cents: number) => (cents / 100).toFixed(2);

const mutedStyle = { color: 'var(--text-muted)' };
const sectionDivider = { borderTop: '1px solid var(--border-subtle)' };

/** Quick-fill suggestion under an amount field. */
function Chip({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <Button
      type="button"
      onClick={onClick}
      className="press h-8 shrink-0 whitespace-nowrap rounded-full px-3 text-label tabular-nums"
      style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}
    >
      {children}
    </Button>
  );
}

/** Amount input with the currency code tucked inside on the right. */
function AmountInput({
  id,
  value,
  onChange,
  currency,
  form,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  currency: string;
  form?: string;
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <Input
        id={id}
        form={form}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => e.target.select()}
        placeholder="0.00"
        autoComplete="off"
        className="h-12 pr-14 tabular-nums"
      />
      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-label" style={mutedStyle}>
        {currency}
      </span>
    </div>
  );
}

export function BudgetCategorySheet({
  category,
  groupName,
  data,
  monthName,
  baseCurrency,
  accounts,
  categories,
  payees,
  onClose,
  onSaved,
  onTransactionChanged,
}: BudgetCategorySheetProps) {
  const [view, setView] = useState<View>('overview');
  const [editTx, setEditTx] = useState<RecentTransaction | null>(null);
  const txTrigger = useRef<HTMLElement | null>(null);
  const [nameInput, setNameInput] = useState(() => category?.name ?? '');
  const [budgetInput, setBudgetInput] = useState(() => (category ? centsToInput(category.budgeted) : ''));
  const [moveDir, setMoveDir] = useState<MoveDir>(() => (category && category.balance < 0 ? 'in' : 'out'));
  const [moveOther, setMoveOther] = useState(''); // '' = To budget
  const [moveInput, setMoveInput] = useState(() => (category && category.balance < 0 ? centsToInput(-category.balance) : ''));
  const [busy, setBusy] = useState<null | 'save' | 'move' | 'rollover'>(null);
  const [error, setError] = useState<string | null>(null);

  const money = (cents: number) => formatMoney(cents / 100, baseCurrency);

  const otherGroups = useMemo(
    () =>
      data.groups
        .filter((g) => !g.isIncome)
        .map((g) => ({ ...g, categories: g.categories.filter((c) => c.id !== category?.id) }))
        .filter((g) => g.categories.length > 0),
    [data.groups, category?.id],
  );

  if (!category) return null;

  const over = category.balance < 0;
  const ratio = spentRatio(category.spent, category.balance);
  const newBudgeted = parseCents(budgetInput);
  const budgetDelta = newBudgeted === null ? 0 : newBudgeted - category.budgeted;
  const toBudgetAfter = data.toBudget - budgetDelta;
  const newName = nameInput.trim();
  const nameChanged = newName !== '' && newName !== category.name;
  const moveCents = parseCents(moveInput);
  const otherCat = moveOther ? otherGroups.flatMap((g) => g.categories).find((c) => c.id === moveOther) : null;
  const otherName = otherCat?.name ?? 'To budget';
  const otherAvailable = otherCat ? otherCat.balance : data.toBudget;

  const moveOptions: SelectGroup[] = [
    { label: 'Unassigned', options: [{ value: '', label: 'To budget', hint: money(data.toBudget) }] },
    ...otherGroups.map((g) => ({
      label: g.name,
      options: g.categories.map((c) => ({ value: c.id, label: c.name, hint: money(c.balance) })),
    })),
  ];

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newBudgeted === null) return setError('Enter an amount, e.g. 250 or 250.50');
    if (!newName) return setError('Give the category a name');
    const budgetChanged = newBudgeted !== category.budgeted;
    if (!budgetChanged && !nameChanged) return setView('overview');

    setBusy('save');
    setError(null);
    const done: string[] = [];
    try {
      if (budgetChanged) {
        await apiFetch(`/api/budget/${data.month}/categories/${encodeURIComponent(category.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ budgeted: newBudgeted }),
        });
        done.push(`${category.name} budget set to ${money(newBudgeted)}`);
      }
      if (nameChanged) {
        await apiFetch(`/api/budget/categories/${encodeURIComponent(category.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: newName }),
        });
        done.push(budgetChanged ? `renamed to ${newName}` : `${category.name} renamed to ${newName}`);
      }
      onSaved(done.join(', '), false);
      setView('overview');
    } catch (err) {
      // Keep the sheet open on a partial save, but still refresh what did land.
      if (done.length > 0) onSaved(done.join(', '), false);
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  async function run(kind: 'move' | 'rollover', fn: () => Promise<unknown>, message: string, close: boolean) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
      onSaved(message, close);
      if (kind === 'move') {
        setMoveInput('');
        setView('overview');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  }

  const moveMoney = (e: React.FormEvent) => {
    e.preventDefault();
    if (moveCents === null || moveCents <= 0) return setError('Enter an amount to move');
    const fromCategoryId = moveDir === 'in' ? moveOther || null : category.id;
    const toCategoryId = moveDir === 'in' ? category.id : moveOther || null;
    void run(
      'move',
      () => apiFetch(`/api/budget/${data.month}/move`, { method: 'POST', body: JSON.stringify({ fromCategoryId, toCategoryId, amount: moveCents }) }),
      moveDir === 'in' ? `Moved ${money(moveCents)} from ${otherName} to ${category.name}` : `Moved ${money(moveCents)} from ${category.name} to ${otherName}`,
      false,
    );
  };

  const toggleRollover = (next: boolean) => {
    void run(
      'rollover',
      () =>
        apiFetch(`/api/budget/${data.month}/categories/${encodeURIComponent(category.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ carryover: next }),
        }),
      next ? `${category.name} now rolls overspending over` : `${category.name} no longer rolls overspending over`,
      false,
    );
  };

  const budgetChips = [
    over && { key: 'cover', text: `Cover overspending`, value: category.budgeted - category.balance },
    category.spent > 0 && category.spent !== category.budgeted && { key: 'spent', text: `Match spent · ${money(category.spent)}`, value: category.spent },
    data.toBudget > 0 && { key: 'all', text: `+ To budget · ${money(data.toBudget)}`, value: category.budgeted + data.toBudget },
    category.budgeted !== 0 && { key: 'clear', text: 'Clear', value: 0 },
  ].filter((c): c is { key: string; text: string; value: number } => Boolean(c));

  const moveChips = [
    moveDir === 'in' && over && { key: 'over', text: `Overspent · ${money(-category.balance)}`, value: -category.balance },
    moveDir === 'in' && otherAvailable > 0 && { key: 'other', text: `All of ${otherName} · ${money(otherAvailable)}`, value: otherAvailable },
    moveDir === 'out' && category.balance > 0 && { key: 'avail', text: `All available · ${money(category.balance)}`, value: category.balance },
  ].filter((c): c is { key: string; text: string; value: number } => Boolean(c));

  const moveWarning =
    moveCents === null
      ? null
      : moveDir === 'in' && moveCents > otherAvailable
        ? `That's more than ${otherName} has available; it will go negative.`
        : moveDir === 'out' && moveCents > category.balance
          ? `That's more than ${category.name} has available; it will go negative.`
          : null;

  return (
    <Sheet financialForm open onClose={onClose} title={category.name} subtitle={`${groupName} · ${monthName}`}>
      {view === 'overview' && (
        <div key="overview" className="view-in flex flex-col gap-6">
          {/* Summary */}
          <section className="flex flex-col gap-2" aria-label="This month">
            <span className="text-label" style={mutedStyle}>
              {over ? 'Overspent' : 'Available'}
            </span>
            <span className="text-title tabular-nums" style={{ color: over ? 'var(--negative)' : 'var(--text-primary)' }}>
              {over ? `−${money(-category.balance)}` : money(category.balance)}
            </span>
            <ProgressBar ratio={ratio} color={barColor(category.balance, ratio)} label={`${Math.round(ratio * 100)}% spent`} />
            <span className="text-caption tabular-nums" style={mutedStyle}>
              {money(category.spent)} spent of {money(category.budgeted)} budgeted
            </span>
          </section>

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setView('budget')}
              className="flex h-11 items-center justify-center gap-2 rounded-2xl text-label"
            >
              <PencilLine className="h-4 w-4" />
              Change budget
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setView('move')}
              className="flex h-11 items-center justify-center gap-2 rounded-2xl text-label"
            >
              <ArrowLeftRight className="h-4 w-4" />
              Move money
            </Button>
          </div>
          {over && (
            <Button
              type="button"
              onClick={() => {
                setBudgetInput(centsToInput(category.budgeted - category.balance));
                setView('budget');
              }}
              className="press -mt-3 flex min-h-11 items-center justify-between gap-3 rounded-2xl px-4 text-left text-label"
              style={{ backgroundColor: 'var(--negative-soft)', color: 'var(--negative)' }}
            >
              <span>Cover the {money(-category.balance)} overspending</span>
              <span aria-hidden="true">›</span>
            </Button>
          )}

          <CategoryTransactions
            month={data.month}
            monthName={monthName}
            categoryId={category.id}
            categoryName={category.name}
            baseCurrency={baseCurrency}
            reloadKey={data}
            onSelect={(t, trigger) => {
              txTrigger.current = trigger;
              setEditTx(t);
            }}
          />
        </div>
      )}

      {view === 'budget' && (
        <div key="budget" className="view-in flex flex-col gap-6">
          <Button
            type="button"
            onClick={() => {
              setError(null);
              setView('overview');
            }}
            className="press -ml-1.5 flex min-h-11 items-center gap-1 self-start rounded-xl pr-2.5 text-label"
            style={mutedStyle}
          >
            <ChevronLeft className="h-4 w-4" />
            {category.name}
          </Button>
          {/* Budgeted (saved by the Save button at the bottom) */}
          <form id="budget-category-form" onSubmit={save} className="flex flex-col gap-1.5">
            <Label htmlFor="budget-amount" className="text-label" style={mutedStyle}>
              Budgeted for {monthName}
            </Label>
            <AmountInput id="budget-amount" value={budgetInput} onChange={setBudgetInput} currency={baseCurrency} />
            {budgetChips.length > 0 && (
              <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pt-1">
                {budgetChips.map((c) => (
                  <Chip key={c.key} onClick={() => setBudgetInput(centsToInput(c.value))}>
                    {c.text}
                  </Chip>
                ))}
              </div>
            )}
            {budgetDelta !== 0 && (
              <p className="text-caption tabular-nums" style={{ color: toBudgetAfter < 0 ? 'var(--negative)' : 'var(--text-muted)' }}>
                {toBudgetAfter < 0 ? `This overbudgets the month by ${money(-toBudgetAfter)}` : `To budget after saving: ${money(toBudgetAfter)}`}
              </p>
            )}
          </form>

          {/* Category settings */}
          <section className="flex flex-col gap-4 pt-6" style={sectionDivider} aria-label="Category settings">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="budget-category-name" className="text-label" style={mutedStyle}>
                Name
              </Label>
              <Input
                id="budget-category-name"
                form="budget-category-form"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                autoComplete="off"
                maxLength={100}
              />
            </div>
            <Switch
              checked={category.carryover}
              disabled={busy !== null}
              onCheckedChange={toggleRollover}
              className="flex min-h-11 items-center justify-between gap-3 text-left disabled:opacity-60"
            >
              <span className="flex flex-col gap-0.5">
                <span className="text-body">Roll over overspending</span>
                <span className="text-caption" style={mutedStyle}>
                  Carry a negative balance into next month instead of taking it from To budget.
                </span>
              </span>
              <SwitchThumb className="shrink-0" />
            </Switch>
          </section>

          {error && (
            <Alert as="p" variant="destructive">
              {error}
            </Alert>
          )}

          <Button
            type="submit"
            form="budget-category-form"
            disabled={busy !== null || newBudgeted === null || !newName}
            variant="default"
            className="h-12 w-full rounded-2xl text-body disabled:opacity-50"
          >
            {busy === 'save' ? 'Saving…' : 'Save'}
          </Button>
        </div>
      )}

      {view === 'move' && (
        <div key="move" className="view-in flex flex-col gap-6">
          <Button
            type="button"
            onClick={() => {
              setError(null);
              setView('overview');
            }}
            className="press -ml-1.5 flex min-h-11 items-center gap-1 self-start rounded-xl pr-2.5 text-label"
            style={mutedStyle}
          >
            <ChevronLeft className="h-4 w-4" />
            {category.name}
          </Button>
          {/* Move money */}
          <form onSubmit={moveMoney} className="flex flex-col gap-4" aria-labelledby="move-money-label">
            <span id="move-money-label" className="text-label" style={mutedStyle}>
              Move money
            </span>
            <RadioGroup
              value={moveDir}
              onValueChange={(value) => setMoveDir(value as MoveDir)}
              aria-label="Move direction"
              className="grid grid-cols-2 gap-1 rounded-2xl p-1"
              style={{ backgroundColor: 'var(--bg-subtle)' }}
            >
              {(
                [
                  ['in', `Into ${category.name}`],
                  ['out', `Out of ${category.name}`],
                ] as const
              ).map(([id, text]) => {
                const on = moveDir === id;
                return (
                  <RadioGroupItem
                    key={id}
                    value={id}
                    className="h-10 truncate rounded-xl px-2 text-label transition"
                    style={{ backgroundColor: on ? 'var(--accent)' : 'transparent', color: on ? 'var(--accent-fg)' : 'var(--text-muted)' }}
                  >
                    {text}
                  </RadioGroupItem>
                );
              })}
            </RadioGroup>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="move-other" className="text-label" style={mutedStyle}>
                {moveDir === 'in' ? 'Take from' : 'Send to'}
              </Label>
              <Select
                id="move-other"
                aria-label={moveDir === 'in' ? 'Take money from' : 'Send money to'}
                value={moveOther}
                onValueChange={setMoveOther}
                options={moveOptions}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="move-amount" className="text-label" style={mutedStyle}>
                Amount
              </Label>
              <div className="flex gap-2">
                <AmountInput id="move-amount" value={moveInput} onChange={setMoveInput} currency={baseCurrency} />
                <Button
                  type="submit"
                  disabled={busy !== null || moveCents === null || moveCents <= 0}
                  variant="secondary"
                  className="h-12 shrink-0 rounded-2xl px-5 text-body disabled:opacity-50"
                >
                  {busy === 'move' ? 'Moving…' : 'Move'}
                </Button>
              </div>
              {moveChips.length > 0 && (
                <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pt-1">
                  {moveChips.map((c) => (
                    <Chip key={c.key} onClick={() => setMoveInput(centsToInput(c.value))}>
                      {c.text}
                    </Chip>
                  ))}
                </div>
              )}
              {moveWarning && (
                <p className="text-caption" style={{ color: 'var(--warning)' }}>
                  {moveWarning}
                </p>
              )}
            </div>
          </form>

          {error && (
            <Alert as="p" variant="destructive">
              {error}
            </Alert>
          )}

        </div>
      )}

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
            txTrigger.current?.focus({ preventScroll: true });
          }}
          onSaved={() => {
            setEditTx(null);
            onTransactionChanged('Transaction updated');
          }}
        />
      )}
    </Sheet>
  );
}
