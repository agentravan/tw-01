import type { DashboardBuild, Product, QAReport } from './types.js';
import { normHeader, parseCsv, parseDate } from './csv.js';
import { uid } from './util.js';

/**
 * AI QA Officer — independent verification. Deliberately does NOT import the Specialist's KPI code:
 * it re-reads the raw file, recomputes every KPI with its own day-by-day logic, and compares against
 * the numbers embedded in the delivered dashboard. It also checks customer isolation, filters, guide
 * consistency and that delivery files exist.
 */
interface Rec { id: string; doj: string; doe: string | null; female: boolean; dept: string; loc: string; gender: string; }

function readRaw(csv: string): Rec[] {
  const rows = parseCsv(csv); const h = rows[0].map(normHeader);
  const col = (...names: string[]) => h.findIndex(x => names.includes(x));
  const ci = { id: col('employee_id', 'emp_id', 'empid', 'employee_code', 'emp_code', 'id'), doj: col('date_of_joining', 'doj', 'joining_date', 'join_date'), doe: col('date_of_exit', 'doe', 'exit_date', 'relieving_date', 'date_of_leaving', 'dol'), g: col('gender', 'sex'), d: col('department', 'dept', 'function'), l: col('location', 'branch', 'site', 'city') };
  const out: Rec[] = []; const seen = new Set<string>();
  for (const r of rows.slice(1)) {
    const id = (r[ci.id] ?? '').trim(); const doj = parseDate(r[ci.doj] ?? ''); const rawExit = ci.doe >= 0 ? (r[ci.doe] ?? '').trim() : '';
    const doe = rawExit ? parseDate(rawExit) : null; const g = (r[ci.g] ?? '').trim().toLowerCase();
    const gender = ['m', 'male'].includes(g) ? 'Male' : ['f', 'female'].includes(g) ? 'Female' : ['o', 'other', 'others', 'transgender', 'non-binary', 'nonbinary'].includes(g) ? 'Other' : '';
    const dept = (r[ci.d] ?? '').trim(); const loc = (r[ci.l] ?? '').trim();
    if (!id || seen.has(id) || !doj || (rawExit && !doe) || (doe && doe < doj) || !gender || !dept || !loc) continue; // same exclusion rules as the published validation spec
    seen.add(id); out.push({ id, doj, doe, female: gender === 'Female', dept, loc, gender });
  }
  return out;
}

function recompute(recs: Rec[], asOf: string) {
  const end = new Date(asOf + 'T00:00:00Z'); const startD = new Date(end); startD.setUTCFullYear(end.getUTCFullYear() - 1);
  const start = startD.toISOString().slice(0, 10);
  const on = (r: Rec, day: string) => !(r.doj > day) && !(r.doe !== null && !(r.doe > day));
  let hc = 0, hc0 = 0, ex = 0, jn = 0, fem = 0, tenureDays = 0;
  for (const r of recs) {
    if (on(r, asOf)) { hc++; if (r.female) fem++; tenureDays += (end.getTime() - new Date(r.doj + 'T00:00:00Z').getTime()) / 864e5; }
    if (on(r, start)) hc0++;
    if (r.doe !== null && r.doe > start && !(r.doe > asOf)) ex++;
    if (r.doj > start && !(r.doj > asOf)) jn++;
  }
  const avg = (hc0 + hc) / 2; const r2 = (n: number) => Math.round(n * 100) / 100;
  return { headcount: hc, joiners_12m: jn, exits_12m: ex, avg_headcount_12m: r2(avg), attrition_pct_12m: avg > 0 ? r2((ex / avg) * 100) : 0, female_pct: hc ? r2((fem / hc) * 100) : 0, avg_tenure_years: hc ? r2(tenureDays / hc / 365.25) : 0 };
}

export async function runDashboardQA(input: { orderId: string; build: DashboardBuild; product: Product; rawCsv: string; otherCustomersIds: string[]; at: string; read: (key: string) => Promise<string | null> }): Promise<QAReport> {
  const checks: QAReport['checks'] = [];
  const add = (name: string, passed: boolean, detail: string) => checks.push({ name, passed, detail });
  const { build } = input;

  // Delivery: files exist and are non-empty
  let html = '';
  try { html = (await input.read(build.dashboardPath)) ?? ''; add('delivery.dashboard_file', html.length > 1000, html ? `${Buffer.byteLength(html)} bytes` : 'missing'); }
  catch (e) { add('delivery.dashboard_file', false, `unreadable: ${(e as Error).message}`); }
  let guide = '';
  if (build.guidePath) { try { guide = (await input.read(build.guidePath)) ?? ''; add('delivery.guide_file', guide.length > 500, guide ? `${guide.length} chars` : 'missing'); } catch (e) { add('delivery.guide_file', false, `unreadable: ${(e as Error).message}`); } }
  else add('delivery.guide_file', false, 'no guide produced');

  // Embedded data block
  const m = /<script id="tw01-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  let embedded: any = null;
  try { embedded = m ? JSON.parse(m[1].replace(/\\u003c/g, '<')) : null; } catch { embedded = null; }
  add('ui.embedded_data', !!embedded, embedded ? 'data block parsed' : 'data block missing or invalid');

  // Data: row count and totals
  const recs = readRaw(input.rawCsv);
  add('data.row_count', !!embedded && embedded.rows?.length === recs.length, `dashboard rows ${embedded?.rows?.length ?? '?'} vs raw valid rows ${recs.length}`);

  // Calculations: independent recompute
  const expected = recompute(recs, build.asOf);
  for (const k of Object.keys(expected) as (keyof typeof expected)[]) {
    const got = embedded?.kpis?.[k];
    add(`calc.${k}`, typeof got === 'number' && Math.abs(got - expected[k]) < 0.011, `dashboard ${got} vs QA ${expected[k]}`);
  }
  // Breakdown totals reconcile with headcount
  const deptSum = (embedded?.byDepartment ?? []).reduce((s: number, x: any) => s + x.headcount, 0);
  add('calc.department_reconciles', deptSum === expected.headcount, `sum ${deptSum} vs headcount ${expected.headcount}`);

  // UI: filters present with the right options, charts and tables present
  for (const f of ['department', 'location', 'gender']) {
    const want = [...new Set(recs.map(r => (r as any)[f === 'department' ? 'dept' : f === 'location' ? 'loc' : 'gender']))].sort();
    const sel = new RegExp(`<select[^>]*id="f-${f}"[^>]*>([\\s\\S]*?)</select>`).exec(html);
    const opts = sel ? [...sel[1].matchAll(/<option value="([^"]*)"/g)].map(x => x[1]).filter(Boolean).sort() : [];
    add(`ui.filter_${f}`, !!sel && JSON.stringify(opts) === JSON.stringify(want.map(escapeAttr)), `${opts.length} options vs ${want.length} values`);
  }
  add('ui.charts', (html.match(/<svg[^>]*class="chart"/g) ?? []).length >= 2, 'bar charts rendered');
  add('ui.table', /<table[^>]*id="emp-table"/.test(html), 'employee table present');
  add('ui.responsive', /name="viewport"/.test(html) && /@media/.test(html), 'viewport meta and media queries');
  add('ui.no_external_requests', !/(src|href)="https?:\/\//.test(html), 'fully self-contained');

  // Security: customer isolation — no other customer/order ids leak into the files
  const leaked = input.otherCustomersIds.filter(id => html.includes(id) || guide.includes(id));
  add('security.customer_isolation', leaked.length === 0, leaked.length ? `found foreign ids: ${leaked.slice(0, 3).join(', ')}` : 'no foreign ids');
  add('security.no_script_injection', !/<script(?![^>]*id="tw01-(data|app)")/i.test(html.replace(/<script id="tw01-(data|app)"[\s\S]*?<\/script>/g, '')), 'only the two known script blocks');

  // Guide corresponds to the actual dashboard
  for (const k of input.product.kpis) add(`guide.kpi_${k}`, guide.includes(`data-kpi="${k}"`) && html.includes(`data-kpi="${k}"`), 'KPI documented and present');
  for (const sec of ['Purpose', 'Access', 'Navigation', 'KPIs', 'Filters', 'Data updates', 'Reports', 'Export', 'Troubleshooting', 'Support']) add(`guide.section_${sec.toLowerCase().replace(/\s+/g, '_')}`, guide.includes(`<h2>${sec}</h2>`), sec);
  add('guide.matches_build', guide.includes(build.id) && guide.includes(build.asOf), 'guide references this build and as-of date');

  return { id: uid('qa'), orderId: input.orderId, buildId: build.id, by: 'AI_QA', at: input.at, passed: checks.every(c => c.passed), checks };
}
const escapeAttr = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
