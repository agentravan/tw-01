import nodemailer from 'nodemailer';
import { buildDailyReport, formatDailyReport } from './daily.js';
import { JsonStore } from '../memory/store.js';

export function startDailyReportScheduler(store=new JsonStore()){
  const run=async()=>{
    if(String(process.env.TW01_DAILY_REPORT_ENABLED||'true')==='false') return;
    const now=new Date();
    const timezone=process.env.TW01_REPORT_TIMEZONE||'Asia/Kolkata';
    const parts=new Intl.DateTimeFormat('en-IN',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(now);
    const hour=Number(parts.find(p=>p.type==='hour')?.value||-1);
    const minute=Number(parts.find(p=>p.type==='minute')?.value||-1);
    const targetHour=Number(process.env.TW01_REPORT_HOUR||20);
    const targetMinute=Number(process.env.TW01_REPORT_MINUTE||0);
    if(hour!==targetHour || minute!==targetMinute) return;
    const report=await buildDailyReport(store);
    const host=process.env.SMTP_HOST,user=process.env.SMTP_USER,password=process.env.SMTP_PASSWORD,to=process.env.REPORT_EMAIL_TO;
    if(!host||!user||!password||!to) return;
    const transporter=nodemailer.createTransport({host,port:Number(process.env.SMTP_PORT||587),secure:String(process.env.SMTP_SECURE||'false')==='true',auth:{user,pass:password}});
    await transporter.sendMail({from:process.env.SMTP_FROM||user,to,subject:'Team Work — AI Daily Business Report',text:formatDailyReport(report)});
  };
  setInterval(()=>run().catch(()=>{}),60_000);
  run().catch(()=>{});
}
