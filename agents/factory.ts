import { mkdir, writeFile } from 'node:fs/promises';
import { LocalAI } from '../ai/ollama.js';

export interface AgentBuildRequest {
  name: string;
  goal: string;
  inputs?: string[];
  outputs?: string[];
  tools?: string[];
  schedule?: string;
}

export interface AgentBuildResult {
  name: string;
  slug: string;
  mission: string;
  inputs: string[];
  outputs: string[];
  tools: string[];
  schedule: string;
  guardrails: string[];
  starterPrompt: string;
  implementationPlan: string[];
  artifactPath: string;
}

export class AgentFactory {
  private ai=new LocalAI();

  async build(request:AgentBuildRequest):Promise<AgentBuildResult>{
    const cleanName=request.name.trim()||'New AI Agent';
    const slug=cleanName.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50)||'new-agent';
    const fallback:AgentBuildResult={
      name:cleanName,
      slug,
      mission:request.goal,
      inputs:request.inputs||['user task'],
      outputs:request.outputs||['structured result'],
      tools:request.tools||['local AI'],
      schedule:request.schedule||'on-demand',
      guardrails:[
        'Do not send external messages or make irreversible changes without approval.',
        'Do not expose secrets, credentials or private data.',
        'Use only configured tools and public/authorized sources.',
        'Report uncertainty and failures instead of inventing results.'
      ],
      starterPrompt:`You are the ${cleanName} for Team Work Solutions. Goal: ${request.goal}. Execute only within the configured tools and guardrails.`,
      implementationPlan:[
        'Define the agent input and success criteria.',
        'Connect only the required tools.',
        'Add approval gates for external or irreversible actions.',
        'Test with a small dry run before enabling automation.'
      ],
      artifactPath:`data/agent-factory/${slug}.json`
    };

    const prompt=`Design a safe AI employee from this request. Return ONLY valid JSON with keys mission,inputs,outputs,tools,schedule,guardrails,starterPrompt,implementationPlan.
Agent name: ${cleanName}
Goal: ${request.goal}
Inputs: ${JSON.stringify(request.inputs||[])}
Outputs: ${JSON.stringify(request.outputs||[])}
Tools: ${JSON.stringify(request.tools||[])}
Schedule: ${request.schedule||'on-demand'}
Rules: no secret exposure, no fake results, no irreversible external actions without approval, use authorized/public data only.`;
    const raw=await this.ai.generate(prompt);
    let result=fallback;
    if(raw){
      try{
        const parsed=JSON.parse(raw);
        result={
          ...fallback,
          mission:String(parsed.mission||fallback.mission),
          inputs:Array.isArray(parsed.inputs)?parsed.inputs.map(String):fallback.inputs,
          outputs:Array.isArray(parsed.outputs)?parsed.outputs.map(String):fallback.outputs,
          tools:Array.isArray(parsed.tools)?parsed.tools.map(String):fallback.tools,
          schedule:String(parsed.schedule||fallback.schedule),
          guardrails:Array.isArray(parsed.guardrails)?parsed.guardrails.map(String):fallback.guardrails,
          starterPrompt:String(parsed.starterPrompt||fallback.starterPrompt),
          implementationPlan:Array.isArray(parsed.implementationPlan)?parsed.implementationPlan.map(String):fallback.implementationPlan
        };
      }catch{}
    }

    await mkdir('data/agent-factory',{recursive:true});
    await writeFile(result.artifactPath,JSON.stringify({...result,created_at:new Date().toISOString()},null,2),'utf8');
    return result;
  }
}
