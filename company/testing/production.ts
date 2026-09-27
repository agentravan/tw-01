import type { Role, TestResult } from '../types.js';

/**
 * PRODUCTION-level verification: real HTTP requests against a deployed TW-01.
 * Needs the deployed base URL and a Founder session token (for the authenticated checks).
 * Nothing here is simulated; if the deployment is unreachable, every check fails.
 */
export async function verifyProduction(baseUrl: string, founderToken: string, http: typeof fetch = fetch): Promise<TestResult[]> {
  const base = baseUrl.replace(/\/+$/, '');
  if (!/^https:\/\//.test(base) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) throw new Error('baseUrl must be https:// (or localhost for a dry run)');
  const out: TestResult[] = [];
  const get = (p: string, auth = false) => http(base + p, { headers: auth ? { authorization: 'Bearer ' + founderToken } : {}, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
  async function check(employee: Role, scenario: string, fn: () => Promise<string>) {
    const t0 = Date.now();
    try { const ev = await fn(); out.push({ scenario, employee, level: 'PRODUCTION', passed: true, detail: 'passed', evidence: [ev], durationMs: Date.now() - t0 }); }
    catch (e) { out.push({ scenario, employee, level: 'PRODUCTION', passed: false, detail: (e as Error).message.slice(0, 300), evidence: [], durationMs: Date.now() - t0 }); }
  }
  const must = (c: unknown, m: string) => { if (!c) throw new Error(m); };
  let health: any = null;

  await check('AI_BOSS', 'deployed health endpoint reports OK', async () => { const r = await get('/api/co/health', true); must(r.ok, `HTTP ${r.status}`); health = await r.json(); must(health.status === 'OK', `status ${health.status}`); return `${base}/api/co/health ${health.checkedAt}`; });
  await check('AI_BOSS', 'objectives require a Founder session', async () => { const r = await http(base + '/api/co/admin/objective', { method: 'POST', body: '{"text":"Run a security scan"}', headers: { 'content-type': 'application/json' } }); must(r.status === 401, `anonymous objective got HTTP ${r.status}`); return 'HTTP 401'; });
  await check('AI_SECURITY', 'secrets and data files are not served', async () => { for (const p of ['/.env', '/data/tw01.json', '/package.json', '/server/app.ts']) { const r = await get(p); must(r.status === 404, `${p} → HTTP ${r.status}`); } return '4 paths → 404'; });
  await check('AI_SECURITY', 'admin API denies anonymous callers and sends security headers', async () => { const r = await get('/api/co/admin/overview'); must(r.status === 401, `HTTP ${r.status}`); must(r.headers.get('x-content-type-options') === 'nosniff', 'missing nosniff'); must(r.headers.get('x-frame-options') === 'DENY', 'missing frame protection'); return 'HTTP 401 + headers'; });
  await check('AI_SECURITY', 'served over HTTPS', async () => { must(base.startsWith('https://'), 'not https'); return base; });
  await check('AI_FINANCE', 'Razorpay and webhook secret configured on the deployment', async () => { must(health, 'health unavailable'); must(health.integrations.razorpay === 'CONFIGURED', `razorpay ${health.integrations.razorpay}`); must(health.integrations.razorpayWebhook === 'CONFIGURED', `webhook ${health.integrations.razorpayWebhook}`); return JSON.stringify(health.integrations); });
  await check('AI_FINANCE', 'webhook rejects a forged signature', async () => { const r = await http(base + '/api/co/webhooks/razorpay', { method: 'POST', body: '{"event":"payment.captured"}', headers: { 'content-type': 'application/json', 'x-razorpay-signature': '0'.repeat(64), 'x-razorpay-event-id': 'verify-prod-forged' } }); must(r.status === 401, `HTTP ${r.status}`); return 'HTTP 401'; });
  await check('AI_DASHBOARD', 'portal is served and at least one product is on sale', async () => { const p = await get('/portal/'); must(p.ok, `portal HTTP ${p.status}`); const r = await get('/api/co/products'); const list = await r.json(); must(Array.isArray(list) && list.length > 0, 'no active products'); return `${list.length} products`; });
  await check('AI_QA', 'all tools on the deployment passed their self-tests', async () => { must(health, 'health unavailable'); const bad = health.tools.filter((t: any) => t.status !== 'ACTIVE'); must(!bad.length, `inactive: ${bad.map((t: any) => t.name)}`); return `${health.tools.length} tools ACTIVE`; });
  await check('AI_QA', 'audit chain intact on the deployment', async () => { must(health?.auditChain?.ok, `chain ${JSON.stringify(health?.auditChain)}`); return `${health.auditChain.checked} entries`; });
  await check('AI_DATA', 'founder metrics are served from live records', async () => { const r = await get('/api/co/admin/overview', true); must(r.ok, `HTTP ${r.status}`); const o = await r.json(); must(typeof o.metrics?.totals?.orders === 'number', 'no metrics'); return `orders=${o.metrics.totals.orders}`; });
  await check('AI_SECURITY', 'durable storage (not a serverless temp disk)', async () => { must(health, 'health unavailable'); must(!(health.runtime?.serverless && !health.store.durableOnServerless), `store ${health.store.kind} is not durable on this serverless runtime`); return health.store.kind; });
  return out;
}
