import { useMemo } from 'react';
import type { ActualAccount, ActualCategory, ActualCategoryGroup, RecentTransaction } from '@shared/types';
import { Sheet } from '../Sheet';
import { Button } from '@client/components/ui/button';
import { Select, type SelectGroup, type SelectOption } from '@client/components/ui/select';

export type ActivityKind = 'all' | 'out' | 'in' | 'transfers';

/** `null` = any; `''` (category only) = uncategorized. */
export interface ActivityFilters {
  kind: ActivityKind;
  categoryId: string | null;
  accountId: string | null;
}

export const NO_FILTERS: ActivityFilters = { kind: 'all', categoryId: null, accountId: null };

export const KIND_LABELS: Record<ActivityKind, string> = { all: 'All', out: 'Money out', in: 'Money in', transfers: 'Transfers' };

const ANY = '__any';

export function activeFilterCount(f: ActivityFilters): number {
  return (f.kind !== 'all' ? 1 : 0) + (f.categoryId !== null ? 1 : 0) + (f.accountId !== null ? 1 : 0);
}

export function matchesFilters(t: RecentTransaction, f: ActivityFilters): boolean {
  if (f.kind === 'out' && (t.amount >= 0 || t.isTransfer)) return false;
  if (f.kind === 'in' && (t.amount <= 0 || t.isTransfer)) return false;
  if (f.kind === 'transfers' && !t.isTransfer) return false;
  if (f.categoryId !== null) {
    if (f.categoryId === '') {
      if (t.category || t.isTransfer) return false;
    } else if (t.category !== f.categoryId) return false;
  }
  if (f.accountId !== null && t.account !== f.accountId) return false;
  return true;
}

export function ActivityFilterSheet({
  open,
  onClose,
  filters,
  onChange,
  transactions,
  categories,
  categoryGroups = [],
  accounts,
  resultCount,
}: {
  open: boolean;
  onClose: () => void;
  filters: ActivityFilters;
  onChange: (next: ActivityFilters) => void;
  transactions: RecentTransaction[];
  categories: ActualCategory[];
  categoryGroups?: ActualCategoryGroup[];
  accounts: ActualAccount[];
  resultCount: number;
}) {
  // Only offer categories/accounts that appear in the loaded activity, with how often they appear.
  const { categoryCounts, accountCounts, uncategorized } = useMemo(() => {
    const cats = new Map<string, number>();
    const accts = new Map<string, number>();
    let none = 0;
    for (const t of transactions) {
      if (t.category) cats.set(t.category, (cats.get(t.category) || 0) + 1);
      else if (!t.isTransfer) none++;
      accts.set(t.account, (accts.get(t.account) || 0) + 1);
    }
    return { categoryCounts: cats, accountCounts: accts, uncategorized: none };
  }, [transactions]);

  const categoryOptions = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c]));
    const groups: SelectGroup[] = [{ label: 'Any', options: [{ value: ANY, label: 'All categories' }] }];
    const seen = new Set<string>();
    for (const g of categoryGroups) {
      const opts: SelectOption[] = categories
        .filter((c) => c.group_id === g.id && categoryCounts.has(c.id))
        .map((c) => {
          seen.add(c.id);
          return { value: c.id, label: c.name, hint: categoryCounts.get(c.id) };
        });
      if (opts.length) groups.push({ label: g.name, options: opts });
    }
    const rest: SelectOption[] = [...categoryCounts.keys()]
      .filter((id) => !seen.has(id))
      .map((id) => ({ value: id, label: byId.get(id)?.name || 'Unknown category', hint: categoryCounts.get(id) }));
    if (uncategorized) rest.push({ value: '', label: 'Uncategorized', hint: uncategorized });
    if (rest.length) groups.push({ label: 'Other', options: rest });
    return groups;
  }, [categories, categoryGroups, categoryCounts, uncategorized]);

  const accountOptions = useMemo<SelectOption[]>(() => {
    const names = new Map(accounts.map((a) => [a.id, a.name]));
    const used = [...accountCounts.entries()]
      .map(([id, n]) => ({ value: id, label: names.get(id) || 'Unknown account', hint: n }))
      .sort((a, b) => b.hint - a.hint);
    return [{ value: ANY, label: 'All accounts' }, ...used];
  }, [accounts, accountCounts]);

  const kinds = Object.keys(KIND_LABELS) as ActivityKind[];
  const active = activeFilterCount(filters);

  return (
    <Sheet open={open} onClose={onClose} title="Filter activity" subtitle="Last 60 days">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <span className="text-label" style={{ color: 'var(--text-muted)' }}>
            Type
          </span>
          <div role="radiogroup" aria-label="Type" className="grid grid-cols-4 gap-1 rounded-2xl p-1" style={{ backgroundColor: 'var(--bg-subtle)' }}>
            {kinds.map((k) => {
              const on = filters.kind === k;
              return (
                <Button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onChange({ ...filters, kind: k })}
                  className="h-10 min-w-0 truncate rounded-xl px-1 text-label transition-colors duration-150"
                  style={{ backgroundColor: on ? 'var(--accent)' : 'transparent', color: on ? 'var(--accent-fg)' : 'var(--text-muted)' }}
                >
                  {k === 'all' ? 'All' : k === 'out' ? 'Out' : k === 'in' ? 'In' : 'Transfers'}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="activity-filter-category" className="text-label" style={{ color: 'var(--text-muted)' }}>
            Category
          </label>
          <Select
            id="activity-filter-category"
            value={filters.categoryId ?? ANY}
            options={categoryOptions}
            onValueChange={(v) => onChange({ ...filters, categoryId: v === ANY ? null : v })}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="activity-filter-account" className="text-label" style={{ color: 'var(--text-muted)' }}>
            Account
          </label>
          <Select
            id="activity-filter-account"
            value={filters.accountId ?? ANY}
            options={accountOptions}
            onValueChange={(v) => onChange({ ...filters, accountId: v === ANY ? null : v })}
          />
        </div>

        <div className="mt-1 flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={active === 0}
            onClick={() => onChange(NO_FILTERS)}
            className="h-12 flex-1 rounded-2xl text-body disabled:opacity-40"
          >
            Clear all
          </Button>
          <Button type="button" variant="default" onClick={onClose} className="h-12 flex-[2] rounded-2xl text-body tabular-nums">
            Show {resultCount} {resultCount === 1 ? 'transaction' : 'transactions'}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
