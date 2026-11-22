import { Hono } from 'hono';
import { z } from 'zod';
import { requireSession } from '../auth/service';
import * as actual from '../actual/client';
import { linkImportedPayee } from '../actual/payeeRules';

export const payeeRoutes = new Hono();

/**
 * "McDonalds JE" should be "McDonalds": adds an Actual payee rule so future imports are renamed, and
 * optionally merges an existing duplicate payee so past transactions are renamed too.
 */
payeeRoutes.post('/link', requireSession, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z
    .object({
      raw: z.string().trim().min(1).max(120),
      targetPayeeId: z.string().trim().min(1).optional(),
      targetName: z.string().trim().min(1).max(120).optional(),
      match: z.enum(['exact', 'contains']).default('exact'),
      containsText: z.string().trim().min(2).max(120).optional(),
      mergePayeeId: z.string().trim().min(1).optional(),
    })
    .refine((d) => d.targetPayeeId || d.targetName, { message: 'Choose the payee to rename to' })
    .safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, 400);
  const d = parsed.data;

  const targetPayeeId = d.targetPayeeId || (await actual.ensurePayeeByName(d.targetName!));
  if (d.mergePayeeId && d.mergePayeeId === targetPayeeId) {
    return c.json({ error: 'That is already the same payee' }, 400);
  }

  const rule = await linkImportedPayee({ raw: d.raw, targetPayeeId, match: d.match, containsText: d.containsText });
  let merged = false;
  if (d.mergePayeeId) {
    await actual.mergePayees(targetPayeeId, [d.mergePayeeId]);
    merged = true;
  }
  const payees = await actual.getPayees();
  return c.json({ ok: true, targetPayeeId, targetName: payees.find((p) => p.id === targetPayeeId)?.name ?? d.targetName, ...rule, merged });
});
