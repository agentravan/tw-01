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
