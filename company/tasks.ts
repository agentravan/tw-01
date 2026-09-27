import type { CompanyState, Evidence, Priority, Role, Task, TaskStatus } from './types.js';
import { fail, uid } from './util.js';

/** Allowed task transitions. Anything else is rejected. */
export const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  PLANNED: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['IN_PROGRESS', 'WAITING', 'CANCELLED'],
  IN_PROGRESS: ['WAITING', 'QA', 'FAILED', 'CANCELLED'],
  WAITING: ['IN_PROGRESS', 'ASSIGNED', 'ESCALATED', 'CANCELLED'],
  QA: ['COMPLETED', 'IN_PROGRESS', 'FAILED'],
  FAILED: ['ASSIGNED', 'ESCALATED'],
  ESCALATED: ['ASSIGNED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};
export const MAX_RETRIES_DEFAULT = 3;

export function createTask(s: CompanyState, input: { title: string; description?: string; type: string; agent: Role; priority?: Priority; inputs?: Record<string, unknown>; dependencies?: string[]; orderId?: string | null; createdBy: string; at: string; maxRetries?: number }): Task {
  for (const d of input.dependencies ?? []) if (!s.tasks.some(t => t.id === d)) fail('VALIDATION', `Dependency ${d} does not exist.`);
  const t: Task = {
    id: uid('tsk'), title: input.title, description: input.description ?? '', type: input.type, agent: input.agent, priority: input.priority ?? 'MEDIUM',
    status: 'PLANNED', inputs: input.inputs ?? {}, outputs: {}, dependencies: input.dependencies ?? [], approvalId: null, evidence: [], errors: [],
    retryCount: 0, maxRetries: input.maxRetries ?? MAX_RETRIES_DEFAULT, orderId: input.orderId ?? null, createdBy: input.createdBy, qaBy: null,
    createdAt: input.at, updatedAt: input.at, completedAt: null,
  };
  s.tasks.push(t);
  s.taskEvents.push({ id: uid('tev'), taskId: t.id, at: input.at, by: input.createdBy, from: null, to: 'PLANNED', note: 'created' });
  moveTask(s, t, 'ASSIGNED', input.createdBy, input.at, `assigned to ${input.agent}`);
  return t;
}

export function moveTask(s: CompanyState, t: Task, to: TaskStatus, by: string, at: string, note = '') {
  if (!TASK_TRANSITIONS[t.status].includes(to)) fail('BAD_STATE', `Task ${t.id} cannot go from ${t.status} to ${to}.`);
  if (to === 'IN_PROGRESS') {
    const open = t.dependencies.map(d => s.tasks.find(x => x.id === d)!).filter(d => d.status !== 'COMPLETED');
    if (open.length) fail('BAD_STATE', `Task ${t.id} depends on unfinished task ${open[0].id} (${open[0].title}).`);
    if (s.pausedAgents.includes(t.agent)) fail('PAUSED', `${t.agent} is paused by the Founder.`);
  }
  if (to === 'QA' && !t.evidence.length) fail('BAD_STATE', `Task ${t.id} has no evidence; it cannot go to QA.`);
  if (to === 'COMPLETED') {
    if (!t.qaBy) fail('BAD_STATE', 'A task can only be completed by a QA pass.');
    if (!t.evidence.length) fail('BAD_STATE', 'A task cannot be completed without evidence.');
  }
  const from = t.status;
  t.status = to; t.updatedAt = at;
  if (to === 'COMPLETED') t.completedAt = at;
  s.taskEvents.push({ id: uid('tev'), taskId: t.id, at, by, from, to, note });
}

/** Evidence must point at a record that really exists and succeeded. Claims are not evidence. */
export function validateEvidence(s: CompanyState, e: Evidence): string | null {
  switch (e.kind) {
    case 'tool_execution': { const x = s.toolExecutions.find(r => r.id === e.ref); return !x ? 'tool execution not found' : x.status !== 'OK' ? `tool execution ${x.status}` : null; }
    case 'payment': { const p = s.payments.find(r => r.id === e.ref); return !p ? 'payment record not found' : !p.verified ? 'payment not verified' : null; }
    case 'test_run': return s.testRuns.some(r => r.id === e.ref) ? null : 'test run not found';
    case 'email': return s.emails.some(r => r.id === e.ref) ? null : 'email record not found';
    case 'audit': return s.audit.some(r => r.id === e.ref) ? null : 'audit entry not found';
    case 'file': return s.builds.some(b => b.id === e.ref) || s.orders.some(o => o.files.some(f => f.id === e.ref)) || s.qaReports.some(q => q.id === e.ref) ? null : 'file/build not found';
    default: return 'unknown evidence kind';
  }
}
export function addEvidence(s: CompanyState, t: Task, e: Evidence) {
  const err = validateEvidence(s, e);
  if (err) fail('VALIDATION', `Evidence rejected (${e.kind} ${e.ref}): ${err}.`);
  t.evidence.push(e);
}

/** QA gate: the reviewer must be a different agent from the producer; pass completes, fail sends back for rework. */
export function qaDecision(s: CompanyState, t: Task, reviewer: Role, pass: boolean, note: string, at: string, reviewerLabel: string) {
  if (t.status !== 'QA') fail('BAD_STATE', `Task ${t.id} is not in QA.`);
  if (reviewer === t.agent) fail('FORBIDDEN', 'An employee cannot QA its own work.');
  if (pass) { t.qaBy = reviewerLabel; moveTask(s, t, 'COMPLETED', reviewerLabel, at, `QA passed: ${note}`); }
  else { t.errors.push(`QA failed: ${note}`); moveTask(s, t, 'IN_PROGRESS', reviewerLabel, at, `QA failed: ${note}`); }
}

/** Bounded failure recovery: FAILED → retry (ASSIGNED) until maxRetries, then ESCALATED. Never loops forever. */
export function failTask(s: CompanyState, t: Task, error: string, by: string, at: string): 'RETRY' | 'ESCALATED' {
  t.errors.push(error);
  moveTask(s, t, 'FAILED', by, at, error);
  if (t.retryCount < t.maxRetries) { t.retryCount++; moveTask(s, t, 'ASSIGNED', 'system:ai-boss', at, `retry ${t.retryCount}/${t.maxRetries}`); return 'RETRY'; }
  moveTask(s, t, 'ESCALATED', 'system:ai-boss', at, `retries exhausted after ${t.retryCount}; escalated to Founder`);
  return 'ESCALATED';
}
