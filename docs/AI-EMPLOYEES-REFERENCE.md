# TW-01 vs AI Employees — adopted operating model

The open-source ai-employees project at https://github.com/markfulton/ai-employees was reviewed as a design reference.

Adopted concepts for TW-01:
- Employees are persistent business-role identities, not temporary chat sessions.
- Each employee owns a set of scheduled routines.
- Each routine has an authoritative schedule with fire time, execution window, period key, budget and browser lane.
- A Chief-of-Staff style observer reconciles every employee's run logs and detects both loud failures and silent stops.
- Every run produces a durable run record with status, timestamps, blockers, outputs and notes.
- The owner gets a short daily brief plus access to detailed run logs.
- Work is file/state based so it remains inspectable and recoverable.
- Outbound actions and credentials stay behind explicit guardrails.
- Employees improve by recording dated operational corrections and changes to their own instructions.
- A task should be visible as work only when there is runtime evidence; the UI must not fake WORKING status.

Changes TW-01 will make:
1. Persistent Employee Registry
2. Persistent Routine Registry
3. Task objects with assignment and parent/child relationships
4. Run/Heartbeat records
5. Event stream with concise operational progress events
6. Employee Detail view
7. Task Detail / work-thread view
8. Chief-of-Staff fleet reconciliation
9. Daily brief and fault dossier
10. Cost and approval tracking
11. Stale heartbeat detection and recovery
12. Scheduler with windows and once-per-period protection
13. Browser-lane locking for browser-enabled workers
14. Pause/emergency stop at employee and company level
15. Evidence-first completion checks

TW-01 remains distinct:
- AI Boss is the top commander.
- AI Office owns business strategy and opportunity discovery.
- AI HR can request/create specialist AI employees through the Agent Factory.
- AI Finance owns budget controls.
- AI Website, AI Stock and AI IT are specialist roles.
- Business OS evaluates experiments and can change strategy, scale or shut down a business.
- Team Work HR services and the Dashboard Template Kit are first-class business lines.

Owner experience target:
- Control Room opens to the company overview.
- Click any employee to see status, current task, manager, last heartbeat, recent runs, progress events, blockers, outputs and approvals.
- Click any task to see who assigned it, who owns it, parent goal, live progress, handoffs, artifacts and final result.
- A fleet timeline shows what happened today.
- A fault panel shows employees that stopped, stalled or errored.
- A spend panel shows usage by employee and project.
- An approval panel shows actions waiting for the owner.
- No private chain-of-thought is displayed; only concise work events and evidence.

Reference reading:
- markfulton/ai-employees README
- docs/HOW-EMPLOYEES-WORK.md
- docs/GUARDRAILS.md
- employees/chief-of-staff ROLE/SCHEDULE/routines
- employees/sales-employee/SCHEDULE.md
