import type { Actor, Role } from './types.js';
import { fail } from './util.js';

/**
 * Least-privilege permission table. The engine checks this on every command.
 * A permission not listed for a role is denied. CUSTOMER permissions are further
 * restricted to the customer's own records by the command handlers (ownership checks).
 */
export const PERMISSIONS: Record<string, Role[]> = {
  // Founder administration
  'admin.view': ['FOUNDER'],
  'approval.decide': ['FOUNDER'],
  'agent.pause': ['FOUNDER'],
  'product.configure': ['FOUNDER'],
  'audit.view': ['FOUNDER', 'AI_SECURITY'],
  'certification.run': ['FOUNDER', 'AI_QA'],
  'objective.submit': ['FOUNDER'],

  // Orders (customer-facing)
  'order.create': ['CUSTOMER'],
  'order.view.own': ['CUSTOMER'],
  'order.upload.own': ['CUSTOMER'],
  'payment.confirm.own': ['CUSTOMER'],
  'payment.claim.own': ['CUSTOMER'],
  'revision.request.own': ['CUSTOMER'],
  'deliverable.download.own': ['CUSTOMER'],

  // Orders (internal)
  'order.view.all': ['FOUNDER', 'AI_BOSS', 'AI_DASHBOARD', 'AI_FINANCE', 'AI_QA', 'AI_SUPPORT', 'AI_ORDER'],
  'order.data.read': ['AI_DASHBOARD', 'AI_QA'],          // customer data files: only builders and QA
  'payment.verify': ['AI_FINANCE', 'AI_ORDER'],
  'production.start': ['AI_BOSS', 'AI_DASHBOARD'],
  'production.override.request': ['FOUNDER', 'AI_BOSS'],
  'dashboard.build': ['AI_DASHBOARD'],
  'guide.write': ['AI_DASHBOARD', 'AI_DOCS'],
  'qa.review': ['AI_QA'],
  'order.deliver': ['AI_DASHBOARD', 'AI_BOSS'],
  'refund.request': ['FOUNDER', 'AI_FINANCE', 'AI_SUPPORT'],

  // Tasks
  'task.create': ['FOUNDER', 'AI_BOSS'],
  'task.work': ['AI_BOSS', 'AI_OPERATOR', 'AI_RESEARCHER', 'AI_DASHBOARD', 'AI_SALES', 'AI_MARKETING', 'AI_FINANCE', 'AI_HR', 'AI_ORDER', 'AI_SUPPLIER', 'AI_SUPPORT', 'AI_DATA', 'AI_QA', 'AI_SECURITY', 'AI_DOCS'],
  'task.qa': ['AI_QA'],
  'task.escalate': ['AI_BOSS'],
  'task.cancel': ['FOUNDER', 'AI_BOSS'],

  // Tools, email, reports, security
  'tool.register': ['AI_OPERATOR', 'FOUNDER'],
  'email.send': ['AI_BOSS', 'AI_SUPPORT', 'AI_FINANCE', 'AI_DASHBOARD', 'AI_ORDER'],
  'report.generate': ['AI_BOSS', 'AI_DATA', 'FOUNDER'],
  'security.scan': ['AI_SECURITY', 'FOUNDER'],
};

export const AGENT_ROLES: Role[] = ['AI_BOSS', 'AI_OPERATOR', 'AI_RESEARCHER', 'AI_DASHBOARD', 'AI_SALES', 'AI_MARKETING', 'AI_FINANCE', 'AI_HR', 'AI_ORDER', 'AI_SUPPLIER', 'AI_SUPPORT', 'AI_DATA', 'AI_QA', 'AI_SECURITY', 'AI_DOCS'];

export function can(role: Role, permission: string): boolean {
  return (PERMISSIONS[permission] ?? []).includes(role);
}
export function require(actor: Actor | null, permission: string): Actor {
  if (!actor) return fail('UNAUTHENTICATED', 'Sign in first.');
  if (!can(actor.role, permission)) fail('FORBIDDEN', `${actor.role} is not allowed to ${permission}.`);
  return actor;
}
/** Customers may only touch records they own. Internal roles pass through (their permission was checked separately). */
export function requireOwner(actor: Actor, customerId: string) {
  if (actor.role === 'CUSTOMER' && (actor.kind !== 'user' || actor.customerId !== customerId)) fail('NOT_FOUND', 'Not found.');
}
export const actorLabel = (a: Actor | null) => (a ? `${a.kind}:${a.id}` : 'anonymous');
