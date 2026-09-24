# AI Employee Control Room — Implementation Blueprint

TW-01 will be upgraded from a roadmap display into a real observable AI-company control plane. Current open-source AI workforce projects commonly expose agent status, heartbeat/run status, task activity, transcripts, dashboards, costs, approvals, and live updates. TW-01 will use the same operational concepts while keeping its own architecture. 

## What the owner must see

### Company Command Center
- AI Boss status
- organization tree and reporting lines
- current priorities, risks and approvals
- spend vs budget
- revenue/profit snapshot

### Employee Fleet
Every AI employee gets a persistent identity: employee_id, name, role, manager, provider/model, capabilities, permissions, status, current task, last heartbeat, last completed task, health, spend and outputs.

Statuses: IDLE, THINKING, WORKING, WAITING, BLOCKED, COMPLETED, ERROR, PAUSED, STALLED.

### Task Center
Every task is a first-class object: task_id, goal, assigned_by, assigned_to, parent_task_id, priority, status, progress, timestamps, blockers, approvals and result/artifacts.

### Live Employee Detail
Clicking an employee must show the current task, why it is being done, task instructions, current progress event, tools used, tool result summaries, handoffs, approval requests, errors/retries, output and run history.

Progress events are concise operational events, for example: 'Researching 12 target companies', '3 public sources checked', 'Drafting outreach', 'Waiting for approval', 'Handed qualified lead to AI Sales', 'Task completed'. Hidden model chain-of-thought is never exposed.

### Team Work Thread
A task thread shows visible work handoffs such as AI Boss -> AI Office -> employee -> result -> next assignee.

### Run / Heartbeat Monitor
Each execution records run_id, employee_id, task_id, trigger, start/end, status, duration, retries, tool calls, token/cost metrics where available, heartbeat timestamps and recovery decisions.

A stale heartbeat must become STALLED or ERROR rather than pretending the employee is working.

## Runtime architecture

Owner -> AI Boss / Control Plane -> AI Office -> specialist employees -> Task Queue -> Agent Runtime -> Tools -> Evidence/Artifacts -> Event Stream -> Owner Control Room.

## Evidence-first rules
1. WORKING requires an active run/heartbeat.
2. COMPLETED requires a persisted result.
3. Disconnected runtime must show NOT CONNECTED.
4. Tool calls must be logged with success/failure.
5. Sensitive information and private chain-of-thought are never exposed.
6. Financial, external-communication, destructive and security-sensitive actions remain approval-gated.

## Build order
1. Persistent employee registry
2. Persistent task/run/event model
3. Runtime heartbeat and stale detection
4. Event API and live updates
5. Employee detail page with run history
6. Task detail/work thread
7. Command Center org chart
8. Cost, approval and risk views
9. Autonomous scheduling and recovery
