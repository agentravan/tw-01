import type { Employee } from './hr-data.js';

/**
 * AI Dashboard Specialist — KPI calculator (the producer).
 * Definitions (repeated verbatim in the guide book):
 *  - Headcount (as of D): joined on/before D and (no exit or exit after D).
 *  - Exits (period): exit date within (start, D].
 *  - Average headcount: (headcount at start + headcount at D) / 2.
 *  - Attrition % (period): exits ÷ average headcount × 100, period = 12 months ending D.
 *  - Joiners (period): joining date within (start, D].
 *  - Average tenure (years): mean of (D − joining date) over active employees.
 *  - Female %: female active employees ÷ headcount × 100.
 */
export interface KpiSet { headcount: number; joiners_12m: number; exits_12m: number; avg_headcount_12m: number; attrition_pct_12m: number; female_pct: number; avg_tenure_years: number; }

export function periodStart(asOf: string): string {
  const d = new Date(asOf + 'T00:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() - 1); return d.toISOString().slice(0, 10);
}
const activeOn = (e: Employee, day: string) => e.doj <= day && (!e.doe || e.doe > day);
const round = (n: number, p = 2) => Math.round(n * 10 ** p) / 10 ** p;

export function computeKpis(emps: Employee[], asOf: string): KpiSet {
  const start = periodStart(asOf);
  const active = emps.filter(e => activeOn(e, asOf));
  const hcStart = emps.filter(e => activeOn(e, start)).length;
  const exits = emps.filter(e => e.doe && e.doe > start && e.doe <= asOf).length;
  const joiners = emps.filter(e => e.doj > start && e.doj <= asOf).length;
  const avgHc = (hcStart + active.length) / 2;
  const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400000;
  return {
    headcount: active.length,
    joiners_12m: joiners,
    exits_12m: exits,
    avg_headcount_12m: round(avgHc),
    attrition_pct_12m: avgHc > 0 ? round((exits / avgHc) * 100) : 0,
    female_pct: active.length ? round((active.filter(e => e.gender === 'Female').length / active.length) * 100) : 0,
    avg_tenure_years: active.length ? round(active.reduce((s, e) => s + days(e.doj, asOf), 0) / active.length / 365.25) : 0,
  };
}

export function breakdown(emps: Employee[], asOf: string, key: 'department' | 'location' | 'gender'): { label: string; headcount: number; exits_12m: number }[] {
  const start = periodStart(asOf); const m = new Map<string, { headcount: number; exits_12m: number }>();
  for (const e of emps) {
    const k = e[key]; const v = m.get(k) ?? { headcount: 0, exits_12m: 0 };
    if (activeOn(e, asOf)) v.headcount++;
    if (e.doe && e.doe > start && e.doe <= asOf) v.exits_12m++;
    m.set(k, v);
  }
  return [...m.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.headcount - a.headcount || a.label.localeCompare(b.label));
}

/** As-of date: the latest date present in the data (joining or exit), so results are reproducible. */
export function dataAsOf(emps: Employee[]): string {
  let max = '0000-00-00';
  for (const e of emps) { if (e.doj > max) max = e.doj; if (e.doe && e.doe > max) max = e.doe; }
  return max;
}
