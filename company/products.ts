import type { Product } from './types.js';

const EMP_MASTER = { name: 'employee_master.csv', columns: ['employee_id', 'department', 'location', 'gender', 'date_of_joining', '(optional) name', '(optional) date_of_exit', '(optional) exit_type'] };
const REQ_FIELDS = ['company', 'employeeCount', 'dataSource', 'deadline'];
const ALL_KPIS = ['headcount', 'joiners_12m', 'exits_12m', 'avg_headcount_12m', 'attrition_pct_12m', 'female_pct', 'avg_tenure_years'];

/**
 * Dashboard catalogue. Prices are NOT invented: every product starts with price=null and inactive.
 * The Founder sets a price to activate a product. Products without a builder cannot be activated
 * until the AI Operator builds one (their build engine does not exist yet).
 */
export function seedProducts(): Product[] {
  const hr = (id: string, name: string, kpis: string[]): Product => ({ id, name, category: 'DASHBOARD', price: null, paymentMode: 'ONLINE', deliveryType: 'HTML_DASHBOARD', requiredFields: REQ_FIELDS, requiredFiles: [EMP_MASTER], assignedSpecialist: 'AI_DASHBOARD', slaDays: 3, guideTemplate: 'hr_employee_master_v1', builder: 'hr_employee_master', active: false, kpis });
  const pending = (id: string, name: string): Product => ({ id, name, category: 'DASHBOARD', price: null, paymentMode: 'ONLINE', deliveryType: 'HTML_DASHBOARD', requiredFields: REQ_FIELDS, requiredFiles: [], assignedSpecialist: 'AI_DASHBOARD', slaDays: 5, guideTemplate: '', builder: null, active: false, kpis: [] });
  return [
    hr('hr-master', 'HR Master Dashboard', ALL_KPIS),
    hr('headcount', 'Headcount Dashboard', ['headcount', 'joiners_12m', 'exits_12m', 'avg_headcount_12m']),
    hr('attrition', 'Attrition Dashboard', ['headcount', 'exits_12m', 'avg_headcount_12m', 'attrition_pct_12m', 'avg_tenure_years']),
    hr('diversity', 'Diversity Dashboard', ['headcount', 'female_pct']),
    hr('chro', 'CHRO Dashboard', ALL_KPIS),
    pending('recruitment', 'Recruitment Dashboard'),
    pending('payroll', 'Payroll Dashboard'),
    pending('compliance', 'Compliance Dashboard'),
    pending('fnf', 'F&F Dashboard'),
    pending('attendance', 'Attendance Dashboard'),
    pending('custom', 'Custom Dashboard'),
  ];
}
