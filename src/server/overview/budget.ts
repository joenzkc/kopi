import type { RawBudgetMonth } from '../actual/client';
import type { BudgetGroup, BudgetMonthResponse } from '../../shared/types';

/** Converts Actual's month summary into the UI shape: hidden items dropped, spending as positive numbers. */
export function normalizeBudgetMonth(raw: RawBudgetMonth, months: string[], fallbackMonth: string): BudgetMonthResponse {
  let overspentCount = 0;
  const groups: BudgetGroup[] = (raw.categoryGroups || [])
    .filter((g) => !g.hidden)
    .map((g) => {
      const isIncome = Boolean(g.is_income);
      const categories = (g.categories || [])
        .filter((cat) => !cat.hidden)
        .map((cat) => {
          const balance = cat.balance ?? 0;
          if (!isIncome && balance < 0) overspentCount += 1;
          return {
            id: cat.id,
            name: cat.name,
            budgeted: cat.budgeted ?? 0,
            // Actual reports spending as a negative number; flip it so the UI can reason in "spent" terms.
            spent: isIncome ? (cat.received ?? 0) : -(cat.spent ?? 0),
            balance,
            carryover: Boolean(cat.carryover),
          };
        });
      return {
        id: g.id,
        name: g.name,
        isIncome,
        budgeted: g.budgeted ?? 0,
        spent: -(g.spent ?? 0),
        balance: g.balance ?? 0,
        received: g.received ?? (isIncome ? categories.reduce((s, cat) => s + cat.spent, 0) : 0),
        categories,
      };
    })
    // Keep empty expense groups so a freshly created group shows up (with its "Add category" row).
    .filter((g) => g.categories.length > 0 || !g.isIncome);

  return {
    month: raw.month || fallbackMonth,
    months,
    toBudget: raw.toBudget ?? 0,
    // totalBudgeted/totalSpent come back negative from Actual.
    totalBudgeted: Math.abs(raw.totalBudgeted ?? 0),
    totalSpent: -(raw.totalSpent ?? 0),
    totalBalance: raw.totalBalance ?? 0,
    totalIncome: raw.totalIncome ?? 0,
    overspentCount,
    groups,
  };
}
