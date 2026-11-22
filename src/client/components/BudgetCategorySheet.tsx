import React, { useMemo, useState } from 'react';
import type { BudgetCategory, BudgetMonthResponse } from '@shared/types';
import { apiFetch, formatMoney } from '../lib/api';
import { Sheet } from './Sheet';
import { Button } from '@client/components/ui/button';
import { Input } from '@client/components/ui/input';
import { Label } from '@client/components/ui/label';
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from '@client/components/ui/native-select';

interface BudgetCategorySheetProps {
  category: BudgetCategory | null;
  groupName: string;
  data: BudgetMonthResponse;
  monthName: string;
  baseCurrency: string;
  onClose: () => void;
  /** Called after Actual accepted a change. `close` is false for edits that keep the sheet open. */
  onSaved: (message: string, close: boolean) => void;
}

type MoveDir = 'in' | 'out';

/** Parses a typed amount like "1,234.50" or "-20" into cents; null when it isn't a number. */
export function parseCents(input: string): number | null {
  const cleaned = input.replace(/[,\s]/g, '').replace(/[^\d.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  if (!/^-?\d*\.?\d*$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

const centsToInput = (cents: number) => (cents / 100).toFixed(2);

const labelStyle = { color: 'var(--text-secondary)' };

function Chip({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <Button
      type="button"
      onClick={onClick}
      className="press rounded-full px-3 py-1.5 text-xs font-bold tabular-nums"
      style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}
    >
      {children}
    </Button>
  );
}

export function BudgetCategorySheet({ category, groupName, data, monthName, baseCurrency, onClose, onSaved }: BudgetCategorySheetProps) {
  const [budgetInput, setBudgetInput] = useState(() => (category ? centsToInput(category.budgeted) : ''));
  const [moveDir, setMoveDir] = useState<MoveDir>(() => (category && category.balance < 0 ? 'in' : 'out'));
  const [moveOther, setMoveOther] = useState(''); // '' = To budget
  const [moveInput, setMoveInput] = useState(() => (category && category.balance < 0 ? centsToInput(-category.balance) : ''));
  const [busy, setBusy] = useState<null | 'budget' | 'move' | 'rollover'>(null);
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
  const newBudgeted = parseCents(budgetInput);
  const budgetDelta = newBudgeted === null ? 0 : newBudgeted - category.budgeted;
  const toBudgetAfter = data.toBudget - budgetDelta;
  const moveCents = parseCents(moveInput);
  const otherCat = moveOther ? otherGroups.flatMap((g) => g.categories).find((c) => c.id === moveOther) : null;
  const otherName = otherCat?.name ?? 'To budget';
  const otherAvailable = otherCat ? otherCat.balance : data.toBudget;

  async function run(kind: 'budget' | 'move' | 'rollover', fn: () => Promise<unknown>, message: string, close: boolean) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
      onSaved(message, close);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  }

  const saveBudget = (e: React.FormEvent) => {
    e.preventDefault();
    if (newBudgeted === null) return setError('Enter an amount, e.g. 250 or 250.50');
    if (newBudgeted === category.budgeted) return onClose();
    void run(
      'budget',
      () =>
        apiFetch(`/api/budget/${data.month}/categories/${encodeURIComponent(category.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ budgeted: newBudgeted }),
        }),
      `${category.name} budget set to ${money(newBudgeted)}`,
      true,
    );
  };

  const moveMoney = (e: React.FormEvent) => {
    e.preventDefault();
    if (moveCents === null || moveCents <= 0) return setError('Enter an amount to move');
    const fromCategoryId = moveDir === 'in' ? moveOther || null : category.id;
    const toCategoryId = moveDir === 'in' ? category.id : moveOther || null;
    void run(
      'move',
      () => apiFetch(`/api/budget/${data.month}/move`, { method: 'POST', body: JSON.stringify({ fromCategoryId, toCategoryId, amount: moveCents }) }),
      moveDir === 'in' ? `Moved ${money(moveCents)} from ${otherName} to ${category.name}` : `Moved ${money(moveCents)} from ${category.name} to ${otherName}`,
      true,
    );
  };

  const toggleRollover = () => {
    const next = !category.carryover;
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

  return (
    <Sheet open onClose={onClose} title={category.name} subtitle={`${groupName} · ${monthName}`}>
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Budgeted', value: category.budgeted },
            { label: 'Spent', value: category.spent },
            { label: 'Available', value: category.balance },
          ].map((s) => (
            <div key={s.label} className="flex flex-col gap-0.5 rounded-2xl p-3" style={{ backgroundColor: 'var(--bg-subtle)' }}>
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{s.label}</span>
              <span className="text-[15px] font-extrabold tabular-nums" style={{ color: s.value < 0 ? 'var(--negative)' : undefined }}>
                {money(s.value)}
              </span>
            </div>
          ))}
        </div>

        {/* Set budgeted amount */}
        <form onSubmit={saveBudget} className="flex flex-col gap-2">
          <Label htmlFor="budget-amount" className="text-xs font-bold" style={labelStyle}>
            Budgeted for {monthName} ({baseCurrency})
          </Label>
          <div className="flex gap-2">
            <Input
              id="budget-amount"
              inputMode="decimal"
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value)}
              onFocus={(e) => e.target.select()}
              placeholder="0.00"
              className="flex-1 tabular-nums"
            />
            <Button type="submit" disabled={busy !== null || newBudgeted === null} variant="default" className="h-12 shrink-0 rounded-2xl px-5 text-[15px] disabled:opacity-50">
              {busy === 'budget' ? 'Saving…' : 'Save'}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {over && <Chip onClick={() => setBudgetInput(centsToInput(category.budgeted - category.balance))}>Cover overspending</Chip>}
            {category.spent > 0 && category.spent !== category.budgeted && (
              <Chip onClick={() => setBudgetInput(centsToInput(category.spent))}>Match spent · {money(category.spent)}</Chip>
            )}
            {data.toBudget > 0 && <Chip onClick={() => setBudgetInput(centsToInput(category.budgeted + data.toBudget))}>Add all of To budget</Chip>}
            {category.budgeted !== 0 && <Chip onClick={() => setBudgetInput('0.00')}>Clear</Chip>}
          </div>
          <p className="text-xs tabular-nums" style={{ color: toBudgetAfter < 0 ? 'var(--negative)' : 'var(--text-muted)' }}>
            {budgetDelta === 0
              ? `To budget: ${money(data.toBudget)}`
              : toBudgetAfter < 0
                ? `This overbudgets the month by ${money(-toBudgetAfter)}`
                : `To budget after saving: ${money(toBudgetAfter)}`}
          </p>
        </form>

        {/* Move money */}
        <form onSubmit={moveMoney} className="flex flex-col gap-2">
          <span className="text-xs font-bold" style={labelStyle}>Move money</span>
          <div role="radiogroup" aria-label="Move direction" className="grid grid-cols-2 gap-1 rounded-2xl p-1" style={{ backgroundColor: 'var(--bg-subtle)' }}>
            {(
              [
                ['in', `Into ${category.name}`],
                ['out', `Out of ${category.name}`],
              ] as const
            ).map(([id, text]) => {
              const on = moveDir === id;
              return (
                <Button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setMoveDir(id)}
                  className="h-10 truncate rounded-xl px-2 text-sm font-bold transition"
                  style={{ backgroundColor: on ? 'var(--accent)' : 'transparent', color: on ? 'var(--accent-fg)' : 'var(--text-muted)' }}
                >
                  {text}
                </Button>
              );
            })}
          </div>
          <Label htmlFor="move-other" className="sr-only">
            {moveDir === 'in' ? 'Take money from' : 'Send money to'}
          </Label>
          <div className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>
              {moveDir === 'in' ? 'From' : 'To'}
            </span>
            <NativeSelect id="move-other" value={moveOther} onChange={(e) => setMoveOther(e.target.value)} className="flex-1">
              <NativeSelectOption value="">To budget ({money(data.toBudget)})</NativeSelectOption>
              {otherGroups.map((g) => (
                <NativeSelectOptGroup key={g.id} label={g.name}>
                  {g.categories.map((c) => (
                    <NativeSelectOption key={c.id} value={c.id}>
                      {c.name} ({money(c.balance)})
                    </NativeSelectOption>
                  ))}
                </NativeSelectOptGroup>
              ))}
            </NativeSelect>
          </div>
          <div className="flex gap-2">
            <Label htmlFor="move-amount" className="sr-only">Amount to move</Label>
            <Input
              id="move-amount"
              inputMode="decimal"
              value={moveInput}
              onChange={(e) => setMoveInput(e.target.value)}
              onFocus={(e) => e.target.select()}
              placeholder="0.00"
              className="flex-1 tabular-nums"
            />
            <Button
              type="submit"
              disabled={busy !== null || moveCents === null || moveCents <= 0}
              variant="secondary" className="h-12 shrink-0 rounded-2xl px-5 text-[15px] font-bold disabled:opacity-50"
            >
              {busy === 'move' ? 'Moving…' : 'Move'}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {moveDir === 'in' && over && <Chip onClick={() => setMoveInput(centsToInput(-category.balance))}>Overspent · {money(-category.balance)}</Chip>}
            {moveDir === 'in' && otherAvailable > 0 && <Chip onClick={() => setMoveInput(centsToInput(otherAvailable))}>All of {otherName} · {money(otherAvailable)}</Chip>}
            {moveDir === 'out' && category.balance > 0 && <Chip onClick={() => setMoveInput(centsToInput(category.balance))}>All available · {money(category.balance)}</Chip>}
          </div>
          {moveDir === 'in' && moveCents !== null && moveCents > otherAvailable && (
            <p className="text-xs" style={{ color: 'var(--warning)' }}>
              That's more than {otherName} has available; it will go negative.
            </p>
          )}
          {moveDir === 'out' && moveCents !== null && moveCents > category.balance && (
            <p className="text-xs" style={{ color: 'var(--warning)' }}>
              That's more than {category.name} has available; it will go negative.
            </p>
          )}
        </form>

        {/* Rollover */}
        <Button
          type="button"
          role="switch"
          aria-checked={category.carryover}
          disabled={busy !== null}
          onClick={toggleRollover}
          className="flex items-center justify-between gap-3 rounded-2xl p-3 text-left disabled:opacity-60"
          style={{ backgroundColor: 'var(--bg-subtle)' }}
        >
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-bold">Roll over overspending</span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Carry a negative balance into next month instead of taking it from To budget.
            </span>
          </span>
          <span
            className="flex h-7 w-12 shrink-0 rounded-full p-[3px] transition"
            style={{ backgroundColor: category.carryover ? 'var(--accent)' : 'var(--bg-hover)', justifyContent: category.carryover ? 'flex-end' : 'flex-start' }}
          >
            <span className="h-[22px] w-[22px] rounded-full" style={{ backgroundColor: category.carryover ? 'var(--accent-fg)' : 'var(--text-muted)' }} />
          </span>
        </Button>

        {error && (
          <p role="alert" className="text-sm font-semibold" style={{ color: 'var(--negative)' }}>
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}
