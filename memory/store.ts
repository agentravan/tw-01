import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Approval, AuditEvent, Lead, MemoryItem, Mission, SkillVersion, Activity, RevenueRecord } from '../src/types.js';
import type { BusinessIdea, StrategyDecision } from '../strategy/engine.js';
import type { EmployeeRecord, TaskRecord, RunRecord, WorkEvent } from '../control-room/types.js';
import { emptyCompany, type CompanyState } from '../company/types.js';
export interface State { leads:Lead[]; memory:MemoryItem[]; skills:SkillVersion[]; audit:AuditEvent[]; approvals:Approval[]; missions:Mission[]; activities:Activity[]; revenue:RevenueRecord[]; researchQueue:Lead[]; businesses:BusinessIdea[]; strategyDecisions:StrategyDecision[]; employees:EmployeeRecord[]; tasks:TaskRecord[]; runs:RunRecord[]; workEvents:WorkEvent[]; settings:{paused:boolean; emergencyStop:boolean}; company:CompanyState; }
const empty:State={leads:[],memory:[],skills:[],audit:[],approvals:[],missions:[],activities:[],revenue:[],researchQueue:[],businesses:[],strategyDecisions:[],employees:[],tasks:[],runs:[],workEvents:[],settings:{paused:false,emergencyStop:false},company:emptyCompany()};
// One write queue per file for the whole process, so concurrent update() calls cannot
// read the same snapshot and overwrite each other's changes (lost-update race).
const queues = new Map<string, Promise<unknown>>();
function serialize<T>(file: string, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(file) ?? Promise.resolve();
  const next = prev.then(job, job);
  queues.set(file, next.catch(() => undefined));
  return next;
}
export class JsonStore {
  constructor(private file=process.env.DATA_FILE||'data/tw01.json'){}
  async load():Promise<State>{
    try{
      const raw=JSON.parse(await readFile(this.file,'utf8'));
      return {leads:raw.leads||[],memory:raw.memory||[],skills:raw.skills||[],audit:raw.audit||[],approvals:raw.approvals||[],missions:raw.missions||[],activities:raw.activities||[],revenue:raw.revenue||[],researchQueue:raw.researchQueue||[],businesses:raw.businesses||[],strategyDecisions:raw.strategyDecisions||[],employees:raw.employees||[],tasks:raw.tasks||[],runs:raw.runs||[],workEvents:raw.workEvents||[],settings:{...empty.settings,...(raw.settings||{})},company:{...emptyCompany(),...(raw.company||{}),settings:{...emptyCompany().settings,...(raw.company?.settings||{})}}};
    }catch(e:any){if(e?.code==='ENOENT')return structuredClone(empty);throw new Error(`Data file ${this.file} is unreadable (${e?.message||e}). Refusing to start with empty state so existing records are not overwritten.`)}
  }
  // Write to a temp file then rename, so a crash mid-write cannot leave a truncated store.
  private async write(s:State){await mkdir(dirname(this.file),{recursive:true});const tmp=`${this.file}.${process.pid}.tmp`;await writeFile(tmp,JSON.stringify(s,null,2));await rename(tmp,this.file);}
  async save(s:State){return serialize(this.file,()=>this.write(s));}
  async update(fn:(s:State)=>void){return serialize(this.file,async()=>{const s=await this.load();fn(s);await this.write(s);return s;});}
  /** Like update(), but returns the callback's own result instead of the whole state. */
  async transact<T>(fn:(s:State)=>T|Promise<T>):Promise<T>{return serialize(this.file,async()=>{const s=await this.load();const out=await fn(s);await this.write(s);return out;});}
  /** Runs fn under the write lock without saving (consistent read). */
  async read<T>(fn:(s:State)=>T):Promise<T>{return serialize(this.file,async()=>fn(await this.load()));}
  get path(){return this.file}
  id(){return randomUUID()}
}