import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { config } from './config';
import './db';
import { authRoutes } from './auth/routes';
import { portfolioRoutes } from './portfolio/routes';
import { scheduleRoutes } from './schedules/routes';
import { emailRulesRoutes, inboxRoutes, ingestRoutes } from './ingest/routes';
import { overviewRoutes } from './overview/routes';
import { accountRoutes } from './accounts/routes';
import { payeeRoutes } from './payees/routes';
import { notificationRoutes } from './notifications/routes';
import { startEmailWorker } from './ingest/worker';
import { startScheduleWatcher } from './schedules/watcher';

const app = new Hono();

// Security headers for public HTTPS deployment
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
});

// Global JSON error handler
app.onError((err, c) => {
  console.error('[server error]', err);
  const status = (err as { status?: number }).status;
  return c.json(
    { error: err.message || 'Internal server error' },
    status && status >= 400 && status < 600 ? (status as 400) : 500,
  );
});

// Public health check
app.get('/api/health', (c) => c.json({ ok: true, time: new Date().toISOString() }));

// Mount API routes
app.route('/api/auth', authRoutes);
app.route('/api/portfolio', portfolioRoutes);
app.route('/api/schedules', scheduleRoutes);
app.route('/api/v1', ingestRoutes);
app.route('/api/accounts', accountRoutes);
app.route('/api/payees', payeeRoutes);
app.route('/api/inbox', inboxRoutes);
app.route('/api/email-rules', emailRulesRoutes);
app.route('/api/notifications', notificationRoutes);
app.route('/api', overviewRoutes);

// Serve built Vite PWA assets in production
const clientDir = path.resolve(process.cwd(), 'dist/client');
if (fs.existsSync(clientDir)) {
  app.use('/*', serveStatic({ root: './dist/client' }));
  // SPA fallback for client routes
  app.get('*', async (c) => {
    if (c.req.path.startsWith('/api/')) {
      return c.json({ error: 'Not found' }, 404);
    }
    const html = await Bun.file(path.join(clientDir, 'index.html')).text();
    return c.html(html);
  });
}

// Start background workers
startEmailWorker();
startScheduleWatcher();

console.log(`Kopi (Hono on Bun) listening on http://0.0.0.0:${config.port}`);

export default {
  port: config.port,
  fetch: app.fetch,
};
