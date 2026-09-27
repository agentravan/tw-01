# Deployment

## Local

Use Node 20+, `npm install`, `cp .env.example .env`, then `npm run dev`. For local AI, install Ollama and pull a model such as `ollama pull llama3.2:3b`; the initial planner works without Ollama.

## Vercel-compatible deployment

The current server is designed for local/VPS Node execution because JSON persistence needs a writable disk. For Vercel, keep the dashboard static and replace `JsonStore` with a free hosted Postgres/SQLite-compatible adapter; do not use ephemeral filesystem persistence for production. The adapter contract is the only required change.

Never put SMTP, WhatsApp, voice, calendar, or authentication secrets in frontend variables. Set `TW01_AUTH_TOKEN` and add a production auth middleware before exposing the API publicly. Restrict CORS, enable HTTPS, back up data, and rotate credentials.

## Provider status

Blank provider variables intentionally produce `NOT_CONFIGURED`. Configure only official APIs and compliant consent/opt-out flows. Calls and recording are not simulated.

## Company OS deployment checklist

1. Set `FOUNDER_EMAIL`, `FOUNDER_PASSWORD`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, the SMTP settings and `TW01_ALLOWED_ORIGIN` as server-side environment variables. Never put them in frontend code.
2. In the Razorpay dashboard, add a webhook to `https://<host>/api/co/webhooks/razorpay` for `payment.captured` and `payment.failed`, using the same secret.
3. Start the server, sign in at `/console`, set a price for a product and activate it.
4. Run **Certification → Run all self-tests now**, then **verify production** against the https URL. Only after that do employees become PRODUCTION_READY.

**Vercel:** not supported yet. The JSON store and the uploaded and delivered files need a writable, durable disk. Use a VPS or Docker host with a mounted `data/` volume until a Postgres and object-storage adapter is added.
