# Changelog

## 0.2.0 - unreleased (branch feat/company-os-foundation)

Security (existing server):
- Static file serving was limited to `dashboard/`. Before, any file in the repo folder was served, including `/.env` and `/data/tw01.json`.
- The legacy API now fails closed. It needs `TW01_AUTH_TOKEN` or a Founder session; an empty token no longer leaves every endpoint open.
- Request bodies are size-limited, and 500 errors no longer echo internal error text.

Fixes:
- The strategy engine counted each loss period twice, so a business was shut down after its first losing period. This made CI red on `main`.
- The JSON store lost writes under concurrent requests. Writes are now serialized and atomic (temp file + rename).
- An unreadable data file was silently replaced with empty state, and the next save wiped every record. Startup now refuses instead.
- `BusinessOS.review()` and `addMetric()` returned the whole store, including leads and the audit log, to API callers.

Added:
- Company OS (`company/`): Founder and customer accounts, least-privilege RBAC, the 🟢/🟡/🔴 approval policy, and a hash-chained audit log.
- A task engine with evidence validation, independent QA and bounded retries/escalation, plus a tool registry with self-tests.
- The dashboard order workflow with server-side Razorpay verification (checkout HMAC + payment fetch, webhook HMAC + event dedupe, payment claims, refunds after approval).
- The HR dashboard build engine, guide book generator and independent QA.
- An AI Boss with deterministic routing, and an AI workforce registry with certification computed from recorded test runs.
- `/console` (Founder) and `/portal` (customers).
- 38 certification scenarios (`npm run certify`, also run by `npm test`) and a 38-check HTTP end-to-end test (`npm run e2e`).

## 0.1.0 - 2026-09-19

- Added free-first TypeScript foundation.
- Added persistent searchable memory and immutable skill versions.
- Added CRM lead scoring, statuses, approvals, emergency stop, audit logging, and daily missions.
- Added optional Ollama, SMTP, WhatsApp, voice, and calendar adapter contracts.
- Added responsive PWA dashboard and API.
