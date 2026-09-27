import { KPI_LABELS } from './dashboard-build.js';
import type { KpiSet } from './hr-kpi.js';
import { escapeHtml } from './util.js';

const DEFINITIONS: Record<keyof KpiSet, string> = {
  headcount: 'Employees who joined on or before the as-of date and have no exit date, or exit after it.',
  joiners_12m: 'Employees whose joining date falls in the 12 months ending on the as-of date.',
  exits_12m: 'Employees whose exit date falls in the 12 months ending on the as-of date.',
  avg_headcount_12m: '(Headcount at the start of the 12-month period + headcount on the as-of date) ÷ 2.',
  attrition_pct_12m: 'Exits (12 months) ÷ average headcount (12 months) × 100.',
  female_pct: 'Active female employees ÷ headcount × 100.',
  avg_tenure_years: 'Average time since joining, in years, across active employees.',
};

/** Guide book generated from the actual build: every KPI, filter and value it lists comes from that build. */
export function renderGuide(input: { buildId: string; productName: string; company: string; asOf: string; kpis: KpiSet; kpiKeys: (keyof KpiSet)[]; filters: Record<string, string[]>; rowCount: number; supportEmail: string; orderId: string }): string {
  const kpiRows = input.kpiKeys.map(k => `<tr data-kpi="${k}"><td>${KPI_LABELS[k].label}</td><td>${input.kpis[k]}${KPI_LABELS[k].unit}</td><td>${DEFINITIONS[k]}</td></tr>`).join('');
  const filterRows = Object.entries(input.filters).map(([f, v]) => `<li><b>${f[0].toUpperCase() + f.slice(1)}</b>: ${v.length} options (${escapeHtml(v.slice(0, 8).join(', '))}${v.length > 8 ? ', …' : ''})</li>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Guide — ${escapeHtml(input.productName)}</title>
<style>body{font:15px/1.6 system-ui,sans-serif;max-width:760px;margin:0 auto;padding:24px 16px;color:#16202a}h1{font-size:24px}h2{font-size:18px;margin-top:28px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #dde3e8;padding:6px 8px;text-align:left;vertical-align:top}code{background:#eef2f5;padding:1px 4px;border-radius:3px}</style></head><body>
<h1>${escapeHtml(input.productName)} — guide book</h1>
<p>Prepared for ${escapeHtml(input.company)} · order ${escapeHtml(input.orderId)} · build <code>${input.buildId}</code> · data as of ${input.asOf} · ${input.rowCount} employee records.</p>
<h2>Purpose</h2><p>This dashboard shows your workforce size, movement and composition from the employee master file you supplied, so you can track headcount, joiners, exits and attrition by department, location and gender.</p>
<h2>Access</h2><p>Open <code>dashboard.html</code> in any modern browser (Chrome, Edge, Safari, Firefox) on desktop or mobile. It works offline and sends no data anywhere. You can also download it again from your TW-01 customer portal.</p>
<h2>Navigation</h2><p>The page has four parts, top to bottom: filters, KPI cards, two charts (headcount by department and by location) and the employee table.</p>
<h2>KPIs</h2><table><thead><tr><th>KPI</th><th>Value (all employees)</th><th>Definition</th></tr></thead><tbody>${kpiRows}</tbody></table>
<p>“As-of date” is the latest joining or exit date in your file (${input.asOf}). Dates written as DD-MM-YYYY or DD/MM/YYYY are read day-first.</p>
<h2>Filters</h2><ul>${filterRows}</ul><p>Filters combine: choosing a department and a location shows employees matching both. KPI cards and the table update immediately. The charts always show the whole organisation. “Reset filters” clears all three.</p>
<h2>Data updates</h2><p>To refresh the figures, upload a new employee master (same columns) from your portal and request a revision. Required columns: <code>employee_id</code>, <code>department</code>, <code>location</code>, <code>gender</code>, <code>date_of_joining</code>; optional: <code>name</code>, <code>date_of_exit</code>, <code>exit_type</code>.</p>
<h2>Reports</h2><p>The KPI table above is a snapshot report for the as-of date. Apply filters in the dashboard to see the same KPIs for any department, location or gender.</p>
<h2>Export</h2><p>“Export CSV” downloads every employee row that matches the current filters. Use your browser’s Print command to save the dashboard view as a PDF.</p>
<h2>Troubleshooting</h2><ul><li>A number looks wrong: check the employee’s joining and exit dates in your file; exits dated after the as-of date count as active.</li><li>A department is missing from a filter: it had no rows in the file.</li><li>The page is blank: make sure JavaScript is enabled; the file must be opened directly, not inside an email preview.</li></ul>
<h2>Support</h2><p>Raise a support request or revision from your customer portal, or email ${escapeHtml(input.supportEmail)} quoting order ${escapeHtml(input.orderId)}.</p>
</body></html>`;
}
