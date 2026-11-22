import crypto from 'node:crypto';
import { Hono } from 'hono';
import { db } from '../db';
import {
  holdingInputSchema,
  holdingUpdateSchema,
  rsuGrantInputSchema,
  rsuGrantUpdateSchema,
  rsuTrancheInputSchema,
  rsuTrancheUpdateSchema,
} from '../../shared/types';
import { requireApiKeyOrSession, requireSession } from '../auth/service';
import { getEnrichedPortfolio, searchAssets } from './prices';
import * as actual from '../actual/client';

export const portfolioRoutes = new Hono();

portfolioRoutes.get('/', requireApiKeyOrSession('portfolio:read'), async (c) => {
  const refresh = c.req.query('refresh') === '1' || c.req.query('refresh') === 'true';
  const portfolio = await getEnrichedPortfolio(refresh);
  return c.json(portfolio);
});

portfolioRoutes.get('/search', requireSession, async (c) => {
  const q = c.req.query('q') || '';
  const typeParam = c.req.query('type') || 'all';
  const type =
    typeParam === 'stock' || typeParam === 'etf' || typeParam === 'crypto' ? typeParam : 'all';
  const hits = await searchAssets(q, type);
  return c.json({ results: hits });
});

portfolioRoutes.post('/holdings', requireSession, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = holdingInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid holding input' }, 400);
  }

  const d = parsed.data;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const ccy = d.currency.toUpperCase();
  const providerId =
    d.asset_type === 'cash'
      ? `cash:${ccy}`
      : d.asset_type === 'crypto'
        ? d.provider_id.toLowerCase()
        : d.provider_id.toUpperCase();

  db.query(
    `INSERT INTO holdings (id, symbol, name, asset_type, provider_id, quantity, avg_cost, currency, actual_account_id, notes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    d.asset_type === 'cash' ? ccy : d.symbol.toUpperCase(),
    d.name,
    d.asset_type,
    providerId,
    d.quantity,
    d.asset_type === 'cash' ? 1 : d.avg_cost,
    ccy,
    d.actual_account_id || null,
    d.notes || null,
    now,
  );

  return c.json({ id, ok: true }, 201);
});

portfolioRoutes.patch('/holdings/:id', requireSession, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const parsed = holdingUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid holding update' }, 400);
  }

  const existing = db
    .query<{ id: string; asset_type: string; currency: string }, [string]>(
      'SELECT id, asset_type, currency FROM holdings WHERE id = ?',
    )
    .get(id);
  if (!existing) return c.json({ error: 'Holding not found' }, 404);

  const d = parsed.data;
  const effectiveType = d.asset_type ?? existing.asset_type;
  if (d.quantity !== undefined && effectiveType !== 'cash' && d.quantity <= 0) {
    return c.json({ error: 'Quantity must be greater than 0' }, 400);
  }

  const fields: string[] = [];
  const values: unknown[] = [];

  if (d.symbol !== undefined) {
    fields.push('symbol = ?');
    values.push(d.symbol.toUpperCase());
  }
  if (d.name !== undefined) {
    fields.push('name = ?');
    values.push(d.name);
  }
  if (d.asset_type !== undefined) {
    fields.push('asset_type = ?');
    values.push(d.asset_type);
  }
  if (d.provider_id !== undefined) {
    fields.push('provider_id = ?');
    const ccy = (d.currency ?? existing.currency).toUpperCase();
    values.push(
      effectiveType === 'cash'
        ? `cash:${ccy}`
        : effectiveType === 'crypto'
          ? d.provider_id.toLowerCase()
          : d.provider_id.toUpperCase(),
    );
  }
  if (d.quantity !== undefined) {
    fields.push('quantity = ?');
    values.push(d.quantity);
  }
  if (d.avg_cost !== undefined) {
    fields.push('avg_cost = ?');
    values.push(effectiveType === 'cash' ? 1 : d.avg_cost);
  }
  if (d.currency !== undefined) {
    fields.push('currency = ?');
    values.push(d.currency.toUpperCase());
    if (effectiveType === 'cash' && d.provider_id === undefined) {
      fields.push('provider_id = ?');
      values.push(`cash:${d.currency.toUpperCase()}`);
    }
  }
  if (d.actual_account_id !== undefined) {
    fields.push('actual_account_id = ?');
    values.push(d.actual_account_id || null);
  }
  if (d.notes !== undefined) {
    fields.push('notes = ?');
    values.push(d.notes || null);
  }

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  db.query(`UPDATE holdings SET ${fields.join(', ')} WHERE id = ?`).run(...(values as never[]));
  return c.json({ ok: true });
});

portfolioRoutes.delete('/holdings/:id', requireSession, (c) => {
  db.query('DELETE FROM holdings WHERE id = ?').run(c.req.param('id'));
  return c.json({ ok: true });
});

// --- RSU Grants & Vesting Tranches ---

portfolioRoutes.post('/rsus', requireSession, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = rsuGrantInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid RSU grant input' }, 400);
  }

  const d = parsed.data;
  const grantId = crypto.randomUUID();
  const now = new Date().toISOString();

  db.transaction(() => {
    db.query(
      `INSERT INTO rsu_grants (
        id, symbol, name, provider_id, grant_name, grant_date, grant_price,
        currency, tax_withhold_pct, include_in_total, actual_account_id, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      grantId,
      d.symbol.toUpperCase(),
      d.name,
      d.provider_id.toUpperCase(),
      d.grant_name,
      d.grant_date,
      d.grant_price,
      d.currency.toUpperCase(),
      d.tax_withhold_pct,
      d.include_in_total ? 1 : 0,
      d.actual_account_id || null,
      d.notes || null,
      now,
      now,
    );

    const insertTranche = db.query(
      `INSERT INTO rsu_tranches (id, grant_id, vest_date, units, status, vested_price, withheld_units, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const t of d.tranches) {
      insertTranche.run(
        crypto.randomUUID(),
        grantId,
        t.vest_date,
        t.units,
        t.status,
        t.vested_price ?? null,
        t.withheld_units ?? 0,
        t.notes || null,
      );
    }
  })();

  return c.json({ id: grantId, ok: true }, 201);
});

portfolioRoutes.patch('/rsus/:id', requireSession, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const parsed = rsuGrantUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid RSU grant update' }, 400);
  }

  const existing = db.query<{ id: string }, [string]>('SELECT id FROM rsu_grants WHERE id = ?').get(id);
  if (!existing) return c.json({ error: 'RSU grant not found' }, 404);

  const d = parsed.data;
  const now = new Date().toISOString();

  db.transaction(() => {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (d.symbol !== undefined) {
      fields.push('symbol = ?');
      values.push(d.symbol.toUpperCase());
    }
    if (d.name !== undefined) {
      fields.push('name = ?');
      values.push(d.name);
    }
    if (d.provider_id !== undefined) {
      fields.push('provider_id = ?');
      values.push(d.provider_id.toUpperCase());
    }
    if (d.grant_name !== undefined) {
      fields.push('grant_name = ?');
      values.push(d.grant_name);
    }
    if (d.grant_date !== undefined) {
      fields.push('grant_date = ?');
      values.push(d.grant_date);
    }
    if (d.grant_price !== undefined) {
      fields.push('grant_price = ?');
      values.push(d.grant_price);
    }
    if (d.currency !== undefined) {
      fields.push('currency = ?');
      values.push(d.currency.toUpperCase());
    }
    if (d.tax_withhold_pct !== undefined) {
      fields.push('tax_withhold_pct = ?');
      values.push(d.tax_withhold_pct);
    }
    if (d.include_in_total !== undefined) {
      fields.push('include_in_total = ?');
      values.push(d.include_in_total ? 1 : 0);
    }
    if (d.actual_account_id !== undefined) {
      fields.push('actual_account_id = ?');
      values.push(d.actual_account_id || null);
    }
    if (d.notes !== undefined) {
      fields.push('notes = ?');
      values.push(d.notes || null);
    }

    fields.push('updated_at = ?');
    values.push(now);
    values.push(id);

    db.query(`UPDATE rsu_grants SET ${fields.join(', ')} WHERE id = ?`).run(...(values as never[]));

    if (d.tranches !== undefined) {
      db.query('DELETE FROM rsu_tranches WHERE grant_id = ?').run(id);
      const insertTranche = db.query(
        `INSERT INTO rsu_tranches (id, grant_id, vest_date, units, status, vested_price, withheld_units, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const t of d.tranches) {
        insertTranche.run(
          t.id || crypto.randomUUID(),
          id,
          t.vest_date,
          t.units,
          t.status,
          t.vested_price ?? null,
          t.withheld_units ?? 0,
          t.notes || null,
        );
      }
    }
  })();

  return c.json({ ok: true });
});

portfolioRoutes.delete('/rsus/:id', requireSession, (c) => {
  db.query('DELETE FROM rsu_grants WHERE id = ?').run(c.req.param('id'));
  return c.json({ ok: true });
});

portfolioRoutes.post('/rsus/:grantId/tranches', requireSession, async (c) => {
  const grantId = c.req.param('grantId');
  const grant = db.query<{ id: string }, [string]>('SELECT id FROM rsu_grants WHERE id = ?').get(grantId);
  if (!grant) return c.json({ error: 'RSU grant not found' }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = rsuTrancheInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid tranche input' }, 400);
  }

  const t = parsed.data;
  const trancheId = crypto.randomUUID();
  db.query(
    `INSERT INTO rsu_tranches (id, grant_id, vest_date, units, status, vested_price, withheld_units, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    trancheId,
    grantId,
    t.vest_date,
    t.units,
    t.status,
    t.vested_price ?? null,
    t.withheld_units ?? 0,
    t.notes || null,
  );
  db.query('UPDATE rsu_grants SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), grantId);

  return c.json({ id: trancheId, ok: true }, 201);
});

portfolioRoutes.patch('/rsus/:grantId/tranches/:trancheId', requireSession, async (c) => {
  const grantId = c.req.param('grantId');
  const trancheId = c.req.param('trancheId');
  const existing = db
    .query<{ id: string; units: number; withheld_units: number }, [string, string]>(
      'SELECT id, units, withheld_units FROM rsu_tranches WHERE id = ? AND grant_id = ?',
    )
    .get(trancheId, grantId);
  if (!existing) return c.json({ error: 'Vesting tranche not found' }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = rsuTrancheUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid tranche update' }, 400);
  }

  const d = parsed.data;
  const finalUnits = d.units ?? existing.units;
  const finalWithheld = d.withheld_units ?? existing.withheld_units;
  if (finalWithheld > finalUnits) {
    return c.json({ error: 'Withheld units cannot exceed tranche units' }, 400);
  }

  const fields: string[] = [];
  const values: unknown[] = [];

  if (d.vest_date !== undefined) {
    fields.push('vest_date = ?');
    values.push(d.vest_date);
  }
  if (d.units !== undefined) {
    fields.push('units = ?');
    values.push(d.units);
  }
  if (d.status !== undefined) {
    fields.push('status = ?');
    values.push(d.status);
  }
  if (d.vested_price !== undefined) {
    fields.push('vested_price = ?');
    values.push(d.vested_price);
  }
  if (d.withheld_units !== undefined) {
    fields.push('withheld_units = ?');
    values.push(d.withheld_units);
  }
  if (d.notes !== undefined) {
    fields.push('notes = ?');
    values.push(d.notes || null);
  }

  if (fields.length > 0) {
    values.push(trancheId, grantId);
    db.query(`UPDATE rsu_tranches SET ${fields.join(', ')} WHERE id = ? AND grant_id = ?`).run(
      ...(values as never[]),
    );
    db.query('UPDATE rsu_grants SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), grantId);
  }

  return c.json({ ok: true });
});

portfolioRoutes.delete('/rsus/:grantId/tranches/:trancheId', requireSession, (c) => {
  const grantId = c.req.param('grantId');
  const trancheId = c.req.param('trancheId');
  db.query('DELETE FROM rsu_tranches WHERE id = ? AND grant_id = ?').run(trancheId, grantId);
  db.query('UPDATE rsu_grants SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), grantId);
  return c.json({ ok: true });
});

portfolioRoutes.post('/sync-actual', requireSession, async (c) => {
  const portfolio = await getEnrichedPortfolio(true);
  const byAccount = new Map<string, number>();

  for (const h of portfolio.holdings) {
    if (!h.actual_account_id || h.marketValueBase === null) continue;
    byAccount.set(h.actual_account_id, (byAccount.get(h.actual_account_id) || 0) + h.marketValueBase);
  }
  for (const g of portfolio.rsuGrants) {
    if (!g.include_in_total || !g.actual_account_id || g.heldValueBase === null) continue;
    byAccount.set(g.actual_account_id, (byAccount.get(g.actual_account_id) || 0) + g.heldValueBase);
  }

  if (byAccount.size === 0) {
    return c.json({
      ok: true,
      synced: [],
      message: 'No holdings or RSU grants are linked to an Actual off-budget account yet.',
    });
  }

  const accounts = await actual.getAccounts(true);
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const today = new Date().toISOString().slice(0, 10);
  const synced: Array<{ accountId: string; accountName: string; targetCents: number; deltaCents: number }> = [];

  for (const [accountId, targetMajor] of byAccount.entries()) {
    const acc = accountMap.get(accountId);
    if (!acc) continue;
    const currentCents = acc.workingBalance ?? (await actual.getAccountBalance(accountId));
    const targetCents = Math.round(targetMajor * 100);
    const deltaCents = targetCents - currentCents;

    if (Math.abs(deltaCents) >= 1) {
      await actual.addTransaction(accountId, {
        date: today,
        amount: deltaCents,
        payee_name: 'Market Valuation Update',
        notes: `Portfolio sync (${portfolio.baseCurrency} ${targetMajor.toFixed(2)})`,
        cleared: true,
      });
    }

    synced.push({
      accountId,
      accountName: acc.name,
      targetCents,
      deltaCents,
    });
  }

  return c.json({ ok: true, synced });
});
