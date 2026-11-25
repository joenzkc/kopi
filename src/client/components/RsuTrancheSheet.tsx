import React, { useEffect, useState } from 'react';
import { CheckCircle2, Undo2 } from 'lucide-react';
import type { EnrichedRsuGrant, EnrichedRsuTranche, RsuTrancheStatus } from '@shared/types';
import { apiFetch } from '../lib/api';
import { useFinancialValues } from '../lib/valueVisibility';
import { Sheet } from './Sheet';
import { Button } from '@client/components/ui/button';
import { Input } from '@client/components/ui/input';
import { DeleteButton, Field, Segmented, SubmitButton } from './portfolio/parts';
import { formatShortDate, todayLocalIso } from './portfolio/format';

interface RsuTrancheSheetProps {
  open: boolean;
  onClose: () => void;
  grant: EnrichedRsuGrant | null;
  tranche: EnrichedRsuTranche | null; // null = adding new tranche to grant
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
  baseCurrency?: string;
}

const STATUS_OPTIONS: Array<{ value: RsuTrancheStatus; label: string; hint: string }> = [
  { value: 'scheduled', label: 'Auto', hint: 'Vests automatically on the vest date.' },
  { value: 'vested', label: 'Vested', hint: 'Vested and still held.' },
  { value: 'sold', label: 'Sold', hint: 'Vested and sold, so no longer held.' },
  { value: 'forfeited', label: 'Forfeited', hint: 'Cancelled, e.g. after leaving the company.' },
];

export function RsuTrancheSheet({ open, onClose, grant, tranche, onSaved, onError, baseCurrency = 'SGD' }: RsuTrancheSheetProps) {
  const { formatMoney } = useFinancialValues();
  const [vestDate, setVestDate] = useState(todayLocalIso());
  const [units, setUnits] = useState('');
  const [status, setStatus] = useState<RsuTrancheStatus>('scheduled');
  const [withheldUnits, setWithheldUnits] = useState('0');
  const [vestedPrice, setVestedPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !grant) return;
    if (tranche) {
      setVestDate(tranche.vest_date);
      setUnits(String(tranche.units));
      setStatus(tranche.status);
      setWithheldUnits(String(tranche.withheld_units ?? 0));
      setVestedPrice(tranche.vested_price !== null ? String(tranche.vested_price) : '');
      setNotes(tranche.notes || '');
    } else {
      setVestDate(todayLocalIso());
      setUnits('');
      setStatus('scheduled');
      setWithheldUnits('0');
      setVestedPrice('');
      setNotes('');
    }
  }, [open, grant, tranche]);

  if (!grant) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!grant) return;
    const unitsNum = Number(units);
    const withheldNum = Number(withheldUnits || 0);
    const vestPriceNum = vestedPrice.trim() === '' ? null : Number(vestedPrice);

    if (!Number.isFinite(unitsNum) || unitsNum <= 0) {
      onError('Enter a number of shares above 0');
      return;
    }
    if (!Number.isFinite(withheldNum) || withheldNum < 0 || withheldNum > unitsNum) {
      onError('Withheld shares must be between 0 and the gross shares');
      return;
    }
    if (vestPriceNum !== null && (!Number.isFinite(vestPriceNum) || vestPriceNum < 0)) {
      onError('Enter a valid vest price');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        vest_date: vestDate,
        units: unitsNum,
        status,
        withheld_units: withheldNum,
        vested_price: vestPriceNum,
        notes: notes.trim() || null,
      };
      if (tranche) {
        await apiFetch(`/api/portfolio/rsus/${grant.id}/tranches/${tranche.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        onSaved(`Updated ${grant.symbol} vest (${vestDate})`);
      } else {
        await apiFetch(`/api/portfolio/rsus/${grant.id}/tranches`, { method: 'POST', body: JSON.stringify(payload) });
        onSaved(`Added a vest to ${grant.symbol}`);
      }
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save vest');
    } finally {
      setSaving(false);
    }
  }

  /** One-tap "Mark sold" / "Mark held" for vested tranches, without touching the other fields. */
  async function toggleSold() {
    if (!grant || !tranche) return;
    const next = tranche.effectiveStatus === 'sold' ? 'vested' : 'sold';
    setSaving(true);
    try {
      await apiFetch(`/api/portfolio/rsus/${grant.id}/tranches/${tranche.id}`, { method: 'PATCH', body: JSON.stringify({ status: next }) });
      onSaved(`Marked ${grant.symbol} ${tranche.vest_date} vest as ${next === 'sold' ? 'sold' : 'held'}`);
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!grant || !tranche) return;
    setSaving(true);
    try {
      await apiFetch(`/api/portfolio/rsus/${grant.id}/tranches/${tranche.id}`, { method: 'DELETE' });
      onSaved(`Removed ${grant.symbol} vest (${tranche.vest_date})`);
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setSaving(false);
    }
  }

  const unitsNum = Number(units) || 0;
  const withheldNum = Number(withheldUnits) || 0;
  const netPreview = Math.max(0, unitsNum - withheldNum);
  const canToggleSold = tranche && (tranche.effectiveStatus === 'vested' || tranche.effectiveStatus === 'sold');
  const isSold = tranche?.effectiveStatus === 'sold';

  return (
    <Sheet
      financialForm
      open={open}
      onClose={onClose}
      title={tranche ? `${grant.symbol} vest · ${formatShortDate(tranche.vest_date)}` : `Add vest · ${grant.symbol}`}
      subtitle={grant.grant_name || grant.name}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {canToggleSold && tranche && (
          <div className="flex items-center gap-3 rounded-2xl p-3.5" style={{ backgroundColor: 'var(--bg-subtle)' }}>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-body font-semibold tabular-nums">
                {tranche.netValueBase !== null ? formatMoney(tranche.netValueBase, baseCurrency) : '—'}
              </span>
              <span className="text-caption" style={{ color: 'var(--text-muted)' }}>
                {isSold ? 'Sold, not counted as held' : 'Vested and held'}
              </span>
            </span>
            <Button
              type="button"
              variant="secondary"
              disabled={saving}
              onClick={() => void toggleSold()}
              className="flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-label disabled:opacity-50"
            >
              {isSold ? <Undo2 className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              {isSold ? 'Mark held' : 'Mark sold'}
            </Button>
          </div>
        )}

        <Field label="Status" help={STATUS_OPTIONS.find((o) => o.value === status)?.hint}>
          <Segmented value={status} onChange={setStatus} options={STATUS_OPTIONS} ariaLabel="Vest status" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Vest date" htmlFor="t-date">
            <Input id="t-date" required type="date" value={vestDate} onChange={(e) => setVestDate(e.target.value)} />
          </Field>
          <Field label="Gross shares" htmlFor="t-units">
            <Input
              id="t-units"
              required
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={units}
              onChange={(e) => setUnits(e.target.value)}
              placeholder="0"
              className="tabular-nums"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Withheld for tax"
            htmlFor="t-withheld"
            help={unitsNum > 0 ? `${Number(netPreview.toFixed(4))} shares received` : undefined}
          >
            <Input
              id="t-withheld"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={withheldUnits}
              onChange={(e) => setWithheldUnits(e.target.value)}
              placeholder="0"
              className="tabular-nums"
            />
          </Field>
          <Field label={`Vest price (${grant.currency})`} htmlFor="t-fmv" help="Cost basis for P&L after vesting">
            <Input
              id="t-fmv"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={vestedPrice}
              onChange={(e) => setVestedPrice(e.target.value)}
              placeholder={grant.price !== null ? grant.price.toFixed(2) : 'Optional'}
              className="tabular-nums"
            />
          </Field>
        </div>
        {grant.tax_withhold_pct > 0 && unitsNum > 0 && (
          <Button
            type="button"
            onClick={() => setWithheldUnits(String(Math.round(unitsNum * (grant.tax_withhold_pct / 100) * 1000) / 1000))}
            className="-mt-2 self-start text-label"
            style={{ color: 'var(--accent-text)' }}
          >
            Use the grant’s {grant.tax_withhold_pct}% withholding
          </Button>
        )}

        <Field label="Notes" htmlFor="t-notes">
          <Input id="t-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional, e.g. sold to cover taxes" />
        </Field>

        <div className="flex flex-col gap-1 pt-1">
          <SubmitButton disabled={saving}>{saving ? 'Saving…' : tranche ? 'Save vest' : 'Add vest'}</SubmitButton>
          {tranche && <DeleteButton disabled={saving} label="Remove vest" onConfirm={() => void handleDelete()} />}
        </div>
      </form>
    </Sheet>
  );
}
