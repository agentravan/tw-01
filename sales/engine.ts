import type { Lead } from '../src/types.js';
import { JsonStore } from '../memory/store.js';
import { CRM } from '../crm/crm.js';
import { ResearchEngine, type ResearchCandidate } from './research.js';
import { OutreachEngine } from './outreach.js';
import { meetingBrief } from './meeting.js';
import { LearningEngine } from './learning.js';

export class SalesEngine {
  crm=new CRM(); research=new ResearchEngine(this.crm); outreach=new OutreachEngine();
  learning=new LearningEngine(); constructor(private store=new JsonStore()){}
  async importLeads(items:ResearchCandidate[]){return this.research.importCandidates(items)}
  async draftOutreach(id:string,channel:'email'|'whatsapp'|'call'='email'){
    const lead=(await this.crm.list()).find(x=>x.id===id); if(!lead) throw new Error('Lead not found');
    return this.outreach.draft(lead,channel);
  }
  async requestOutreach(id:string,channel:'email'|'whatsapp'|'call'='email'){
    const lead=(await this.crm.list()).find(x=>x.id===id); if(!lead) throw new Error('Lead not found');
    const draft=await this.outreach.draft(lead,channel); if(!draft) throw new Error('Lead is not eligible for outreach');
    const action=channel==='email'?'outreach':channel;
    const approval=await this.outreach.requestApproval(lead,action,draft.body);
    await this.crm.update(id,{status:'CONTACTED',last_contact:new Date().toISOString()});
    return {draft,approval};
  }
  async followupsDue(){
    const now=Date.now();
    return (await this.crm.list()).filter(x=>x.next_followup && new Date(x.next_followup).getTime()<=now && !['WON','LOST'].includes(x.status));
  }
  async setFollowup(id:string,days=3){
    const next=new Date(Date.now()+days*86400000).toISOString();
    return this.crm.update(id,{next_followup:next,status:'FOLLOW_UP'});
  }
  async qualify(id:string){
    const lead=(await this.crm.list()).find(x=>x.id===id); if(!lead) throw new Error('Lead not found');
    const status=lead.lead_score>=80?'HOT':lead.lead_score>=60?'QUALIFIED':lead.lead_score>=40?'RESEARCHED':'NEW';
    return this.crm.update(id,{status});
  }
  async brief(id:string){const lead=(await this.crm.list()).find(x=>x.id===id);if(!lead)throw new Error('Lead not found');return meetingBrief(lead);}
  async won(id:string,monthlyRecurring:number=0,oneTime:number=0){
    const lead=await this.crm.update(id,{status:'WON'}); if(!lead)throw new Error('Lead not found');
    await this.store.update(s=>s.revenue.push({id:this.store.id(),lead_id:id,company_name:lead.company_name,monthly_recurring:monthlyRecurring,one_time:oneTime,won_at:new Date().toISOString()}));
    return lead;
  }
  async dashboard(){
    const s=await this.store.load(); const leads=s.leads;
    return {totalLeads:leads.length,qualifiedLeads:leads.filter(x=>['QUALIFIED','HOT'].includes(x.status)).length,hotLeads:leads.filter(x=>x.status==='HOT').length,replies:leads.filter(x=>x.status==='REPLIED').length,meetings:leads.filter(x=>x.status==='MEETING_BOOKED').length,proposals:leads.filter(x=>x.status==='PROPOSAL').length,wonClients:leads.filter(x=>x.status==='WON').length,followupsDue:leads.filter(x=>x.status==='FOLLOW_UP').length,paused:s.settings.paused,emergencyStop:s.settings.emergencyStop,
      revenue:s.revenue.reduce((a,x)=>a+x.monthly_recurring+x.one_time,0),
      recurringRevenue:s.revenue.reduce((a,x)=>a+x.monthly_recurring,0),
      pipelineValue:s.revenue.reduce((a,x)=>a+x.monthly_recurring*12+x.one_time,0),
      approvalsPending:s.approvals.filter(x=>x.status==='PENDING').length,
      activities:s.activities.length,
      researchQueue:s.researchQueue.length,
      dueFollowups:leads.filter(x=>x.next_followup&&new Date(x.next_followup)<=new Date()).length};
  }
}