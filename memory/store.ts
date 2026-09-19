import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Approval, AuditEvent, Lead, MemoryItem, Mission, SkillVersion } from './types.js';
export interface State { leads:Lead[]; memory:MemoryItem[]; skills:SkillVersion[]; audit:AuditEvent[]; approvals:Approval[]; missions:Mission[]; settings:{paused:boolean; emergencyStop:boolean}; }
const empty:State={leads:[],memory:[],skills:[],audit:[],approvals:[],missions:[],settings:{paused:false,emergencyStop:false}};
export class JsonStore { constructor(private file=process.env.DATA_FILE||'data/tw01.json'){} async load():Promise<State>{try{return {...empty,...JSON.parse(await readFile(this.file,'utf8'))}}catch{return structuredClone(empty)}} async save(s:State){await mkdir(dirname(this.file),{recursive:true}); await writeFile(this.file,JSON.stringify(s,null,2));} async update(fn:(s:State)=>void){const s=await this.load();fn(s);await this.save(s);return s} id(){return randomUUID()} }
