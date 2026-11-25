import { Award, Banknote, Link2, LineChart, Plus, RefreshCcw } from 'lucide-react';
import type { AssetType, EnrichedHolding } from '@shared/types';
import { HIDDEN_VALUE, useFinancialValues } from '../../lib/valueVisibility';
import { Button } from '@client/components/ui/button';
import { Menu } from '@client/components/ui/menu';
import { Segmented, SectionHeader, SymbolTile } from './parts';
import { HOLDING_GROUP_ORDER, TYPE_META, changeColor, visibleUnits, type ChangeMode, type PortfolioFilter } from './format';

/** "+ Add" menu: the page's only action button (add holding / cash / RSU grant, sync with Actual). */
export function AddMenu({
  onAddHolding,
  onAddCash,
  onAddRsu,
  onSync,
  syncing,
}: {
  onAddHolding: () => void;
  onAddCash: () => void;
  onAddRsu: () => void;
  onSync: () => void;
  syncing: boolean;
}) {
  return (
    <Menu
      trigger={
        <Button type="button" variant="secondary" className="flex h-9 items-center gap-1.5 rounded-full pl-3 pr-3.5 text-label">
          <Plus className="h-4 w-4" />
          Add
        </Button>
      }
      items={[
        { label: 'Add holding', icon: <LineChart />, onSelect: onAddHolding },
        { label: 'Add cash', icon: <Banknote />, onSelect: onAddCash },
        { label: 'Add RSU grant', icon: <Award />, onSelect: onAddRsu },
        { type: 'separator' },
        {
          label: syncing ? 'Syncing…' : 'Sync with Actual',
          icon: <RefreshCcw />,
          onSelect: onSync,
          disabled: syncing,
        },
      ]}
    />
  );
}

export function ChangeModeToggle({ value, onChange }: { value: ChangeMode; onChange: (m: ChangeMode) => void }) {
  return (
    <Segmented
      size="sm"
      value={value}
      onChange={onChange}
      ariaLabel="Change shown for each holding"
      options={[
        { value: 'today', label: 'Today' },
        { value: 'all', label: 'All-time' },
      ]}
    />
  );
}

/** Holdings grouped by type; each group is one card of divider-separated rows. */
export function HoldingGroups({
  holdings,
  byType,
  filter,
  mode,
  baseCurrency,
  accountMap,
  onOpen,
}: {
  holdings: EnrichedHolding[];
  byType: Record<AssetType, number>;
  filter: PortfolioFilter;
  mode: ChangeMode;
  baseCurrency: string;
  accountMap: Map<string, string>;
  onOpen: (h: EnrichedHolding) => void;
}) {
  const { formatMoney } = useFinancialValues();
  const groups = HOLDING_GROUP_ORDER.filter((t) => filter === 'all' || filter === t)
    .map((type) => ({ type, rows: holdings.filter((h) => h.asset_type === type) }))
    .filter((g) => g.rows.length > 0);

  return (
    <>
      {groups.map((g) => (
        <section key={g.type} className="flex flex-col gap-2">
          <SectionHeader
            title={TYPE_META[g.type].label}
            right={
              <span className="text-body font-semibold tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {formatMoney(byType[g.type] ?? 0, baseCurrency)}
              </span>
            }
          />
          <div className="flex flex-col rounded-3xl px-4" style={{ backgroundColor: 'var(--bg-surface)' }}>
            {g.rows.map((h, i) => (
              <HoldingRow key={h.id} holding={h} first={i === 0} mode={mode} baseCurrency={baseCurrency} accountMap={accountMap} onOpen={onOpen} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function HoldingRow({
  holding: h,
  first,
  mode,
  baseCurrency: cur,
  accountMap,
  onOpen,
}: {
  holding: EnrichedHolding;
  first: boolean;
  mode: ChangeMode;
  baseCurrency: string;
  accountMap: Map<string, string>;
  onOpen: (h: EnrichedHolding) => void;
}) {
  const { valuesHidden, formatMoney, formatPct, formatWhole } = useFinancialValues();
  const isCash = h.asset_type === 'cash';
  const linkedName = h.actual_account_id ? accountMap.get(h.actual_account_id) || 'Linked' : null;

  const qty = valuesHidden ? HIDDEN_VALUE : visibleUnits(h.quantity);
  const meta = isCash
    ? h.currency !== cur
      ? formatMoney(h.quantity, h.currency)
      : !valuesHidden && h.notes
        ? h.notes
        : 'Cash'
    : `${qty} ${h.asset_type === 'crypto' ? h.symbol : 'sh'}`;

  const signedWhole = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatWhole(Math.abs(n), cur)}`;
  let sub: { text: string; color: string };
  if (isCash) {
    sub = { text: h.currency, color: 'var(--text-muted)' };
  } else if (mode === 'today') {
    sub =
      h.dayChangeBase !== null && h.change24hPct !== null
        ? { text: `${signedWhole(h.dayChangeBase)} · ${formatPct(h.change24hPct)}`, color: changeColor(h.change24hPct) }
        : { text: '—', color: 'var(--text-muted)' };
  } else {
    sub =
      h.unrealizedPnlBase !== null && h.avg_cost > 0
        ? { text: `${signedWhole(h.unrealizedPnlBase)} · ${formatPct(h.unrealizedPnlPct)}`, color: changeColor(h.unrealizedPnlBase) }
        : { text: 'No cost basis', color: 'var(--text-muted)' };
  }

  return (
    <Button
      type="button"
      onClick={() => onOpen(h)}
      aria-label={`Edit ${isCash ? h.name : h.symbol}`}
      className="press flex w-full items-center gap-3 py-3 text-left"
      style={{ borderTop: first ? 'none' : '1px solid var(--border-subtle)' }}
    >
      <SymbolTile symbol={isCash ? h.currency : h.symbol} tile={TYPE_META[h.asset_type].tile} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body">{isCash ? h.name : h.name || h.symbol}</span>
        <span className="flex min-w-0 items-center gap-1 text-caption tabular-nums" style={{ color: 'var(--text-muted)' }}>
          <span className="max-w-[75%] shrink-0 truncate">
            {isCash || h.asset_type === 'crypto' ? meta : `${h.symbol} · ${meta}`}
          </span>
          {linkedName && (
            <span className="flex min-w-0 shrink items-center gap-1" title={`Linked to ${linkedName} in Actual`}>
              <span aria-hidden="true">·</span>
              <Link2 className="h-3 w-3 shrink-0" aria-label="Linked to" />
              <span className="truncate">{linkedName}</span>
            </span>
          )}
          {h.stale && (
            <span className="shrink-0" style={{ color: 'var(--warning)' }}>
              · cached
            </span>
          )}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end">
        <span className="text-body font-semibold tabular-nums">{h.marketValueBase !== null ? formatMoney(h.marketValueBase, cur) : 'No quote'}</span>
        <span className="text-caption tabular-nums" style={{ color: sub.color }}>
          {sub.text}
        </span>
      </span>
    </Button>
  );
}
