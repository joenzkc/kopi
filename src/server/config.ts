import path from 'node:path';

export const config = {
  port: Number(process.env.PORT || 5008),
  dataDir: process.env.DATA_DIR || path.resolve(process.cwd(), 'data'),
  actualApiUrl: (process.env.ACTUAL_API_URL || 'http://127.0.0.1:5007').replace(/\/+$/, ''),
  actualApiKey: process.env.ACTUAL_API_KEY || '',
  actualBudgetSyncId: process.env.ACTUAL_BUDGET_SYNC_ID || '',
  defaultBaseCurrency: (process.env.BASE_CURRENCY || 'SGD').toUpperCase(),
  appOrigin: (process.env.APP_ORIGIN || '').replace(/\/+$/, ''),
  emailWebhookSecret: process.env.EMAIL_WEBHOOK_SECRET || '',
  llmApiUrl: (process.env.LLM_API_URL || '').replace(/\/+$/, ''),
  llmApiKey: process.env.LLM_API_KEY || '',
  llmModel: process.env.LLM_MODEL || '',
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || '',
  vapidSubject: process.env.VAPID_SUBJECT || '',
  scheduleWatchIntervalMs: Math.max(30_000, Number(process.env.SCHEDULE_WATCH_INTERVAL_MS || 300_000)),
  isProd: process.env.NODE_ENV === 'production',
};
