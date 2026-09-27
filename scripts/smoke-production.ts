/**
 * Production smoke test against a deployed TW-01 (real HTTP, real database).
 * Usage: TW01_BASE_URL=https://… FOUNDER_EMAIL=… FOUNDER_PASSWORD=… tsx scripts/smoke-production.ts
 *   1. Founder sign-in
 *   2. POST /api/co/admin/verify-production: the server runs the PRODUCTION checks against its own public URL and records the run
 *   3. One clearly labelled test order end to end (customer smoke-…@tw01.test). Without Razorpay keys it runs under a
 *      recorded Founder override. The product is switched back off afterwards.
 */
import { generatedCsv } from '../company/testing/fixtures.js';

const B = (process.env.TW01_BASE_URL ?? '').replace(/\/+$/, '');
const email = process.env.FOUNDER_EMAIL ?? '', password = process.env.FOUNDER_PASSWORD ?? '';
if (!B.startsWith('https://') || !email || !password) { console.error('Set TW01_BASE_URL (https), FOUNDER_EMAIL, FOUNDER_PASSWORD'); process.exit(2); }
const out: string[] = []; const ok = (n: string, c: unknown, d = '') => { out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : ' — ' + d}`); console.log(out.at(-1)); };
async function j(method: string, path: string, body?: unknown, token?: string) {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  const t = await r.text(); let d: any = t; try { d = JSON.parse(t); } catch { /* text */ } return { s: r.status, d, h: r.headers };
}

const L = await j('POST', '/api/co/auth/login', { email, password }); ok('Founder signs in', L.s === 200, JSON.stringify(L.d)); const F = L.d.token;
if (!F) process.exit(1);

const V = await j('POST', '/api/co/admin/verify-production', { baseUrl: B }, F);
ok('production verification recorded', V.s === 200 && V.d.runId, JSON.stringify(V.d).slice(0, 300));
for (const r of V.d.results ?? []) console.log(`   ${r.passed ? 'pass' : 'FAIL'}  ${r.employee.padEnd(12)} ${r.scenario}${r.passed ? '' : ' — ' + r.detail}`);

const stamp = Date.now();
const before = (await j('GET', '/api/co/admin/list/products', undefined, F)).d.find((p: any) => p.id === 'hr-master');
await j('POST', '/api/co/admin/products/hr-master', { price: before?.price ?? 1, active: true }, F);
const R = await j('POST', '/api/co/auth/register', { name: 'Smoke Test', company: `TW-01 smoke test ${stamp}`, email: `smoke-${stamp}@tw01.test`, mobile: '9000000000', password: `smoke-${stamp}-pw` });
ok('test customer registers', R.s === 201, JSON.stringify(R.d)); const C = R.d.token;
const O = await j('POST', '/api/co/orders', { productId: 'hr-master', company: `TW-01 smoke test ${stamp}`, employeeCount: 150, dataSource: 'generated test data', deadline: '2099-12-31', additional: 'Automated production smoke test. Not a real customer.' }, C);
ok('order created', O.s === 201, JSON.stringify(O.d)); const id = O.d.order?.id;
ok('payment status is honest', ['READY', 'NOT_CONFIGURED'].includes(O.d.checkout?.status), JSON.stringify(O.d.checkout));
ok('employee file uploaded', (await j('POST', `/api/co/orders/${id}/files`, { name: 'employees.csv', content: generatedCsv() }, C)).s === 201);
const gate = await j('POST', `/api/co/admin/orders/${id}/run`, undefined, F);
ok('production blocked before payment/override', gate.d.status === 'AWAITING_PAYMENT', JSON.stringify(gate.d));
const ov = await j('POST', `/api/co/admin/orders/${id}/override`, { reason: 'Automated production smoke test (no real payment)' }, F);
const ap = await j('POST', `/api/co/admin/approvals/${ov.d.id}`, { decision: 'approve' }, F);
ok('Founder override approved and recorded', ap.s === 200 && ap.d.status === 'APPROVED', JSON.stringify(ap.d));
let st = ''; for (let i = 0; i < 20; i++) { st = (await j('GET', `/api/co/orders/${id}`, undefined, C)).d.statusCode; if (st === 'DELIVERED') break; await j('POST', `/api/co/admin/orders/${id}/run`, undefined, F); }
ok('order built, QA-checked and delivered', st === 'DELIVERED', st);
const detail = await j('GET', `/api/co/admin/orders/${id}`, undefined, F);
ok('QA report passed', detail.d.qa?.[0]?.passed === true, JSON.stringify(detail.d.qa?.[0]?.checks?.filter((c: any) => !c.passed)));
const dl = await fetch(`${B}/api/co/orders/${id}/download/dashboard`, { headers: { authorization: 'Bearer ' + C } });
ok('customer downloads dashboard (attachment, sandbox CSP)', dl.status === 200 && (await dl.text()).includes('tw01-data') && dl.headers.get('content-security-policy') === 'sandbox');
if (!before?.active) await j('POST', '/api/co/admin/products/hr-master', { active: false }, F);
const H = await j('GET', '/api/co/health', undefined, F);
ok('health OK with Supabase storage on serverless', H.d.status === 'OK' && H.d.store?.kind === 'supabase-postgres' && H.d.runtime?.serverless, JSON.stringify(H.d).slice(0, 300));
console.log(`\ntest order: ${id}`);
const failed = out.filter(l => l.startsWith('FAIL')).length;
console.log(`${out.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
