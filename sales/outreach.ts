import type { Lead, ActionKind, Approval } from '../src/types.js';
import { JsonStore } from '../memory/store.js';
import { LocalAI } from '../ai/ollama.js';

export interface OutreachDraft {lead_id:string; channel:'email'|'whatsapp'|'call'; subject?:string; body:string; created_at:string;}
export class OutreachEngine {
  constructor(private store=new JsonStore(),private ai=new LocalAI()){}
  async draft(lead:Lead,channel:'email'|'whatsapp'|'call'='email'){
    if(lead.status==='LOST'||lead.status==='WON') return null;
    const name=lead.contact_name||'HR/Business Head';
    const body=channel==='email'
      ? `Hi ${name},\\n\\nI’m reaching out from Team Work Solutions. We help growing businesses manage payroll, HR operations, PF/ESIC and labour compliance with a practical recurring support model.\\n\\nI noticed ${lead.company_name} operates in ${lead.industry}. If HR/payroll compliance or operations support is currently on your agenda, I’d be happy to share a short approach.\\n\\nRegards,\\nTeam Work Solutions`
      : channel==='whatsapp'
      ? `Hi ${name}, this is Team Work Solutions. We support businesses with payroll, HR operations, PF/ESIC and labour compliance. If this is relevant for ${lead.company_name}, may I share a short overview?`
      : `Call script: introduce Team Work Solutions, confirm whether HR/payroll/compliance is handled internally, identify the current pain point, ask permission to schedule a detailed discussion. Honour any opt-out immediately.`;
    const aiDraft=await this.ai.generate(`Create a concise, honest B2B ${channel} outreach draft for Team Work Solutions. Company: ${lead.company_name}. Industry: ${lead.industry}. Location: ${lead.location}. Possible HR problem: ${lead.possible_hr_problem||'unknown'}. Do not invent facts. Do not use pressure, deception or unsupported claims. Return only the message.`);
    return {lead_id:lead.id,channel,subject:channel==='email'?'HR & Payroll Support for '+lead.company_name:undefined,body:aiDraft||body,created_at:new Date().toISOString()};
  }
  async requestApproval(lead:Lead,action:ActionKind,description:string){
    const approval:Approval={id:this.store.id(),action,lead_id:lead.id,description,status:'PENDING',created_at:new Date().toISOString()};
    await this.store.update(s=>s.approvals.push(approval));
    return approval;
  }
}