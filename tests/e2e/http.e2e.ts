/**
 * HTTP end-to-end test: starts the real server process and drives it over HTTP, the way a browser would.
 * The Razorpay API is served by a local gateway double (NODE_ENV=test only). Run: npm run e2e
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { RazorpayDouble } from '../../company/testing/gateway-double.js';
import { generatedCsv } from '../../company/testing/fixtures.js';

const ROOT = resolve(import.meta.dirname, '../..');
const dir = mkdtempSync(join(tmpdir(), 'tw01-e2e-'));
const gw = new RazorpayDouble();
const gwServer = createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const r = await gw.fetch(`http://gw${req.url}`, { method: req.method, headers: { authorization: req.headers.authorization }, body: body || undefined } as any);
  res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(await r.text());
}).listen(0);
await new Promise(r => gwServer.once('listening', r));
const gwPort = (gwServer.address() as any).port;
const PORT = 3000 + Math.floor(Math.random() * 1000) + 5000;
const B = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, NODE_ENV: 'test', PORT: String(PORT), DATA_FILE: join(dir, 'state.json'), TW01_AUTO_RUN: 'false', TW01_DAILY_REPORT_ENABLED: 'false', TW01_AUTH_TOKEN: '',
  FOUNDER_EMAIL: 'harshit@e2e.test', FOUNDER_PASSWORD: 'e2e-founder-password', RAZORPAY_KEY_ID: gw.keyId, RAZORPAY_KEY_SECRET: gw.keySecret, RAZORPAY_WEBHOOK_SECRET: gw.webhookSecret, RAZORPAY_API_BASE: `http://127.0.0.1:${gwPort}`, SMTP_HOST: '', TW01_ALLOWED_ORIGIN: 'https://console.example' };
// Resolve tsx from the repo (CI) or fall back to a tsx on PATH (local).
let tsxCli: string | null = null; try { tsxCli = createRequire(join(ROOT, 'package.json')).resolve('tsx/cli'); } catch {}
const srv = tsxCli ? spawn(process.execPath, [tsxCli, join(ROOT, 'api/server.ts')], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
  : spawn('tsx', [join(ROOT, 'api/server.ts')], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', d => (log += d)); srv.stderr.on('data', d => (log += d));

let passed = 0; const failures: string[] = [];
const check = (name: string, cond: unknown, detail = '') => { if (cond) { passed++; console.log('PASS ', name); } else { failures.push(name); console.log('FAIL ', name, detail); } };
const j = async (method: string, path: string, body?: unknown, token?: string, extra: Record<string, string> = {}) => {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...extra }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const text = await r.text(); let data: any = text; try { data = JSON.parse(text); } catch {}
  return { status: r.status, data, headers: r.headers };
};
try {
  for (let i = 0; i < 60 && !/listening/.test(log); i++) await new Promise(r => setTimeout(r, 250));
  check('server starts', /listening/.test(log), log.slice(-500));

  // Hardening of the pre-existing server
  check('GET /.env is not served', (await fetch(B + '/.env')).status === 404);
  check('GET /data/tw01.json is not served', (await fetch(B + '/data/tw01.json')).status === 404);
  check('GET /package.json is not served', (await fetch(B + '/package.json')).status === 404);
  check('encoded traversal is not served', (await fetch(B + '/dashboard/%2e%2e/.env')).status === 404);
  check('legacy API fails closed without a token', (await j('POST', '/api/stop')).status === 401);
  check('control room page still served', (await fetch(B + '/')).status === 200);
  check('console and portal served', (await fetch(B + '/console/')).status === 200 && (await fetch(B + '/portal/')).status === 200);

  // Founder
  const fl = await j('POST', '/api/co/auth/login', { email: 'harshit@e2e.test', password: 'e2e-founder-password' });
  check('founder signs in', fl.status === 200 && fl.data.token, JSON.stringify(fl.data));
  const F = fl.data.token;
  check('founder session unlocks legacy control room', (await j('GET', '/api/control-room', undefined, F)).status === 200);
  check('wrong password rejected', (await j('POST', '/api/co/auth/login', { email: 'harshit@e2e.test', password: 'nope-nope-nope' })).status === 401);
  let spoofLimited = false;
  for (let i = 0; i < 12; i++) { const r = await j('POST', '/api/co/auth/login', { email: 'nobody@e2e.test', password: 'guess-guess-guess' }, undefined, { 'x-forwarded-for': `203.0.113.${i}` }); if (r.status === 429) { spoofLimited = true; break; } }
  check('spoofed X-Forwarded-For does not bypass the login limit', spoofLimited);
  check('nothing on sale before the Founder prices a product', (await j('GET', '/api/co/products')).data.length === 0);
  const act = await j('POST', '/api/co/admin/products/payroll', { price: 9999, active: true }, F);
  check('product without a build engine cannot be activated', act.status === 409, JSON.stringify(act.data));
  check('founder prices and activates HR Master', (await j('POST', '/api/co/admin/products/hr-master', { price: 14999, active: true }, F)).status === 200);

  // Customer
  const reg = await j('POST', '/api/co/auth/register', { name: 'Neha', company: 'Acme Logistics', email: 'neha@acme.in', mobile: '+91 98111 22334', password: 'customer-password-1' });
  check('customer registers', reg.status === 201, JSON.stringify(reg.data)); const C = reg.data.token;
  check('customer cannot open founder API', (await j('GET', '/api/co/admin/overview', undefined, C)).status === 403);
  const ord = await j('POST', '/api/co/orders', { productId: 'hr-master', company: 'Acme Logistics', employeeCount: 150, dataSource: 'Keka export', deadline: '2099-01-31' }, C);
  check('order created awaiting payment with a real gateway order', ord.status === 201 && ord.data.order.statusCode === 'AWAITING_PAYMENT' && ord.data.checkout.status === 'READY', JSON.stringify(ord.data));
  const oid = ord.data.order.id;
  check('upload rejects non-CSV', (await j('POST', `/api/co/orders/${oid}/files`, { name: 'x.exe', content: 'MZ' }, C)).status === 400);
  check('upload CSV', (await j('POST', `/api/co/orders/${oid}/files`, { name: 'employees.csv', content: generatedCsv() }, C)).status === 201);
  const run0 = await j('POST', `/api/co/admin/orders/${oid}/run`, undefined, F);
  check('pipeline refuses unpaid order over HTTP', run0.data.status === 'AWAITING_PAYMENT' && /blocked/.test(run0.data.log[0]), JSON.stringify(run0.data));

  // Payment
  const paid = gw.pay(ord.data.checkout.gatewayOrderId);
  const forged = await j('POST', `/api/co/orders/${oid}/checkout/confirm`, { ...paid, razorpay_signature: 'a'.repeat(64) }, C);
  check('forged checkout signature rejected', forged.status === 400);
  const wh = gw.webhook('payment.captured', paid.payment);
  const whBad = await fetch(B + '/api/co/webhooks/razorpay', { method: 'POST', body: wh.raw, headers: { 'x-razorpay-signature': 'bad', 'x-razorpay-event-id': 'e1' } });
  check('forged webhook rejected', whBad.status === 401);
  const conf = await j('POST', `/api/co/orders/${oid}/checkout/confirm`, paid, C);
  check('genuine checkout verified', conf.status === 200 && conf.data.verified === true, JSON.stringify(conf.data));
  const whOk = await fetch(B + '/api/co/webhooks/razorpay', { method: 'POST', body: wh.raw, headers: wh.headers });
  check('genuine webhook accepted (idempotent after checkout)', whOk.status === 200);

  // Autonomous pipeline kicked by payment
  let status = ''; for (let i = 0; i < 40; i++) { status = (await j('GET', `/api/co/orders/${oid}`, undefined, C)).data.statusCode; if (status === 'DELIVERED') break; await new Promise(r => setTimeout(r, 250)); }
  check('order delivered autonomously after payment', status === 'DELIVERED', status);
  const dl = await fetch(`${B}/api/co/orders/${oid}/download/dashboard`, { headers: { authorization: 'Bearer ' + C } });
  const html = await dl.text();
  check('dashboard download is an attachment with sandbox CSP', dl.status === 200 && /attachment/.test(dl.headers.get('content-disposition') ?? '') && dl.headers.get('content-security-policy') === 'sandbox');
  check('dashboard contains filters and data', html.includes('id="f-department"') && html.includes('tw01-data'));
  const detail = await j('GET', `/api/co/admin/orders/${oid}`, undefined, F);
  const byType = Object.fromEntries(detail.data.tasks.map((t: any) => [t.type, t]));
  check('validation and build tasks completed with evidence + passing QA', ['DATA_VALIDATION', 'DASHBOARD_BUILD'].every(k => byType[k]?.status === 'COMPLETED' && byType[k].evidence.length) && detail.data.qa[0]?.passed, JSON.stringify(detail.data.tasks.map((t: any) => t.status)));
  // SMTP is not configured in this run: the delivery task must not claim the customer was notified (review finding #5).
  check('delivery task escalated because the customer was not emailed', byType.DELIVERY?.status === 'ESCALATED' && /not notified/.test(byType.DELIVERY.errors.join(' ')), JSON.stringify(byType.DELIVERY));
  check('customer view exposes no internal tasks/audit', !JSON.stringify((await j('GET', `/api/co/orders/${oid}`, undefined, C)).data).match(/tasks|audit|agent:|AI_/));

  // Isolation
  const reg2 = await j('POST', '/api/co/auth/register', { name: 'Ravi', company: 'Other Co', email: 'ravi@other.in', mobile: '9876500001', password: 'customer-password-2' });
  const C2 = reg2.data.token;
  check('other customer cannot see the order', (await j('GET', `/api/co/orders/${oid}`, undefined, C2)).status === 404);
  check('other customer cannot download', (await fetch(`${B}/api/co/orders/${oid}/download/dashboard`, { headers: { authorization: 'Bearer ' + C2 } })).status === 404);

  // CORS
  const evil = await fetch(B + '/api/co/products', { headers: { origin: 'https://evil.example' } });
  check('no CORS for unknown origins', !evil.headers.get('access-control-allow-origin'));
  const pre = await fetch(B + '/api/co/orders', { method: 'OPTIONS', headers: { origin: 'https://console.example', 'access-control-request-method': 'POST' } });
  check('CORS preflight answered for the configured origin', pre.status === 204 && pre.headers.get('access-control-allow-origin') === 'https://console.example');
  const good = await fetch(B + '/api/co/products', { headers: { origin: 'https://console.example' } });
  check('CORS only for the configured origin', good.headers.get('access-control-allow-origin') === 'https://console.example');

  // Objectives, certification, health
  const obj = await j('POST', '/api/co/admin/objective', { text: 'Run a security scan' }, F);
  check('AI Boss objective completes with evidence', obj.data.status === 'COMPLETED' && obj.data.evidence.length > 0, JSON.stringify(obj.data).slice(0, 300));
  const h = await j('GET', '/api/co/health', undefined, F);
  check('health OK, audit chain intact, tools active', h.data.status === 'OK' && h.data.auditChain.ok && h.data.tools.every((t: any) => t.status === 'ACTIVE'), JSON.stringify(h.data).slice(0, 300));
  const anonHealth = await j('GET', '/api/co/health');
  check('anonymous health reveals only status', Object.keys(anonHealth.data).sort().join() === 'checkedAt,status');
  const vp = await j('POST', '/api/co/admin/verify-production', { baseUrl: 'http://127.0.0.1:1' }, F);
  check('production verification refuses non-https targets', vp.status === 400);
  const denied = await j('GET', '/api/co/admin/list/audit', undefined, F);
  check('denied attempts are in the audit log', denied.data.entries.some((e: any) => e.result === 'DENIED'));
} catch (e) { failures.push('exception: ' + (e as Error).stack); console.log(e); }
finally {
  srv.kill(); gwServer.close(); rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failures.length} failed`); if (failures.length) { console.log(failures.join('\n')); console.log('--- server log tail ---\n' + log.slice(-1500)); }
  process.exit(failures.length ? 1 : 0);
}
