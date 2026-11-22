import { db } from '../db';
import type { AccountLink } from '../../shared/types';

type Row = {
  fingerprint: string;
  kind: AccountLink['kind'];
  label: string;
  account_id: string;
  source: AccountLink['source'];
  conflicts: number;
  updated_at: string;
};

const toLink = (r: Row): AccountLink => ({
  fingerprint: r.fingerprint,
  kind: r.kind,
  label: r.label,
  accountId: r.account_id,
  source: r.source,
  conflicts: r.conflicts,
  updatedAt: r.updated_at,
});

export function findLink(fingerprint: string | null | undefined): AccountLink | null {
  if (!fingerprint) return null;
  const r = db.query<Row, [string]>('SELECT * FROM account_links WHERE fingerprint = ?').get(fingerprint);
  return r ? toLink(r) : null;
}

export function listLinks(): AccountLink[] {
  return db.query<Row, []>('SELECT * FROM account_links ORDER BY kind, label').all().map(toLink);
}

/**
 * Remembers fingerprint → account. Re-pointing an alert-type link (no digits) to a different account counts as a
 * conflict, which keeps that alert type in review from then on, because it evidently covers more than one account.
 */
export function upsertLink(input: { fingerprint: string; kind: AccountLink['kind']; label: string; accountId: string; source: AccountLink['source'] }): void {
  const now = new Date().toISOString();
  const existing = findLink(input.fingerprint);
  if (!existing) {
    db.query(
      `INSERT INTO account_links (fingerprint, kind, label, account_id, source, hits, conflicts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)`,
    ).run(input.fingerprint, input.kind, input.label, input.accountId, input.source, now, now);
    return;
  }
  const changed = existing.accountId !== input.accountId;
  db.query(
    `UPDATE account_links
     SET account_id = ?, label = ?, source = ?, hits = hits + 1, conflicts = conflicts + ?, updated_at = ?
     WHERE fingerprint = ?`,
  ).run(
    input.accountId,
    input.label,
    input.source === 'manual' ? 'manual' : existing.source,
    changed && input.kind === 'alert' ? 1 : 0,
    now,
    input.fingerprint,
  );
}

export function deleteLink(fingerprint: string): boolean {
  return db.query('DELETE FROM account_links WHERE fingerprint = ?').run(fingerprint).changes > 0;
}

export function getAutoImportAccounts(): Set<string> {
  const rows = db.query<{ account_id: string }, []>('SELECT account_id FROM account_prefs WHERE auto_import = 1').all();
  return new Set(rows.map((r) => r.account_id));
}

export function setAutoImport(accountId: string, on: boolean): void {
  db.query(
    `INSERT INTO account_prefs (account_id, auto_import) VALUES (?, ?)
     ON CONFLICT(account_id) DO UPDATE SET auto_import = excluded.auto_import`,
  ).run(accountId, on ? 1 : 0);
}
