# TW-01 — Team Work AI Employee

Free-first, open-source business-development automation foundation for Team Work Solutions.

TW-01 helps Harshit research prospects, qualify leads, prepare compliant outreach, manage follow-ups, prepare meetings, and track revenue. External providers are optional; missing credentials are never simulated.

## Quick start

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:3000`. The included PWA is responsive for Android and desktop.

## Free-first operation

- Default persistence is a local JSON store (`data/tw01.json`). No paid database is required.
- Optional Ollama integration provides local AI planning (`OLLAMA_BASE_URL`, `OLLAMA_MODEL`). Without it, deterministic planning still works and is clearly labelled.
- SMTP, WhatsApp Business API, voice, and calendar are adapters. Unconfigured adapters report `NOT_CONFIGURED` and never fake delivery.
- Public-source research must respect robots.txt, terms, consent, privacy, and applicable Indian law. TW-01 does not scrape private data or use unofficial WhatsApp automation.

## Commands

`npm run dev` · `npm run build` · `npm test` · `npm run lint`

## Structure

- `agents/` orchestration, planning, qualification, meetings
- `skills/` versioned skill library
- `memory/` searchable persistent memory
- `tools/` safe tool registry and approvals
- `integrations/` optional provider adapters
- `crm/` lead, pipeline, scoring and follow-up logic
- `dashboard/` PWA frontend
- `api/` HTTP API
- `tests/` unit, integration and regression tests
- `docs/` deployment and operating guidance

## Safety

Research, analysis, drafts and learning can run automatically. Outbound communication, calls, high-volume outreach, contracts, payments, and irreversible actions require approval. The emergency stop disables all outbound channels and follow-ups. Do not record meetings without appropriate consent.

See [ARCHITECTURE.md](ARCHITECTURE.md), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), and [CONTRIBUTING.md](CONTRIBUTING.md).

## Phase 2 — end-to-end sales engine

TW-01 now includes an integrated workflow for:

1. Public-source lead intake and URL research
2. Deterministic lead scoring and qualification
3. CRM pipeline management
4. Email/WhatsApp/call draft generation
5. Human approval records for outbound actions
6. Follow-up scheduling and due-follow-up detection
7. Meeting briefs
8. Won-client recurring/one-time revenue tracking
9. Learning memory and versioned skills
10. A daily sales cycle that qualifies leads and prepares follow-up approvals without sending messages automatically

### Local AI

If Ollama is running locally, TW-01 can use its local HTTP API for outreach drafting. If Ollama is unavailable, the system falls back to deterministic templates. The default local endpoint is http://127.0.0.1:11434.

### Important operating boundary

The core is free-first, but production email delivery, WhatsApp Business messaging, telephony and calendar integrations depend on the provider credentials and policies you choose. TW-01 never reports an external message or call as delivered when the adapter is not configured. Public-source research must respect source terms, robots rules, privacy, consent and applicable law.
