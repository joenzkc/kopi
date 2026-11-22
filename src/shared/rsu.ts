import type { RsuEffectiveStatus, RsuTrancheStatus } from './types';

export type VestingPreset =
  | 'standard_4yr_cliff_qtr'
  | 'equal_4yr_qtr'
  | 'standard_4yr_cliff_mo'
  | 'equal_4yr_annual'
  | 'backloaded_5_15_40_40'
  | 'frontloaded_38_32_20_10'
  | 'custom';

export type VestingFrequency = 'monthly' | 'quarterly' | 'semiannual' | 'annual';

export interface VestingScheduleOptions {
  preset: VestingPreset;
  totalUnits: number;
  startDate: string; // YYYY-MM-DD
  years?: number;
  cliffMonths?: number;
  frequency?: VestingFrequency;
  roundWholeShares?: boolean;
}

export interface GeneratedTranche {
  vest_date: string;
  units: number;
  status: RsuTrancheStatus;
}

export const VESTING_PRESETS: Array<{ id: VestingPreset; label: string; description: string }> = [
  { id: 'standard_4yr_cliff_qtr', label: '4yr · 1yr cliff · Qtr', description: '25% after 1 year, then 6.25% quarterly' },
  { id: 'equal_4yr_qtr', label: '4yr · Quarterly', description: '6.25% every quarter for 4 years (no cliff)' },
  { id: 'standard_4yr_cliff_mo', label: '4yr · 1yr cliff · Mo', description: '25% after 1 year, then monthly for 3 years' },
  { id: 'equal_4yr_annual', label: '4yr · Annual', description: '25% every year for 4 years' },
  { id: 'backloaded_5_15_40_40', label: '5 / 15 / 40 / 40', description: '5% Yr 1, 15% Yr 2, 20% every 6mo in Yr 3–4' },
  { id: 'frontloaded_38_32_20_10', label: '38 / 32 / 20 / 10', description: 'Front-loaded quarterly over 4 years' },
  { id: 'custom', label: 'Custom', description: 'Choose duration, cliff, and frequency' },
];

/** Adds `months` calendar months to a YYYY-MM-DD string, clamping day to month end (e.g. Jan 31 + 1m -> Feb 28). */
export function addMonthsIso(isoDate: string, months: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return isoDate;
  const year = Number(m[1]);
  const monthIdx = Number(m[2]) - 1;
  const day = Number(m[3]);

  const totalMonths = year * 12 + monthIdx + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, daysInTargetMonth);

  return `${String(targetYear).padStart(4, '0')}-${String(targetMonth + 1).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

/** Calendar day difference (toIso - fromIso). Positive means `toIso` is in the future. */
export function daysBetweenIso(fromIso: string, toIso: string): number {
  const parse = (s: string) => {
    const [y, mo, d] = s.split('-').map(Number);
    return Date.UTC(y, (mo || 1) - 1, d || 1);
  };
  return Math.round((parse(toIso) - parse(fromIso)) / 86_400_000);
}

/** Effective status: 'scheduled' tranches on or before today auto-vest. */
export function computeEffectiveTrancheStatus(
  status: RsuTrancheStatus,
  vestDate: string,
  todayIso: string,
): RsuEffectiveStatus {
  if (status === 'sold') return 'sold';
  if (status === 'forfeited') return 'forfeited';
  if (status === 'vested') return 'vested';
  return vestDate <= todayIso ? 'vested' : 'unvested';
}

/** Allocates `totalUnits` across `weights` so the sum matches `totalUnits` cleanly. */
function allocateUnits(totalUnits: number, weights: number[], roundWholeShares: boolean): number[] {
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW <= 0 || weights.length === 0) return [];

  const exact = weights.map((w) => (totalUnits * w) / sumW);

  if (roundWholeShares && Number.isInteger(totalUnits) && totalUnits >= weights.length) {
    // Largest-remainder allocation (Hamilton method) for exact integer share sums
    const floored = exact.map((v) => Math.floor(v));
    let remainder = totalUnits - floored.reduce((a, b) => a + b, 0);
    const order = exact
      .map((v, idx) => ({ idx, frac: v - floored[idx] }))
      .sort((a, b) => b.frac - a.frac || a.idx - b.idx);
    for (let i = 0; i < remainder && i < order.length; i++) {
      floored[order[i].idx] += 1;
    }
    return floored;
  }

  // Fractional allocation rounded to 4 decimals, placing rounding dust on the last tranche
  const rounded = exact.map((v) => Math.round(v * 10_000) / 10_000);
  const sumRounded = rounded.reduce((a, b) => a + b, 0);
  const diff = Math.round((totalUnits - sumRounded) * 10_000) / 10_000;
  if (rounded.length > 0 && diff !== 0) {
    rounded[rounded.length - 1] = Math.max(0.0001, Math.round((rounded[rounded.length - 1] + diff) * 10_000) / 10_000);
  }
  return rounded;
}

function frequencyStepMonths(freq: VestingFrequency): number {
  switch (freq) {
    case 'monthly':
      return 1;
    case 'quarterly':
      return 3;
    case 'semiannual':
      return 6;
    case 'annual':
      return 12;
  }
}

export function generateVestingSchedule(opts: VestingScheduleOptions): GeneratedTranche[] {
  const { preset, totalUnits, startDate } = opts;
  if (!Number.isFinite(totalUnits) || totalUnits <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return [];
  }

  const roundWhole = opts.roundWholeShares ?? Number.isInteger(totalUnits);
  const entries: Array<{ monthOffset: number; weight: number }> = [];

  if (preset === 'standard_4yr_cliff_qtr') {
    entries.push({ monthOffset: 12, weight: 25 });
    for (let m = 15; m <= 48; m += 3) {
      entries.push({ monthOffset: m, weight: 6.25 });
    }
  } else if (preset === 'equal_4yr_qtr') {
    for (let m = 3; m <= 48; m += 3) {
      entries.push({ monthOffset: m, weight: 1 });
    }
  } else if (preset === 'standard_4yr_cliff_mo') {
    entries.push({ monthOffset: 12, weight: 12 });
    for (let m = 13; m <= 48; m += 1) {
      entries.push({ monthOffset: m, weight: 1 });
    }
  } else if (preset === 'equal_4yr_annual') {
    for (let m = 12; m <= 48; m += 12) {
      entries.push({ monthOffset: m, weight: 1 });
    }
  } else if (preset === 'backloaded_5_15_40_40') {
    entries.push({ monthOffset: 12, weight: 5 });
    entries.push({ monthOffset: 24, weight: 15 });
    entries.push({ monthOffset: 30, weight: 20 });
    entries.push({ monthOffset: 36, weight: 20 });
    entries.push({ monthOffset: 42, weight: 20 });
    entries.push({ monthOffset: 48, weight: 20 });
  } else if (preset === 'frontloaded_38_32_20_10') {
    const yearWeights = [38, 32, 20, 10];
    yearWeights.forEach((yw, yrIdx) => {
      for (let q = 1; q <= 4; q++) {
        entries.push({ monthOffset: yrIdx * 12 + q * 3, weight: yw / 4 });
      }
    });
  } else {
    // custom
    const years = Math.min(6, Math.max(1, Math.round(opts.years ?? 4)));
    const totalMonths = years * 12;
    const step = frequencyStepMonths(opts.frequency ?? 'quarterly');
    const cliff = Math.min(totalMonths, Math.max(0, Math.round(opts.cliffMonths ?? 0)));

    if (cliff > 0) {
      entries.push({ monthOffset: cliff, weight: cliff });
    }
    for (let m = cliff + step; m <= totalMonths; m += step) {
      entries.push({ monthOffset: m, weight: step });
    }
    if (entries.length === 0) {
      entries.push({ monthOffset: totalMonths, weight: 1 });
    }
  }

  const units = allocateUnits(
    totalUnits,
    entries.map((e) => e.weight),
    roundWhole,
  );

  return entries
    .map((e, i) => ({
      vest_date: addMonthsIso(startDate, e.monthOffset),
      units: units[i] ?? 0,
      status: 'scheduled' as RsuTrancheStatus,
    }))
    .filter((t) => t.units > 0);
}
