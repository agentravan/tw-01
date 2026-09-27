import type { Employee } from './hr-data.js';
import { breakdown, computeKpis, type KpiSet } from './hr-kpi.js';
import { escapeHtml } from './util.js';

export const KPI_LABELS: Record<keyof KpiSet, { label: string; unit: string }> = {
  headcount: { label: 'Headcount', unit: '' },
  joiners_12m: { label: 'Joiners (12 months)', unit: '' },
  exits_12m: { label: 'Exits (12 months)', unit: '' },
  avg_headcount_12m: { label: 'Average headcount (12 months)', unit: '' },
  attrition_pct_12m: { label: 'Attrition (12 months)', unit: '%' },
  female_pct: { label: 'Female share', unit: '%' },
  avg_tenure_years: { label: 'Average tenure', unit: ' yrs' },
};

function barChart(title: string, rows: { label: string; headcount: number }[], id: string): string {
  const top = rows.slice(0, 12); const max = Math.max(1, ...top.map(r => r.headcount));
  const W = 560, rowH = 26, left = 150, H = top.length * rowH + 30;
  const bars = top.map((r, i) => {
    const w = Math.round(((W - left - 50) * r.headcount) / max); const y = 10 + i * rowH;
    return `<text x="${left - 8}" y="${y + 16}" text-anchor="end" class="lbl">${escapeHtml(r.label.slice(0, 22))}</text><rect x="${left}" y="${y + 4}" width="${w}" height="16" rx="2" class="bar"/><text x="${left + w + 6}" y="${y + 16}" class="val">${r.headcount}</text>`;
  }).join('');
  return `<figure><figcaption>${escapeHtml(title)}</figcaption><svg class="chart" id="${id}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(title)}">${bars}</svg></figure>`;
}

/** Builds a self-contained, responsive, filterable HTML dashboard. No external requests. */
export function renderHrDashboard(input: { buildId: string; productName: string; company: string; employees: Employee[]; asOf: string; kpiKeys: (keyof KpiSet)[] }): { html: string; kpis: KpiSet; filters: Record<string, string[]>; byDepartment: ReturnType<typeof breakdown> } {
  const { employees: emps, asOf } = input;
  const kpis = computeKpis(emps, asOf);
  const byDepartment = breakdown(emps, asOf, 'department');
  const byLocation = breakdown(emps, asOf, 'location');
  const filters = {
    department: [...new Set(emps.map(e => e.department))].sort(),
    location: [...new Set(emps.map(e => e.location))].sort(),
    gender: [...new Set(emps.map(e => e.gender))].sort(),
  };
  const data = { buildId: input.buildId, asOf, kpis, byDepartment, byLocation, rows: emps.map(e => ({ id: e.employee_id, name: e.name, department: e.department, location: e.location, gender: e.gender, doj: e.doj, doe: e.doe })) };
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const sel = (k: string, label: string, opts: string[]) => `<label>${label}<select id="f-${k}"><option value="">All</option>${opts.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('')}</select></label>`;
  const cards = input.kpiKeys.map(k => `<div class="kpi" data-kpi="${k}"><span>${KPI_LABELS[k].label}</span><b id="k-${k}">${kpis[k]}${KPI_LABELS[k].unit}</b></div>`).join('');
  const rows = emps.slice(0, 500).map(e => `<tr><td>${escapeHtml(e.employee_id)}</td><td>${escapeHtml(e.name)}</td><td>${escapeHtml(e.department)}</td><td>${escapeHtml(e.location)}</td><td>${e.gender}</td><td>${e.doj}</td><td>${e.doe ?? ''}</td></tr>`).join('');

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(input.productName)} — ${escapeHtml(input.company)}</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#16202a;--muted:#5b6875;--line:#dde3e8;--acc:#1f5fbf}
@media (prefers-color-scheme:dark){:root{--bg:#10151b;--card:#18212a;--ink:#e6ecf1;--muted:#93a1ae;--line:#2a3643;--acc:#7aa7ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
header,main{padding:16px clamp(16px,4vw,40px)}header h1{margin:0;font-size:22px}header p{margin:4px 0 0;color:var(--muted)}
.filters{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0}.filters label{display:flex;flex-direction:column;font-size:12px;color:var(--muted);gap:4px}
select,button{font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--ink)}button{cursor:pointer}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}.kpi{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px}
.kpi span{display:block;font-size:12px;color:var(--muted)}.kpi b{font-size:22px;font-variant-numeric:tabular-nums}
.charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-top:14px}figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px}
figcaption{font-weight:600;margin-bottom:6px}svg{width:100%;height:auto}.bar{fill:var(--acc)}.lbl,.val{font-size:11px;fill:var(--muted)}
.tw{overflow-x:auto;margin-top:14px;background:var(--card);border:1px solid var(--line);border-radius:8px}table{border-collapse:collapse;width:100%}th,td{padding:6px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
th{font-size:12px;color:var(--muted)}footer{padding:16px clamp(16px,4vw,40px);color:var(--muted);font-size:12px}
@media (max-width:600px){.kpi b{font-size:18px}}
</style></head><body>
<header><h1>${escapeHtml(input.productName)}</h1><p>${escapeHtml(input.company)} · data as of ${asOf} · build ${input.buildId}</p></header>
<main>
<div class="filters">${sel('department', 'Department', filters.department)}${sel('location', 'Location', filters.location)}${sel('gender', 'Gender', filters.gender)}<label>&nbsp;<button id="reset" type="button">Reset filters</button></label><label>&nbsp;<button id="export" type="button">Export CSV</button></label></div>
<section class="kpis">${cards}</section>
<section class="charts">${barChart('Headcount by department', byDepartment, 'c-dept')}${barChart('Headcount by location', byLocation, 'c-loc')}</section>
<div class="tw"><table id="emp-table"><thead><tr><th>Employee ID</th><th>Name</th><th>Department</th><th>Location</th><th>Gender</th><th>Joined</th><th>Exited</th></tr></thead><tbody>${rows}</tbody></table></div>
</main>
<footer>Prepared by TW-01 · Figures follow the definitions in the guide book. Table shows the first 500 rows; Export CSV includes every row matching the filters.</footer>
<script id="tw01-data" type="application/json">${json}</script>
<script id="tw01-app">
(function(){var D=JSON.parse(document.getElementById('tw01-data').textContent);var L=${JSON.stringify(Object.fromEntries(Object.entries(KPI_LABELS).map(([k, v]) => [k, v.unit])))};
function start(a){var d=new Date(a+'T00:00:00Z');d.setUTCFullYear(d.getUTCFullYear()-1);return d.toISOString().slice(0,10)}
function on(e,day){return e.doj<=day&&(!e.doe||e.doe>day)}
function r2(n){return Math.round(n*100)/100}
function kpis(rows){var a=D.asOf,s=start(a),act=rows.filter(function(e){return on(e,a)}),h0=rows.filter(function(e){return on(e,s)}).length,ex=rows.filter(function(e){return e.doe&&e.doe>s&&e.doe<=a}).length,jn=rows.filter(function(e){return e.doj>s&&e.doj<=a}).length,avg=(h0+act.length)/2;
return{headcount:act.length,joiners_12m:jn,exits_12m:ex,avg_headcount_12m:r2(avg),attrition_pct_12m:avg>0?r2(ex/avg*100):0,female_pct:act.length?r2(act.filter(function(e){return e.gender==='Female'}).length/act.length*100):0,avg_tenure_years:act.length?r2(act.reduce(function(t,e){return t+(Date.parse(a)-Date.parse(e.doj))/864e5},0)/act.length/365.25):0}}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
var F=['department','location','gender'];function filtered(){var v={};F.forEach(function(f){v[f]=document.getElementById('f-'+f).value});return D.rows.filter(function(r){return F.every(function(f){return!v[f]||r[f]===v[f]})})}
function render(){var rows=filtered(),k=kpis(rows);Object.keys(k).forEach(function(x){var el=document.getElementById('k-'+x);if(el)el.textContent=k[x]+(L[x]||'')});
document.querySelector('#emp-table tbody').innerHTML=rows.slice(0,500).map(function(e){return'<tr><td>'+esc(e.id)+'</td><td>'+esc(e.name)+'</td><td>'+esc(e.department)+'</td><td>'+esc(e.location)+'</td><td>'+e.gender+'</td><td>'+e.doj+'</td><td>'+(e.doe||'')+'</td></tr>'}).join('')}
F.forEach(function(f){document.getElementById('f-'+f).addEventListener('change',render)});
document.getElementById('reset').addEventListener('click',function(){F.forEach(function(f){document.getElementById('f-'+f).value=''});render()});
document.getElementById('export').addEventListener('click',function(){var rows=filtered();var q=function(s){s=String(s==null?'':s);return/[",\\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};var csv=['employee_id,name,department,location,gender,date_of_joining,date_of_exit'].concat(rows.map(function(e){return[e.id,e.name,e.department,e.location,e.gender,e.doj,e.doe||''].map(q).join(',')})).join('\\n');var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='employees-filtered.csv';a.click()});
window.__tw01={kpis:kpis,filtered:filtered,render:render};})();
</script></body></html>`;
  return { html, kpis, filters, byDepartment };
}
