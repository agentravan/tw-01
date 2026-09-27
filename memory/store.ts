import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Approval, AuditEvent, Lead, MemoryItem, Mission, SkillVersion, Activity, RevenueRecord } from '../src/types.js';
import type { BusinessIdea, StrategyDecision } from '../strategy/engine.js';
import type { EmployeeRecord, TaskRecord, RunRecord, WorkEvent } from '../control-room/types.js';
import { emptyCompany, type CompanyState } from '../company/types.js';
import { supabaseRpc, supabaseConfigFromEnv, type SupabaseConfig } from './supabase.js';
export interface State { leads:Lead[]; memory:MemoryItem[]; skills:SkillVersion[]; audit:AuditEvent[]; approvals:Approval[]; missions:Mission[]; activities:Activity[]; revenue:RevenueRecord[]; researchQueue:Lead[]; businesses:BusinessIdea[]; strategyDecisions:StrategyDecision[]; employees:EmployeeRecord[]; tasks:TaskRecord[]; runs:RunRecord[]; workEvents:WorkEvent[]; settings:{paused:boolean; emergencyStop:boolean}; company:CompanyState; }
const empty:State={leads:[],memory:[],skills:[],audit:[],approvals:[],missions:[],activities:[],revenue:[],researchQueue:[],businesses:[],strategyDecisions:[],employees:[],tasks:[],runs:[],workEvents:[],settings:{paused:false,emergencyStop:false},company:emptyCompany()};

function normalize(raw:any):State{
  return {leads:raw.leads||[],memory:raw.memory||[],skills:raw.skills||[],audit:raw.audit||[],approvals:raw.approvals||[],missions:raw.missions||[],activities:raw.activities||[],revenue:raw.revenue||[],researchQueue:raw.researchQueue||[],businesses:raw.businesses||[],strategyDecisions:raw.strategyDecisions||[],employees:raw.employees||[],tasks:raw.tasks||[],runs:raw.runs||[],workEvents:raw.workEvents||[],settings:{...empty.settings,...(raw.settings||{})},company:{...emptyCompany(),...(raw.company||{}),settings:{...emptyCompany().settings,...(raw.company?.settings||{})}}};
}

/** Where the state document lives. `version` supports compare-and-swap between server instances. */
export interface StoreBackend {
  readonly key:string; readonly kind:'json-file'|'supabase-postgres'; readonly durableOnServerless:boolean; readonly location:string;
  read():Promise<{data:any|null; version:number}>;
  /** Returns the new version, or -1 if another writer changed the document since `expected`. */
  write(data:State, expected:number):Promise<number>;
}

export class FileBackend implements StoreBackend {
  readonly kind='json-file'; readonly durableOnServerless=false;
  constructor(private file:string){}
  get key(){return `file:${this.file}`} get location(){return this.file}
  async read(){
    try{return {data:JSON.parse(await readFile(this.file,'utf8')),version:0};}
    catch(e:any){if(e?.code==='ENOENT')return {data:null,version:0};throw new Error(`Data file ${this.file} is unreadable (${e?.message||e}). Refusing to start with empty state so existing records are not overwritten.`)}
  }
  // Write to a temp file then rename, so a crash mid-write cannot leave a truncated store.
  async write(s:State){await mkdir(dirname(this.file),{recursive:true});const tmp=`${this.file}.${process.pid}.tmp`;await writeFile(tmp,JSON.stringify(s,null,2));await rename(tmp,this.file);return 0;}
}

/**
 * Supabase Postgres backend. The whole state is one JSONB row, read and written through
 * secret-gated SECURITY DEFINER functions (tw01_load / tw01_save) with a version check.
 */
export class SupabaseBackend implements StoreBackend {
  readonly kind='supabase-postgres'; readonly durableOnServerless=true;
  constructor(private cfg:SupabaseConfig, private docKey='main'){}
  get key(){return `supabase:${this.cfg.url}:${this.docKey}`} get location(){return `${new URL(this.cfg.url).host}/tw01_state/${this.docKey}`}
  async read(){const r=await supabaseRpc<{version:number;data:any}|null>(this.cfg,'tw01_load',{p_key:this.docKey});return r?{data:r.data,version:Number(r.version)}:{data:null,version:0};}
  async write(s:State,expected:number){return Number(await supabaseRpc<number>(this.cfg,'tw01_save',{p_key:this.docKey,p_expected:expected,p_data:s}));}
}

export function defaultBackend(file=process.env.DATA_FILE||'data/tw01.json'):StoreBackend{
  const sb=supabaseConfigFromEnv();
  return sb?new SupabaseBackend(sb):new FileBackend(file);
}

// One write queue per document for the whole process, so concurrent update() calls cannot
// read the same snapshot and overwrite each other's changes (lost-update race).
const queues = new Map<string, Promise<unknown>>();
const versions = new Map<string, number>();
function serialize<T>(key: string, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.then(job, job);
  queues.set(key, next.catch(() => undefined));
  return next;
}
export class StoreConflictError extends Error { code='CONFLICT'; httpStatus=409; constructor(){super('The data changed while this request was running. Please retry.');} }

export class JsonStore {
  readonly backend:StoreBackend;
  /** `new JsonStore()` uses Supabase when TW01_SUPABASE_* is set, otherwise the JSON file. A string argument always means a local file. */
  constructor(target?:string|StoreBackend){this.backend=typeof target==='string'?new FileBackend(target):target??defaultBackend();}
  private async loadVersioned():Promise<{s:State;v:number}>{const r=await this.backend.read();versions.set(this.backend.key,r.version);return {s:r.data?normalize(r.data):structuredClone(empty),v:r.version};}
  private async writeChecked(s:State,v:number){const nv=await this.backend.write(s,v);if(nv===-1)throw new StoreConflictError();versions.set(this.backend.key,nv);}
  async load():Promise<State>{return (await this.loadVersioned()).s;}
  async save(s:State){return serialize(this.backend.key,()=>this.writeChecked(s,versions.get(this.backend.key)??0));}
  /** Pure updates: retried on a cross-instance conflict (the callback has no side effects). */
  async update(fn:(s:State)=>void){
    return serialize(this.backend.key,async()=>{
      for(let attempt=0;;attempt++){
        const {s,v}=await this.loadVersioned();fn(s);
        try{await this.writeChecked(s,v);return s;}catch(e){if(!(e instanceof StoreConflictError)||attempt>=4)throw e;}
      }
    });
  }
  /**
   * Like update(), but returns the callback's own result. Not retried automatically: the callback may have
   * side effects (gateway calls, emails), so a conflict is reported to the caller instead of repeating them.
   */
  async transact<T>(fn:(s:State)=>T|Promise<T>):Promise<T>{return serialize(this.backend.key,async()=>{const {s,v}=await this.loadVersioned();const out=await fn(s);await this.writeChecked(s,v);return out;});}
  /** Runs fn under the write lock without saving (consistent read). */
  async read<T>(fn:(s:State)=>T):Promise<T>{return serialize(this.backend.key,async()=>fn(await this.load()));}
  get path(){return this.backend.location}
  id(){return randomUUID()}
}
