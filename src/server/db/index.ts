import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config';

fs.mkdirSync(config.dataDir, { recursive: true });
const dbPath = path.join(config.dataDir, 'companion.db');

export const db = new Database(dbPath, { create: true });

// Optimize SQLite for concurrent web + background worker access
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT UNIQUE NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_agent TEXT NOT NULL DEFAULT '',
    ip_address TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS passkeys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key TEXT NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT NOT NULL DEFAULT '[]',
    device_name TEXT NOT NULL DEFAULT 'Passkey',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS webauthn_challenges (
    id TEXT PRIMARY KEY,
    challenge TEXT NOT NULL,
    type TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    key_hash TEXT UNIQUE NOT NULL,
    scopes TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS holdings (
    id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    name TEXT NOT NULL,
    asset_type TEXT NOT NULL CHECK (asset_type IN ('stock', 'etf', 'crypto', 'cash')),
    provider_id TEXT NOT NULL,
    quantity REAL NOT NULL,
    avg_cost REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    actual_account_id TEXT,
    notes TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rsu_grants (
    id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    name TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    grant_name TEXT NOT NULL DEFAULT '',
    grant_date TEXT NOT NULL,
    grant_price REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    tax_withhold_pct REAL NOT NULL DEFAULT 0,
    include_in_total INTEGER NOT NULL DEFAULT 1,
    actual_account_id TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rsu_tranches (
    id TEXT PRIMARY KEY,
    grant_id TEXT NOT NULL REFERENCES rsu_grants(id) ON DELETE CASCADE,
    vest_date TEXT NOT NULL,
    units REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'vested', 'sold', 'forfeited')),
    vested_price REAL,
    withheld_units REAL NOT NULL DEFAULT 0,
    notes TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_rsu_tranches_grant ON rsu_tranches(grant_id, vest_date ASC);

  CREATE TABLE IF NOT EXISTS price_cache (
    cache_key TEXT PRIMARY KEY,
    price REAL NOT NULL,
    change_24h_pct REAL,
    currency TEXT NOT NULL,
    name TEXT,
    fetched_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS fx_cache (
    pair TEXT PRIMARY KEY,
    rate REAL NOT NULL,
    fetched_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    snapshot_date TEXT PRIMARY KEY,
    base_currency TEXT NOT NULL,
    investments_value REAL NOT NULL,
    actual_cash_value REAL NOT NULL,
    total_net_worth REAL NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS email_events (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    message_id TEXT NOT NULL,
    sender TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    body_text TEXT NOT NULL DEFAULT '',
    received_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'pending_review', 'imported', 'dismissed', 'failed')),
    parsed_json TEXT,
    confidence REAL NOT NULL DEFAULT 0,
    actual_tx_id TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    processed_at TEXT,
    UNIQUE(source, message_id)
  );

  CREATE TABLE IF NOT EXISTS email_rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sender_pattern TEXT NOT NULL DEFAULT '',
    subject_pattern TEXT NOT NULL DEFAULT '',
    amount_regex TEXT NOT NULL DEFAULT '',
    payee_regex TEXT NOT NULL DEFAULT '',
    default_currency TEXT NOT NULL DEFAULT 'SGD',
    actual_account_id TEXT,
    actual_category_id TEXT,
    auto_import INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_email_events_status ON email_events(status, created_at DESC);

  -- Learned/manual links from a card or account fingerprint (e.g. "uob:card:1234") or an alert type
  -- (kind 'alert', fingerprint "sender|subject") to an Actual account.
  CREATE TABLE IF NOT EXISTS account_links (
    fingerprint TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    account_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'learned',
    hits INTEGER NOT NULL DEFAULT 0,
    conflicts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_account_links_account ON account_links(account_id);

  CREATE TABLE IF NOT EXISTS account_prefs (
    account_id TEXT PRIMARY KEY,
    auto_import INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    endpoint TEXT UNIQUE NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    device_label TEXT NOT NULL DEFAULT 'Browser',
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    last_error TEXT
  );

  CREATE TABLE IF NOT EXISTS schedule_watch_state (
    schedule_id TEXT PRIMARY KEY,
    last_next_date TEXT,
    completed INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notified_schedule_posts (
    dedupe_key TEXT PRIMARY KEY,
    schedule_id TEXT NOT NULL,
    posted_date TEXT NOT NULL,
    tx_id TEXT,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notified_schedule_created ON notified_schedule_posts(created_at);
`);

// Safe additive migration: track when an email event has already triggered a push notification
const emailEventCols = db.query<{ name: string }, []>('PRAGMA table_info(email_events)').all();
if (!emailEventCols.some((c) => c.name === 'notified_at')) {
  db.exec('ALTER TABLE email_events ADD COLUMN notified_at TEXT');
  db.exec("UPDATE email_events SET notified_at = COALESCE(processed_at, created_at) WHERE status != 'queued'");
}

// Safe migration: expand holdings.asset_type CHECK constraint to include 'cash' (excess liquidity)
const holdingsTableSql = db
  .query<{ sql: string | null }, []>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'holdings'")
  .get()?.sql;
if (holdingsTableSql && !holdingsTableSql.includes("'cash'")) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE holdings_v2 (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        asset_type TEXT NOT NULL CHECK (asset_type IN ('stock', 'etf', 'crypto', 'cash')),
        provider_id TEXT NOT NULL,
        quantity REAL NOT NULL,
        avg_cost REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        actual_account_id TEXT,
        notes TEXT,
        updated_at TEXT NOT NULL
      );
      INSERT INTO holdings_v2 (id, symbol, name, asset_type, provider_id, quantity, avg_cost, currency, actual_account_id, notes, updated_at)
      SELECT id, symbol, name, asset_type, provider_id, quantity, avg_cost, currency, actual_account_id, notes, updated_at FROM holdings;
      DROP TABLE holdings;
      ALTER TABLE holdings_v2 RENAME TO holdings;
    `);
  })();
}

export function getSetting(key: string): string | null {
  const row = db.query<{ value: string }, [string]>('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setSetting(key: string, value: string): void {
  db.query('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    value,
  );
}

// Seed defaults once
if (!getSetting('base_currency')) {
  setSetting('base_currency', config.defaultBaseCurrency);
}
if (!getSetting('email_webhook_secret')) {
  setSetting('email_webhook_secret', config.emailWebhookSecret || crypto.randomBytes(24).toString('hex'));
}
if (config.actualBudgetSyncId && !getSetting('budget_sync_id')) {
  setSetting('budget_sync_id', config.actualBudgetSyncId);
}

// Pre-seed helpful Singapore bank/card rules if table is empty
const ruleCount = db.query<{ c: number }, []>('SELECT COUNT(*) AS c FROM email_rules').get()?.c ?? 0;
if (ruleCount === 0) {
  const now = new Date().toISOString();
  const seedRules = [
    {
      name: 'DBS / POSB Card & PayLah Alerts',
      sender_pattern: 'dbs\\.com|posb\\.com',
      subject_pattern: 'Transaction Alert|Card Transaction|PayLah|PayNow',
      amount_regex: '(?:SGD|S\\$|USD|EUR|GBP|JPY|MYR)\\s*([0-9,]+\\.\\d{2})',
      payee_regex: '(?:To|at|Merchant)[:\\s]+([A-Za-z0-9 &.*\\-\'/]{2,60})',
      default_currency: 'SGD',
    },
    {
      name: 'OCBC Card & PayNow Alerts',
      sender_pattern: 'ocbc\\.com',
      subject_pattern: 'Transaction|Alert|PayNow|Card',
      amount_regex: '(?:SGD|S\\$|USD)\\s*([0-9,]+\\.\\d{2})',
      payee_regex: '(?:at|to|Merchant)[:\\s]+([A-Za-z0-9 &.*\\-\'/]{2,60})',
      default_currency: 'SGD',
    },
    {
      name: 'UOB Transaction Alerts',
      sender_pattern: 'uob\\.com|uobgroup\\.com',
      subject_pattern: 'Transaction|Alert|Card|TMRW',
      amount_regex: '(?:SGD|S\\$|USD)\\s*([0-9,]+\\.\\d{2})',
      payee_regex: '(?:at|to|Merchant)[:\\s]+([A-Za-z0-9 &.*\\-\'/]{2,60})',
      default_currency: 'SGD',
    },
    {
      name: 'Grab / Food & Ride Receipts',
      sender_pattern: 'grab\\.com',
      subject_pattern: 'Your Grab E-Receipt|GrabPay|GrabFood',
      amount_regex: '(?:SGD|S\\$)\\s*([0-9,]+\\.\\d{2})',
      payee_regex: '(?:Ordered from|Merchant|GrabFood|GrabTransport)[:\\s]*([A-Za-z0-9 &.*\\-\'/]{2,60})',
      default_currency: 'SGD',
    },
  ];
  const insert = db.query(
    `INSERT INTO email_rules (id, name, sender_pattern, subject_pattern, amount_regex, payee_regex, default_currency, auto_import, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?)`,
  );
  for (const r of seedRules) {
    insert.run(
      crypto.randomUUID(),
      r.name,
      r.sender_pattern,
      r.subject_pattern,
      r.amount_regex,
      r.payee_regex,
      r.default_currency,
      now,
    );
  }
}
