import { JsonStore } from '../memory/store.js';
import { AI_ROLES } from '../organization/roles.js';

export interface DailyReport {
  generated_at:string;
  businesses:{active:number;validating:number;optimizing:number;shutdown:number;profit:number;revenue:number} ;
  workforce:string[];
  risks:string[];
  decisions:string[];
}

export async function buildDailyReport(store=new JsonStore()):Promise<DailyReport>{
  const s=await store.load();
  const businesses=s.businesses||[];
  let revenue=0,profit=0;
  for(const b of businesses) for(const m of b.metrics||[]){
    revenue+=m.revenue;
    profit+=m.revenue-m.direct_cost-m.operating_cost-m.acquisition_cost;
  }
  const risks=s.audit.filter(x=>x.status==='ERROR'||x.status==='DISABLED').slice(-10).map(x=>x.error||x.task);
  const decisions=s.strategyDecisions.slice(-20).map(x=>`${x.decision}: ${x.business_id} — ${x.reason}`);
  return {
    generated_at:new Date().toISOString(),
    businesses:{
      active:businesses.filter(x=>x.status==='ACTIVE').length,
      validating:businesses.filter(x=>x.status==='VALIDATING'||x.status==='IDEA').length,
      optimizing:businesses.filter(x=>x.status==='OPTIMIZING').length,
      shutdown:businesses.filter(x=>x.status==='SHUTDOWN').length,
      profit,revenue
    },
    workforce:AI_ROLES.map(x=>`${x.name} → ${x.reports_to||'YOU'}`),
    risks,
    decisions
  };
}

export function formatDailyReport(r:DailyReport){
  return [
    'TEAM WORK — AI DAILY BUSINESS REPORT',
    `Generated: ${r.generated_at}`,
    '',
    `Businesses: Active ${r.businesses.active} | Validating ${r.businesses.validating} | Optimizing ${r.businesses.optimizing} | Shutdown ${r.businesses.shutdown}`,
    `Revenue tracked: ₹${r.businesses.revenue.toFixed(2)}`,
    `Profit tracked: ₹${r.businesses.profit.toFixed(2)}`,
    '',
    'AI WORKFORCE:',
    ...r.workforce.map(x=>'- '+x),
    '',
    'STRATEGY DECISIONS:',
    ...(r.decisions.length?r.decisions.map(x=>'- '+x):['- None']),
    '',
    'RISKS / FAILURES:',
    ...(r.risks.length?r.risks.map(x=>'- '+x):['- None recorded'])
  ].join('\n');
}
