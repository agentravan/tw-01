# TW-01 Company OS

The Company OS runs the dashboard business end to end: customer order → online payment verified with Razorpay → AI Dashboard Specialist builds → independent AI QA → guide book → delivery. It lives in `company/`, next to the existing sales engine, and is served under `/api/co/*`, `/console` (Founder) and `/portal` (customers).

## Rules the code enforces

| Rule | Where |
|---|---|
| No production before a gateway-verified payment, unless the Founder approves a recorded 🔴 override for that exact order | `Company.productionGate`, `Company.setStatus` |
| A payment is verified only if the checkout HMAC is valid **and** Razorpay reports the payment `captured`, made against a gateway order TW-01 opened for this order, for the exact amount, in INR, and not already used by another order. This applies on every path: checkout, webhook and claim | `Company.confirmCheckout`, `Company.verifyWithGateway` |
| Webhooks are trusted only via HMAC over the raw body. Duplicates are ignored by event id **and** by signed content (event + payment id), because the event-id header is not signed | `Company.handleWebhook`, `Razorpay.verifyWebhook` |
| A customer's payment claim is decided by the gateway. A screenshot never marks an order paid | `Company.claimPayment` |
| A task completes only with evidence that resolves to a real record (an email counts only if it was actually SENT), via a QA decision by a **different** employee. Delivery without a sent notification email is escalated to the Founder | `company/tasks.ts` |
| Retries are bounded (default 3), then the task is ESCALATED to the Founder | `failTask` |
| A second captured payment on an already-paid order is recorded and escalated to the Founder as a refund review (once per payment) | `flagDuplicatePayment` |
| 🟢 runs automatically, 🟡 needs Founder approval (refunds, pricing, production changes), 🔴 always needs the Founder (overrides, deletes, contracts, large payments ≥ ₹50,000). Unknown actions fail closed as 🔴 | `company/approvals.ts` |
| Every action, including denied attempts, goes into an append-only SHA-256 hash-chained audit log | `company/audit.ts` |
| Customers only ever see their own orders and customer-facing statuses | `requireOwner`, `customerView` |
| A tool becomes ACTIVE only after its self-test passes at startup; every tool run is recorded and is what tasks cite as evidence | `company/tools.ts` |
| Products start with no price and inactive. Prices are set by the Founder; products without a build engine cannot be sold | `company/products.ts`, `configureProduct` |
| Missing integrations report `NOT_CONFIGURED`. Emails without SMTP are recorded as NOT_CONFIGURED, never as sent | `company/email.ts`, `company/razorpay.ts` |

## Order states

`AWAITING_PAYMENT → PAID → IN_PRODUCTION → QA → DELIVERED`, with
`PAYMENT_FAILED ⇄ AWAITING_PAYMENT` (retry), `PAYMENT_REVIEW` (claim awaiting the gateway),
`INFO_REQUIRED` (unusable customer file; a corrected upload resumes work), `REVISION → QA` (QA failure or customer revision),
`REFUND_REQUESTED → REFUNDED` (or back to the previous state on rejection). The full transition table is `ORDER_TRANSITIONS` in `company/service.ts`.

## AI workforce

Architecture: one deterministic orchestrator (the AI Boss) with role definitions, registered tools and structured records. No model is called for calculations, validation, routing, permissions or state changes. The optional local model in `ai/ollama.ts` is still only used by the existing sales drafts and agent factory.

| Employee | Built | Mission | Tools | Acceptance (tested) | Failure strategy |
|---|---|---|---|---|---|
| AI Boss | yes | Route founder objectives, plan order tasks, verify evidence, escalate | task engine, routing rules | routes known objectives; escalates unknown/unbuilt ones; no completion without evidence + QA | bounded retries → ESCALATED |
| AI Dashboard Specialist | yes | Build a correct dashboard + guide from a paid order's data | `csv.validate`, `dashboard.render`, `guide.render` | refuses unpaid orders; rejects bad files; KPIs match an independent recompute | bad data → INFO_REQUIRED email; build errors retried then escalated |
| AI QA Officer | yes | Independently verify builds (own recompute, no shared KPI code) | `qa.dashboard` | detects wrong KPIs, missing files, foreign-customer data; cannot QA itself | failed QA → REVISION |
| AI Finance Officer | yes | Verify payments with Razorpay; refunds after approval | `razorpay.fetch_payment`, `razorpay.refund` | valid HMAC only; amount/order/currency match; duplicates and reuse rejected | unverifiable → stays unpaid / PAYMENT_REVIEW |
| AI Security Officer | yes | Audit chain, credentials, least privilege, secrets at rest, webhook trust, CORS | `security.scan` | detects tampering, missing webhook secret, secrets in data | critical findings reported to Founder |
| AI Data Analyst | yes | Metrics from records only | metrics | revenue = verified payments − refunds; profit not shown without expense data | missing data shown as missing |
| AI Support, Operator, Researcher, Sales, Marketing, HR, Order (dropshipping), Supplier, Documentation | **no** | Defined in `company/agents.ts` | — | — | Objectives routed to them are **escalated** to the Founder with an Operator build task, never faked |

The existing TW-01 sales engine (lead scoring, drafts, follow-ups) still runs as before. It has not yet been brought under this certification harness.

## Certification

Each built employee has scenarios at six levels: UNIT, INTEGRATION, FUNCTIONAL, FAILURE, SECURITY and REGRESSION (`company/testing/scenarios.ts`). They run in isolated sandboxes:

- `npm run certify` prints the results table.
- `npm test` runs the same scenarios in CI.
- **Founder console → Certification → "Run all self-tests now"** records a run. The status shown comes only from recorded runs.

The **PRODUCTION** level comes only from `POST /api/co/admin/verify-production` (console) or `npm run verify:production` against a deployed `https://` URL. No employee can be `PRODUCTION_READY` until that passes.

Payment scenarios use `company/testing/gateway-double.ts`, a test double of the three Razorpay endpoints TW-01 calls. It signs exactly as Razorpay documents, so the real verification code runs unchanged. It is never wired into the server, and it cannot produce PRODUCTION results.

`npm run e2e` starts the real server as a separate process and drives 41 checks over HTTP.

Two independent review passes on 2026-09-27 found 11 defects: 7, then 4 more, two of which the first fixes introduced. Each now has a `review #n` scenario that failed before its fix. Mutation testing (11 deliberately injected bugs) confirms the scenarios catch regressions.

## Configuration

| Variable | Purpose |
|---|---|
| `FOUNDER_EMAIL`, `FOUNDER_PASSWORD` | Creates the Founder account on first start (password ≥ 10 characters). Remove the password from the environment after first start if you like; it is stored only as an scrypt hash. |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Razorpay API keys (`rzp_test_…` for test mode). Without them, checkout reports NOT_CONFIGURED. |
| `RAZORPAY_WEBHOOK_SECRET` | Secret set on the Razorpay webhook (events `payment.captured`, `payment.failed`; URL `https://<host>/api/co/webhooks/razorpay`). Without it, webhooks are refused. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Customer emails. Without them, emails are recorded as NOT_CONFIGURED. |
| `TW01_ALLOWED_ORIGIN` | The only origin allowed to call `/api/co/*` cross-site (for example the GitHub Pages UI). Same-origin pages need nothing. |
| `SUPPORT_EMAIL` | Shown in guide books. |
| `TW01_AUTH_TOKEN` | Optional service token for the legacy `/api/*` routes (at least 16 characters). A Founder session also works. |

## Known limits (not yet built)

- **Persistence**: the JSON file locally or on a VPS; Supabase Postgres on Vercel (set `TW01_SUPABASE_*` and `TW01_DB_SECRET`). The whole state is one versioned JSONB document. That is fine at this scale, but should be split into tables as volume grows.
- **Uploads and deliverables**: `data/` locally; the private `tw01_blobs` table on Supabase.
- **Rate limiting** is in-memory, so it applies per process. Limits apply per IP, and per account for devices that have not signed in before, so a stranger cannot lock the Founder out of a known device. The known-device list is in memory, so after a restart the Founder may briefly be limited like anyone else. **Locked out?** All limits are in memory, so restarting the server clears them. Behind a reverse proxy or CDN, set `TW01_TRUST_PROXY=true` and make sure exactly one trusted hop appends `X-Forwarded-For`. Otherwise every request appears to come from the proxy's IP, and failed logins from strangers count against you. Payment claims are limited to 10 per customer per hour. `X-Forwarded-For` is trusted only with `TW01_TRUST_PROXY=true`.
- **Build engines** exist only for the employee-master family: HR Master, Headcount, Attrition, Diversity and CHRO. Payroll, Attendance, Recruitment, Compliance, F&F and Custom need their own data schemas and builders.
- **Dropshipping, HR services and the remaining nine employees** are not implemented.
