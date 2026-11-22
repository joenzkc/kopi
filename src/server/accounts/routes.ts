import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db';
import { requireSession } from '../auth/service';
import * as actual from '../actual/client';
import { fingerprintFor, refLabel } from '../ingest/extract';
import { deleteLink, getAutoImportAccounts, listLinks, setAutoImport, upsertLink } from '../ingest/links';

export const accountRoutes = new Hono();

/** All accounts, closed ones included, with balances and how many portfolio holdings sync into each. */
accountRoutes.get('/', requireSession, async (c) => {
  try {
    const [accounts, groups] = await Promise.all([actual.getAccounts(true), actual.getAccountGroups().catch(() => [])]);
    const holdingLinks = db
      .query<{ actual_account_id: string; n: number }, []>(
        'SELECT actual_account_id, COUNT(*) AS n FROM holdings WHERE actual_account_id IS NOT NULL GROUP BY actual_account_id',
      )
      .all();
    const rsuLinks = db
      .query<{ actual_account_id: string; n: number }, []>(
        'SELECT actual_account_id, COUNT(*) AS n FROM rsu_grants WHERE actual_account_id IS NOT NULL AND include_in_total = 1 GROUP BY actual_account_id',
      )
      .all();
    const linked = new Map<string, number>();
    for (const l of holdingLinks) {
      linked.set(l.actual_account_id, (linked.get(l.actual_account_id) || 0) + l.n);
    }
    for (const l of rsuLinks) {
      linked.set(l.actual_account_id, (linked.get(l.actual_account_id) || 0) + l.n);
    }
    const links = listLinks();
    const autoImport = getAutoImportAccounts();
    return c.json({
      accounts: accounts.map((a) => ({
        ...a,
        linkedHoldings: linked.get(a.id) || 0,
        autoImport: autoImport.has(a.id),
        links: links.filter((l) => l.accountId === a.id),
      })),
      groups,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Could not load accounts from Actual' }, 502);
  }
});

accountRoutes.post('/', requireSession, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(100),
      offbudget: z.boolean().default(false),
      initialBalance: z.number().finite().default(0), // major units
      accountGroupId: z.string().trim().min(1).nullable().optional(),
    })
    .safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Invalid account' }, 400);

  const existing = await actual.getAccounts(false);
  if (existing.some((a) => !a.closed && a.name.toLowerCase() === parsed.data.name.toLowerCase())) {
    return c.json({ error: `An open account named "${parsed.data.name}" already exists` }, 409);
  }

  const id = await actual.createAccount({
    name: parsed.data.name,
    offbudget: parsed.data.offbudget,
    initialBalance: Math.round(parsed.data.initialBalance * 100),
  });
  if (id && parsed.data.accountGroupId) {
    await actual.updateAccount(id, {
      name: parsed.data.name,
      offbudget: parsed.data.offbudget,
      account_group_id: parsed.data.accountGroupId,
    });
  }
  return c.json({ ok: true, id }, 201);
});

accountRoutes.patch('/:id', requireSession, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(100).optional(),
      offbudget: z.boolean().optional(),
      accountGroupId: z.string().trim().min(1).nullable().optional(),
    })
    .safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Invalid update' }, 400);

  const current = (await actual.getAccounts(false)).find((a) => a.id === id);
  if (!current) return c.json({ error: 'Account not found' }, 404);

  // Actual's PATCH needs both fields, so fill in whichever wasn't changed.
  await actual.updateAccount(id, {
    name: parsed.data.name ?? current.name,
    offbudget: parsed.data.offbudget ?? current.offbudget,
    ...(parsed.data.accountGroupId !== undefined ? { account_group_id: parsed.data.accountGroupId } : {}),
  });
  return c.json({ ok: true });
});

accountRoutes.post('/:id/close', requireSession, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = z
    .object({
      transferAccountId: z.string().trim().min(1).optional(),
      transferCategoryId: z.string().trim().min(1).optional(),
    })
    .safeParse(body ?? {});
  if (!parsed.success) return c.json({ error: 'Invalid close request' }, 400);

  const accounts = await actual.getAccounts(true);
  const account = accounts.find((a) => a.id === id);
  if (!account) return c.json({ error: 'Account not found' }, 404);
  if (account.closed) return c.json({ error: 'Account is already closed' }, 409);

  const balance = account.workingBalance ?? 0;
  const { transferAccountId, transferCategoryId } = parsed.data;
  if (balance !== 0) {
    if (!transferAccountId) {
      return c.json({ error: 'This account still has a balance. Pick an account to move it to.' }, 400);
    }
    const target = accounts.find((a) => a.id === transferAccountId);
    if (!target || target.closed || target.id === id) {
      return c.json({ error: 'Pick a different open account to move the balance to.' }, 400);
    }
    // Money leaving the budget (budget → tracking) needs a category so the budget stays balanced.
    if (!account.offbudget && target.offbudget && !transferCategoryId) {
      return c.json({ error: 'Moving money from a budget account to a tracking account needs a category.' }, 400);
    }
  }

  await actual.closeAccount(id, balance !== 0 ? { transferAccountId, transferCategoryId } : undefined);
  return c.json({ ok: true });
});

accountRoutes.post('/:id/reopen', requireSession, async (c) => {
  const id = c.req.param('id');
  await actual.reopenAccount(id);
  return c.json({ ok: true });
});

// --- Account groups ---

const groupNameSchema = z.object({ name: z.string().trim().min(1).max(60) });

accountRoutes.post('/groups', requireSession, async (c) => {
  const parsed = groupNameSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Give the group a name' }, 400);
  const groups = await actual.getAccountGroups();
  if (groups.some((g) => g.name.toLowerCase() === parsed.data.name.toLowerCase())) {
    return c.json({ error: `A group named "${parsed.data.name}" already exists` }, 409);
  }
  const id = await actual.createAccountGroup(parsed.data.name);
  return c.json({ ok: true, id }, 201);
});

accountRoutes.patch('/groups/:groupId', requireSession, async (c) => {
  const parsed = groupNameSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Give the group a name' }, 400);
  await actual.renameAccountGroup(c.req.param('groupId'), parsed.data.name);
  return c.json({ ok: true });
});

accountRoutes.delete('/groups/:groupId', requireSession, async (c) => {
  await actual.deleteAccountGroup(c.req.param('groupId'));
  return c.json({ ok: true });
});

// --- Card / account links used by email import ---

accountRoutes.patch('/:id/prefs', requireSession, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ autoImport: z.boolean() }).safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid preferences' }, 400);
  setAutoImport(c.req.param('id'), parsed.data.autoImport);
  return c.json({ ok: true });
});

/** Manually link a card/account by its last 4 digits before any email has arrived. */
accountRoutes.post('/:id/links', requireSession, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z
    .object({
      issuer: z.string().trim().min(2).max(30),
      kind: z.enum(['card', 'account', 'wallet']),
      last4: z.string().regex(/^\d{4}$/, 'Enter the last 4 digits'),
    })
    .safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Invalid card details' }, 400);
  const { issuer, kind, last4 } = parsed.data;
  const fingerprint = fingerprintFor(issuer, kind, last4);
  upsertLink({ fingerprint, kind, label: refLabel(issuer, kind, last4), accountId: c.req.param('id'), source: 'manual' });
  return c.json({ ok: true, fingerprint }, 201);
});

accountRoutes.delete('/links/:fingerprint', requireSession, (c) => {
  const ok = deleteLink(decodeURIComponent(c.req.param('fingerprint')));
  return ok ? c.json({ ok: true }) : c.json({ error: 'Link not found' }, 404);
});
