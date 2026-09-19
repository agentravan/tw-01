# Development notes

The initial release is deliberately a secure foundation rather than an autonomous spam system. Lead discovery connectors should be added under `integrations/` using permitted public APIs or user-imported CSV data. Each connector must record its source, timestamp, confidence, and terms/consent assumptions.

Before enabling outreach, implement owner authentication, approval UI, opt-out suppression, per-provider rate limits, and message review. Learning from payroll/PF/ESIC/labour sources must preserve source URLs, retrieval dates, and versions; never present legal information as professional advice.
