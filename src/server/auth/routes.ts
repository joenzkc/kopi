import crypto from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type { RegistrationResponseJSON, AuthenticationResponseJSON, AuthenticatorTransportFuture } from '@simplewebauthn/server';
import { db } from '../db';
import {
  checkRateLimit,
  clearSession,
  createSession,
  getClientIp,
  getFirstOwner,
  getOwnerCount,
  getSessionUser,
  requireSession,
  resolveRequestOrigin,
  sha256,
} from './service';

export const authRoutes = new Hono();

const setupSchema = z.object({
  username: z.string().trim().min(2).max(40),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

authRoutes.get('/status', (c) => {
  const ownerCount = getOwnerCount();
  const user = getSessionUser(c);
  const passkeyCount = db.query<{ c: number }, []>('SELECT COUNT(*) AS c FROM passkeys').get()?.c ?? 0;
  const { isHttps, rpID } = resolveRequestOrigin(c);
  return c.json({
    needsSetup: ownerCount === 0,
    authenticated: Boolean(user),
    user: user ? { id: user.id, username: user.username } : null,
    hasPasskeys: passkeyCount > 0,
    webAuthnSupportedOrigin: isHttps || rpID === 'localhost' || rpID === '127.0.0.1',
  });
});

authRoutes.post('/setup', async (c) => {
  if (getOwnerCount() > 0) {
    return c.json({ error: 'Owner account already configured' }, 403);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = setupSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Username (min 2 chars) and password (min 8 chars) required' }, 400);
  }

  const userId = crypto.randomUUID();
  const passwordHash = await Bun.password.hash(parsed.data.password, {
    algorithm: 'argon2id',
    memoryCost: 19456,
    timeCost: 2,
  });

  db.query('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    parsed.data.username,
    passwordHash,
    new Date().toISOString(),
  );

  createSession(c, userId);
  return c.json({ ok: true, user: { id: userId, username: parsed.data.username } }, 201);
});

authRoutes.post('/login', async (c) => {
  const ip = getClientIp(c);
  if (!checkRateLimit(`login:${ip}`, 10, 15 * 60 * 1000)) {
    return c.json({ error: 'Too many login attempts. Try again in 15 minutes.' }, 429);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Username and password required' }, 400);
  }

  const user = db
    .query<{ id: string; username: string; password_hash: string }, [string]>(
      'SELECT id, username, password_hash FROM users WHERE LOWER(username) = LOWER(?)',
    )
    .get(parsed.data.username);

  if (!user) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const valid = await Bun.password.verify(parsed.data.password, user.password_hash);
  if (!valid) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  createSession(c, user.id);
  return c.json({ ok: true, user: { id: user.id, username: user.username } });
});

authRoutes.post('/logout', (c) => {
  clearSession(c);
  return c.json({ ok: true });
});

authRoutes.post('/change-password', requireSession, async (c) => {
  const user = getSessionUser(c)!;
  const body = await c.req.json().catch(() => null);
  const schema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(128),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'New password must be at least 8 characters' }, 400);
  }

  const row = db
    .query<{ password_hash: string }, [string]>('SELECT password_hash FROM users WHERE id = ?')
    .get(user.id);
  if (!row || !(await Bun.password.verify(parsed.data.currentPassword, row.password_hash))) {
    return c.json({ error: 'Current password is incorrect' }, 401);
  }

  const nextHash = await Bun.password.hash(parsed.data.newPassword, {
    algorithm: 'argon2id',
    memoryCost: 19456,
    timeCost: 2,
  });
  db.query('UPDATE users SET password_hash = ? WHERE id = ?').run(nextHash, user.id);
  return c.json({ ok: true });
});

// --- WebAuthn Passkeys ---

authRoutes.post('/passkey/register/options', requireSession, async (c) => {
  const user = getSessionUser(c)!;
  const { rpID } = resolveRequestOrigin(c);

  const existing = db
    .query<{ id: string; transports: string }, [string]>('SELECT id, transports FROM passkeys WHERE user_id = ?')
    .all(user.id);

  const options = await generateRegistrationOptions({
    rpName: 'Kopi',
    rpID,
    userName: user.username,
    userID: new TextEncoder().encode(user.id),
    attestationType: 'none',
    excludeCredentials: existing.map((cred) => ({
      id: cred.id,
      transports: JSON.parse(cred.transports || '[]') as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  const challengeId = crypto.randomUUID();
  db.query('INSERT INTO webauthn_challenges (id, challenge, type, expires_at) VALUES (?, ?, ?, ?)').run(
    challengeId,
    options.challenge,
    'register',
    new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  );

  return c.json({ challengeId, options });
});

authRoutes.post('/passkey/register/verify', requireSession, async (c) => {
  const user = getSessionUser(c)!;
  const { origin, rpID } = resolveRequestOrigin(c);
  const body = (await c.req.json().catch(() => null)) as {
    challengeId?: string;
    deviceName?: string;
    response?: RegistrationResponseJSON;
  } | null;

  if (!body?.challengeId || !body?.response) {
    return c.json({ error: 'Missing challengeId or response' }, 400);
  }

  const chRow = db
    .query<{ challenge: string; expires_at: string }, [string]>(
      "SELECT challenge, expires_at FROM webauthn_challenges WHERE id = ? AND type = 'register'",
    )
    .get(body.challengeId);
  db.query('DELETE FROM webauthn_challenges WHERE id = ?').run(body.challengeId);

  if (!chRow || new Date(chRow.expires_at).getTime() <= Date.now()) {
    return c.json({ error: 'Registration challenge expired' }, 400);
  }

  const verification = await verifyRegistrationResponse({
    response: body.response,
    expectedChallenge: chRow.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  });

  if (!verification.verified || !verification.registrationInfo) {
    return c.json({ error: 'Passkey verification failed' }, 400);
  }

  const { credential } = verification.registrationInfo;
  db.query(
    `INSERT INTO passkeys (id, user_id, public_key, counter, transports, device_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    credential.id,
    user.id,
    Buffer.from(credential.publicKey).toString('base64url'),
    credential.counter,
    JSON.stringify(credential.transports || []),
    (body.deviceName || 'Passkey').slice(0, 60),
    new Date().toISOString(),
  );

  return c.json({ ok: true, id: credential.id });
});

authRoutes.post('/passkey/login/options', async (c) => {
  const owner = getFirstOwner();
  if (!owner) return c.json({ error: 'No owner configured' }, 404);
  const { rpID } = resolveRequestOrigin(c);

  const creds = db
    .query<{ id: string; transports: string }, [string]>('SELECT id, transports FROM passkeys WHERE user_id = ?')
    .all(owner.id);

  if (creds.length === 0) {
    return c.json({ error: 'No passkeys registered' }, 404);
  }

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
    allowCredentials: creds.map((cred) => ({
      id: cred.id,
      transports: JSON.parse(cred.transports || '[]') as AuthenticatorTransportFuture[],
    })),
  });

  const challengeId = crypto.randomUUID();
  db.query('INSERT INTO webauthn_challenges (id, challenge, type, expires_at) VALUES (?, ?, ?, ?)').run(
    challengeId,
    options.challenge,
    'login',
    new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  );

  return c.json({ challengeId, options });
});

authRoutes.post('/passkey/login/verify', async (c) => {
  const ip = getClientIp(c);
  if (!checkRateLimit(`passkey:${ip}`, 20, 15 * 60 * 1000)) {
    return c.json({ error: 'Too many attempts' }, 429);
  }

  const { origin, rpID } = resolveRequestOrigin(c);
  const body = (await c.req.json().catch(() => null)) as {
    challengeId?: string;
    response?: AuthenticationResponseJSON;
  } | null;

  if (!body?.challengeId || !body?.response) {
    return c.json({ error: 'Invalid passkey payload' }, 400);
  }

  const chRow = db
    .query<{ challenge: string; expires_at: string }, [string]>(
      "SELECT challenge, expires_at FROM webauthn_challenges WHERE id = ? AND type = 'login'",
    )
    .get(body.challengeId);
  db.query('DELETE FROM webauthn_challenges WHERE id = ?').run(body.challengeId);

  if (!chRow || new Date(chRow.expires_at).getTime() <= Date.now()) {
    return c.json({ error: 'Login challenge expired' }, 400);
  }

  const credRow = db
    .query<
      { id: string; user_id: string; public_key: string; counter: number; transports: string },
      [string]
    >('SELECT id, user_id, public_key, counter, transports FROM passkeys WHERE id = ?')
    .get(body.response.id);

  if (!credRow) {
    return c.json({ error: 'Passkey not recognized' }, 401);
  }

  const verification = await verifyAuthenticationResponse({
    response: body.response,
    expectedChallenge: chRow.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: credRow.id,
      publicKey: new Uint8Array(Buffer.from(credRow.public_key, 'base64url')),
      counter: credRow.counter,
      transports: JSON.parse(credRow.transports || '[]') as AuthenticatorTransportFuture[],
    },
  });

  if (!verification.verified) {
    return c.json({ error: 'Passkey authentication failed' }, 401);
  }

  db.query('UPDATE passkeys SET counter = ? WHERE id = ?').run(
    verification.authenticationInfo.newCounter,
    credRow.id,
  );

  const user = db
    .query<{ id: string; username: string }, [string]>('SELECT id, username FROM users WHERE id = ?')
    .get(credRow.user_id);
  if (!user) return c.json({ error: 'User not found' }, 404);

  createSession(c, user.id);
  return c.json({ ok: true, user });
});

authRoutes.get('/passkeys', requireSession, (c) => {
  const user = getSessionUser(c)!;
  const rows = db
    .query<{ id: string; device_name: string; created_at: string }, [string]>(
      'SELECT id, device_name, created_at FROM passkeys WHERE user_id = ? ORDER BY created_at DESC',
    )
    .all(user.id);
  return c.json({ passkeys: rows });
});

authRoutes.delete('/passkeys/:id', requireSession, (c) => {
  const user = getSessionUser(c)!;
  db.query('DELETE FROM passkeys WHERE id = ? AND user_id = ?').run(c.req.param('id'), user.id);
  return c.json({ ok: true });
});

// --- Sessions ---

authRoutes.get('/sessions', requireSession, (c) => {
  const user = getSessionUser(c)!;
  const rows = db
    .query<
      { id: string; user_agent: string; ip_address: string; created_at: string; last_seen_at: string },
      [string, string]
    >(
      'SELECT id, user_agent, ip_address, created_at, last_seen_at FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC',
    )
    .all(user.id, new Date().toISOString());
  return c.json({
    sessions: rows.map((r) => ({ ...r, current: r.id === user.sessionId })),
  });
});

authRoutes.delete('/sessions/:id', requireSession, (c) => {
  const user = getSessionUser(c)!;
  db.query('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(c.req.param('id'), user.id);
  return c.json({ ok: true });
});

// --- API Keys ---

authRoutes.get('/api-keys', requireSession, (c) => {
  const rows = db
    .query<
      {
        id: string;
        name: string;
        key_prefix: string;
        scopes: string;
        created_at: string;
        last_used_at: string | null;
        revoked_at: string | null;
      },
      []
    >('SELECT id, name, key_prefix, scopes, created_at, last_used_at, revoked_at FROM api_keys ORDER BY created_at DESC')
    .all();

  return c.json({
    keys: rows.map((r) => ({ ...r, scopes: JSON.parse(r.scopes || '[]') })),
  });
});

authRoutes.post('/api-keys', requireSession, async (c) => {
  const body = await c.req.json().catch(() => null);
  const schema = z.object({
    name: z.string().trim().min(1).max(80),
    scopes: z.array(z.enum(['ingest:write', 'portfolio:read', 'schedules:write', '*'])).min(1),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Name and at least one scope required' }, 400);
  }

  const rawKey = `lp_live_${crypto.randomBytes(24).toString('base64url')}`;
  const id = crypto.randomUUID();
  const prefix = rawKey.slice(0, 14);
  const now = new Date().toISOString();

  db.query(
    `INSERT INTO api_keys (id, name, key_prefix, key_hash, scopes, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, parsed.data.name, prefix, sha256(rawKey), JSON.stringify(parsed.data.scopes), now);

  return c.json(
    {
      id,
      name: parsed.data.name,
      key_prefix: prefix,
      scopes: parsed.data.scopes,
      created_at: now,
      rawKey, // Shown once!
    },
    201,
  );
});

authRoutes.delete('/api-keys/:id', requireSession, (c) => {
  db.query('UPDATE api_keys SET revoked_at = ? WHERE id = ?').run(new Date().toISOString(), c.req.param('id'));
  return c.json({ ok: true });
});
