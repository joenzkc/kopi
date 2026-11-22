import { config } from '../config';
import { getSetting, setSetting } from '../db';
import type {
  ActualAccount,
  ActualBudget,
  ActualCategory,
  ActualCategoryGroup,
  ActualPayee,
  ActualSchedule,
  ActualTransaction,
  RecurConfig,
} from '../../shared/types';

class ActualApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ActualApiError';
  }
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const metaCache = new Map<string, CacheEntry<unknown>>();
const META_TTL_MS = 15_000;

function getCached<T>(key: string): T | null {
  const entry = metaCache.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.data as T;
  }
  return null;
}

function setCached<T>(key: string, data: T, ttl = META_TTL_MS): T {
  metaCache.set(key, { data, expiresAt: Date.now() + ttl });
  return data;
}

export function invalidateActualCache(): void {
  metaCache.clear();
}

const READ_RETRY_DELAY_MS = 1200;

/**
 * actual-http-api's session with the Actual server expires periodically; the first requests after that
 * fail with a 500 ("token-expired") while it signs in again. Reads are retried once after a short pause
 * to ride that out. Writes are never retried, so a blip can't create duplicate transactions.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || 'GET').toUpperCase();
  try {
    return await requestOnce<T>(path, init);
  } catch (err) {
    const isTimeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    const retryable = method === 'GET' && !isTimeout && (!(err instanceof ActualApiError) || err.status >= 500);
    if (!retryable) throw err;
    console.warn(`Actual API read failed, retrying once: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`);
    await new Promise((resolve) => setTimeout(resolve, READ_RETRY_DELAY_MS));
    return requestOnce<T>(path, init);
  }
}

async function requestOnce<T>(path: string, init?: RequestInit): Promise<T> {
  const base = config.actualApiUrl.endsWith('/v1') ? config.actualApiUrl : `${config.actualApiUrl}/v1`;
  const url = `${base}${path}`;
  const headers = new Headers(init?.headers);
  if (config.actualApiKey) {
    headers.set('x-api-key', config.actualApiKey);
  }
  if (init?.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const res = await fetch(url, {
    ...init,
    headers,
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ActualApiError(`Actual API ${res.status} (${path}): ${text.slice(0, 300)}`, res.status);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await res.json()) as T;
  }
  return (await res.text()) as unknown as T;
}

export async function getBudgets(): Promise<ActualBudget[]> {
  const cached = getCached<ActualBudget[]>('budgets');
  if (cached) return cached;
  const res = await request<{ data: ActualBudget[] }>('/budgets');
  // Deduplicate by groupId (actual-http-api returns local + remote entries)
  const seen = new Map<string, ActualBudget>();
  for (const b of res.data || []) {
    const key = b.groupId || b.cloudFileId || b.name;
    const existing = seen.get(key);
    if (!existing || (b.id && !existing.id)) {
      seen.set(key, b);
    }
  }
  return setCached('budgets', Array.from(seen.values()), 60_000);
}

export async function resolveBudgetSyncId(): Promise<{ syncId: string; budgetName: string | null }> {
  const configured = getSetting('budget_sync_id') || config.actualBudgetSyncId;
  const budgets = await getBudgets();
  if (configured) {
    const match = budgets.find((b) => b.groupId === configured || b.cloudFileId === configured || b.id === configured);
    return { syncId: configured, budgetName: match?.name ?? null };
  }
  const first = budgets.find((b) => b.groupId) || budgets[0];
  if (!first || !first.groupId) {
    throw new ActualApiError('No Actual budgets found on actual-http-api', 404);
  }
  setSetting('budget_sync_id', first.groupId);
  return { syncId: first.groupId, budgetName: first.name };
}

export async function getAccounts(includeBalances = true): Promise<ActualAccount[]> {
  const { syncId } = await resolveBudgetSyncId();
  const key = `accounts:${syncId}:${includeBalances}`;
  const cached = getCached<ActualAccount[]>(key);
  if (cached) return cached;
  const qs = includeBalances ? '?include_balances=true' : '';
  const res = await request<{ data: ActualAccount[] }>(`/budgets/${encodeURIComponent(syncId)}/accounts${qs}`);
  return setCached(key, res.data || [], 10_000);
}

export async function getAccountBalance(accountId: string): Promise<number> {
  const { syncId } = await resolveBudgetSyncId();
  const res = await request<{ data: number }>(
    `/budgets/${encodeURIComponent(syncId)}/accounts/${encodeURIComponent(accountId)}/balance`,
  );
  return Number(res.data ?? 0);
}

export async function getPayees(): Promise<ActualPayee[]> {
  const { syncId } = await resolveBudgetSyncId();
  const key = `payees:${syncId}`;
  const cached = getCached<ActualPayee[]>(key);
  if (cached) return cached;
  const res = await request<{ data: ActualPayee[] }>(`/budgets/${encodeURIComponent(syncId)}/payees`);
  return setCached(key, res.data || [], 30_000);
}

export async function ensurePayeeByName(name: string): Promise<string> {
  const trimmed = name.trim();
  const payees = await getPayees();
  const existing = payees.find((p) => p.name.toLowerCase() === trimmed.toLowerCase() && !p.transfer_acct);
  if (existing) return existing.id;

  const { syncId } = await resolveBudgetSyncId();
  const created = await request<{ data?: string; id?: string }>(
    `/budgets/${encodeURIComponent(syncId)}/payees`,
    {
      method: 'POST',
      body: JSON.stringify({ payee: { name: trimmed } }),
    },
  );
  invalidateActualCache();
  if (typeof created.data === 'string') return created.data;
  if (typeof created.id === 'string') return created.id;
  // Re-fetch to locate the newly created payee UUID
  const refreshed = await getPayees();
  const found = refreshed.find((p) => p.name.toLowerCase() === trimmed.toLowerCase());
  if (!found) throw new ActualApiError(`Created payee "${trimmed}" but could not resolve ID`, 500);
  return found.id;
}

export async function getCategories(): Promise<ActualCategory[]> {
  const { syncId } = await resolveBudgetSyncId();
  const key = `categories:${syncId}`;
  const cached = getCached<ActualCategory[]>(key);
  if (cached) return cached;
  const res = await request<{ data: ActualCategory[] }>(`/budgets/${encodeURIComponent(syncId)}/categories`);
  return setCached(key, res.data || [], 30_000);
}

export async function getCategoryGroups(): Promise<ActualCategoryGroup[]> {
  const { syncId } = await resolveBudgetSyncId();
  const key = `categorygroups:${syncId}`;
  const cached = getCached<ActualCategoryGroup[]>(key);
  if (cached) return cached;
  const res = await request<{ data: ActualCategoryGroup[] }>(`/budgets/${encodeURIComponent(syncId)}/categorygroups`);
  return setCached(key, res.data || [], 30_000);
}

export async function getAccountTransactions(
  accountId: string,
  sinceDate?: string,
  untilDate?: string,
): Promise<ActualTransaction[]> {
  const { syncId } = await resolveBudgetSyncId();
  const params = new URLSearchParams();
  if (sinceDate) params.set('since_date', sinceDate);
  if (untilDate) params.set('until_date', untilDate);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await request<{ data: ActualTransaction[] }>(
    `/budgets/${encodeURIComponent(syncId)}/accounts/${encodeURIComponent(accountId)}/transactions${qs}`,
  );
  return res.data || [];
}

export async function addTransaction(
  accountId: string,
  tx: {
    date: string;
    amount: number;
    payee_name?: string;
    payee?: string;
    category?: string;
    notes?: string;
    cleared?: boolean;
    imported_id?: string;
  },
  opts: { runTransfers?: boolean } = {},
): Promise<void> {
  const { syncId } = await resolveBudgetSyncId();
  await request(`/budgets/${encodeURIComponent(syncId)}/accounts/${encodeURIComponent(accountId)}/transactions`, {
    method: 'POST',
    body: JSON.stringify({
      learnCategories: false,
      runTransfers: Boolean(opts.runTransfers),
      transaction: {
        account: accountId,
        ...tx,
      },
    }),
  });
  invalidateActualCache();
}

export async function importTransactions(
  accountId: string,
  transactions: Array<{
    date: string;
    amount: number;
    payee_name?: string;
    imported_payee?: string;
    category?: string;
    notes?: string;
    cleared?: boolean;
    imported_id?: string;
  }>,
): Promise<{ added: string[]; updated: string[] }> {
  const { syncId } = await resolveBudgetSyncId();
  const res = await request<{ data: { added: string[]; updated: string[] } }>(
    `/budgets/${encodeURIComponent(syncId)}/accounts/${encodeURIComponent(accountId)}/transactions/import`,
    {
      method: 'POST',
      body: JSON.stringify({
        transactions: transactions.map((t) => ({ account: accountId, ...t })),
        defaultCleared: true,
        payeeNameNormalization: 'original',
      }),
    },
  );
  invalidateActualCache();
  return res.data || { added: [], updated: [] };
}

export async function getSchedules(): Promise<ActualSchedule[]> {
  const { syncId } = await resolveBudgetSyncId();
  const res = await request<{ data: ActualSchedule[] }>(`/budgets/${encodeURIComponent(syncId)}/schedules`);
  return res.data || [];
}

export async function createSchedule(schedule: {
  name?: string;
  posts_transaction?: boolean;
  payee?: string | null;
  account?: string | null;
  amount?: number;
  amountOp?: 'is' | 'isapprox' | 'isbetween';
  date: string | RecurConfig;
}): Promise<string> {
  const { syncId } = await resolveBudgetSyncId();
  const res = await request<{ data: string }>(`/budgets/${encodeURIComponent(syncId)}/schedules`, {
    method: 'POST',
    body: JSON.stringify({ schedule }),
  });
  invalidateActualCache();
  return res.data;
}

export async function updateSchedule(
  scheduleId: string,
  schedule: Partial<{
    name: string;
    posts_transaction: boolean;
    payee: string | null;
    account: string | null;
    amount: number;
    amountOp: 'is' | 'isapprox' | 'isbetween';
    date: string | RecurConfig;
  }>,
  resetNextDate = true,
): Promise<ActualSchedule> {
  const { syncId } = await resolveBudgetSyncId();
  const res = await request<{ data: ActualSchedule }>(
    `/budgets/${encodeURIComponent(syncId)}/schedules/${encodeURIComponent(scheduleId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ schedule, resetNextDate }),
    },
  );
  invalidateActualCache();
  return res.data;
}

export async function deleteSchedule(scheduleId: string): Promise<void> {
  const { syncId } = await resolveBudgetSyncId();
  await request(`/budgets/${encodeURIComponent(syncId)}/schedules/${encodeURIComponent(scheduleId)}`, {
    method: 'DELETE',
  });
  invalidateActualCache();
}

// --- Monthly envelope budget ---

export interface RawBudgetCategory {
  id: string;
  name: string;
  is_income?: boolean;
  hidden?: boolean;
  group_id?: string;
  budgeted?: number;
  spent?: number;
  balance?: number;
  received?: number;
  carryover?: boolean;
}

export interface RawBudgetMonth {
  month: string;
  toBudget?: number;
  totalBudgeted?: number;
  totalSpent?: number;
  totalBalance?: number;
  totalIncome?: number;
  categoryGroups?: Array<{
    id: string;
    name: string;
    is_income?: boolean;
    hidden?: boolean;
    budgeted?: number;
    spent?: number;
    balance?: number;
    received?: number;
    categories?: RawBudgetCategory[];
  }>;
}

export async function getBudgetMonths(): Promise<string[]> {
  const { syncId } = await resolveBudgetSyncId();
  const key = `months:${syncId}`;
  const cached = getCached<string[]>(key);
  if (cached) return cached;
  const res = await request<{ data: string[] }>(`/budgets/${encodeURIComponent(syncId)}/months`);
  return setCached(key, res.data || [], 60_000);
}

export async function getBudgetMonth(month: string): Promise<RawBudgetMonth> {
  const { syncId } = await resolveBudgetSyncId();
  const res = await request<{ data: RawBudgetMonth }>(
    `/budgets/${encodeURIComponent(syncId)}/months/${encodeURIComponent(month)}`,
  );
  return res.data;
}

/** Sets a category's budgeted amount (cents) and/or overspending rollover for a month. */
export async function setCategoryBudget(
  month: string,
  categoryId: string,
  fields: { budgeted?: number; carryover?: boolean },
): Promise<void> {
  const { syncId } = await resolveBudgetSyncId();
  await request(
    `/budgets/${encodeURIComponent(syncId)}/months/${encodeURIComponent(month)}/categories/${encodeURIComponent(categoryId)}`,
    { method: 'PATCH', body: JSON.stringify({ category: fields }) },
  );
  invalidateActualCache();
}

// --- Account management ---

export async function createAccount(input: { name: string; offbudget: boolean; initialBalance: number }): Promise<string | null> {
  const { syncId } = await resolveBudgetSyncId();
  const res = await request<{ data?: string }>(`/budgets/${encodeURIComponent(syncId)}/accounts`, {
    method: 'POST',
    body: JSON.stringify({
      account: { name: input.name, offbudget: input.offbudget, initialBalance: input.initialBalance },
    }),
  });
  invalidateActualCache();
  return typeof res?.data === 'string' ? res.data : null;
}

export async function updateAccount(
  accountId: string,
  fields: { name: string; offbudget: boolean; account_group_id?: string | null },
): Promise<void> {
  const { syncId } = await resolveBudgetSyncId();
  await request(`/budgets/${encodeURIComponent(syncId)}/accounts/${encodeURIComponent(accountId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ account: fields }),
  });
  invalidateActualCache();
}

export async function closeAccount(
  accountId: string,
  transfer?: { transferAccountId?: string; transferCategoryId?: string },
): Promise<void> {
  const { syncId } = await resolveBudgetSyncId();
  await request(`/budgets/${encodeURIComponent(syncId)}/accounts/${encodeURIComponent(accountId)}/close`, {
    method: 'PUT',
    body: JSON.stringify(transfer && transfer.transferAccountId ? { transfer } : {}),
  });
  invalidateActualCache();
}

export async function reopenAccount(accountId: string): Promise<void> {
  const { syncId } = await resolveBudgetSyncId();
  await request(`/budgets/${encodeURIComponent(syncId)}/accounts/${encodeURIComponent(accountId)}/reopen`, {
    method: 'PUT',
  });
  invalidateActualCache();
}

// --- Account groups (Actual's own sidebar groups, e.g. Banks / Credit Cards) ---

export interface AccountGroup {
  id: string;
  name: string;
}

export async function getAccountGroups(): Promise<AccountGroup[]> {
  const { syncId } = await resolveBudgetSyncId();
  const key = `accountgroups:${syncId}`;
  const cached = getCached<AccountGroup[]>(key);
  if (cached) return cached;
  const res = await request<{ data: AccountGroup[] }>(`/budgets/${encodeURIComponent(syncId)}/accountgroups`);
  return setCached(key, res.data || [], 10_000);
}

export async function createAccountGroup(name: string): Promise<string | null> {
  const { syncId } = await resolveBudgetSyncId();
  const res = await request<{ data?: string }>(`/budgets/${encodeURIComponent(syncId)}/accountgroups`, {
    method: 'POST',
    body: JSON.stringify({ account_group: { name } }),
  });
  invalidateActualCache();
  return typeof res?.data === 'string' ? res.data : null;
}

export async function renameAccountGroup(groupId: string, name: string): Promise<void> {
  const { syncId } = await resolveBudgetSyncId();
  await request(`/budgets/${encodeURIComponent(syncId)}/accountgroups/${encodeURIComponent(groupId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ account_group: { name } }),
  });
  invalidateActualCache();
}

/** Deletes the group; Actual keeps its accounts and makes them ungrouped. */
export async function deleteAccountGroup(groupId: string): Promise<void> {
  const { syncId } = await resolveBudgetSyncId();
  await request(`/budgets/${encodeURIComponent(syncId)}/accountgroups/${encodeURIComponent(groupId)}`, {
    method: 'DELETE',
  });
  invalidateActualCache();
}

// --- Rules & payee merging ---

export interface ActualRuleCondition {
  field: string;
  op: string;
  value: unknown;
  type?: string;
}

export interface ActualRule {
  id: string;
  stage: string | null;
  conditionsOp: 'and' | 'or';
  conditions: ActualRuleCondition[];
  actions: ActualRuleCondition[];
}

export async function getRules(): Promise<ActualRule[]> {
  const { syncId } = await resolveBudgetSyncId();
  const key = `rules:${syncId}`;
  const cached = getCached<ActualRule[]>(key);
  if (cached) return cached;
  const res = await request<{ data: ActualRule[] }>(`/budgets/${encodeURIComponent(syncId)}/rules`);
  return setCached(key, res.data || [], 30_000);
}

export async function createRule(rule: Omit<ActualRule, 'id'>): Promise<string | null> {
  const { syncId } = await resolveBudgetSyncId();
  const res = await request<{ data?: { id?: string } | string }>(`/budgets/${encodeURIComponent(syncId)}/rules`, {
    method: 'POST',
    body: JSON.stringify({ rule }),
  });
  invalidateActualCache();
  const d = res?.data;
  return typeof d === 'string' ? d : d?.id ?? null;
}

export async function updateRule(rule: ActualRule): Promise<void> {
  const { syncId } = await resolveBudgetSyncId();
  await request(`/budgets/${encodeURIComponent(syncId)}/rules/${encodeURIComponent(rule.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ rule }),
  });
  invalidateActualCache();
}

export async function mergePayees(targetId: string, mergeIds: string[]): Promise<void> {
  const { syncId } = await resolveBudgetSyncId();
  await request(`/budgets/${encodeURIComponent(syncId)}/payees/merge`, {
    method: 'POST',
    body: JSON.stringify({ targetId, mergeIds }),
  });
  invalidateActualCache();
}
