import { useFinancialValues } from '../../lib/valueVisibility';
import { Progress } from '@client/components/ui/progress';

/** Share of what was available this month that has been spent (0–1). */
export function spentRatio(spent: number, balance: number): number {
  if (balance < 0) return 1;
  const available = spent + balance;
  if (available <= 0) return spent > 0 ? 1 : 0;
  return Math.max(0, Math.min(1, spent / available));
}

export function barColor(balance: number, ratio: number): string {
  if (balance < 0) return 'var(--negative)';
  if (ratio >= 0.9) return 'var(--warning)';
  return 'var(--accent)';
}

/** Spent-of-available bar; hidden with the rest of the financial values. */
export function ProgressBar({ ratio, color, label }: { ratio: number; color: string; label: string }) {
  const { valuesHidden } = useFinancialValues();
  if (valuesHidden) return null;
  const percentage = ratio * 100;
  return (
    <Progress
      aria-label={label}
      aria-valuetext={undefined}
      value={Math.min(100, Math.max(0, Math.round(percentage)))}
      indicatorStyle={{ width: `${Math.max(percentage, ratio > 0 ? 3 : 0)}%`, backgroundColor: color }}
    />
  );
}
