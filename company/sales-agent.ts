import type { Lead, LeadStatus } from '../src/types.js';

export interface SalesDraft {
  leadId: string;
  to: string;
  subject: string;
  body: string;
}

export interface SalesReview {
  asOf: string;
  source: 'persisted CRM leads';
  leadCount: number;
  statusCounts: Record<LeadStatus, number>;
  qualificationRecommendations: { leadId: string; current: LeadStatus; recommended: LeadStatus; score: number }[];
  followUpsDue: string[];
  outreachDrafts: SalesDraft[];
  messagesSent: 0;
  policy: 'Drafts only. Outbound execution is not enabled for this employee.';
}

const EMPTY_STATUS_COUNTS = (): Record<LeadStatus, number> => ({
  NEW: 0, RESEARCHED: 0, CONTACTED: 0, REPLIED: 0, INTERESTED: 0, QUALIFIED: 0,
  HOT: 0, MEETING_BOOKED: 0, PROPOSAL: 0, WON: 0, LOST: 0, FOLLOW_UP: 0,
});
const TERMINAL: LeadStatus[] = ['WON', 'LOST'];
const ALREADY_CONTACTED: LeadStatus[] = ['CONTACTED', 'REPLIED', 'INTERESTED', 'MEETING_BOOKED', 'PROPOSAL', 'WON', 'LOST'];
const safe = (s: unknown, fallback: string, max = 160) => String(s ?? fallback).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) || fallback;

function recommendedStatus(score: number): LeadStatus {
  return score >= 80 ? 'HOT' : score >= 60 ? 'QUALIFIED' : score >= 40 ? 'RESEARCHED' : 'NEW';
}
function isDue(lead: Lead, cutoff: number) {
  if (!lead.next_followup || TERMINAL.includes(lead.status) || lead.opt_out) return false;
  const at = Date.parse(lead.next_followup);
  return Number.isFinite(at) && at <= cutoff;
}
function draftFor(lead: Lead): SalesDraft {
  const contact = safe(lead.contact_name, 'HR or Business Head', 80);
  const company = safe(lead.company_name, 'your company', 120);
  const industry = safe(lead.industry, 'your industry', 80);
  return {
    leadId: lead.id,
    to: lead.email!,
    subject: `HR and payroll support for ${company}`,
    body: `Hi ${contact},\n\nI’m reaching out from Team Work Solutions. We support businesses with payroll, HR operations and compliance workflows. I noticed ${company} works in ${industry}. If this is relevant to your current priorities, may I share a short overview?\n\nRegards,\nTeam Work Solutions`,
  };
}

/**
 * Produce a bounded, read-only review from already-persisted CRM records. It does not discover prospects,
 * alter CRM stages, create approvals, or send messages. All contact suggestions exclude opt-outs.
 */
export function reviewSalesPipeline(leads: Lead[], asOf = new Date().toISOString()): SalesReview {
  const statusCounts = EMPTY_STATUS_COUNTS();
  for (const lead of leads) if (Object.hasOwn(statusCounts, lead.status)) statusCounts[lead.status]++;
  const qualificationRecommendations = leads
    .filter(lead => lead.status === 'NEW' || lead.status === 'RESEARCHED')
    .map(lead => ({ leadId: lead.id, current: lead.status, recommended: recommendedStatus(Number(lead.lead_score) || 0), score: Number(lead.lead_score) || 0 }))
    .filter(item => item.current !== item.recommended);
  const cutoff = Date.parse(asOf);
  const followUpsDue = Number.isFinite(cutoff) ? leads.filter(lead => isDue(lead, cutoff)).map(lead => lead.id).slice(0, 100) : [];
  const outreachDrafts = leads
    .filter(lead => !lead.opt_out && !!lead.email && !ALREADY_CONTACTED.includes(lead.status))
    .filter(lead => lead.status === 'HOT' || lead.status === 'QUALIFIED' || recommendedStatus(Number(lead.lead_score) || 0) === 'HOT' || recommendedStatus(Number(lead.lead_score) || 0) === 'QUALIFIED')
    .slice(0, 5)
    .map(draftFor);
  return {
    asOf, source: 'persisted CRM leads', leadCount: leads.length, statusCounts,
    qualificationRecommendations, followUpsDue, outreachDrafts, messagesSent: 0,
    policy: 'Drafts only. Outbound execution is not enabled for this employee.',
  };
}

/** Independent QA: recompute counts and eligibility from source records, then reject invented contact activity. */
export function verifySalesReview(leads: Lead[], report: SalesReview, asOf = report.asOf): string[] {
  const errors: string[] = [];
  const counts = EMPTY_STATUS_COUNTS();
  for (const lead of leads) if (Object.hasOwn(counts, lead.status)) counts[lead.status]++;
  if (report.source !== 'persisted CRM leads') errors.push('source label is not grounded in CRM records');
  if (report.leadCount !== leads.length) errors.push('lead count mismatch');
  if (JSON.stringify(report.statusCounts) !== JSON.stringify(counts)) errors.push('pipeline counts mismatch');
  const expectedRecommendations = leads.flatMap(lead => {
    if (lead.status !== 'NEW' && lead.status !== 'RESEARCHED') return [];
    const score = Number(lead.lead_score) || 0;
    const recommended: LeadStatus = score >= 80 ? 'HOT' : score >= 60 ? 'QUALIFIED' : score >= 40 ? 'RESEARCHED' : 'NEW';
    return recommended !== lead.status ? [{ leadId: lead.id, current: lead.status, recommended, score }] : [];
  }).sort((a, b) => a.leadId.localeCompare(b.leadId));
  const actualRecommendations = report.qualificationRecommendations.map(({ leadId, current, recommended, score }) => ({ leadId, current, recommended, score })).sort((a, b) => a.leadId.localeCompare(b.leadId));
  if (JSON.stringify(actualRecommendations) !== JSON.stringify(expectedRecommendations)) errors.push('qualification recommendations do not match source records');
  const cutoff = Date.parse(asOf);
  const expectedDue = Number.isFinite(cutoff) ? leads.filter(lead => {
    if (!lead.next_followup || TERMINAL.includes(lead.status) || lead.opt_out) return false;
    const at = Date.parse(lead.next_followup); return Number.isFinite(at) && at <= cutoff;
  }).map(lead => lead.id).slice(0, 100).sort() : [];
  if (JSON.stringify(report.followUpsDue.slice().sort()) !== JSON.stringify(expectedDue)) errors.push('follow-up list mismatch');
  const expectedDrafts = leads.filter(lead => !lead.opt_out && !!lead.email && !ALREADY_CONTACTED.includes(lead.status))
    .filter(lead => lead.status === 'HOT' || lead.status === 'QUALIFIED' || lead.lead_score >= 60).slice(0, 5).map(lead => lead.id).sort();
  const actualDrafts = report.outreachDrafts.map(draft => draft.leadId).sort();
  if (JSON.stringify(actualDrafts) !== JSON.stringify(expectedDrafts)) errors.push('draft eligibility mismatch');
  if (report.outreachDrafts.some(draft => !draft.to || !draft.subject || !draft.body)) errors.push('draft is incomplete');
  if (report.messagesSent !== 0) errors.push('review claims messages were sent');
  if (!report.policy.includes('Outbound execution is not enabled')) errors.push('draft-only policy is missing');
  return errors;
}
