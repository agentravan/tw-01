import type { Approval, CompanyState, Tier } from './types.js';
import { fail, uid } from './util.js';

/**
 * Approval policy. GREEN runs automatically; YELLOW needs Founder approval above a configured threshold;
 * RED always needs the Founder. Callers never pick the tier: the policy does.
 */
export function tierFor(s: CompanyState, action: string, ctx: { amount?: number } = {}): Tier {
  switch (action) {
    case 'task.create': case 'email.send': case 'report.generate': case 'followup.schedule': return 'GREEN';
    case 'refund':
      if ((ctx.amount ?? 0) >= s.settings.largePaymentRedThreshold) return 'RED';
      return 'YELLOW';
    case 'discount': case 'price.change': case 'production.change': case 'supplier.change': return 'YELLOW';
    case 'production.override': case 'order.delete': case 'contract.sign': case 'legal.commit': case 'data.destroy': case 'large.payment': return 'RED';
    default: return 'RED'; // unknown actions fail closed
  }
}
/** YELLOW actions below the configured auto-limit may run without approval. RED never does. */
export function needsApproval(s: CompanyState, action: string, ctx: { amount?: number } = {}): boolean {
  const t = tierFor(s, action, ctx);
  if (t === 'GREEN') return false;
  if (t === 'RED') return true;
  if (action === 'refund' && (ctx.amount ?? Infinity) <= s.settings.yellowRefundAutoLimit) return false;
  return true;
}

export function requestApproval(s: CompanyState, input: { action: string; entity: string; entityId: string; reason: string; summary: string; payload?: Record<string, unknown>; requestedBy: string; at: string; amount?: number }): Approval {
  const dup = s.approvals.find(a => a.status === 'PENDING' && a.action === input.action && a.entityId === input.entityId);
  if (dup) fail('CONFLICT', `An approval for ${input.action} on ${input.entityId} is already pending (${dup.id}).`);
  const a: Approval = {
    id: uid('apr'), action: input.action, tier: tierFor(s, input.action, { amount: input.amount }), entity: input.entity, entityId: input.entityId,
    reason: input.reason, summary: input.summary, payload: input.payload ?? {}, status: 'PENDING',
    requestedBy: input.requestedBy, requestedAt: input.at, decidedBy: null, decidedAt: null, rejectionReason: null,
  };
  s.approvals.push(a);
  return a;
}

/** True only for an APPROVED approval of exactly this action on exactly this entity, decided by a Founder user. */
export function hasApproved(s: CompanyState, approvalId: string | null, action: string, entityId: string): boolean {
  if (!approvalId) return false;
  const a = s.approvals.find(x => x.id === approvalId);
  if (!a || a.status !== 'APPROVED' || a.action !== action || a.entityId !== entityId || !a.decidedBy) return false;
  const decider = s.users.find(u => `user:${u.id}` === a.decidedBy);
  return !!decider && decider.role === 'FOUNDER' && !decider.disabled;
}
