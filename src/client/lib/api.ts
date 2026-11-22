export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const res = await fetch(path, {
    ...init,
    headers,
    credentials: 'include',
  });

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const msg =
      typeof data === 'object' && data && 'error' in data
        ? String((data as { error: string }).error)
        : `Request failed (${res.status})`;
    throw new ApiError(msg, res.status);
  }

  return data as T;
}

export function formatMoney(amount: number, currency = 'SGD', compact = false): string {
  try {
    return new Intl.NumberFormat('en-SG', {
      style: 'currency',
      currency: currency.toUpperCase(),
      notation: compact ? 'compact' : 'standard',
      minimumFractionDigits: compact ? 1 : 2,
      maximumFractionDigits: compact ? 2 : 2,
    }).format(amount);
  } catch {
    return `${currency.toUpperCase()} ${amount.toFixed(2)}`;
  }
}

export function formatSignedMoney(amount: number, currency = 'SGD'): string {
  const prefix = amount > 0 ? '+' : '';
  return `${prefix}${formatMoney(amount, currency)}`;
}

export function formatPct(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

export function formatPrice(price: number, currency = 'USD'): string {
  const digits = price >= 100 ? 2 : price >= 1 ? 3 : 5;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: digits,
    }).format(price);
  } catch {
    return `${currency} ${price.toFixed(digits)}`;
  }
}

export function formatDueBadge(days: number | null): { text: string; tone: 'rose' | 'amber' | 'zinc' } {
  if (days === null) return { text: 'No date', tone: 'zinc' };
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, tone: 'rose' };
  if (days === 0) return { text: 'Due today', tone: 'amber' };
  if (days === 1) return { text: 'Tomorrow', tone: 'amber' };
  if (days <= 7) return { text: `In ${days}d`, tone: 'amber' };
  return { text: `In ${days}d`, tone: 'zinc' };
}
