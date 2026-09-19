import { describe,it,expect } from 'vitest'; import { scoreLead } from '../crm/crm.js'; import { plan } from '../agents/employee.js';
describe('lead scoring',()=>it('rewards target geography and size',()=>expect(scoreLead({industry:'Manufacturing',location:'Gurugram',estimated_employee_count:70,contact_name:'HR'})).toBeGreaterThanOrEqual(55)));
describe('planner',()=>it('creates explicit safe plans',()=>expect(plan("Show today's hot leads.")).toEqual(['list_hot_leads'])));
