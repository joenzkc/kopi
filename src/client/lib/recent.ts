import type { RecentTransaction } from '@shared/types';
import { apiFetch } from './api';

let cache: { at: number; data: RecentTransaction[] } | null = null;
let inflight: Promise<RecentTransaction[]> | null = null;
const TTL_MS = 60_000;

/** Recent transactions (last 60 days) shared by Home, Activity and the add flow. */
export async function fetchRecent(force = false): Promise<RecentTransaction[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;
  if (!force && inflight) return inflight;
  inflight = apiFetch<{ transactions: RecentTransaction[] }>('/api/transactions/recent?days=60')
    .then((res) => {
      cache = { at: Date.now(), data: res.transactions };
      return res.transactions;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function invalidateRecent(): void {
  cache = null;
}

/** YYYY-MM-DD in the device's local time zone. */
export function localISODate(d = new Date()): string {
  const shifted = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 10);
}

export function shiftDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return localISODate(date);
}

export function friendlyDate(iso: string): string {
  const today = localISODate();
  if (iso === today) return 'Today';
  if (iso === shiftDays(today, -1)) return 'Yesterday';
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const sameYear = y === new Date().getFullYear();
  return date.toLocaleDateString('en-SG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export function formatWhole(amount: number, currency = 'SGD'): string {
  try {
    return new Intl.NumberFormat('en-SG', {
      style: 'currency',
      currency: currency.toUpperCase(),
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount)}`;
  }
}

/** Short display name for an email sender, e.g. 'DBS Alerts <x@dbs.com>' → 'DBS Alerts'. */
export function senderLabel(sender: string): string {
  const name = sender.replace(/<.*>/, '').replace(/"/g, '').trim();
  if (name && !name.includes('@')) return name;
  const domain = sender.split('@')[1]?.replace(/>.*/, '') || sender;
  // Skip second-level public suffixes so alerts@citibank.com.sg reads "CITIBANK", not "COM".
  const parts = domain.toLowerCase().split('.').filter(Boolean);
  const SECOND_LEVEL = new Set(['com', 'co', 'net', 'org', 'gov', 'edu', 'ac']);
  let i = parts.length - 2;
  if (i > 0 && parts[parts.length - 1].length === 2 && SECOND_LEVEL.has(parts[i])) i -= 1;
  return parts[i]?.toUpperCase() || sender;
}
