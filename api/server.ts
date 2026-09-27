import 'dotenv/config';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { AIEmployee } from '../agents/employee.js';
import { CRM } from '../crm/crm.js';
import { Safety } from '../tools/safety.js';
import { SalesEngine } from '../sales/engine.js';
import { AgentFactory } from '../agents/factory.js';
import { AI_ROLES } from '../organization/roles.js';
import { buildDailyReport } from '../reports/daily.js';
import { startDailyReportScheduler } from '../reports/scheduler.js';
import { BusinessOS } from '../strategy/business-os.js';
import { ControlRoom } from '../control-room/runtime.js';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Company } from '../company/service.js';
import { Razorpay, configFromEnv } from '../company/razorpay.js';
import { smtpMailer } from '../company/email.js';
import { handleCompany, readRaw, bearer } from './company-routes.js';
import { safeEqual } from '../company/util.js';

const employee=new AIEmployee(); await employee.initialize();
const company=new Company({mailer:smtpMailer(),razorpay:new Razorpay(configFromEnv()),allowedOrigin:process.env.TW01_ALLOWED_ORIGIN||'',supportEmail:process.env.SUPPORT_EMAIL||undefined});
await company.init();
const crm=new CRM(); const safety=new Safety(); const sales=new SalesEngine(); const factory=new AgentFactory(); const businessOS=new BusinessOS(); const controlRoom=new ControlRoom();
async function runAutonomousCycle(){
  const task=await controlRoom.createTask({goal:'Run the autonomous sales and business-development cycle',assignedBy:'ai-boss',assignedTo:'ai-office',priority:'HIGH'});
  const run=await controlRoom.startRun('ai-office',task.id,'scheduler');
  try{
    await controlRoom.progress(run.id,'AI Office started daily operating cycle',10);
    const result=await sales.runCycle();
    await controlRoom.progress(run.id,'Sales cycle completed; recording verified result',80);
    await controlRoom.finish(run.id,result,false);
    return result;
  }catch(error){await controlRoom.finish(run.id,{error:String(error)},true);throw error;}
}

const json=(res:any,data:any,status=200)=>{res.writeHead(status,{'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type,authorization'});res.end(JSON.stringify(data));};
const body=async(req:any)=>{const raw=(await readRaw(req,256*1024)).toString('utf8');return raw?JSON.parse(raw):{};};
// Legacy API auth now FAILS CLOSED: a request needs the service token (TW01_AUTH_TOKEN, not the example value)
// or a signed-in Founder session. Previously an empty token left every endpoint open to anyone.
const auth=async(req:any)=>{const t=bearer(req);if(!t)return false;const expected=process.env.TW01_AUTH_TOKEN||'';if(expected&&expected!=='change-me'&&expected.length>=16&&safeEqual(t,expected))return true;const a=await company.actorFromToken(t);return a?.role==='FOUNDER';};
// Static files: only these folders/files are served. Everything else (.env, data/, source) is 404.
const ROOT=resolve(fileURLToPath(new URL('..',import.meta.url)));
const STATIC_DIRS=['dashboard','console','portal'];
const TYPES:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
function staticPath(pathname:string):string|null{
  let rel=decodeURIComponent(pathname);
  if(rel==='/'||rel==='/index.html')rel='/dashboard/index.html';
  if(rel==='/console'||rel==='/console/')rel='/console/index.html';
  if(rel==='/portal'||rel==='/portal/')rel='/portal/index.html';
  const full=resolve(ROOT,'.'+rel);
  if(!STATIC_DIRS.some(d=>full.startsWith(resolve(ROOT,d)+sep)))return null;
  if(!TYPES[extname(full)])return null;
  return full;
}

const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url||'/',`http://${req.headers.host}`);
    if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
    if(await handleCompany(company,req,res,url))return;
    if(url.pathname.startsWith('/api/')&&!(await auth(req)))return json(res,{error:'unauthorized'},401);

    if(url.pathname==='/api/dashboard')return json(res,await employee.dashboard());
    if(url.pathname==='/api/leads')return json(res,await crm.list());
    if(url.pathname==='/api/status')return json(res,await safety.state());
    if(url.pathname==='/api/organization')return json(res,{roles:AI_ROLES});
    if(url.pathname==='/api/daily-report')return json(res,await buildDailyReport());
    if(url.pathname==='/api/control-room'){
      const [control,safetyState,approvals]=await Promise.all([controlRoom.snapshot(),safety.state(),sales.approvals()]);
      return json(res,{...control,safety:safetyState,approvals});
    }
    if(url.pathname==='/api/control-room/task'&&req.method==='POST'){const b=await body(req);return json(res,await controlRoom.createTask({goal:String(b.goal||''),assignedBy:String(b.assignedBy||'ai-office'),assignedTo:String(b.assignedTo||'ai-office'),parentTaskId:b.parentTaskId||null,priority:b.priority||'MEDIUM'}));}
    if(url.pathname==='/api/control-room/run'&&req.method==='POST'){const b=await body(req);return json(res,await controlRoom.startRun(String(b.employeeId||''),String(b.taskId||''),String(b.trigger||'manual')));}
    if(url.pathname==='/api/control-room/heartbeat'&&req.method==='POST'){const b=await body(req);await controlRoom.heartbeat(String(b.runId||''),String(b.message||'Heartbeat received'),b.progress==null?undefined:Number(b.progress));return json(res,{status:'OK'});}
    if(url.pathname==='/api/control-room/progress'&&req.method==='POST'){const b=await body(req);await controlRoom.progress(String(b.runId||''),String(b.message||'Progress update'),b.progress==null?undefined:Number(b.progress),b.type||'PROGRESS');return json(res,{status:'OK'});}
    if(url.pathname==='/api/control-room/finish'&&req.method==='POST'){const b=await body(req);await controlRoom.finish(String(b.runId||''),b.result||null,Boolean(b.failed));return json(res,{status:b.failed?'FAILED':'COMPLETED'});}

    if(url.pathname==='/api/stop'&&req.method==='POST'){await safety.emergencyStop();return json(res,{status:'DISABLED'});}
    if(url.pathname==='/api/resume'&&req.method==='POST'){await safety.resume();return json(res,{status:'WORKING'});}
    if(url.pathname==='/api/command'&&req.method==='POST'){const b=await body(req);return json(res,await employee.command(b.command||''));}
    if(url.pathname==='/api/cycle'&&req.method==='POST')return json(res,await runAutonomousCycle());

    if(url.pathname==='/api/discover'&&req.method==='POST'){
      const b=await body(req);
      return json(res,await sales.discover({
        location:String(b.location||process.env.TW01_TARGET_LOCATION||'Gurugram'),
        industries:Array.isArray(b.industries)?b.industries:(process.env.TW01_TARGET_INDUSTRIES||'Manufacturing,Hospitals,Logistics,Schools,BPO,Facility').split(',').map(x=>x.trim()),
        minEmployees:Number(b.minEmployees||process.env.TW01_MIN_EMPLOYEES||20),
        maxEmployees:Number(b.maxEmployees||process.env.TW01_MAX_EMPLOYEES||150),
        limit:Number(b.limit||process.env.TW01_DISCOVERY_LIMIT||5)
      }));
    }

    if(url.pathname==='/api/businesses'&&req.method==='GET')return json(res,await businessOS.portfolio());
    if(url.pathname==='/api/businesses'&&req.method==='POST'){
      const b=await body(req);
      if(!String(b.name||'').trim()||!String(b.hypothesis||'').trim())return json(res,{error:'name and hypothesis are required'},400);
      return json(res,await businessOS.createIdea({name:String(b.name),hypothesis:String(b.hypothesis),budget:Number(b.budget||10000),maxLoss:b.maxLoss==null?undefined:Number(b.maxLoss)}));
    }
    if(url.pathname==='/api/businesses/metric'&&req.method==='POST'){
      const b=await body(req);
      return json(res,await businessOS.addMetric(String(b.businessId||''),{
        revenue:Number(b.revenue||0),direct_cost:Number(b.direct_cost||0),operating_cost:Number(b.operating_cost||0),
        acquisition_cost:Number(b.acquisition_cost||0),conversions:Number(b.conversions||0),customers:Number(b.customers||0),period_days:Number(b.period_days||1)
      }));
    }
    if(url.pathname==='/api/businesses/review'&&req.method==='POST'){
      return json(res,await businessOS.review({
        min_profit_margin:Number(process.env.TW01_MIN_PROFIT_MARGIN||0.10),
        max_loss_periods:Number(process.env.TW01_MAX_LOSS_PERIODS||2),
        min_validation_days:Number(process.env.TW01_MIN_VALIDATION_DAYS||7),
        max_test_budget:Number(process.env.TW01_MAX_TEST_BUDGET||10000)
      }));
    }

    if(url.pathname==='/api/agent-factory'&&req.method==='POST'){
      const b=await body(req);
      if(!String(b.name||'').trim()||!String(b.goal||'').trim())return json(res,{error:'name and goal are required'},400);
      const built=await factory.build({name:String(b.name),goal:String(b.goal),inputs:Array.isArray(b.inputs)?b.inputs.map(String):undefined,outputs:Array.isArray(b.outputs)?b.outputs.map(String):undefined,tools:Array.isArray(b.tools)?b.tools.map(String):undefined,schedule:b.schedule?String(b.schedule):undefined});
      const employeeRecord=await controlRoom.registerEmployee({name:built.name,role:String(b.role||'SPECIALIST'),managerId:'ai-hr',model:'local/configured',capabilities:built.tools,permissions:['read configured inputs','write assigned outputs']});
      return json(res,{...built,employeeRecord});
    }
    if(url.pathname==='/api/research/import'&&req.method==='POST'){const b=await body(req);return json(res,{leads:await sales.importLeads(Array.isArray(b.items)?b.items:[])});}
    if(url.pathname==='/api/research/url'&&req.method==='POST'){const b=await body(req);return json(res,await sales.research.researchUrl(String(b.url||'')));}
    if(url.pathname==='/api/lead/qualify'&&req.method==='POST'){const b=await body(req);return json(res,await sales.qualify(String(b.id)));}
    if(url.pathname==='/api/outreach/draft'&&req.method==='POST'){const b=await body(req);return json(res,await sales.draftOutreach(String(b.id),b.channel||'email'));}
    if(url.pathname==='/api/outreach/request'&&req.method==='POST'){const b=await body(req);return json(res,await sales.requestOutreach(String(b.id),b.channel||'email'));}
    if(url.pathname==='/api/followups/due')return json(res,await sales.followupsDue());
    if(url.pathname==='/api/followups/set'&&req.method==='POST'){const b=await body(req);return json(res,await sales.setFollowup(String(b.id),Number(b.days||3)));}
    if(url.pathname==='/api/meeting/brief'&&req.method==='POST'){const b=await body(req);return json(res,await sales.brief(String(b.id)));}
    if(url.pathname==='/api/revenue/won'&&req.method==='POST'){const b=await body(req);return json(res,await sales.won(String(b.id),Number(b.monthly_recurring||0),Number(b.one_time||0)));}
    if(url.pathname==='/api/learning'&&req.method==='POST'){const b=await body(req);return json(res,await sales.learning.learn(String(b.text||''),String(b.source||'manual')));}
    if(url.pathname==='/api/approvals')return json(res,await sales.approvals());
    if(url.pathname==='/api/approvals/approve'&&req.method==='POST'){const b=await body(req);return json(res,await sales.approve(String(b.id)));}
    if(url.pathname==='/api/approvals/execute'&&req.method==='POST'){const b=await body(req);return json(res,await sales.executeApproved(String(b.id)));}

    if(url.pathname.startsWith('/api/'))return json(res,{error:'not found'},404);

    const file=staticPath(url.pathname);
    if(!file||!['GET','HEAD'].includes(req.method||'')){res.writeHead(404,{'content-type':'text/plain'});return res.end('Not found');}
    let content:Buffer; try{content=await readFile(file);}catch{res.writeHead(404,{'content-type':'text/plain'});return res.end('Not found');}
    res.writeHead(200,{'content-type':TYPES[extname(file)],'x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
    res.end(content);
  }catch(e){console.error('[tw01] legacy route error',e);json(res,{error:'Internal error'},500);}
});

const port=Number(process.env.PORT||3000);
server.listen(port,'0.0.0.0',()=>{
  controlRoom.ensureSeed().catch(error=>console.error('TW-01 control room seed error',error));
  startDailyReportScheduler();
  console.log(`TW-01 listening on http://localhost:${port}`);
  if(process.env.TW01_AUTO_RUN!=='false'){
    const hours=Math.max(1,Number(process.env.TW01_CYCLE_HOURS||6));
    runAutonomousCycle().then(result=>console.log('TW-01 initial autonomous cycle',result)).catch(error=>console.error('TW-01 initial cycle error',error));
    setInterval(()=>runAutonomousCycle().catch(error=>console.error('TW-01 cycle error',error)),hours*60*60*1000);
    console.log(`TW-01 autonomous cycle enabled every ${hours}h`);
  }
});
