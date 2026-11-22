import React, { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { EnrichedRsuGrant, EnrichedRsuTranche, RsuTrancheStatus } from '@shared/types';
import { apiFetch } from '../lib/api';
import { Sheet } from './Sheet';

interface RsuTrancheSheetProps {
  open: boolean;
  onClose: () => void;
  grant: EnrichedRsuGrant | null;
  tranche: EnrichedRsuTranche | null; // null = adding new tranche to grant
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}

const STATUS_OPTIONS: Array<{ id: RsuTrancheStatus; label: string; hint: string }> = [
  { id: 'scheduled', label: 'Auto', hint: 'Auto-vests on vest date' },
  { id: 'vested', label: 'Vested', hint: 'Confirmed vested & held' },
  { id: 'sold', label: 'Sold', hint: 'Vested & sold (not held)' },
  { id: 'forfeited', label: 'Forfeited', hint: 'Cancelled / left role' },
];

function todayLocalIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function RsuTrancheSheet({ open, onClose, grant, tranche, onSaved, onError }: RsuTrancheSheetProps) {
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
      // If auto-vested with grant withholding and no explicit withheld_units yet, show 0 (with quick apply button)
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
      onError('Enter valid units > 0');
      return;
    }
    if (!Number.isFinite(withheldNum) || withheldNum < 0 || withheldNum > unitsNum) {
      onError('Withheld shares must be between 0 and total units');
      return;
    }
    if (vestPriceNum !== null && (!Number.isFinite(vestPriceNum) || vestPriceNum < 0)) {
      onError('Enter a valid vest FMV price');
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
        await apiFetch(`/api/portfolio/rsus/${grant.id}/tranches/${tranche.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        onSaved(`Updated ${grant.symbol} tranche (${vestDate})`);
      } else {
        await apiFetch(`/api/portfolio/rsus/${grant.id}/tranches`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        onSaved(`Added vesting tranche to ${grant.symbol}`);
      }
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save tranche');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!grant || !tranche) return;
    if (!confirm(`Remove the ${tranche.vest_date} (${tranche.units} ${grant.symbol}) tranche?`)) return;
    setSaving(true);
    try {
      await apiFetch(`/api/portfolio/rsus/${grant.id}/tranches/${tranche.id}`, { method: 'DELETE' });
      onSaved(`Removed tranche (${tranche.vest_date})`);
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

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={tranche ? `Edit Vesting Tranche · ${grant.symbol}` : `Add Vesting Tranche · ${grant.symbol}`}
      subtitle={grant.grant_name || grant.name}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            Status
          </label>
          <div className="grid grid-cols-4 gap-1.5">
            {STATUS_OPTIONS.map((opt) => {
              const active = status === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setStatus(opt.id)}
                  className="rounded-xl py-2 text-xs font-semibold transition"
                  style={{
                    backgroundColor: active ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                    color: active ? 'var(--accent-text)' : 'var(--text-secondary)',
                    border: `1px solid ${active ? 'var(--accent-border)' : 'transparent'}`,
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {STATUS_OPTIONS.find((o) => o.id === status)?.hint}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              Vest Date
            </label>
            <input required type="date" value={vestDate} onChange={(e) => setVestDate(e.target.value)} className="input-field" />
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              Gross Shares
            </label>
            <input
              required
              type="number"
              step="any"
              min="0"
              value={units}
              onChange={(e) => setUnits(e.target.value)}
              placeholder="0"
              className="input-field"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                Tax Withheld Shares
              </label>
              {grant.tax_withhold_pct > 0 && unitsNum > 0 && (
                <button
                  type="button"
                  onClick={() => setWithheldUnits(String(Math.round(unitsNum * (grant.tax_withhold_pct / 100) * 1000) / 1000))}
                  className="shrink-0 text-[10px] font-semibold"
                  style={{ color: 'var(--accent-text)' }}
                >
                  Apply {grant.tax_withhold_pct}%
                </button>
              )}
            </div>
            <input
              type="number"
              step="any"
              min="0"
              value={withheldUnits}
              onChange={(e) => setWithheldUnits(e.target.value)}
              placeholder="0"
              className="input-field"
            />
            {unitsNum > 0 && (
              <p className="mt-1 text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
                Net shares received: <strong style={{ color: 'var(--text-primary)' }}>{Number(netPreview.toFixed(4))}</strong>
              </p>
            )}
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              Vest FMV Price ({grant.currency})
            </label>
            <input
              type="number"
              step="any"
              min="0"
              value={vestedPrice}
              onChange={(e) => setVestedPrice(e.target.value)}
              placeholder={grant.price !== null ? `${grant.price.toFixed(2)}` : 'Optional'}
              className="input-field"
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Used as cost basis for post-vest P&amp;L
            </p>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            Notes (optional)
          </label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Sold to cover taxes / transferred to broker"
            className="input-field"
          />
        </div>

        <div className="flex items-center gap-2">
          {tranche && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleDelete()}
              className="btn-secondary flex items-center gap-1.5 rounded-xl px-4 py-3 text-sm font-medium disabled:opacity-50"
              style={{ color: 'var(--negative)' }}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          )}
          <button
            type="submit"
            disabled={saving}
            className="btn-primary flex-1 rounded-xl py-3 text-sm font-medium disabled:opacity-50"
          >
            {saving ? 'Saving...' : tranche ? 'Save Tranche' : 'Add Tranche'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
