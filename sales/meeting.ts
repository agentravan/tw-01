import type { Lead } from '../src/types.js';
export function meetingBrief(lead:Lead){
  return {lead_id:lead.id,company:lead.company_name,industry:lead.industry,location:lead.location,
    employee_estimate:lead.estimated_employee_count||null,contact:lead.contact_name||null,
    role:lead.designation||null,known_problem:lead.possible_hr_problem||'Not verified',
    qualification_score:lead.lead_score,
    agenda:['Understand current HR/payroll setup','Identify compliance or process gaps','Confirm scope and decision process','Discuss recurring support model','Agree next step'],
    questions:['How is payroll currently managed?','Which PF/ESIC/compliance work is handled internally?','Where does the team lose the most time?','What would a successful support arrangement look like?'],
    objection_points:['Need to understand current process before proposing changes','Clarify scope, turnaround time and ownership','Use documented requirements rather than assumptions']};
}