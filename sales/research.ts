import type { Lead } from '../src/types.js';
import { CRM } from '../crm/crm.js';

export interface ResearchCandidate {
  company_name:string; industry:string; location:string; source:string;
  source_url?:string; website?:string; estimated_employee_count?:number;
  contact_name?:string; designation?:string; email?:string; phone?:string;
  linkedin?:string; possible_hr_problem?:string; notes?:string;
}

export class ResearchEngine {
  constructor(private crm=new CRM()) {}
  async importCandidates(items:ResearchCandidate[]){
    const created:Lead[]=[];
    for(const item of items){
      if(!item.company_name||!item.industry||!item.location||!item.source) continue;
      const existing=(await this.crm.list()).find(x=>x.company_name.toLowerCase()===item.company_name.toLowerCase());
      if(existing){created.push(existing);continue;}
      created.push(await this.crm.add(item));
    }
    return created;
  }
  async researchUrl(url:string){
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),8000);
    try{
      const res=await fetch(url,{signal:controller.signal,headers:{'user-agent':'TW-01 public research bot/1.0'}});
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const html=await res.text();
      const title=(html.match(/<title[^>]*>([\\s\\S]*?)<\\/title>/i)?.[1]||'').replace(/<[^>]+>/g,' ').replace(/\\s+/g,' ').trim();
      const emails=[...new Set((html.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/gi)||[]))].slice(0,5);
      const phones=[...new Set((html.match(/(?:\\+91[\\s-]?)?[6-9]\\d{9}/g)||[]))].slice(0,5);
      return {url,title,emails,phones,characters:html.length,status:'RESEARCHED'};
    } finally {clearTimeout(timer);}
  }
}