import React, { useEffect, useState } from 'react';
import { Calendar, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import type { ActualAccount, EnrichedRsuGrant, RsuTrancheStatus } from '@shared/types';
import {
  VESTING_PRESETS,
  generateVestingSchedule,
  type VestingFrequency,
  type VestingPreset,
} from '@shared/rsu';
import { apiFetch } from '../lib/api';
import { Sheet } from './Sheet';

interface StockSearchHit {
  symbol: string;
  name: string;
  asset_type: 'stock' | 'etf' | 'crypto';
  provider_id: string;
  exchange?: string;
  currency: string;
}

interface DraftTranche {
  key: string;
  id?: string;
  vest_date: string;
  units: string;
  status: RsuTrancheStatus;
  vested_price: number | null;
  withheld_units: number;
  notes: string | null;
}

interface RsuGrantSheetProps {
  open: boolean;
  onClose: () => void;
  editing: EnrichedRsuGrant | null;
  accounts: ActualAccount[];
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}

function todayLocalIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function RsuGrantSheet({ open, onClose, editing, accounts, onSaved, onError }: RsuGrantSheetProps) {
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [providerId, setProviderId] = useState('');
  const [grantName, setGrantName] = useState('');
  const [grantDate, setGrantDate] = useState(todayLocalIso());
  const [grantPrice, setGrantPrice] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [taxWithholdPct, setTaxWithholdPct] = useState('0');
  const [includeInTotal, setIncludeInTotal] = useState(true);
  const [actualAccountId, setActualAccountId] = useState('');
  const [notes, setNotes] = useState('');

  // Vesting generator controls
  const [preset, setPreset] = useState<VestingPreset>('standard_4yr_cliff_qtr');
  const [totalUnits, setTotalUnits] = useState('');
  const [vestStartDate, setVestStartDate] = useState(todayLocalIso());
  const [customYears, setCustomYears] = useState('4');
  const [customFreq, setCustomFreq] = useState<VestingFrequency>('quarterly');
  const [customCliff, setCustomCliff] = useState('12');
  const [roundWhole, setRoundWhole] = useState(true);
  const [manualOverride, setManualOverride] = useState(false);

  const [tranches, setTranches] = useState<DraftTranche[]>([]);
  const [saving, setSaving] = useState(false);

  // Ticker search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<StockSearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setSymbol(editing.symbol);
      setName(editing.name);
      setProviderId(editing.provider_id);
      setGrantName(editing.grant_name);
      setGrantDate(editing.grant_date);
      setGrantPrice(editing.grant_price > 0 ? String(editing.grant_price) : '');
      setCurrency(editing.currency);
      setTaxWithholdPct(String(editing.tax_withhold_pct));
      setIncludeInTotal(editing.include_in_total);
      setActualAccountId(editing.actual_account_id || '');
      setNotes(editing.notes || '');
      setTotalUnits(String(editing.totalUnits));
      setVestStartDate(editing.grant_date);
      setManualOverride(true);
      setTranches(
        editing.tranches.map((t, i) => ({
          key: t.id || `tr-${i}`,
          id: t.id,
          vest_date: t.vest_date,
          units: String(t.units),
          status: t.status,
          vested_price: t.vested_price,
          withheld_units: t.withheld_units,
          notes: t.notes,
        })),
      );
    } else {
      const today = todayLocalIso();
      setSymbol('');
      setName('');
      setProviderId('');
      setGrantName('');
      setGrantDate(today);
      setGrantPrice('');
      setCurrency('USD');
      setTaxWithholdPct('0');
      setIncludeInTotal(true);
      setActualAccountId('');
      setNotes('');
      setPreset('standard_4yr_cliff_qtr');
      setTotalUnits('');
      setVestStartDate(today);
      setCustomYears('4');
      setCustomFreq('quarterly');
      setCustomCliff('12');
      setRoundWhole(true);
      setManualOverride(false);
      setTranches([]);
    }
    setSearchQuery('');
    setSearchResults([]);
  }, [open, editing]);

  // Yahoo ticker search
  useEffect(() => {
    if (!open || editing || searchQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await apiFetch<{ results: StockSearchHit[] }>(
          `/api/portfolio/search?q=${encodeURIComponent(searchQuery.trim())}&type=stock`,
        );
        setSearchResults(res.results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, open, editing]);

  // Auto-generate schedule when creating a new grant and user hasn't manually edited rows
  useEffect(() => {
    if (!open || editing || manualOverride) return;
    const unitsNum = Number(totalUnits);
    if (!Number.isFinite(unitsNum) || unitsNum <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(vestStartDate)) {
      setTranches([]);
      return;
    }
    const generated = generateVestingSchedule({
      preset,
      totalUnits: unitsNum,
      startDate: vestStartDate,
      years: Number(customYears) || 4,
      cliffMonths: Number(customCliff) || 0,
      frequency: customFreq,
      roundWholeShares: roundWhole,
    });
    setTranches(
      generated.map((t, i) => ({
        key: `gen-${i}-${t.vest_date}`,
        vest_date: t.vest_date,
        units: String(t.units),
        status: t.status,
        vested_price: null,
        withheld_units: 0,
        notes: null,
      })),
    );
  }, [open, editing, manualOverride, preset, totalUnits, vestStartDate, customYears, customCliff, customFreq, roundWhole]);

  function regenerateNow() {
    const unitsNum = Number(totalUnits);
    if (!Number.isFinite(unitsNum) || unitsNum <= 0) {
      onError('Enter total granted units first');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(vestStartDate)) {
      onError('Enter a valid vesting start date');
      return;
    }
    const generated = generateVestingSchedule({
      preset,
      totalUnits: unitsNum,
      startDate: vestStartDate,
      years: Number(customYears) || 4,
      cliffMonths: Number(customCliff) || 0,
      frequency: customFreq,
      roundWholeShares: roundWhole,
    });
    setManualOverride(false);
    setTranches(
      generated.map((t, i) => ({
        key: `gen-${Date.now()}-${i}`,
        vest_date: t.vest_date,
        units: String(t.units),
        status: t.status,
        vested_price: null,
        withheld_units: 0,
        notes: null,
      })),
    );
  }

  function pickSearchHit(hit: StockSearchHit) {
    setSymbol(hit.symbol);
    setName(hit.name);
    setProviderId(hit.provider_id);
    setCurrency(hit.currency);
    setSearchQuery('');
    setSearchResults([]);
  }

  function addManualTranche() {
    setManualOverride(true);
    const lastDate = tranches.length > 0 ? tranches[tranches.length - 1].vest_date : vestStartDate || todayLocalIso();
    setTranches((prev) => [
      ...prev,
      {
        key: `man-${Date.now()}-${Math.random()}`,
        vest_date: lastDate,
        units: '',
        status: 'scheduled',
        vested_price: null,
        withheld_units: 0,
        notes: null,
      },
    ]);
  }

  function updateTranche(key: string, patch: Partial<DraftTranche>) {
    setManualOverride(true);
    setTranches((prev) => prev.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  }

  function removeTranche(key: string) {
    setManualOverride(true);
    setTranches((prev) => prev.filter((t) => t.key !== key));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!symbol.trim()) {
      onError('Enter a stock symbol');
      return;
    }
    const parsedTranches = tranches.map((t) => ({
      id: t.id,
      vest_date: t.vest_date.trim(),
      units: Number(t.units),
      status: t.status,
      vested_price: t.vested_price,
      withheld_units: t.withheld_units || 0,
      notes: t.notes,
    }));

    if (parsedTranches.length === 0) {
      onError('Add at least one vesting tranche');
      return;
    }
    for (const t of parsedTranches) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t.vest_date)) {
        onError('Every vesting tranche needs a valid YYYY-MM-DD date');
        return;
      }
      if (!Number.isFinite(t.units) || t.units <= 0) {
        onError('Every vesting tranche needs units > 0');
        return;
      }
    }

    const grantPriceNum = Number(grantPrice || 0);
    const taxNum = Number(taxWithholdPct || 0);
    if (!Number.isFinite(taxNum) || taxNum < 0 || taxNum >= 100) {
      onError('Tax withholding % must be between 0 and 99');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        symbol: symbol.trim().toUpperCase(),
        name: name.trim() || symbol.trim().toUpperCase(),
        provider_id: providerId.trim() || symbol.trim().toUpperCase(),
        grant_name: grantName.trim(),
        grant_date: grantDate,
        grant_price: Number.isFinite(grantPriceNum) && grantPriceNum >= 0 ? grantPriceNum : 0,
        currency: currency.trim().toUpperCase() || 'USD',
        tax_withhold_pct: taxNum,
        include_in_total: includeInTotal,
        actual_account_id: actualAccountId || null,
        notes: notes.trim() || null,
        tranches: parsedTranches,
      };

      if (editing) {
        await apiFetch(`/api/portfolio/rsus/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        onSaved(`Updated ${payload.symbol} RSU grant`);
      } else {
        await apiFetch('/api/portfolio/rsus', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        onSaved(`Added ${payload.symbol} RSU grant (${parsedTranches.length} vests)`);
      }
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save RSU grant');
    } finally {
      setSaving(false);
    }
  }

  const offBudgetAccounts = accounts.filter((a) => a.offbudget);
  const today = todayLocalIso();
  const sumTrancheUnits = tranches.reduce((acc, t) => acc + (Number(t.units) || 0), 0);
  const presetInfo = VESTING_PRESETS.find((p) => p.id === preset);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${editing.symbol} RSU Grant` : 'Add RSU Grant & Vesting'}
      subtitle="Live stock valuation · past vest dates auto-vest into holdings"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Yahoo ticker search */}
        {!editing && (
          <div className="relative">
            <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              Search company stock ticker (Yahoo Finance)
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4" style={{ color: 'var(--text-muted)' }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by ticker or company name..."
                className="input-field pl-9"
              />
            </div>
            {(searching || searchResults.length > 0) && (
              <div
                className="mt-1.5 max-h-44 overflow-y-auto rounded-xl shadow-lg"
                style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
              >
                {searching && (
                  <div className="p-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                    Searching...
                  </div>
                )}
                {searchResults.map((hit) => (
                  <button
                    key={`${hit.asset_type}:${hit.provider_id}`}
                    type="button"
                    onClick={() => pickSearchHit(hit)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-xs transition hover:opacity-80"
                    style={{ borderBottom: '1px solid var(--border-subtle)' }}
                  >
                    <div className="min-w-0">
                      <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {hit.symbol}
                      </span>
                      <span className="ml-2 truncate" style={{ color: 'var(--text-muted)' }}>
                        {hit.name}
                      </span>
                    </div>
                    <span className="ml-2 shrink-0 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      {hit.exchange || hit.currency}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Symbol + Ticker + Name */}
        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              Symbol
            </label>
            <input required value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="ACME" className="input-field" />
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              Yahoo Ticker
            </label>
            <input
              required
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
              placeholder="ACME"
              className="input-field"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              Company Name
            </label>
            <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp." className="input-field" />
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              Grant Label (optional)
            </label>
            <input
              value={grantName}
              onChange={(e) => setGrantName(e.target.value)}
              placeholder="e.g. New-hire grant"
              className="input-field"
            />
          </div>
        </div>

        {/* Grant date, price, currency */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <div className="col-span-2 min-w-0 sm:col-span-1">
            <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              Grant Date
            </label>
            <input
              required
              type="date"
              value={grantDate}
              onChange={(e) => {
                const next = e.target.value;
                setGrantDate(next);
                if (!editing && !manualOverride) setVestStartDate(next);
              }}
              className="input-field"
            />
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              Grant Price
            </label>
            <input
              type="number"
              step="any"
              min="0"
              value={grantPrice}
              onChange={(e) => setGrantPrice(e.target.value)}
              placeholder="Optional"
              className="input-field"
            />
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              Currency
            </label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="input-field">
              {['USD', 'SGD', 'EUR', 'GBP', 'HKD', 'JPY', 'AUD'].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Vesting Schedule Generator */}
        <div className="rounded-2xl p-3.5 space-y-3" style={{ backgroundColor: 'var(--bg-subtle)' }}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
              <Calendar className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--accent-text)' }} />
              Vesting Schedule Builder
            </div>
            {editing && (
              <button
                type="button"
                onClick={regenerateNow}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition hover:opacity-80"
                style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)' }}
              >
                <RefreshCw className="h-3 w-3" />
                Regenerate
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div className="min-w-0">
              <label className="mb-1 block text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                Total Shares Granted
              </label>
              <input
                type="number"
                step="any"
                min="0"
                value={totalUnits}
                onChange={(e) => {
                  setTotalUnits(e.target.value);
                  if (!editing) setManualOverride(false);
                }}
                placeholder="e.g. 100"
                className="input-field"
                style={{ backgroundColor: 'var(--bg-surface)' }}
              />
            </div>
            <div className="min-w-0">
              <label className="mb-1 block text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                Vesting Start Date
              </label>
              <input
                type="date"
                value={vestStartDate}
                onChange={(e) => {
                  setVestStartDate(e.target.value);
                  if (!editing) setManualOverride(false);
                }}
                className="input-field"
                style={{ backgroundColor: 'var(--bg-surface)' }}
              />
            </div>
          </div>

          {/* Preset selector chips */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              <span>Schedule Preset</span>
              <label className="inline-flex shrink-0 items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={roundWhole}
                  onChange={(e) => {
                    setRoundWhole(e.target.checked);
                    if (!editing) setManualOverride(false);
                  }}
                />
                <span>Whole shares</span>
              </label>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {VESTING_PRESETS.map((p) => {
                const active = preset === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setPreset(p.id);
                      if (!editing) setManualOverride(false);
                    }}
                    className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition"
                    style={{
                      backgroundColor: active ? 'var(--accent-soft)' : 'var(--bg-surface)',
                      color: active ? 'var(--accent-text)' : 'var(--text-secondary)',
                      border: `1px solid ${active ? 'var(--accent-border)' : 'var(--border-subtle)'}`,
                    }}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            {presetInfo && (
              <p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {presetInfo.description}
              </p>
            )}
          </div>

          {preset === 'custom' && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div className="min-w-0">
                <label className="mb-1 block text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                  Years
                </label>
                <input
                  type="number"
                  min="1"
                  max="6"
                  value={customYears}
                  onChange={(e) => {
                    setCustomYears(e.target.value);
                    if (!editing) setManualOverride(false);
                  }}
                  className="input-field"
                  style={{ backgroundColor: 'var(--bg-surface)' }}
                />
              </div>
              <div className="min-w-0">
                <label className="mb-1 block text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                  Cliff (mo)
                </label>
                <select
                  value={customCliff}
                  onChange={(e) => {
                    setCustomCliff(e.target.value);
                    if (!editing) setManualOverride(false);
                  }}
                  className="input-field"
                  style={{ backgroundColor: 'var(--bg-surface)' }}
                >
                  <option value="0">None</option>
                  <option value="6">6 mo</option>
                  <option value="12">12 mo</option>
                  <option value="18">18 mo</option>
                  <option value="24">24 mo</option>
                </select>
              </div>
              <div className="col-span-2 min-w-0 sm:col-span-1">
                <label className="mb-1 block text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                  Frequency
                </label>
                <select
                  value={customFreq}
                  onChange={(e) => {
                    setCustomFreq(e.target.value as VestingFrequency);
                    if (!editing) setManualOverride(false);
                  }}
                  className="input-field"
                  style={{ backgroundColor: 'var(--bg-surface)' }}
                >
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="semiannual">Semi-Annual</option>
                  <option value="annual">Annual</option>
                </select>
              </div>
            </div>
          )}

          {/* Editable Tranches List */}
          <div className="pt-1">
            <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] tabular-nums">
              <span className="truncate font-semibold" style={{ color: 'var(--text-primary)' }}>
                Tranches ({tranches.length}) · {Number(sumTrancheUnits.toFixed(4))} sh
              </span>
              <button
                type="button"
                onClick={addManualTranche}
                className="inline-flex shrink-0 items-center gap-1 font-semibold transition hover:opacity-80"
                style={{ color: 'var(--accent-text)' }}
              >
                <Plus className="h-3 w-3" />
                Add date
              </button>
            </div>

            {tranches.length === 0 ? (
              <div
                className="rounded-xl p-3 text-center text-xs"
                style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-muted)' }}
              >
                Enter total shares above to generate vesting dates, or click &ldquo;Add date&rdquo; for a custom schedule.
              </div>
            ) : (
              <div
                className="max-h-60 divide-y overflow-y-auto rounded-xl"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderColor: 'var(--border-subtle)',
                }}
              >
                {tranches.map((t) => {
                  const isPast = t.vest_date <= today;
                  const badgeText =
                    t.status === 'sold'
                      ? 'Sold'
                      : t.status === 'forfeited'
                        ? 'Forfeited'
                        : t.status === 'vested' || isPast
                          ? 'Vested'
                          : 'Upcoming';
                  const badgeColor =
                    badgeText === 'Vested'
                      ? 'var(--positive)'
                      : badgeText === 'Sold'
                        ? 'var(--info)'
                        : badgeText === 'Forfeited'
                          ? 'var(--negative)'
                          : 'var(--text-muted)';
                  return (
                    <div
                      key={t.key}
                      className="flex flex-col gap-2 p-2.5 sm:flex-row sm:items-center sm:gap-2"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <input
                          type="date"
                          required
                          value={t.vest_date}
                          onChange={(e) => updateTranche(t.key, { vest_date: e.target.value })}
                          className="input-field min-w-0 flex-1 !py-1.5 !px-2.5 sm:!text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => removeTranche(t.key)}
                          className="shrink-0 rounded-lg p-1.5 transition hover:opacity-80 sm:hidden"
                          style={{ color: 'var(--negative)' }}
                          aria-label="Remove tranche"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 sm:shrink-0">
                        <input
                          type="number"
                          required
                          step="any"
                          min="0"
                          value={t.units}
                          onChange={(e) => updateTranche(t.key, { units: e.target.value })}
                          placeholder="Shares"
                          className="input-field min-w-0 flex-1 !py-1.5 !px-2.5 text-right tabular-nums sm:w-20 sm:flex-none sm:!text-xs"
                        />
                        <span
                          className="w-16 shrink-0 text-center text-[11px] font-semibold"
                          style={{ color: badgeColor }}
                        >
                          {badgeText}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeTranche(t.key)}
                          className="hidden shrink-0 rounded-lg p-1 transition hover:opacity-80 sm:inline-flex"
                          style={{ color: 'var(--negative)' }}
                          aria-label="Remove tranche"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Tax withholding + Portfolio inclusion */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              Est. Tax Withholding %
            </label>
            <input
              type="number"
              step="any"
              min="0"
              max="99"
              value={taxWithholdPct}
              onChange={(e) => setTaxWithholdPct(e.target.value)}
              placeholder="0"
              className="input-field"
            />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {[0, 22, 30, 37].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => setTaxWithholdPct(String(pct))}
                  className="rounded-md px-2 py-1 text-[11px] font-medium"
                  style={{
                    backgroundColor: Number(taxWithholdPct) === pct ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                    color: Number(taxWithholdPct) === pct ? 'var(--accent-text)' : 'var(--text-muted)',
                  }}
                >
                  {pct}%
                </button>
              ))}
            </div>
          </div>

          <div className="min-w-0">
            <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              Link Actual Account (optional)
            </label>
            <select value={actualAccountId} onChange={(e) => setActualAccountId(e.target.value)} className="input-field">
              <option value="">Not linked</option>
              {(offBudgetAccounts.length > 0 ? offBudgetAccounts : accounts).map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name} {acc.offbudget ? '(Off-budget)' : '(On-budget)'}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label
          className="flex items-start gap-2.5 rounded-xl p-3 text-xs cursor-pointer"
          style={{ backgroundColor: 'var(--bg-subtle)' }}
        >
          <input
            type="checkbox"
            checked={includeInTotal}
            onChange={(e) => setIncludeInTotal(e.target.checked)}
            className="mt-0.5"
          />
          <div>
            <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
              Count vested shares in Total Investments &amp; Net Worth
            </div>
            <div className="mt-0.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Unvested RSUs are always shown separately and never inflate Net Worth. Turn this off if you already track vested shares in regular Stock holdings.
            </div>
          </div>
        </label>

        <div>
          <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            Notes (optional)
          </label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Broker name / grant ID"
            className="input-field"
          />
        </div>

        <button
          type="submit"
          disabled={saving}
          className="btn-primary w-full rounded-xl py-3 text-sm font-medium disabled:opacity-50"
        >
          {saving ? 'Saving...' : editing ? 'Save RSU Grant' : 'Add RSU Grant'}
        </button>
      </form>
    </Sheet>
  );
}
