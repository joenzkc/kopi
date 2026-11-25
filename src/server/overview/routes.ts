import crypto from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { db, getSetting, setSetting } from '../db';
import { requireSession } from '../auth/service';
import * as actual from '../actual/client';
import { localISODate } from '../dates';
import { getEnrichedPortfolio } from '../portfolio/prices';
import { getEnrichedSchedules } from '../schedules/routes';
import { normalizeBudgetMonth } from './budget';
import { appearanceSchema, DEFAULT_APPEARANCE, transactionChangesSchema } from '../../shared/types';
import type {
  ActualAccount,
  Appearance,
  OverviewResponse,
  RecentTransaction,
  SnapshotPoint,
} from '../../shared/types';

export const overviewRoutes = new Hono();

function recordDailySnapshot(baseCurrency: string, investments: number, actualCash: number, netWorth: number): void {
  const today = new Date().toISOString().slice(0, 10);
  db.query(
    `INSERT INTO portfolio_snapshots (snapshot_date, base_currency, investments_value, actual_cash_value, total_net_worth, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(snapshot_date) DO UPDATE SET
       base_currency = excluded.base_currency,
       investments_value = excluded.investments_value,
       actual_cash_value = excluded.actual_cash_value,
       total_net_worth = excluded.total_net_worth`,
  ).run(today, baseCurrency, investments, actualCash, netWorth, new Date().toISOString());
}

overviewRoutes.get('/overview', requireSession, async (c) => {
  const refresh = c.req.query('refresh') === '1' || c.req.query('refresh') === 'true';
  const baseCurrency = (getSetting('base_currency') || 'SGD').toUpperCase();

  const portfolioPromise = getEnrichedPortfolio(refresh);
  const pendingInboxCount =
    db.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM email_events WHERE status = 'pending_review'").get()?.c ?? 0;

  let actualConnected = false;
  let actualError: string | undefined;
  let budgetName: string | null = null;
  let budgetSyncId: string | null = null;
  let accounts: ActualAccount[] = [];
  let upcomingSchedules: OverviewResponse['upcomingSchedules'] = [];
  let accountGroups: OverviewResponse['accountGroups'] = [];

  try {
    const resolved = await actual.resolveBudgetSyncId();
    budgetSyncId = resolved.syncId;
    budgetName = resolved.budgetName;
    const [accts, scheds, groups] = await Promise.all([
      actual.getAccounts(true),
      getEnrichedSchedules(),
      actual.getAccountGroups().catch(() => []),
    ]);
    accounts = accts.filter((a) => !a.closed);
    accountGroups = groups;
    upcomingSchedules = scheds
      .filter((s) => !s.completed && s.daysUntilNext !== null && s.daysUntilNext <= 14)
      .slice(0, 6);
    actualConnected = true;
  } catch (err) {
    actualError = err instanceof Error ? err.message : String(err);
  }

  const portfolio = await portfolioPromise;

  // Map linked portfolio values per Actual account so we never double-count linked off-budget accounts
  const linkedByAccount = new Map<string, number>();
  for (const h of portfolio.holdings) {
    if (h.actual_account_id && h.marketValueBase !== null) {
      linkedByAccount.set(h.actual_account_id, (linkedByAccount.get(h.actual_account_id) || 0) + h.marketValueBase);
    }
  }
  for (const g of portfolio.rsuGrants) {
    if (g.include_in_total && g.actual_account_id && g.heldValueBase !== null) {
      linkedByAccount.set(g.actual_account_id, (linkedByAccount.get(g.actual_account_id) || 0) + g.heldValueBase);
    }
  }

  let actualCash = 0;
  let actualOffBudgetUnlinked = 0;

  const decoratedAccounts = accounts.map((acc) => {
    const balanceMajor = (acc.workingBalance ?? 0) / 100;
    const linkedVal = linkedByAccount.get(acc.id);
    if (!acc.offbudget) {
      actualCash += balanceMajor;
    } else if (linkedVal === undefined) {
      actualOffBudgetUnlinked += balanceMajor;
    }
    return {
      ...acc,
      linkedPortfolioValue: linkedVal,
    };
  });

  const investments = portfolio.totals.marketValueBase;
  const totalNetWorth = actualCash + actualOffBudgetUnlinked + investments;

  recordDailySnapshot(baseCurrency, investments, actualCash + actualOffBudgetUnlinked, totalNetWorth);

  const snapshotRows = db
    .query<
      { snapshot_date: string; investments_value: number; actual_cash_value: number; total_net_worth: number },
      []
    >(
      'SELECT snapshot_date, investments_value, actual_cash_value, total_net_worth FROM portfolio_snapshots ORDER BY snapshot_date DESC LIMIT 30',
    )
    .all()
    .reverse();

  const snapshots: SnapshotPoint[] = snapshotRows.map((s) => ({
    date: s.snapshot_date,
    investments: s.investments_value,
    cash: s.actual_cash_value,
    netWorth: s.total_net_worth,
  }));

  const payload: OverviewResponse = {
    baseCurrency,
    actualConnected,
    actualError,
    budgetName,
    budgetSyncId,
    netWorth: {
      total: totalNetWorth,
      actualCash,
      actualOffBudgetUnlinked,
      investments,
      dayChangeBase: portfolio.totals.dayChangeBase,
      dayChangePct: portfolio.totals.dayChangePct,
    },
    accounts: decoratedAccounts,
    accountGroups,
    upcomingSchedules,
    pendingInboxCount,
    snapshots,
    refreshedAt: new Date().toISOString(),
  };

  return c.json(payload);
});

overviewRoutes.get('/actual/meta', requireSession, async (c) => {
  try {
    const [budgets, resolved, accounts, categories, categoryGroups, payees] = await Promise.all([
      actual.getBudgets(),
      actual.resolveBudgetSyncId(),
      actual.getAccounts(true),
      actual.getCategories(),
      actual.getCategoryGroups(),
      actual.getPayees(),
    ]);
    return c.json({
      connected: true,
      budgets,
      activeBudgetSyncId: resolved.syncId,
      activeBudgetName: resolved.budgetName,
      accounts: accounts.filter((a) => !a.closed),
      categories: categories.filter((cat) => !cat.hidden),
      categoryGroups: categoryGroups.filter((g) => !g.hidden),
      payees: payees.filter((p) => !p.transfer_acct),
    });
  } catch (err) {
    return c.json(
      {
        connected: false,
        error: err instanceof Error ? err.message : String(err),
        budgets: [],
        accounts: [],
        categories: [],
        categoryGroups: [],
        payees: [],
      },
      200,
    );
  }
});

overviewRoutes.get('/transactions/recent', requireSession, async (c) => {
  const days = Math.min(90, Math.max(7, Number(c.req.query('days') || 30)));
  const now = new Date();
  const since = localISODate(-days, now);
  // Actual's default end date can still be yesterday in Kopi's time zone.
  const until = localISODate(0, now);

  const [accounts, payees, categories] = await Promise.all([
    actual.getAccounts(false),
    actual.getPayees(),
    actual.getCategories(),
  ]);
  const activeAccounts = accounts.filter((a) => !a.closed);
  const accountMap = new Map(accounts.map((a) => [a.id, a.name]));
  const payeeMap = new Map(payees.map((p) => [p.id, p]));
  const catMap = new Map(categories.map((cat) => [cat.id, cat.name]));

  const perAccount = await Promise.all(
    activeAccounts.slice(0, 12).map((a) => actual.getAccountTransactions(a.id, since, until).catch(() => [])),
  );

  const merged: RecentTransaction[] = perAccount
    .flat()
    .map((t) => {
      const payee = t.payee ? payeeMap.get(t.payee) : undefined;
      const transferAcct = payee?.transfer_acct || null;
      const isTransfer = Boolean(transferAcct || t.transfer_id);
      const payeeName = transferAcct
        ? `Transfer · ${accountMap.get(transferAcct) || 'Account'}`
        : payee?.name || t.imported_payee || 'Unknown';
      return {
        ...t,
        accountName: accountMap.get(t.account) || 'Account',
        payeeName,
        categoryName: t.category ? catMap.get(t.category) || null : null,
        isTransfer,
        transferAccountId: transferAcct,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 120);

  return c.json({ transactions: merged });
});

overviewRoutes.post('/transactions', requireSession, async (c) => {
  const body = await c.req.json().catch(() => null);
  const schema = z
    .object({
      accountId: z.string().min(1),
      amount: z.number(),
      payee: z.string().trim().max(120).optional(),
      transferAccountId: z.string().trim().min(1).optional(),
      categoryId: z.string().nullable().optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      notes: z.string().max(500).optional(),
      cleared: z.boolean().default(true),
    })
    .refine((d) => Boolean(d.transferAccountId) || Boolean(d.payee), { message: 'Payee is required' })
    .refine((d) => d.transferAccountId !== d.accountId, { message: 'Pick a different account to transfer to' });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid transaction' }, 400);
  }
  const d = parsed.data;

  if (d.transferAccountId) {
    const payees = await actual.getPayees();
    const transferPayee = payees.find((p) => p.transfer_acct === d.transferAccountId);
    if (!transferPayee) {
      return c.json({ error: 'Could not find the transfer payee for that account in Actual' }, 400);
    }
    await actual.addTransaction(
      d.accountId,
      {
        date: d.date,
        amount: Math.round(d.amount * 100),
        payee: transferPayee.id,
        category: d.categoryId || undefined,
        notes: d.notes || undefined,
        cleared: d.cleared,
      },
      { runTransfers: true },
    );
    return c.json({ ok: true }, 201);
  }

  await actual.addTransaction(d.accountId, {
    date: d.date,
    amount: Math.round(d.amount * 100),
    payee_name: d.payee,
    category: d.categoryId || undefined,
    notes: d.notes || undefined,
    cleared: d.cleared,
  });
  return c.json({ ok: true }, 201);
});

const transactionEditSchema = z.object({
  accountId: z.string().min(1),
  originalDate: z.string().date(),
  changes: transactionChangesSchema,
});

overviewRoutes.patch('/transactions/:id', requireSession, async (c) => {
  const parsed = transactionEditSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid transaction edit' }, 400);
  }

  const id = c.req.param('id');
  const { accountId, originalDate, changes: { payeeName, ...fields } } = parsed.data;
  const transactions = await actual.getAccountTransactions(accountId, originalDate, originalDate);
  const current = transactions.find((tx) => tx.id === id && tx.account === accountId && tx.date === originalDate);
  if (!current) {
    return c.json({ error: 'This transaction changed or was removed. Refresh Activity and try again.' }, 409);
  }

  if ((current.is_parent || current.subtransactions?.length) && (fields.amount !== undefined || fields.category !== undefined)) {
    return c.json({ error: 'Change split amounts and categories in Actual.' }, 400);
  }
  if (current.reconciled && fields.cleared !== undefined) {
    return c.json({ error: 'Change the cleared status of reconciled transactions in Actual.' }, 400);
  }

  const payee = current.payee && (payeeName !== undefined || fields.category !== undefined)
    ? (await actual.getPayees()).find((p) => p.id === current.payee)
    : undefined;
  const isTransfer = Boolean(current.transfer_id || payee?.transfer_acct);
  if (isTransfer && payeeName !== undefined) {
    return c.json({ error: 'Change the transfer account in Actual.' }, 400);
  }
  if (fields.category !== undefined) {
    const accounts = await actual.getAccounts(false);
    const account = accounts.find((a) => a.id === accountId);
    const counterpart = accounts.find((a) => a.id === payee?.transfer_acct);
    if (account?.offbudget !== false || (isTransfer && counterpart?.offbudget !== true)) {
      return c.json({ error: 'This transaction does not have an editable budget category.' }, 400);
    }
    if (fields.category && !(await actual.getCategories()).some((cat) => cat.id === fields.category)) {
      return c.json({ error: 'This category no longer exists. Pick another category.' }, 400);
    }
  }

  const payload: Parameters<typeof actual.updateTransaction>[1] = fields;
  if (payeeName !== undefined) {
    payload.payee = payeeName ? await actual.ensurePayeeByName(payeeName) : null;
  }
  await actual.updateTransaction(id, payload);
  return c.json({ ok: true });
});

function readAppearance(): Appearance {
  const raw = getSetting('appearance');
  if (!raw) return DEFAULT_APPEARANCE;
  try {
    const parsed = appearanceSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_APPEARANCE;
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

function readHiddenHomeAccounts(): string[] {
  try {
    const parsed = JSON.parse(getSetting('home_hidden_accounts') || '[]');
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function settingsPayload() {
  return {
    baseCurrency: getSetting('base_currency') || 'SGD',
    budgetSyncId: getSetting('budget_sync_id') || '',
    defaultEmailAccountId: getSetting('default_email_account_id') || '',
    webhookSecret: getSetting('email_webhook_secret') || '',
    appearance: readAppearance(),
    hiddenHomeAccounts: readHiddenHomeAccounts(),
    forwardingAddress: getSetting('forwarding_address') || '',
  };
}

overviewRoutes.get('/settings', requireSession, (c) => {
  return c.json(settingsPayload());
});

overviewRoutes.patch('/settings', requireSession, async (c) => {
  const body = await c.req.json().catch(() => null);
  const schema = z.object({
    baseCurrency: z.string().trim().min(3).max(6).optional(),
    budgetSyncId: z.string().trim().optional(),
    defaultEmailAccountId: z.string().trim().optional(),
    rotateWebhookSecret: z.boolean().optional(),
    appearance: appearanceSchema.optional(),
    hiddenHomeAccounts: z.array(z.string().min(1).max(100)).max(500).optional(),
    forwardingAddress: z.union([z.string().trim().email().max(200), z.literal('')]).optional(),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid settings' }, 400);

  if (parsed.data.baseCurrency) {
    setSetting('base_currency', parsed.data.baseCurrency.toUpperCase());
  }
  if (parsed.data.budgetSyncId !== undefined) {
    setSetting('budget_sync_id', parsed.data.budgetSyncId);
    actual.invalidateActualCache();
  }
  if (parsed.data.defaultEmailAccountId !== undefined) {
    setSetting('default_email_account_id', parsed.data.defaultEmailAccountId);
  }
  if (parsed.data.rotateWebhookSecret) {
    setSetting('email_webhook_secret', crypto.randomBytes(24).toString('hex'));
  }
  if (parsed.data.forwardingAddress !== undefined) {
    setSetting('forwarding_address', parsed.data.forwardingAddress);
  }
  if (parsed.data.hiddenHomeAccounts) {
    setSetting('home_hidden_accounts', JSON.stringify([...new Set(parsed.data.hiddenHomeAccounts)]));
  }
  if (parsed.data.appearance) {
    setSetting('appearance', JSON.stringify(parsed.data.appearance));
  }

  return c.json({ ok: true, ...settingsPayload() });
});

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

overviewRoutes.get('/budget', requireSession, async (c) => {
  const requested = c.req.query('month');
  if (requested && !/^\d{4}-\d{2}$/.test(requested)) {
    return c.json({ error: 'month must be YYYY-MM' }, 400);
  }
  const month = requested || currentMonth();

  try {
    const [months, raw] = await Promise.all([actual.getBudgetMonths().catch(() => [] as string[]), actual.getBudgetMonth(month)]);

    const payload = normalizeBudgetMonth(raw, months, month);
    return c.json(payload);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Could not load budget from Actual' }, 502);
  }
});

const MONTH_RE = /^\d{4}-\d{2}$/;
const MAX_CENTS = 100_000_000_00; // 100M in major units; guards against typos

/** Looks up expense (non-income) categories in a month so edits never touch income rows. */
async function expenseCategoriesForMonth(month: string) {
  const raw = await actual.getBudgetMonth(month);
  const map = new Map<string, { budgeted: number; balance: number }>();
  for (const g of raw.categoryGroups || []) {
    if (g.is_income) continue;
    for (const cat of g.categories || []) {
      if (cat.is_income) continue;
      map.set(cat.id, { budgeted: cat.budgeted ?? 0, balance: cat.balance ?? 0 });
    }
  }
  return map;
}

overviewRoutes.patch('/budget/:month/categories/:categoryId', requireSession, async (c) => {
  const month = c.req.param('month');
  const categoryId = c.req.param('categoryId');
  if (!MONTH_RE.test(month)) return c.json({ error: 'month must be YYYY-MM' }, 400);

  const body = await c.req.json().catch(() => null);
  const parsed = z
    .object({
      budgeted: z.number().int().min(-MAX_CENTS).max(MAX_CENTS).optional(),
      carryover: z.boolean().optional(),
    })
    .refine((d) => d.budgeted !== undefined || d.carryover !== undefined, { message: 'Nothing to update' })
    .safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Invalid budget update' }, 400);

  try {
    const cats = await expenseCategoriesForMonth(month);
    if (!cats.has(categoryId)) return c.json({ error: 'That category is not budgetable this month' }, 404);
    await actual.setCategoryBudget(month, categoryId, parsed.data);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Could not update budget in Actual' }, 502);
  }
});

/**
 * Moves budgeted money between two categories, or between a category and "To budget" (null side).
 * Done as two awaited budget writes rather than actual-http-api's categorytransfers endpoint,
 * which doesn't await its writes and so can report success before (or despite) a failure.
 */
overviewRoutes.post('/budget/:month/move', requireSession, async (c) => {
  const month = c.req.param('month');
  if (!MONTH_RE.test(month)) return c.json({ error: 'month must be YYYY-MM' }, 400);

  const body = await c.req.json().catch(() => null);
  const parsed = z
    .object({
      fromCategoryId: z.string().min(1).nullable(),
      toCategoryId: z.string().min(1).nullable(),
      amount: z.number().int().positive().max(MAX_CENTS),
    })
    .refine((d) => d.fromCategoryId || d.toCategoryId, { message: 'Pick a category to move money from or to' })
    .refine((d) => d.fromCategoryId !== d.toCategoryId, { message: 'Pick two different categories' })
    .safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Invalid move' }, 400);
  const { fromCategoryId, toCategoryId, amount } = parsed.data;

  try {
    const cats = await expenseCategoriesForMonth(month);
    const from = fromCategoryId ? cats.get(fromCategoryId) : null;
    const to = toCategoryId ? cats.get(toCategoryId) : null;
    if ((fromCategoryId && !from) || (toCategoryId && !to)) {
      return c.json({ error: 'That category is not budgetable this month' }, 404);
    }

    if (fromCategoryId && from) {
      await actual.setCategoryBudget(month, fromCategoryId, { budgeted: from.budgeted - amount });
    }
    if (toCategoryId && to) {
      try {
        await actual.setCategoryBudget(month, toCategoryId, { budgeted: to.budgeted + amount });
      } catch (err) {
        // Put the source back so money isn't stranded in "To budget".
        if (fromCategoryId && from) {
          await actual.setCategoryBudget(month, fromCategoryId, { budgeted: from.budgeted }).catch(() => undefined);
        }
        throw err;
      }
    }
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Could not move money in Actual' }, 502);
  }
});

// --- Budget structure: categories ("buckets") and their groups ---

const budgetNameSchema = z.string().trim().min(1, 'Enter a name').max(100, 'Keep the name under 100 characters');
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Visible expense groups; Kopi only creates and renames expense categories. */
async function expenseGroups() {
  const groups = await actual.getCategoryGroups();
  return groups.filter((g) => !g.is_income && !g.hidden);
}

overviewRoutes.post('/budget/categories', requireSession, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ name: budgetNameSchema, groupId: z.string().min(1, 'Pick a group') }).safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Invalid category' }, 400);
  const { name, groupId } = parsed.data;

  try {
    const [groups, categories] = await Promise.all([expenseGroups(), actual.getCategories()]);
    if (!groups.some((g) => g.id === groupId)) return c.json({ error: 'That group is not an expense group in Actual' }, 404);
    if (categories.some((cat) => cat.group_id === groupId && sameName(cat.name, name))) {
      return c.json({ error: `There is already a ${name} category in that group` }, 409);
    }
    const id = await actual.createCategory({ name, groupId });
    return c.json({ ok: true, id });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Could not create the category in Actual' }, 502);
  }
});

overviewRoutes.patch('/budget/categories/:categoryId', requireSession, async (c) => {
  const categoryId = c.req.param('categoryId');
  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ name: budgetNameSchema }).safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Invalid category' }, 400);
  const { name } = parsed.data;

  try {
    const categories = await actual.getCategories();
    const category = categories.find((cat) => cat.id === categoryId);
    if (!category || category.is_income) return c.json({ error: 'That category is not an expense category in Actual' }, 404);
    if (categories.some((cat) => cat.id !== categoryId && cat.group_id === category.group_id && sameName(cat.name, name))) {
      return c.json({ error: `There is already a ${name} category in that group` }, 409);
    }
    await actual.updateCategory(categoryId, { name });
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Could not rename the category in Actual' }, 502);
  }
});

overviewRoutes.post('/budget/category-groups', requireSession, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ name: budgetNameSchema }).safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Invalid group' }, 400);
  const { name } = parsed.data;

  try {
    const groups = await actual.getCategoryGroups();
    if (groups.some((g) => sameName(g.name, name))) return c.json({ error: `There is already a ${name} group` }, 409);
    const id = await actual.createCategoryGroup({ name });
    return c.json({ ok: true, id });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Could not create the group in Actual' }, 502);
  }
});

overviewRoutes.patch('/budget/category-groups/:groupId', requireSession, async (c) => {
  const groupId = c.req.param('groupId');
  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ name: budgetNameSchema }).safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Invalid group' }, 400);
  const { name } = parsed.data;

  try {
    const groups = await actual.getCategoryGroups();
    const group = groups.find((g) => g.id === groupId);
    if (!group || group.is_income || group.hidden) return c.json({ error: 'That group is not an expense group in Actual' }, 404);
    if (groups.some((g) => g.id !== groupId && sameName(g.name, name))) return c.json({ error: `There is already a ${name} group` }, 409);
    await actual.updateCategoryGroup(groupId, { name });
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Could not rename the group in Actual' }, 502);
  }
});
