/** Hand-checked fixture. Expected KPIs (as of 2025-06-30) were computed by hand; see tests/company.test.ts. */
export const SMALL_CSV = `Emp ID,Name,Department,Location,Gender,DOJ,Date of Exit
E1,Asha,Ops,Gurugram,F,2020-01-01,
E2,Ravi,Ops,Gurugram,M,15-06-2021,31/03/2025
E3,Meena,HR,Noida,Female,2024-09-01,
E4,Karan,Sales,Noida,Male,01.02.2025,
E5,"Singh, Arjun",Sales,Gurugram,M,2019-05-10,2024-12-15
E6,Sam,HR,Noida,Other,30-06-2025,
`;
export const SMALL_EXPECTED = { headcount: 4, joiners_12m: 3, exits_12m: 2, avg_headcount_12m: 3.5, attrition_pct_12m: 57.14, female_pct: 50, avg_tenure_years: 1.68 };

/** Deterministic larger file (seeded PRNG) for end-to-end runs. */
export function generatedCsv(rows = 150, seed = 7): string {
  let x = seed; const r = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const depts = ['Operations', 'Sales', 'HR', 'Finance', 'Warehouse', 'IT'], locs = ['Gurugram', 'Noida', 'Manesar', 'Faridabad'], g = ['M', 'F', 'F', 'M', 'M', 'O'];
  const out = ['employee_id,name,department,location,gender,date_of_joining,date_of_exit'];
  for (let i = 1; i <= rows; i++) {
    const join = new Date(Date.UTC(2018, 0, 1) + Math.floor(r() * 2700) * 864e5);
    const exits = r() < 0.25; const exit = exits ? new Date(join.getTime() + Math.floor(30 + r() * 900) * 864e5) : null;
    const cap = Date.UTC(2025, 8, 30); const e = exit && exit.getTime() <= cap ? exit.toISOString().slice(0, 10) : '';
    out.push([`TW${1000 + i}`, `Employee ${i}`, depts[Math.floor(r() * depts.length)], locs[Math.floor(r() * locs.length)], g[Math.floor(r() * g.length)], join.toISOString().slice(0, 10), e].join(','));
  }
  return out.join('\n') + '\n';
}
