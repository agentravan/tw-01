import type { ActionKind, Lead } from '../src/types.js';
import nodemailer from 'nodemailer';

export interface Adapter {name:string; action:ActionKind; status():Promise<string>; send(input:unknown):Promise<unknown>}
const configured=(...v:string[])=>v.every(Boolean);

export class SmtpAdapter implements Adapter {
  name='smtp'; action='outreach' as ActionKind;
  async status(){
    return configured(process.env.SMTP_HOST||'',process.env.SMTP_USER||'',process.env.SMTP_PASSWORD||'')?'CONNECTED':'NOT_CONFIGURED';
  }
  async send(input:unknown){
    const status=await this.status(); if(status!=='CONNECTED')return{status};
    const data=input as {lead?:Lead;description?:string};
    const lead=data.lead; if(!lead?.email)return{status:'NOT_CONFIGURED',note:'Lead has no email'};
    if(lead.opt_out)return{status:'SKIPPED_OPT_OUT'};
    const transporter=nodemailer.createTransport({
      host:process.env.SMTP_HOST,
      port:Number(process.env.SMTP_PORT||587),
      secure:String(process.env.SMTP_SECURE||'false')==='true',
      auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD}
    });
    const subject=(process.env.SMTP_SUBJECT_PREFIX||'Team Work Solutions')+' | '+lead.company_name;
    const info=await transporter.sendMail({
      from:process.env.SMTP_FROM||process.env.SMTP_USER,
      to:lead.email,
      subject,
      text:data.description||'Hello, Team Work Solutions would like to connect regarding HR/payroll/compliance support.'
    });
    return{status:'SENT',messageId:info.messageId,to:lead.email};
  }
}

export class WhatsAppAdapter implements Adapter {
  name='whatsapp-business-api'; action='whatsapp' as ActionKind;
  async status(){
    return configured(process.env.WHATSAPP_API_URL||'',process.env.WHATSAPP_ACCESS_TOKEN||'',process.env.WHATSAPP_PHONE_NUMBER_ID||'')?'CONNECTED':'NOT_CONFIGURED';
  }
  async send(input:unknown){
    const status=await this.status(); if(status!=='CONNECTED')return{status};
    const data=input as {lead?:Lead;description?:string}; const lead=data.lead;
    if(!lead?.phone)return{status:'NOT_CONFIGURED',note:'Lead has no phone'};
    if(lead.opt_out)return{status:'SKIPPED_OPT_OUT'};
    const url=process.env.WHATSAPP_API_URL!;
    const payload=process.env.WHATSAPP_TEMPLATE_NAME
      ? {messaging_product:'whatsapp',to:lead.phone,type:'template',template:{name:process.env.WHATSAPP_TEMPLATE_NAME,language:{code:process.env.WHATSAPP_TEMPLATE_LANGUAGE||'en_US'},components:[]}}
      : {messaging_product:'whatsapp',to:lead.phone,type:'text',text:{body:data.description||'Hello from Team Work Solutions.'}};
    const res=await fetch(url,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+process.env.WHATSAPP_ACCESS_TOKEN},body:JSON.stringify(payload)});
    const result=await res.json().catch(()=>({}));
    return res.ok?{status:'SENT',result}:{status:'ERROR',httpStatus:res.status,result};
  }
}

export class VoiceAdapter implements Adapter {
  name='voice'; action='call' as ActionKind;
  async status(){return process.env.VOICE_PROVIDER_URL?'CONNECTED':'NOT_CONFIGURED'}
  async send(){return{status:await this.status(),note:'No calls are faked; configure a voice provider.'}}
}
export class CalendarAdapter implements Adapter {
  name='calendar'; action='meeting' as ActionKind;
  async status(){return process.env.CALENDAR_ICS_URL?'CONNECTED':'NOT_CONFIGURED'}
  async send(){return{status:await this.status()}}
}
