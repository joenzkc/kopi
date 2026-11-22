# Kopi

*(formerly Actual Companion)*

A calm, lightweight personal finance PWA built with **Hono on Bun**, **SQLite (`bun:sqlite`)**, and **React + Tailwind CSS**, connecting to your self-hosted **Actual Budget** via `actual-http-api`.

## Features
- **Net Worth & Live Portfolio (SGD default):** Track global stocks/ETFs (Yahoo Finance) and crypto (CoinGecko) with live FX conversion on refresh, plus 1-tap sync to Actual off-budget accounts.
- **Event-Driven Email → Transaction Pipeline:** Durable SQLite queue + background worker (`POST /api/v1/events/email`) ready for the free Cloudflare Email Routing Worker (`workers/email-ingest/`) or Google Cloud Pub/Sub, plus direct structured JSON ingest (`POST /api/v1/transactions/ingest`).
- **Scheduled Transactions Manager:** Mobile-friendly recurring bill/income creation, editing, upcoming timeline, and 1-tap **Post Now**.
- **Public-HTTPS Auth:** Single-owner Argon2id password + WebAuthn Passkeys (Face ID / Touch ID), `HttpOnly` sessions, scoped API keys, and HMAC-SHA256 webhook verification.

## Self-Hosting with Docker Compose
Kopi joins the Docker network of your Actual Budget stack (`actual-budget_default` in `docker-compose.yaml`; change it if your stack's folder has a different name) so it can reach `actual-http-api`.

On the server:
```bash
git clone <your-repo-url> actual-companion
cd actual-companion
cp .env.example .env
# Edit .env with your ACTUAL_API_KEY and optional settings
docker compose up -d --build
```

## Updating
Push your changes, then either run this on the server:
```bash
git pull --ff-only && docker compose up -d --build
```
or run `./deploy.sh` from your own machine to do the same over SSH. It needs `DEPLOY_HOST` and `DEPLOY_DIR`, set as environment variables or in a git-ignored `.env.deploy` file:
```bash
DEPLOY_HOST=user@my-server
DEPLOY_DIR=~/apps/actual-companion
```
`docker` must be on the `PATH` of non-interactive SSH sessions on the server.
