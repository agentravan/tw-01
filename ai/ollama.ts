export class LocalAI {
  base=process.env.OLLAMA_BASE_URL||'http://127.0.0.1:11434';
  model=process.env.OLLAMA_MODEL||'llama3.2:3b';
  async status(){try{const r=await fetch(`${this.base}/api/tags`,{signal:AbortSignal.timeout(3000)});return r.ok?'CONNECTED':'ERROR';}catch{return'NOT_CONFIGURED';}}
  async generate(prompt:string){
    if(await this.status()!=='CONNECTED')return null;
    try{
      const r=await fetch(`${this.base}/api/generate`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:this.model,prompt,stream:false,options:{temperature:0.3}}),signal:AbortSignal.timeout(20000)});
      if(!r.ok)return null; const j=await r.json() as {response?:string}; return j.response||null;
    }catch{return null;}
  }
}
