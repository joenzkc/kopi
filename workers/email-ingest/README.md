# Free Event-Driven Email Pipeline (Cloudflare Email Routing + Worker)

This zero-cost pipeline publishes an event the instant a bank/card alert email arrives:

1. In Cloudflare Dashboard → **Email** → **Email Routing**, enable Email Routing for your domain.
2. Update `INGEST_URL` in `wrangler.toml` to your public Kopi URL (e.g. `https://kopi.yourdomain.com/api/v1/events/email`).
3. Deploy the worker:
   ```bash
   cd workers/email-ingest
   npm install
   npx wrangler secret put WEBHOOK_SECRET   # paste the Webhook Secret from Kopi Settings
   npx wrangler deploy
   ```
4. In Cloudflare **Email Routing → Routing Rules**, create a custom address (e.g. `tx@yourdomain.com`) with Action: **Send to a Worker** → `kopi-email-ingest`.
5. In Gmail/Outlook, create a filter for your bank alert senders (DBS, OCBC, UOB, Grab, Amex, etc.) and auto-forward them to `tx@yourdomain.com`.

Every matching email is parsed, signed with HMAC-SHA256, queued durably in Kopi's SQLite DB, and either auto-imported into Actual Budget or held in your **Inbox** tab for 1-tap approval.
