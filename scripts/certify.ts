/**
 * Runs every AI-employee scenario locally and prints a certification table.
 * Usage: npm run certify            (exit code 1 if any scenario fails)
 * Results are printed, not stored; the Founder can store a run from the console (POST /api/admin/certify).
 */
import { runScenarios } from '../company/testing/scenarios.js';
import { EMPLOYEES, LEVELS } from '../company/agents.js';

const results = await runScenarios();
const failed = results.filter(r => !r.passed);
for (const r of results) console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${r.employee.padEnd(12)} ${r.level.padEnd(11)} ${r.scenario}${r.passed ? '' : `\n      → ${r.detail}`}`);
console.log('\nEmployee'.padEnd(26) + LEVELS.map(l => l.slice(0, 5).padEnd(7)).join(''));
for (const e of EMPLOYEES) {
  const row = LEVELS.map(l => { const rs = results.filter(r => r.employee === e.role && r.level === l); return (!rs.length ? '—' : rs.every(r => r.passed) ? 'PASS' : 'FAIL').padEnd(7); }).join('');
  console.log(e.name.slice(0, 24).padEnd(25) + row + (e.implemented ? '' : '  (not built)'));
}
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed. PRODUCTION is never run locally.`);
process.exit(failed.length ? 1 : 0);
