/**
 * Production verification against a deployed TW-01.
 * Usage: TW01_BASE_URL=https://your-domain TW01_FOUNDER_TOKEN=<session token> npm run verify:production
 * Prints results. To record them as the PRODUCTION certification level, use the Founder console
 * (POST /api/co/admin/verify-production), which runs the same checks server-side and stores the run.
 */
import { verifyProduction } from '../company/testing/production.js';
const base = process.env.TW01_BASE_URL; const token = process.env.TW01_FOUNDER_TOKEN ?? '';
if (!base) { console.error('Set TW01_BASE_URL'); process.exit(2); }
const results = await verifyProduction(base, token);
for (const r of results) console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${r.employee.padEnd(12)} ${r.scenario}${r.passed ? '' : `\n      → ${r.detail}`}`);
const failed = results.filter(r => !r.passed).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
