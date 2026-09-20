import type { ResearchCandidate } from './research.js';

export interface DiscoveryConfig {
  location:string;
  industries:string[];
  minEmployees:number;
  maxEmployees:number;
  limit:number;
}

export interface DiscoveryResult {
  query:string;
  candidates:ResearchCandidate[];
  results:number;
}

export class DiscoveryEngine {
  async discover(config:DiscoveryConfig):Promise<DiscoveryResult>{
    const industry=config.industries.join(' OR ');
    const query='"' + config.location + '" "' + industry + '" company HR payroll compliance';
    const url='https://html.duckduckgo.com/html/?q='+encodeURIComponent(query);
    const res=await fetch(url,{headers:{'user-agent':'TW-01 public research bot/1.0'}});
    if(!res.ok) throw new Error(`Discovery search failed: HTTP ${res.status}`);
    const html=await res.text();
    const candidates:ResearchCandidate[]=[];
    const seen=new Set<string>();
    const links=[...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\\/a>/gi)];
    for(const match of links.slice(0,config.limit*2)){
      const href=this.normalizeUrl(this.clean(match[1]));
      const title=this.clean(match[2]);
      if(!href||!/^https?:\/\//i.test(href)) continue;
      let domain:string;
      try{domain=new URL(href).hostname.replace(/^www\./,'')}catch{continue;}
      if(seen.has(domain))continue;
      seen.add(domain);
      const context=(title+' '+domain).toLowerCase();
      const matchedIndustry=config.industries.find(x=>context.includes(x.toLowerCase()))||config.industries[0]||'Business';
      candidates.push({
        company_name:this.companyName(title,domain),
        industry:matchedIndustry,
        location:config.location,
        source:'public-search',
        source_url:href,
        website:href,
        notes:`Discovered from public search. Verify employee count and HR contact before outreach. Target range: ${config.minEmployees}-${config.maxEmployees} employees.`
      });
      if(candidates.length>=config.limit)break;
    }
    return {query,candidates,results:candidates.length};
  }
  private clean(v:string){return v.replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();}
  private normalizeUrl(v:string){
    if(v.startsWith('//')) v='https:'+v;
    try{
      const u=new URL(v);
      const target=u.searchParams.get('uddg');
      return target?decodeURIComponent(target):u.toString();
    }catch{return v;}
  }
  private companyName(title:string,domain:string){return title.replace(/\s*[|–—-]\s*.*$/,'').trim()||domain.split('.')[0];}
}
