import React, { useEffect, useState } from 'react';
import { Plus, RefreshCw, X } from 'lucide-react';
import type { ActualAccount, EnrichedRsuGrant, RsuTrancheStatus } from '@shared/types';
import {
  VESTING_PRESETS,
  generateVestingSchedule,
  type VestingFrequency,
  type VestingPreset,
} from '@shared/rsu';
import { apiFetch } from '../lib/api';
import { Sheet } from './Sheet';
import { Button } from '@client/components/ui/button';
import { Input } from '@client/components/ui/input';
import { Select } from '@client/components/ui/select';
import { Switch, SwitchThumb } from '@client/components/ui/switch';
import { DeleteButton, Field, SubmitButton } from './portfolio/parts';
import { SymbolSearch, type SearchHit } from './portfolio/SymbolSearch';
import { accountOptions, currencyOptions, todayLocalIso } from './portfolio/format';

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
  }, [open, editing]);

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

  function pickSearchHit(hit: SearchHit) {
    setSymbol(hit.symbol);
    setName(hit.name);
    setProviderId(hit.provider_id);
    setCurrency(hit.currency);
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

  async function handleDelete() {
    if (!editing) return;
    const label = editing.grant_name ? `${editing.symbol} (${editing.grant_name})` : editing.symbol;
    setSaving(true);
    try {
      await apiFetch(`/api/portfolio/rsus/${editing.id}`, { method: 'DELETE' });
      onSaved(`Removed ${label}`);
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setSaving(false);
    }
  }

  const today = todayLocalIso();
  const sumTrancheUnits = tranches.reduce((acc, t) => acc + (Number(t.units) || 0), 0);
  const presetInfo = VESTING_PRESETS.find((p) => p.id === preset);
  const onSurface = 'bg-[var(--bg-surface)]';
  /** Changing a generator input re-enables auto-generation for new grants. */
  const regen = () => {
    if (!editing) setManualOverride(false);
  };

  return (
    <Sheet
      financialForm
      open={open}
      onClose={onClose}
      title={editing ? `${editing.symbol} grant` : 'Add RSU grant'}
      subtitle="Valued at the live share price. Past vest dates vest automatically."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {!editing && (
          <SymbolSearch type="stock" label="Find the company" placeholder="Ticker or company name" onPick={pickSearchHit} />
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Symbol" htmlFor="g-symbol">
            <Input id="g-symbol" required value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="ACME" autoCapitalize="characters" />
          </Field>
          <Field label="Yahoo ticker" htmlFor="g-provider">
            <Input id="g-provider" required value={providerId} onChange={(e) => setProviderId(e.target.value)} placeholder="ACME" />
          </Field>
        </div>

        <Field label="Company" htmlFor="g-name">
          <Input id="g-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp." />
        </Field>

        <Field label="Grant label" htmlFor="g-label">
          <Input id="g-label" value={grantName} onChange={(e) => setGrantName(e.target.value)} placeholder="Optional, e.g. New-hire grant" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Grant date" htmlFor="g-date">
            <Input
              id="g-date"
              required
              type="date"
              value={grantDate}
              onChange={(e) => {
                const next = e.target.value;
                setGrantDate(next);
                if (!editing && !manualOverride) setVestStartDate(next);
              }}
            />
          </Field>
          <Field label="Currency">
            <Select aria-label="Grant currency" value={currency} onValueChange={setCurrency} options={currencyOptions('USD')} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Grant price" htmlFor="g-price">
            <Input
              id="g-price"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={grantPrice}
              onChange={(e) => setGrantPrice(e.target.value)}
              placeholder="Optional"
              className="tabular-nums"
            />
          </Field>
          <Field label="Tax withheld %" htmlFor="g-tax">
            <Input
              id="g-tax"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              max="99"
              value={taxWithholdPct}
              onChange={(e) => setTaxWithholdPct(e.target.value)}
              placeholder="0"
              className="tabular-nums"
            />
          </Field>
        </div>
        <div className="-mt-2 flex flex-wrap items-center justify-end gap-1.5" aria-label="Common tax withholding rates">
          {[0, 22, 30, 37].map((pct) => {
            const on = Number(taxWithholdPct) === pct;
            return (
              <Button
                key={pct}
                type="button"
                aria-pressed={on}
                onClick={() => setTaxWithholdPct(String(pct))}
                className="h-8 rounded-full px-3 text-label tabular-nums transition-colors duration-150"
                style={{ backgroundColor: on ? 'var(--accent)' : 'var(--bg-subtle)', color: on ? 'var(--accent-fg)' : 'var(--text-muted)' }}
              >
                {pct}%
              </Button>
            );
          })}
        </div>

        {/* Vesting schedule builder */}
        <section className="flex flex-col gap-4 rounded-2xl p-4" style={{ backgroundColor: 'var(--bg-subtle)' }} aria-label="Vesting schedule">
          <div className="flex items-center justify-between gap-2">
            <span className="text-heading">Vesting schedule</span>
            {editing && (
              <Button type="button" onClick={regenerateNow} className="flex items-center gap-1.5 text-label" style={{ color: 'var(--accent-text)' }}>
                <RefreshCw className="h-3.5 w-3.5" />
                Regenerate
              </Button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Total shares" htmlFor="g-total">
              <Input
                id="g-total"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={totalUnits}
                onChange={(e) => {
                  setTotalUnits(e.target.value);
                  regen();
                }}
                placeholder="e.g. 100"
                className={`${onSurface} tabular-nums`}
              />
            </Field>
            <Field label="Vesting starts" htmlFor="g-start">
              <Input
                id="g-start"
                type="date"
                value={vestStartDate}
                onChange={(e) => {
                  setVestStartDate(e.target.value);
                  regen();
                }}
                className={onSurface}
              />
            </Field>
          </div>

          <Field label="Schedule" help={presetInfo?.description}>
            <Select
              aria-label="Vesting schedule preset"
              value={preset}
              onValueChange={(v) => {
                setPreset(v as VestingPreset);
                regen();
              }}
              options={VESTING_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
              className={onSurface}
            />
          </Field>

          {preset === 'custom' && (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Years" htmlFor="g-years">
                <Input
                  id="g-years"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="6"
                  value={customYears}
                  onChange={(e) => {
                    setCustomYears(e.target.value);
                    regen();
                  }}
                  className={`${onSurface} tabular-nums`}
                />
              </Field>
              <Field label="Cliff">
                <Select
                  aria-label="Cliff"
                  value={customCliff}
                  onValueChange={(v) => {
                    setCustomCliff(v);
                    regen();
                  }}
                  options={[
                    { value: '0', label: 'None' },
                    { value: '6', label: '6 mo' },
                    { value: '12', label: '12 mo' },
                    { value: '18', label: '18 mo' },
                    { value: '24', label: '24 mo' },
                  ]}
                  className={onSurface}
                />
              </Field>
              <Field label="Every">
                <Select
                  aria-label="Vesting frequency"
                  value={customFreq}
                  onValueChange={(v) => {
                    setCustomFreq(v as VestingFrequency);
                    regen();
                  }}
                  options={[
                    { value: 'monthly', label: 'Month' },
                    { value: 'quarterly', label: 'Quarter' },
                    { value: 'semiannual', label: '6 months' },
                    { value: 'annual', label: 'Year' },
                  ]}
                  className={onSurface}
                />
              </Field>
            </div>
          )}

          <Switch
            checked={roundWhole}
            onCheckedChange={(v) => {
              setRoundWhole(v);
              regen();
            }}
            className="flex items-center justify-between gap-3 text-left"
          >
            <span className="flex flex-col">
              <span className="text-body">Whole shares</span>
              <span className="text-caption" style={{ color: 'var(--text-muted)' }}>
                Round each vest to whole shares
              </span>
            </span>
            <SwitchThumb className="shrink-0" />
          </Switch>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-label tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {tranches.length} vest{tranches.length === 1 ? '' : 's'} · {Number(sumTrancheUnits.toFixed(4))} sh
              </span>
              <Button type="button" onClick={addManualTranche} className="flex items-center gap-1 text-label" style={{ color: 'var(--accent-text)' }}>
                <Plus className="h-3.5 w-3.5" />
                Add date
              </Button>
            </div>
            {tranches.length === 0 ? (
              <p className="rounded-2xl p-3.5 text-center text-caption" style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-muted)' }}>
                Enter the total shares to generate vest dates, or add dates yourself.
              </p>
            ) : (
              <div className="divider-list max-h-72 overflow-y-auto overscroll-contain rounded-2xl" style={{ backgroundColor: 'var(--bg-surface)' }}>
                {tranches.map((t, i) => {
                  const past = t.vest_date <= today;
                  const st =
                    t.status === 'sold'
                      ? { label: 'Sold', color: 'var(--info)' }
                      : t.status === 'forfeited'
                        ? { label: 'Forfeited', color: 'var(--negative)' }
                        : t.status === 'vested' || past
                          ? { label: 'Vested', color: 'var(--positive)' }
                          : { label: 'Upcoming', color: 'var(--border-strong)' };
                  return (
                    <div key={t.key} className="flex items-center gap-1.5 py-1.5 pl-2.5 pr-0.5">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: st.color }} title={st.label}>
                        <span className="sr-only">{st.label}</span>
                      </span>
                      <Input
                        type="date"
                        required
                        aria-label={`Vest ${i + 1} date`}
                        value={t.vest_date}
                        onChange={(e) => updateTranche(t.key, { vest_date: e.target.value })}
                        className="min-w-0 flex-1 px-2"
                      />
                      <Input
                        type="number"
                        required
                        inputMode="decimal"
                        step="any"
                        min="0"
                        aria-label={`Vest ${i + 1} shares`}
                        value={t.units}
                        onChange={(e) => updateTranche(t.key, { units: e.target.value })}
                        placeholder="Shares"
                        className="w-16 shrink-0 px-2 text-right tabular-nums"
                      />
                      <Button
                        type="button"
                        onClick={() => removeTranche(t.key)}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
                        style={{ color: 'var(--text-muted)' }}
                        aria-label={`Remove vest ${i + 1}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
              Green dots have vested. To mark a vest as sold, open it from the grant’s vest list.
            </p>
          </div>
        </section>

        <Field label="Actual account" help="Vested shares are included when the account balance is synced to Actual.">
          <Select aria-label="Link to Actual account" value={actualAccountId} onValueChange={setActualAccountId} options={accountOptions(accounts)} />
        </Field>

        <Switch
          checked={includeInTotal}
          onCheckedChange={setIncludeInTotal}
          className="flex items-center justify-between gap-3 rounded-2xl p-3.5 text-left"
          style={{ backgroundColor: 'var(--bg-subtle)' }}
        >
          <span className="flex flex-col gap-0.5">
            <span className="text-body font-semibold">Count vested shares in totals</span>
            <span className="text-caption" style={{ color: 'var(--text-muted)' }}>
              Adds vested, held shares to Investments and net worth. Turn off if you already track them as a stock holding. Unvested shares are never counted.
            </span>
          </span>
          <SwitchThumb className="shrink-0" />
        </Switch>

        <Field label="Notes" htmlFor="g-notes">
          <Input id="g-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional, e.g. broker or grant ID" />
        </Field>

        <div className="flex flex-col gap-1 pt-1">
          <SubmitButton disabled={saving}>{saving ? 'Saving…' : editing ? 'Save grant' : 'Add grant'}</SubmitButton>
          {editing && <DeleteButton disabled={saving} label="Remove grant and its vests" onConfirm={() => void handleDelete()} />}
        </div>
      </form>
    </Sheet>
  );
}
