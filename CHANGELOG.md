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
- 50 certification scenarios (`npm run certify`, also run by `npm test`) and a 41-check HTTP end-to-end test (`npm run e2e`).

Fixed after independent review (each with a regression scenario that failed first):
- One Razorpay payment could mark two orders PAID. Payments must now be bound to a gateway order opened for that order, and reuse is rejected on the webhook path too.
- An order objective was marked COMPLETED when the pipeline stopped at INFO_REQUIRED. It now completes only when the order is DELIVERED.
- Login limits could be bypassed with a spoofed `X-Forwarded-For`. There is now a per-account limit, and the header is trusted only behind a configured proxy.
- A payment made after a Founder override was rolled back and lost. It is now recorded without rewinding the order.
- The delivery task claimed the customer was notified when the email failed or SMTP was not configured. It is now escalated.
- A build could use a file uploaded after validation. It now uses exactly the validated file, with a hash check.
- A signed `payment.failed` webhook replayed with a new event id could flip a retried order. Duplicates are now also detected by signed content.
- The CORS preflight for `/api/co/*` was unreachable.

Second review pass:
- The per-account login limit let strangers lock the Founder out. Devices that have signed in before now bypass it.
- A failed claim on an order in production crashed and lost the claim.
- Behind a proxy, the client-supplied (left-most) `X-Forwarded-For` entry was trusted. The proxy-appended entry is now used.
- A second payment on an already-paid order had no follow-up. It is now escalated as a refund review.
- Payment claims are limited to 10 per customer per hour, and Razorpay 4xx responses are no longer retried (each claim previously made two API calls).

## 0.1.0 - 2026-09-19

- Added free-first TypeScript foundation.
- Added persistent searchable memory and immutable skill versions.
- Added CRM lead scoring, statuses, approvals, emergency stop, audit logging, and daily missions.
- Added optional Ollama, SMTP, WhatsApp, voice, and calendar adapter contracts.
- Added responsive PWA dashboard and API.
