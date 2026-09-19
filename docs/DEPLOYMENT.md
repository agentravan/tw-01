# Deployment

## Local

Use Node 20+, `npm install`, `cp .env.example .env`, then `npm run dev`. For local AI, install Ollama and pull a model such as `ollama pull llama3.2:3b`; the initial planner works without Ollama.

## Vercel-compatible deployment

The current server is designed for local/VPS Node execution because JSON persistence needs a writable disk. For Vercel, keep the dashboard static and replace `JsonStore` with a free hosted Postgres/SQLite-compatible adapter; do not use ephemeral filesystem persistence for production. The adapter contract is the only required change.

Never put SMTP, WhatsApp, voice, calendar, or authentication secrets in frontend variables. Set `TW01_AUTH_TOKEN` and add a production auth middleware before exposing the API publicly. Restrict CORS, enable HTTPS, back up data, and rotate credentials.

## Provider status

Blank provider variables intentionally produce `NOT_CONFIGURED`. Configure only official APIs and compliant consent/opt-out flows. Calls and recording are not simulated.
