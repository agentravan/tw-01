export type Status = 'WORKING'|'CONNECTED'|'NOT_CONFIGURED'|'DISABLED'|'ERROR'|'REQUIRES_APPROVAL';
export type LeadStatus = 'NEW'|'RESEARCHED'|'CONTACTED'|'REPLIED'|'INTERESTED'|'QUALIFIED'|'HOT'|'MEETING_BOOKED'|'PROPOSAL'|'WON'|'LOST'|'FOLLOW_UP';
export type ActionKind = 'research'|'draft'|'outreach'|'call'|'whatsapp'|'financial'|'contract'|'meeting';
export interface Lead { id:string; company_name:string; website?:string; industry:string; location:string; estimated_employee_count?:number; contact_name?:string; designation?:string; email?:string; phone?:string; linkedin?:string; source:string; source_url?:string; possible_hr_problem?:string; lead_score:number; status:LeadStatus; last_contact?:string; next_followup?:string; notes?:string; opt_out?:boolean; created_at:string; }
export interface AuditEvent { id:string; timestamp:string; agent:string; task:string; tool:string; result?:unknown; error?:string; retry:number; approval?:string; status:Status; }
export interface SkillVersion { id:string; name:string; version:number; content:string; change_reason:string; created_at:string; }
export interface MemoryItem { id:string; kind:string; text:string; tags:string[]; source?:string; created_at:string; }
export interface Approval { id:string; action:ActionKind; lead_id?:string; description:string; status:'PENDING'|'APPROVED'|'REJECTED'; created_at:string; decided_at?:string; }
export interface Mission { date:string; lead_target:number; research_target:number; followup_target:number; meeting_target:number; learning_target:number; report:Record<string,number>; }
export interface Activity { id:string; lead_id?:string; kind:'RESEARCH'|'OUTREACH_DRAFT'|'OUTREACH_SENT'|'REPLY'|'FOLLOW_UP'|'CALL'|'WHATSAPP'|'MEETING'|'NOTE'; channel?:string; summary:string; created_at:string; }
export interface RevenueRecord { id:string; lead_id:string; company_name:string; monthly_recurring:number; one_time:number; won_at:string; }
