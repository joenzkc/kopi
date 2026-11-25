import React, { useEffect, useState } from 'react';
import type { ActualAccount, AssetType, EnrichedHolding } from '@shared/types';
import { apiFetch } from '../../lib/api';
import { HIDDEN_VALUE, useFinancialValues } from '../../lib/valueVisibility';
import { Sheet } from '../Sheet';
import { Input } from '@client/components/ui/input';
import { Select } from '@client/components/ui/select';
import { DeleteButton, Field, Segmented, SubmitButton, SymbolTile } from './parts';
import { SymbolSearch } from './SymbolSearch';
import { TYPE_META, accountOptions, changeColor, currencyOptions, visibleUnits } from './format';

interface HoldingSheetProps {
  open: boolean;
  onClose: () => void;
  editing: EnrichedHolding | null;
  initialType: AssetType;
  baseCurrency: string;
  accounts: ActualAccount[];
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}

const TYPE_OPTIONS: Array<{ value: AssetType; label: string }> = [
  { value: 'stock', label: 'Stock' },
  { value: 'etf', label: 'ETF' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'cash', label: 'Cash' },
];

export function HoldingSheet({ open, onClose, editing, initialType, baseCurrency: cur, accounts, onSaved, onError }: HoldingSheetProps) {
  const [assetType, setAssetType] = useState<AssetType>('stock');
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [providerId, setProviderId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [avgCost, setAvgCost] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [actualAccountId, setActualAccountId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setAssetType(editing.asset_type);
      setSymbol(editing.symbol);
      setName(editing.name);
      setProviderId(editing.provider_id);
      setQuantity(String(editing.quantity));
      setAvgCost(String(editing.avg_cost));
      setCurrency(editing.currency);
      setActualAccountId(editing.actual_account_id || '');
      setNotes(editing.notes || '');
    } else {
      const cash = initialType === 'cash';
      setAssetType(initialType);
      setSymbol(cash ? cur : '');
      setName('');
      setProviderId(cash ? `cash:${cur}` : '');
      setQuantity('');
      setAvgCost(cash ? '1' : '');
      setCurrency(cash ? cur : 'USD');
      setActualAccountId('');
      setNotes('');
    }
  }, [open, editing, initialType, cur]);

  const accountMap = new Map(accounts.map((a) => [a.id, a.name]));
  const isCash = assetType === 'cash';

  function changeType(next: AssetType) {
    setAssetType(next);
    if (next === 'crypto') setCurrency('USD');
    if (next === 'cash') {
      setCurrency(cur);
      setSymbol(cur);
      setProviderId(`cash:${cur}`);
      setAvgCost('1');
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const qtyNum = Number(quantity);
    const costNum = Number(avgCost || 0);
    if (!Number.isFinite(qtyNum) || (isCash ? qtyNum < 0 : qtyNum <= 0)) {
      onError(isCash ? 'Enter a cash amount of 0 or more' : 'Enter a quantity above 0');
      return;
    }
    setSaving(true);
    try {
      const ccy = currency.trim().toUpperCase() || cur;
      const linkedName = actualAccountId ? accountMap.get(actualAccountId) : undefined;
      const defaultCashName = linkedName ? `${linkedName} ${ccy} cash` : `${ccy} cash`;
      const payload = isCash
        ? {
            symbol: ccy,
            name: name.trim() || defaultCashName,
            asset_type: 'cash' as const,
            provider_id: `cash:${ccy}`,
            quantity: qtyNum,
            avg_cost: 1,
            currency: ccy,
            actual_account_id: actualAccountId || null,
            notes: notes.trim() || null,
          }
        : {
            symbol: symbol.trim().toUpperCase(),
            name: name.trim() || symbol.trim().toUpperCase(),
            asset_type: assetType,
            provider_id: providerId.trim() || symbol.trim(),
            quantity: qtyNum,
            avg_cost: Number.isFinite(costNum) ? costNum : 0,
            currency: ccy,
            actual_account_id: actualAccountId || null,
            notes: notes.trim() || null,
          };
      const label = isCash ? payload.name : payload.symbol;
      if (editing) {
        await apiFetch(`/api/portfolio/holdings/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        onSaved(`Updated ${label}`);
      } else {
        await apiFetch('/api/portfolio/holdings', { method: 'POST', body: JSON.stringify(payload) });
        onSaved(`Added ${label}`);
      }
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editing) return;
    setSaving(true);
    try {
      await apiFetch(`/api/portfolio/holdings/${editing.id}`, { method: 'DELETE' });
      onSaved(`Removed ${editing.asset_type === 'cash' ? editing.name : editing.symbol}`);
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setSaving(false);
    }
  }

  const title = editing
    ? editing.asset_type === 'cash'
      ? editing.name
      : editing.symbol
    : isCash
      ? 'Add cash'
      : 'Add holding';
  const subtitle = isCash
    ? `Uninvested ${cur} or foreign cash in a brokerage account`
    : assetType === 'crypto'
      ? 'Live prices from CoinGecko'
      : 'Live prices from Yahoo Finance';

  return (
    <Sheet financialForm open={open} onClose={onClose} title={title} subtitle={subtitle}>
      <form onSubmit={handleSave} className="flex flex-col gap-4">
        {editing && <HoldingSummary holding={editing} baseCurrency={cur} />}

        <Segmented value={assetType} onChange={changeType} options={TYPE_OPTIONS} ariaLabel="Holding type" />

        {isCash ? (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Balance" htmlFor="h-qty" className="col-span-2">
                <Input
                  id="h-qty"
                  required
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="0.00"
                  className="tabular-nums"
                />
              </Field>
              <Field label="Currency">
                <Select
                  aria-label="Currency"
                  value={currency}
                  onValueChange={(v) => {
                    setCurrency(v);
                    setSymbol(v);
                    setProviderId(`cash:${v}`);
                  }}
                  options={currencyOptions()}
                />
              </Field>
            </div>
            <Field label="Label" htmlFor="h-name">
              <Input id="h-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={`e.g. Brokerage ${currency} cash`} />
            </Field>
          </>
        ) : (
          <>
            {!editing && (
              <SymbolSearch
                type={assetType === 'crypto' ? 'crypto' : assetType === 'etf' ? 'etf' : 'stock'}
                label={assetType === 'crypto' ? 'Find a coin' : 'Find a ticker'}
                placeholder={assetType === 'crypto' ? 'Bitcoin, ethereum…' : 'Ticker or company name'}
                help={assetType === 'crypto' ? undefined : 'Exchange suffixes work too, e.g. D05.SI or VWRA.L'}
                onPick={(hit) => {
                  setAssetType(hit.asset_type);
                  setSymbol(hit.symbol);
                  setName(hit.name);
                  setProviderId(hit.provider_id);
                  setCurrency(hit.currency);
                }}
              />
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Symbol" htmlFor="h-symbol">
                <Input id="h-symbol" required value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="ACME" autoCapitalize="characters" />
              </Field>
              <Field label={assetType === 'crypto' ? 'CoinGecko ID' : 'Yahoo ticker'} htmlFor="h-provider">
                <Input
                  id="h-provider"
                  required
                  value={providerId}
                  onChange={(e) => setProviderId(e.target.value)}
                  placeholder={assetType === 'crypto' ? 'bitcoin' : 'ACME'}
                />
              </Field>
            </div>
            <Field label="Name" htmlFor="h-name">
              <Input id="h-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp." />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Quantity" htmlFor="h-qty">
                <Input
                  id="h-qty"
                  required
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="0"
                  className="tabular-nums"
                />
              </Field>
              <Field label="Avg cost" htmlFor="h-cost">
                <Input
                  id="h-cost"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={avgCost}
                  onChange={(e) => setAvgCost(e.target.value)}
                  placeholder="0.00"
                  className="tabular-nums"
                />
              </Field>
              <Field label="Currency">
                <Select aria-label="Cost currency" value={currency} onValueChange={setCurrency} options={currencyOptions('USD')} />
              </Field>
            </div>
          </>
        )}

        <Field
          label="Actual account"
          help={
            isCash
              ? 'Linked cash is included when the account balance is synced to Actual.'
              : 'Linked holdings are included when the account balance is synced to Actual.'
          }
        >
          <Select
            aria-label="Link to Actual account"
            value={actualAccountId}
            onValueChange={(v) => {
              setActualAccountId(v);
              if (isCash && !name.trim() && v) {
                const acct = accountMap.get(v);
                if (acct) setName(`${acct} ${currency} cash`);
              }
            }}
            options={accountOptions(accounts)}
          />
        </Field>

        {isCash && (
          <Field label="Notes" htmlFor="h-notes">
            <Input id="h-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional, e.g. dividends waiting to invest" />
          </Field>
        )}

        <div className="flex flex-col gap-1 pt-1">
          <SubmitButton disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : isCash ? 'Add cash' : 'Add holding'}</SubmitButton>
          {editing && (
            <DeleteButton
              disabled={saving}
              label={editing.asset_type === 'cash' ? 'Remove cash balance' : 'Remove holding'}
              onConfirm={() => void handleDelete()}
            />
          )}
        </div>
      </form>
    </Sheet>
  );
}

/** Current position at the top of the edit sheet: value, quantity, average cost and P&L. */
function HoldingSummary({ holding: h, baseCurrency: cur }: { holding: EnrichedHolding; baseCurrency: string }) {
  const { valuesHidden, formatMoney, formatPct, formatPrice, formatWhole } = useFinancialValues();
  const isCash = h.asset_type === 'cash';
  const signedWhole = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatWhole(Math.abs(n), cur)}`;
  const cells: Array<{ label: string; value: string; color?: string }> = isCash
    ? [
        { label: 'Balance', value: formatMoney(h.quantity, h.currency) },
        { label: h.currency === cur ? 'Currency' : `FX to ${cur}`, value: h.currency === cur ? cur : valuesHidden ? HIDDEN_VALUE : h.fxRateToBase.toFixed(4) },
      ]
    : [
        { label: 'Quantity', value: valuesHidden ? HIDDEN_VALUE : visibleUnits(h.quantity) },
        { label: 'Avg cost', value: h.avg_cost > 0 ? formatPrice(h.avg_cost, h.currency) : '—' },
        {
          label: 'Today',
          value: h.price !== null ? `${formatPrice(h.price, h.priceCurrency)} · ${formatPct(h.change24hPct)}` : '—',
          color: changeColor(h.change24hPct),
        },
        {
          label: 'Total P&L',
          value: h.unrealizedPnlBase !== null && h.avg_cost > 0 ? `${signedWhole(h.unrealizedPnlBase)} · ${formatPct(h.unrealizedPnlPct)}` : '—',
          color: h.avg_cost > 0 ? changeColor(h.unrealizedPnlBase) : undefined,
        },
      ];
  const tile = TYPE_META[h.asset_type].tile;
  return (
    <div className="flex flex-col gap-3 rounded-2xl p-4" style={{ backgroundColor: 'var(--bg-subtle)' }}>
      <div className="flex items-center gap-3">
        <SymbolTile symbol={isCash ? h.currency : h.symbol} tile={tile} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-caption" style={{ color: 'var(--text-muted)' }}>
            {isCash ? 'Cash balance' : h.name}
          </span>
          <span className="text-stat tabular-nums">{h.marketValueBase !== null ? formatMoney(h.marketValueBase, cur) : 'Quote unavailable'}</span>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        {cells.map((c) => (
          <div key={c.label} className="flex min-w-0 flex-col">
            <dt className="text-caption" style={{ color: 'var(--text-muted)' }}>
              {c.label}
            </dt>
            <dd className="truncate text-body font-semibold tabular-nums" style={c.color ? { color: c.color } : undefined}>
              {c.value}
            </dd>
          </div>
        ))}
      </dl>
      {h.stale && (
        <p className="text-caption" style={{ color: 'var(--warning)' }}>
          Showing the last cached price; the live quote could not be fetched.
        </p>
      )}
    </div>
  );
}
