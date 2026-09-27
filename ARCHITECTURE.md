# Architecture

TW-01 is a modular workflow system, not a chatbot. The API submits tasks to `AIEmployee`, which plans safe steps, executes registered tools, records every action, and pauses work when the global emergency stop is active.

```text
PWA -> HTTP API -> AIEmployee -> Planner -> ToolManager -> CRM/Memory/Adapters
                                      \-> AuditLog
```

## State model

Every operation exposes one of: `WORKING`, `CONNECTED`, `NOT_CONFIGURED`, `DISABLED`, `ERROR`, or `REQUIRES_APPROVAL`. Outbound actions are blocked until approved and are blocked globally by emergency stop.

## Persistence

`JsonStore` is intentionally dependency-light and free-first. It persists structured records atomically enough for a single-user deployment. The repository boundaries allow a PostgreSQL/SQLite adapter to be added without changing agents.

## Agent boundaries

- Planner turns a command into explicit steps and retries only safe idempotent work.
- Memory stores searchable facts and immutable skill versions.
- CRM owns lead status, scoring, follow-up dates, and revenue records.
- ToolManager is the only path to external actions.
- HumanApprovalGate protects outbound, financial, contractual, high-volume, and irreversible actions.
- Adapters report capability/status and never claim delivery without credentials.

## Legal and operational constraints

Use only permitted public sources. Obtain consent where required, honour opt-outs immediately, identify the business honestly, and follow applicable privacy, telecom, anti-spam and employment-law requirements. Voice recording/transcription is opt-in and consent-based only.

## Company OS

```text
Portal / Console ─► /api/co/* ─► Company (company/service.ts)
                                   ├─ auth (scrypt, hashed sessions) + RBAC (company/rbac.ts)
                                   ├─ approvals 🟢/🟡/🔴 (company/approvals.ts)
                                   ├─ task engine with evidence + independent QA (company/tasks.ts)
                                   ├─ tool registry with self-tests + execution log (company/tools.ts)
                                   ├─ Razorpay client (company/razorpay.ts) ─► api.razorpay.com
                                   ├─ Specialist tools: csv / hr-kpi / dashboard-build / guide
                                   ├─ QA officer: independent recompute (company/qa.ts)
                                   └─ hash-chained audit log (company/audit.ts)
```

All company state lives in `State.company` inside the same JSON store. Every command runs inside one serialized store transaction, so a failed command changes nothing. Order status is only changed in `Company.setStatus`, which applies the transition table and the production gate. See [docs/COMPANY-OS.md](docs/COMPANY-OS.md).
