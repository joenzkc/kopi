import type { ActualAccount, AssetType } from '@shared/types';

/** Options for "Link to Actual account": off-budget accounts when there are any, else every account. */
export function accountOptions(accounts: ActualAccount[]) {
  const offBudget = accounts.filter((a) => a.offbudget);
  const list = offBudget.length > 0 ? offBudget : accounts;
  return [
    { value: '', label: 'Not linked' },
    ...list.map((a) => ({ value: a.id, label: a.name, hint: a.offbudget ? 'Off budget' : 'On budget' })),
  ];
}

export type PortfolioFilter = 'all' | 'stock' | 'etf' | 'crypto' | 'rsu' | 'cash';
export type AllocationKey = Exclude<PortfolioFilter, 'all'>;
export type ChangeMode = 'today' | 'all';

/** One tile colour per asset type, so rows, the allocation bar and its legend share a colour. */
export const TYPE_META: Record<AllocationKey, { label: string; tile: number }> = {
  stock: { label: 'Stocks', tile: 2 },
  etf: { label: 'ETFs', tile: 1 },
  crypto: { label: 'Crypto', tile: 0 },
  rsu: { label: 'RSUs', tile: 4 },
  cash: { label: 'Cash', tile: 5 },
};

export const HOLDING_GROUP_ORDER: AssetType[] = ['stock', 'etf', 'crypto', 'cash'];

export const CURRENCIES = ['SGD', 'USD', 'EUR', 'GBP', 'HKD', 'JPY', 'AUD'];
export const currencyOptions = (first?: string) => {
  const list = first ? [first, ...CURRENCIES.filter((c) => c !== first)] : CURRENCIES;
  return list.map((c) => ({ value: c, label: c }));
};

export function tileVars(index: number): { backgroundColor: string; color: string } {
  return { backgroundColor: `var(--tile-bg-${index})`, color: `var(--tile-fg-${index})` };
}

export function visibleUnits(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? n.toLocaleString('en-US') : Number(n.toFixed(4)).toLocaleString('en-US');
}

export function formatShortDate(iso: string, withYear = true): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
}

export function dateParts(iso: string): { month: string; day: string } {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return { month: '', day: iso };
  const month = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-SG', { month: 'short', timeZone: 'UTC' });
  return { month, day: String(d) };
}

export function formatVestCountdown(days: number): { label: string; soon: boolean } {
  if (days < 0) return { label: `${Math.abs(days)}d ago`, soon: false };
  if (days === 0) return { label: 'Today', soon: true };
  if (days === 1) return { label: 'Tomorrow', soon: true };
  if (days <= 30) return { label: `In ${days}d`, soon: true };
  if (days < 365) return { label: `In ${Math.round(days / 30)}mo`, soon: false };
  return { label: `In ${(days / 365).toFixed(1)}yr`, soon: false };
}

export function todayLocalIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Colour for a signed change; zero/unknown is muted. */
export function changeColor(n: number | null | undefined): string {
  if (n === null || n === undefined || n === 0 || !Number.isFinite(n)) return 'var(--text-muted)';
  return n > 0 ? 'var(--positive)' : 'var(--negative)';
}

export function shortSymbol(symbol: string): string {
  return (symbol.split('.')[0] || symbol).slice(0, 4).toUpperCase();
}
