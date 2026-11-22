import * as actual from './client';
import type { ActualRule } from './client';

const lower = (v: unknown) => String(v ?? '').trim().toLowerCase();

/** A rule we can reason about: only imported_payee conditions, and a "set payee" action. */
function payeeRenameTarget(rule: ActualRule): string | null {
  const set = rule.actions?.find((a) => a.field === 'payee' && a.op === 'set');
  if (!set || typeof set.value !== 'string') return null;
  if (!rule.conditions?.length || rule.conditions.some((c) => c.field !== 'imported_payee')) return null;
  return set.value;
}

function conditionMatches(op: string, value: unknown, raw: string): boolean {
  const r = lower(raw);
  switch (op) {
    case 'is':
      return r === lower(value);
    case 'isNot':
      return r !== lower(value);
    case 'oneOf':
      return Array.isArray(value) && value.some((v) => lower(v) === r);
    case 'notOneOf':
      return Array.isArray(value) && !value.some((v) => lower(v) === r);
    case 'contains':
      return Boolean(lower(value)) && r.includes(lower(value));
    case 'doesNotContain':
      return !r.includes(lower(value));
    case 'matches':
      try {
        return new RegExp(String(value), 'i').test(raw);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

/** Previews which existing payee Actual's rename rules would give this imported payee. */
export async function resolvePayeeByRules(raw: string | null | undefined): Promise<{ payeeId: string; payeeName: string } | null> {
  if (!raw) return null;
  const [rules, payees] = await Promise.all([actual.getRules(), actual.getPayees()]);
  const ordered = [...rules].sort((a, b) => (a.stage === 'pre' ? -1 : 0) - (b.stage === 'pre' ? -1 : 0));
  for (const rule of ordered) {
    const target = payeeRenameTarget(rule);
    if (!target) continue;
    const results = rule.conditions.map((c) => conditionMatches(c.op, c.value, raw));
    const ok = rule.conditionsOp === 'or' ? results.some(Boolean) : results.every(Boolean);
    if (!ok) continue;
    const p = payees.find((x) => x.id === target);
    if (p) return { payeeId: p.id, payeeName: p.name };
  }
  return null;
}

/**
 * Teaches Actual that `raw` (as the bank writes it) means `targetPayeeId`, the same way Actual does when
 * you rename a payee: add it to that payee's "imported payee is one of …" rule, or create one.
 * `contains` creates a broader "imported payee contains …" rule instead.
 */
export async function linkImportedPayee(opts: {
  raw: string;
  targetPayeeId: string;
  match: 'exact' | 'contains';
  containsText?: string;
}): Promise<{ ruleId: string | null; created: boolean }> {
  const rules = await actual.getRules();
  const raw = opts.raw.trim();

  if (opts.match === 'contains') {
    const text = (opts.containsText || raw).trim();
    const existing = rules.find(
      (r) =>
        payeeRenameTarget(r) === opts.targetPayeeId &&
        r.conditions.length === 1 &&
        r.conditions[0].op === 'contains' &&
        lower(r.conditions[0].value) === lower(text),
    );
    if (existing) return { ruleId: existing.id, created: false };
    const id = await actual.createRule({
      stage: 'pre',
      conditionsOp: 'and',
      conditions: [{ field: 'imported_payee', op: 'contains', value: text, type: 'string' }],
      actions: [{ field: 'payee', op: 'set', value: opts.targetPayeeId, type: 'id' }],
    });
    return { ruleId: id, created: true };
  }

  // Exact: drop `raw` from any other payee's one-of list so two rules don't fight over it.
  for (const r of rules) {
    const target = payeeRenameTarget(r);
    if (!target || target === opts.targetPayeeId || r.conditions.length !== 1) continue;
    const c = r.conditions[0];
    if (c.op === 'oneOf' && Array.isArray(c.value) && c.value.some((v) => lower(v) === lower(raw))) {
      const remaining = c.value.filter((v) => lower(v) !== lower(raw));
      if (remaining.length) await actual.updateRule({ ...r, conditions: [{ ...c, value: remaining }] });
    }
  }

  const mine = rules.find(
    (r) => payeeRenameTarget(r) === opts.targetPayeeId && r.conditions.length === 1 && r.conditions[0].op === 'oneOf' && Array.isArray(r.conditions[0].value),
  );
  if (mine) {
    const c = mine.conditions[0];
    const values = c.value as unknown[];
    if (!values.some((v) => lower(v) === lower(raw))) {
      await actual.updateRule({ ...mine, conditions: [{ ...c, value: [...values, raw] }] });
    }
    return { ruleId: mine.id, created: false };
  }
  const id = await actual.createRule({
    stage: 'pre',
    conditionsOp: 'and',
    conditions: [{ field: 'imported_payee', op: 'oneOf', value: [raw], type: 'string' }],
    actions: [{ field: 'payee', op: 'set', value: opts.targetPayeeId, type: 'id' }],
  });
  return { ruleId: id, created: true };
}
