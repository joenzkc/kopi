import crypto from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { db, getSetting } from '../db';
import { config } from '../config';

export const SESSION_COOKIE = 'lp_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface AuthUser {
  id: string;
  username: string;
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

export function getClientIp(c: Context): string {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'unknown'
  );
}

// Lightweight sliding-window rate limiter per key
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= maxRequests) return false;
  bucket.count += 1;
  return true;
}

export function getOwnerCount(): number {
  return db.query<{ c: number }, []>('SELECT COUNT(*) AS c FROM users').get()?.c ?? 0;
}

export function getFirstOwner(): { id: string; username: string; password_hash: string } | null {
  return db
    .query<{ id: string; username: string; password_hash: string }, []>(
      'SELECT id, username, password_hash FROM users LIMIT 1',
    )
    .get();
}

export function resolveRequestOrigin(c: Context): { origin: string; rpID: string; isHttps: boolean } {
  if (config.appOrigin) {
    const u = new URL(config.appOrigin);
    return { origin: u.origin, rpID: u.hostname, isHttps: u.protocol === 'https:' };
  }
  const proto = c.req.header('x-forwarded-proto') || (c.req.url.startsWith('https://') ? 'https' : 'http');
  const host = c.req.header('x-forwarded-host') || c.req.header('host') || 'localhost:5008';
  const origin = `${proto}://${host}`;
  const hostname = host.split(':')[0] || 'localhost';
  return { origin, rpID: hostname, isHttps: proto === 'https' };
}

export function createSession(c: Context, userId: string): string {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = sha256(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  db.query(
    `INSERT INTO sessions (id, token_hash, user_id, user_agent, ip_address, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    tokenHash,
    userId,
    (c.req.header('user-agent') || '').slice(0, 200),
    getClientIp(c),
    now.toISOString(),
    expiresAt.toISOString(),
    now.toISOString(),
  );

  const { isHttps } = resolveRequestOrigin(c);
  setCookie(c, SESSION_COOKIE, rawToken, {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });

  return rawToken;
}

export function clearSession(c: Context): void {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    db.query('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

export function getSessionUser(c: Context): (AuthUser & { sessionId: string }) | null {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const hash = sha256(token);
  const row = db
    .query<
      { session_id: string; user_id: string; username: string; expires_at: string },
      [string]
    >(
      `SELECT s.id AS session_id, u.id AS user_id, u.username, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(hash);

  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.query('DELETE FROM sessions WHERE id = ?').run(row.session_id);
    return null;
  }

  db.query('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), row.session_id);
  return { id: row.user_id, username: row.username, sessionId: row.session_id };
}

export function verifyApiKey(rawKey: string, requiredScope?: string): { id: string; name: string; scopes: string[] } | null {
  const trimmed = rawKey.trim();
  if (!trimmed) return null;
  const hash = sha256(trimmed);
  const row = db
    .query<{ id: string; name: string; scopes: string; revoked_at: string | null }, [string]>(
      'SELECT id, name, scopes, revoked_at FROM api_keys WHERE key_hash = ?',
    )
    .get(hash);

  if (!row || row.revoked_at) return null;
  const scopes: string[] = JSON.parse(row.scopes || '[]');
  if (requiredScope && !scopes.includes(requiredScope) && !scopes.includes('*')) {
    return null;
  }
  db.query('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
  return { id: row.id, name: row.name, scopes };
}

export function verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean {
  if (!signatureHeader) return false;
  const secret = getSetting('email_webhook_secret') || config.emailWebhookSecret;
  if (!secret) return false;
  const provided = signatureHeader.replace(/^sha256=/i, '').trim().toLowerCase();
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return timingSafeEqualHex(provided, expected);
}

export const requireSession: MiddlewareHandler = async (c, next) => {
  const user = getSessionUser(c);
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  c.set('user', user);
  await next();
};

export function requireApiKeyOrSession(scope: string): MiddlewareHandler {
  return async (c, next) => {
    const authHeader = c.req.header('authorization') || '';
    const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
    const xApiKey = c.req.header('x-api-key') || bearer;
    if (xApiKey) {
      const key = verifyApiKey(xApiKey, scope);
      if (key) {
        c.set('apiKey', key);
        await next();
        return;
      }
      return c.json({ error: 'Invalid or insufficient API key' }, 401);
    }

    const user = getSessionUser(c);
    if (user) {
      c.set('user', user);
      await next();
      return;
    }

    return c.json({ error: 'Authentication required' }, 401);
  };
}
