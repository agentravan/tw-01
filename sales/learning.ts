import { Memory } from '../memory/memory.js';
import { SkillManager } from '../skills/manager.js';
export class LearningEngine {
  constructor(private memory=new Memory(),private skills=new SkillManager()){}
  async learn(text:string,source='sales-cycle'){
    if(!text.trim()) return null;
    const item=await this.memory.add(text,'learning',['sales','tw01'],source);
    return item;
  }
  async snapshotSkill(name:string,content:string,reason:string){
    return this.skills.addVersion(name,content,reason);
  }
}