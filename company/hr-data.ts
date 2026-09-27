import { normHeader, parseCsv, parseDate } from './csv.js';

/** Employee-master schema used by the HR dashboard family. Aliases map common Indian HRMS export headers. */
export const EMPLOYEE_COLUMNS: { key: EmpKey; required: boolean; aliases: string[] }[] = [
  { key: 'employee_id', required: true, aliases: ['employee_id', 'emp_id', 'empid', 'employee_code', 'emp_code', 'id'] },
  { key: 'name', required: false, aliases: ['name', 'employee_name', 'full_name'] },
  { key: 'department', required: true, aliases: ['department', 'dept', 'function'] },
  { key: 'location', required: true, aliases: ['location', 'branch', 'site', 'city'] },
  { key: 'gender', required: true, aliases: ['gender', 'sex'] },
  { key: 'date_of_joining', required: true, aliases: ['date_of_joining', 'doj', 'joining_date', 'join_date'] },
  { key: 'date_of_exit', required: false, aliases: ['date_of_exit', 'doe', 'exit_date', 'relieving_date', 'date_of_leaving', 'dol'] },
  { key: 'exit_type', required: false, aliases: ['exit_type', 'separation_type', 'leaving_reason_type'] },
];
export type EmpKey = 'employee_id' | 'name' | 'department' | 'location' | 'gender' | 'date_of_joining' | 'date_of_exit' | 'exit_type';
export interface Employee { employee_id: string; name: string; department: string; location: string; gender: 'Male' | 'Female' | 'Other'; doj: string; doe: string | null; exit_type: string; }
export interface ValidationIssue { row: number; column: string; problem: string; }
export interface ValidationResult { ok: boolean; employees: Employee[]; issues: ValidationIssue[]; missingColumns: string[]; rowCount: number; }

const GENDER: Record<string, Employee['gender']> = { m: 'Male', male: 'Male', f: 'Female', female: 'Female', o: 'Other', other: 'Other', others: 'Other', transgender: 'Other', 'non-binary': 'Other', nonbinary: 'Other' };

/** Data validation: critical issues make the file unusable (ok=false) and trigger an "Information Required" request. */
export function validateEmployeeMaster(csvText: string, maxRows = 100_000): ValidationResult {
  const rows = parseCsv(csvText);
  if (rows.length < 2) return { ok: false, employees: [], issues: [{ row: 0, column: '', problem: 'File has no data rows.' }], missingColumns: [], rowCount: 0 };
  if (rows.length - 1 > maxRows) return { ok: false, employees: [], issues: [{ row: 0, column: '', problem: `File has ${rows.length - 1} rows; the limit is ${maxRows}.` }], missingColumns: [], rowCount: rows.length - 1 };
  const header = rows[0].map(normHeader);
  const idx: Partial<Record<EmpKey, number>> = {};
  for (const c of EMPLOYEE_COLUMNS) { const i = header.findIndex(h => c.aliases.includes(h)); if (i >= 0) idx[c.key] = i; }
  const missingColumns = EMPLOYEE_COLUMNS.filter(c => c.required && idx[c.key] == null).map(c => c.key);
  if (missingColumns.length) return { ok: false, employees: [], issues: [], missingColumns, rowCount: rows.length - 1 };

  const issues: ValidationIssue[] = []; const employees: Employee[] = []; const seen = new Set<string>();
  const get = (r: string[], k: EmpKey) => (idx[k] == null ? '' : (r[idx[k]!] ?? '').trim());
  rows.slice(1).forEach((r, n) => {
    const line = n + 2; // 1-based incl. header
    const id = get(r, 'employee_id');
    if (!id) { issues.push({ row: line, column: 'employee_id', problem: 'missing' }); return; }
    if (seen.has(id)) { issues.push({ row: line, column: 'employee_id', problem: `duplicate ${id}` }); return; }
    seen.add(id);
    const doj = parseDate(get(r, 'date_of_joining'));
    if (!doj) { issues.push({ row: line, column: 'date_of_joining', problem: `unreadable date "${get(r, 'date_of_joining')}"` }); return; }
    const rawExit = get(r, 'date_of_exit');
    const doe = rawExit ? parseDate(rawExit) : null;
    if (rawExit && !doe) { issues.push({ row: line, column: 'date_of_exit', problem: `unreadable date "${rawExit}"` }); return; }
    if (doe && doe < doj) { issues.push({ row: line, column: 'date_of_exit', problem: 'exit date is before joining date' }); return; }
    const g = GENDER[get(r, 'gender').toLowerCase()];
    if (!g) { issues.push({ row: line, column: 'gender', problem: `unrecognised value "${get(r, 'gender')}"` }); return; }
    const dept = get(r, 'department'); const loc = get(r, 'location');
    if (!dept) { issues.push({ row: line, column: 'department', problem: 'missing' }); return; }
    if (!loc) { issues.push({ row: line, column: 'location', problem: 'missing' }); return; }
    employees.push({ employee_id: id, name: get(r, 'name'), department: dept, location: loc, gender: g, doj, doe, exit_type: get(r, 'exit_type') });
  });
  // Critical if more than 2% of rows are unusable or nothing is usable.
  const ok = employees.length > 0 && issues.length <= Math.max(0, Math.floor((rows.length - 1) * 0.02));
  return { ok, employees, issues, missingColumns: [], rowCount: rows.length - 1 };
}
