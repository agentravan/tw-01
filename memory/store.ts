import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Approval, AuditEvent, Lead, MemoryItem, Mission, SkillVersion, Activity, RevenueRecord } from '../src/types.js';
import type { BusinessIdea, StrategyDecision } from '../strategy/engine.js';
import type { EmployeeRecord, TaskRecord, RunRecord, WorkEvent } from '../control-room/types.js';
export interface State { leads:Lead[]; memory:MemoryItem[]; skills:SkillVersion[]; audit:AuditEvent[]; approvals:Approval[]; missions:Mission[]; activities:Activity[]; revenue:RevenueRecord[]; researchQueue:Lead[]; businesses:BusinessIdea[]; strategyDecisions:StrategyDecision[]; employees:EmployeeRecord[]; tasks:TaskRecord[]; runs:RunRecord[]; workEvents:WorkEvent[]; settings:{paused:boolean; emergencyStop:boolean}; }
const empty:State={leads:[],memory:[],skills:[],audit:[],approvals:[],missions:[],activities:[],revenue:[],researchQueue:[],businesses:[],strategyDecisions:[],employees:[],tasks:[],runs:[],workEvents:[],settings:{paused:false,emergencyStop:false}};
export class JsonStore {
  constructor(private file=process.env.DATA_FILE||'data/tw01.json'){}
  async load():Promise<State>{
    try{
      const raw=JSON.parse(await readFile(this.file,'utf8'));
      return {leads:raw.leads||[],memory:raw.memory||[],skills:raw.skills||[],audit:raw.audit||[],approvals:raw.approvals||[],missions:raw.missions||[],activities:raw.activities||[],revenue:raw.revenue||[],researchQueue:raw.researchQueue||[],businesses:raw.businesses||[],strategyDecisions:raw.strategyDecisions||[],employees:raw.employees||[],tasks:raw.tasks||[],runs:raw.runs||[],workEvents:raw.workEvents||[],settings:{...empty.settings,...(raw.settings||{})}};
    }catch{return structuredClone(empty)}
  }
  async save(s:State){await mkdir(dirname(this.file),{recursive:true});await writeFile(this.file,JSON.stringify(s,null,2));}
  async update(fn:(s:State)=>void){const s=await this.load();fn(s);await this.save(s);return s}
  id(){return randomUUID()}
}