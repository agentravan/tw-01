import { JsonStore } from '../memory/store.js';
import type { EmployeeRecord, TaskRecord, RunRecord, WorkEvent, EmployeeStatus, TaskStatus } from './types.js';
const now=()=>new Date().toISOString();

export class ControlRoom {
  constructor(private store=new JsonStore()){}
  async ensureSeed(){
    return this.store.update(s=>{
      s.employees ??= []; s.tasks ??= []; s.runs ??= []; s.workEvents ??= [];
      const defs=[
        ['AI Boss','AI_BOSS',null,'orchestrator'],
        ['AI Office','AI_OFFICE','boss','strategy'],
        ['AI HR','AI_HR','office','workforce'],
        ['AI Finance','AI_FINANCE','office','finance'],
        ['AI Website','AI_WEBSITE','office','website'],
        ['AI Stock','AI_STOCK','office','inventory'],
        ['AI IT','AI_IT','office','technology']
      ] as const;
      for(const [name,role,parent,model] of defs){
        const id=role.toLowerCase().replaceAll('_','-');
        if(!s.employees.find(e=>e.id===id)){
          s.employees.push({id,name,role,managerId:parent==='boss'?'ai-boss':parent==='office'?'ai-office':null,model,capabilities:[],permissions:[],status:'IDLE',currentTaskId:null,lastHeartbeat:null,lastCompletedTaskId:null,createdAt:now(),updatedAt:now(),health:'HEALTHY',spendUsd:0,outputs:0});
        }
      }
    });
  }
  async snapshot(){
    await this.ensureSeed(); const s=await this.store.load(); const cutoff=Date.now()-120000;
    for(const e of s.employees){
      if(e.status==='WORKING' && e.lastHeartbeat && new Date(e.lastHeartbeat).getTime()<cutoff){e.status='STALLED';e.health='STALE';e.updatedAt=now();}
    }
    await this.store.save(s);
    return {employees:s.employees,tasks:s.tasks,runs:s.runs.slice(-100).reverse(),events:s.workEvents.slice(-250).reverse()};
  }
  async registerEmployee(input:{name:string;role:string;managerId?:string|null;model?:string;capabilities?:string[];permissions?:string[]}){const id=input.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60);const employee:EmployeeRecord={id,name:input.name,role:input.role,managerId:input.managerId??'ai-hr',model:input.model??'configured-runtime',capabilities:input.capabilities??[],permissions:input.permissions??[],status:'IDLE',currentTaskId:null,lastHeartbeat:null,lastCompletedTaskId:null,createdAt:now(),updatedAt:now(),health:'HEALTHY',spendUsd:0,outputs:0};await this.store.update(s=>{s.employees??=[];if(!s.employees.some(e=>e.id===id))s.employees.push(employee);});return employee;}
  async createTask(input:{goal:string;assignedBy:string;assignedTo:string;parentTaskId?:string|null;priority?:TaskRecord['priority']}) {
    const task:TaskRecord={id:this.store.id(),goal:input.goal,assignedBy:input.assignedBy,assignedTo:input.assignedTo,parentTaskId:input.parentTaskId??null,priority:input.priority??'MEDIUM',status:'ASSIGNED',progress:0,createdAt:now(),startedAt:null,updatedAt:now(),completedAt:null,blockers:[],approvals:[],result:null};
    await this.store.update(s=>{s.tasks ??=[];s.tasks.push(task);const e=s.employees?.find(x=>x.id===task.assignedTo);if(e){e.currentTaskId=task.id;e.status='WORKING';e.updatedAt=now();}});
    return task;
  }
  async startRun(employeeId:string,taskId:string,trigger='manual'){
    const run:RunRecord={id:this.store.id(),employeeId,taskId,trigger,status:'RUNNING',startedAt:now(),endedAt:null,heartbeatAt:now(),durationMs:null,retryCount:0,toolCalls:0,costUsd:0,model:'configured-runtime'};
    await this.store.update(s=>{s.runs ??=[];s.workEvents ??=[];s.runs.push(run);s.workEvents.push({id:this.store.id(),runId:run.id,employeeId,taskId,at:now(),type:'STARTED',message:'Run started'});const e=s.employees?.find(x=>x.id===employeeId);if(e){e.status='WORKING';e.currentTaskId=taskId;e.lastHeartbeat=now();e.health='HEALTHY';e.updatedAt=now();}const t=s.tasks?.find(x=>x.id===taskId);if(t){t.status='WORKING';t.startedAt=t.startedAt||now();t.updatedAt=now();}});
    return run;
  }
  async heartbeat(runId:string,message='Heartbeat received',progress?:number){
    await this.store.update(s=>{const r=s.runs?.find(x=>x.id===runId);if(!r)return;r.heartbeatAt=now();const e=s.employees?.find(x=>x.id===r.employeeId);if(e){e.lastHeartbeat=r.heartbeatAt;e.status='WORKING';e.health='HEALTHY';e.updatedAt=now();}const t=s.tasks?.find(x=>x.id===r.taskId);if(t&&progress!=null){t.progress=Math.max(0,Math.min(100,progress));t.updatedAt=now();}s.workEvents?.push({id:this.store.id(),runId,employeeId:r.employeeId,taskId:r.taskId,at:now(),type:'HEARTBEAT',message,metadata:progress==null?undefined:{progress}});});
  }
  async progress(runId:string,message:string,progress?:number,type:WorkEvent['type']='PROGRESS'){
    await this.store.update(s=>{const r=s.runs?.find(x=>x.id===runId);if(!r)return;r.heartbeatAt=now();const e=s.employees?.find(x=>x.id===r.employeeId);if(e){e.lastHeartbeat=r.heartbeatAt;e.status='WORKING';e.updatedAt=now();}const t=s.tasks?.find(x=>x.id===r.taskId);if(t){if(progress!=null)t.progress=Math.max(0,Math.min(100,progress));t.updatedAt=now();}s.workEvents?.push({id:this.store.id(),runId,employeeId:r.employeeId,taskId:r.taskId,at:now(),type,message});});
  }
  async finish(runId:string,result:any,failed=false){
    await this.store.update(s=>{const r=s.runs?.find(x=>x.id===runId);if(!r)return;r.status=failed?'FAILED':'COMPLETED';r.endedAt=now();r.durationMs=new Date(r.endedAt).getTime()-new Date(r.startedAt).getTime();r.heartbeatAt=r.endedAt;const e=s.employees?.find(x=>x.id===r.employeeId);if(e){e.status=failed?'ERROR':'COMPLETED';e.health=failed?'ERROR':'HEALTHY';e.currentTaskId=null;e.lastCompletedTaskId=failed?e.lastCompletedTaskId:r.taskId;e.lastHeartbeat=r.endedAt;e.outputs+=failed?0:1;e.updatedAt=now();}const t=s.tasks?.find(x=>x.id===r.taskId);if(t){t.status=failed?'FAILED':'COMPLETED';t.progress=failed?t.progress:100;t.completedAt=r.endedAt;t.updatedAt=r.endedAt;t.result=result;}s.workEvents?.push({id:this.store.id(),runId,employeeId:r.employeeId,taskId:r.taskId,at:r.endedAt,type:failed?'ERROR':'COMPLETED',message:failed?'Run failed':'Task completed',metadata:{result}});});
  }
}
