import { CRM } from '../crm/crm.js';
import { Memory } from '../memory/memory.js';
import { SkillManager } from '../skills/manager.js';
import { Safety, Audit } from '../tools/safety.js';
import { JsonStore } from '../memory/store.js';
import { SalesEngine } from '../sales/engine.js';

export function plan(command:string){
  const c=command.toLowerCase();
  if(c.includes('hot lead'))return['list_hot_leads'];
  if(c.includes('pause'))return['pause_outreach'];
  if(c.includes('follow up'))return['list_followups'];
  if(c.includes('meeting brief'))return['meeting_brief'];
  if(c.includes('run cycle')||c.includes('daily cycle'))return['run_cycle'];
  if(c.includes('research'))return['research'];
  if(c.includes('outreach'))return['outreach_draft'];
  if(c.includes('revenue'))return['revenue_report'];
  return['research_and_plan'];
}
export class AIEmployee {
  crm=new CRM(); memory=new Memory(); skills=new SkillManager(); safety=new Safety(); audit=new Audit(); sales:SalesEngine;
  constructor(private store=new JsonStore()){this.sales=new SalesEngine(store)}
  async initialize(){await this.skills.seed()}
  async command(command:string){
    const steps=plan(command);
    await this.audit.record({agent:'ai-brain',task:command,tool:'planner',result:{steps},retry:0,status:'WORKING'});
    if(steps[0]==='pause_outreach'){await this.safety.setPaused(true);return{status:'WORKING',message:'Outreach paused'}};
    if(steps[0]==='list_hot_leads')return{status:'WORKING',leads:await this.crm.list('HOT')};
    if(steps[0]==='list_followups')return{status:'WORKING',leads:(await this.crm.list()).filter(x=>x.status==='FOLLOW_UP')};
    if(steps[0]==='revenue_report')return{status:'WORKING',dashboard:await this.sales.dashboard()};
    return{status:'WORKING',steps,message:'Plan created; use the dedicated API actions for execution. External actions remain approval-gated.'};
  }
  async dashboard(){return this.sales.dashboard()}
}