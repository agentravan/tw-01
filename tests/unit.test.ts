import { describe,it,expect } from 'vitest';
import { scoreLead } from '../crm/crm.js';
import { plan } from '../agents/employee.js';
import { meetingBrief } from '../sales/meeting.js';
describe('lead scoring',()=>it('rewards target geography and size',()=>expect(scoreLead({industry:'Manufacturing',location:'Gurugram',estimated_employee_count:70,contact_name:'HR'})).toBeGreaterThanOrEqual(55)));
describe('planner',()=>it('creates explicit safe plans',()=>expect(plan("Show today's hot leads.")).toEqual(['list_hot_leads'])));
describe('meeting engine',()=>it('creates a usable brief',()=>{const b=meetingBrief({id:'1',company_name:'ABC',industry:'Manufacturing',location:'Gurugram',source:'test',lead_score:70,status:'QUALIFIED',created_at:new Date().toISOString()});expect(b.agenda.length).toBeGreaterThan(3);expect(b.questions.length).toBeGreaterThan(3);}));
