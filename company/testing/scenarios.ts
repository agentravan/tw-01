import { readFile, rm, writeFile } from 'node:fs/promises';
import type { CertLevel, Role, TestResult } from '../types.js';
import { Company } from '../service.js';
import { validateEmployeeMaster } from '../hr-data.js';
import { computeKpis, dataAsOf } from '../hr-kpi.js';
import { verifyAuditChain, appendAudit } from '../audit.js';
import { runDashboardQA } from '../qa.js';
import { createTask, failTask, moveTask, qaDecision, addEvidence } from '../tasks.js';
import { can } from '../rbac.js';
import { hmacHex } from '../util.js';
import { Razorpay } from '../razorpay.js';
import { emptyCompany } from '../types.js';
import { harness, orderInput, type Harness } from './harness.js';
import { SMALL_CSV, SMALL_EXPECTED, generatedCsv } from './fixtures.js';

export interface Scenario { name: string; employee: Role; level: CertLevel; run(): Promise<string[]> }
class Fail extends Error {}
const ok = (cond: unknown, msg: string) => { if (!cond) throw new Fail(msg); };
async function rejects(p: Promise<unknown>, code: string, msg: string) {
  try { await p; } catch (e) { ok((e as any).code === code, `${msg}: expected ${code}, got ${(e as any).code}: ${(e as Error).message}`); return; }
  throw new Fail(`${msg}: expected ${code} but the call succeeded`);
}
async function withH<T>(o: Parameters<typeof harness>[0], fn: (h: Harness) => Promise<T>): Promise<T> { const h = await harness(o); try { return await fn(h); } finally { await h.cleanup(); } }

/** Places an order, uploads data, pays through Checkout (test double) and confirms. Returns ids for evidence. */
async function paidOrder(h: Harness, csv = generatedCsv()) {
  const cust = await h.customer(); const pid = await h.activeProduct();
  const { order, checkout } = await h.co.createOrder(cust, orderInput(pid));
  await h.co.uploadFile(cust, order.id, 'employee_master.csv', csv);
  ok(checkout.status === 'READY', 'checkout should be READY with gateway configured');
  const paid = h.gw.pay((checkout as any).gatewayOrderId);
  const r = await h.co.confirmCheckout(cust, order.id, paid);
  return { cust, orderId: order.id, paid, confirm: r };
}
const state = (h: Harness) => h.co.read(s => s);

export const SCENARIOS: Scenario[] = [
  // ------------------------------------------------------------------ AI BOSS
  { name: 'routes objectives deterministically to the right employee', employee: 'AI_BOSS', level: 'UNIT', async run() {
    const route = (t: string) => Company.ROUTES.find(r => r.re.test(t))?.role ?? null;
    ok(route('Run a security scan of the system') === 'AI_SECURITY', 'security');
    ok(route('Give me the revenue report for today') === 'AI_DATA', 'report');
    ok(route('Continue work on ORD-1004') === 'AI_DASHBOARD', 'order');
    ok(route('Run tests on the workforce') === 'AI_QA', 'certification');
    ok(route('Plan a LinkedIn campaign') === 'AI_MARKETING', 'marketing');
    ok(route('asdf qwerty') === null, 'unknown objective must not be guessed');
    return ['6 routing cases'];
  } },
  { name: 'founder objective → task → execution → evidence → QA → completed', employee: 'AI_BOSS', level: 'FUNCTIONAL', async run() {
    return withH({}, async h => {
      const t = await h.co.submitObjective(h.founder, 'Run a security scan and report');
      ok(t.agent === 'AI_SECURITY', `assigned ${t.agent}`);
      ok(t.status === 'COMPLETED', `status ${t.status}: ${t.errors.join('; ')}`);
      ok(t.evidence.some(e => e.kind === 'tool_execution'), 'tool evidence');
      const s = await state(h); ok(s.toolExecutions.some(x => x.id === t.evidence[0].ref && x.status === 'OK'), 'evidence resolves to a real OK execution');
      ok(t.qaBy === 'agent:ai-qa', 'QA by a different employee');
      return [t.id, t.evidence[0].ref];
    });
  } },
  { name: 'order objective drives the dashboard pipeline end to end', employee: 'AI_BOSS', level: 'INTEGRATION', async run() {
    return withH({}, async h => {
      const { orderId } = await paidOrder(h);
      const t = await h.co.submitObjective(h.founder, `Build and deliver ${orderId}`);
      ok(t.status === 'COMPLETED', `objective task ${t.status}: ${t.errors.join('; ')}`);
      const s = await state(h); ok(s.orders.find(o => o.id === orderId)!.status === 'DELIVERED', 'order delivered');
      return [t.id, orderId];
    });
  } },
  { name: 'unroutable and unbuilt objectives are escalated, never faked', employee: 'AI_BOSS', level: 'FAILURE', async run() {
    return withH({}, async h => {
      const a = await h.co.submitObjective(h.founder, 'zxcv plorp blah');
      ok(a.status === 'ESCALATED', `unroutable → ${a.status}`);
      const b = await h.co.submitObjective(h.founder, 'Write SEO content for the website');
      ok(b.agent === 'AI_MARKETING' && b.status === 'ESCALATED', `unbuilt employee → ${b.status}`);
      const s = await state(h); const op = s.tasks.find(t => t.agent === 'AI_OPERATOR');
      ok(op && op.status === 'ESCALATED', 'operator capability task escalated');
      ok(!s.tasks.some(t => t.status === 'COMPLETED' && !t.evidence.length), 'no completed task without evidence');
      return [a.id, b.id, op!.id];
    });
  } },
  { name: 'retries are bounded and end in escalation', employee: 'AI_BOSS', level: 'FAILURE', async run() {
    const s = emptyCompany(); const t = createTask(s, { title: 'x', type: 'X', agent: 'AI_DATA', createdBy: 'test', at: 't', maxRetries: 2 });
    const outcomes: string[] = [];
    for (let i = 0; i < 3; i++) { moveTask(s, t, 'IN_PROGRESS', 'test', 't'); outcomes.push(failTask(s, t, 'boom', 'test', 't')); }
    ok(JSON.stringify(outcomes) === JSON.stringify(['RETRY', 'RETRY', 'ESCALATED']), `outcomes ${outcomes}`);
    ok(t.status === 'ESCALATED' && t.retryCount === 2, 'escalated after 2 retries');
    return [outcomes.join(',')];
  } },
  { name: 'customers and AI employees cannot submit founder objectives or decide approvals', employee: 'AI_BOSS', level: 'SECURITY', async run() {
    return withH({}, async h => {
      const c = await h.customer();
      await rejects(h.co.submitObjective(c, 'Run a security scan'), 'FORBIDDEN', 'customer objective');
      await rejects(h.co.submitObjective({ kind: 'agent', id: 'ai-sales', role: 'AI_SALES' }, 'Run a security scan'), 'FORBIDDEN', 'agent objective');
      await rejects(h.co.decideApproval({ kind: 'agent', id: 'ai-boss', role: 'AI_BOSS' }, 'apr_x', 'approve', ''), 'FORBIDDEN', 'AI Boss deciding approval');
      return ['3 denials'];
    });
  } },
  { name: 'tasks cannot complete without evidence or self-QA', employee: 'AI_BOSS', level: 'REGRESSION', async run() {
    const s = emptyCompany(); const t = createTask(s, { title: 'x', type: 'X', agent: 'AI_DATA', createdBy: 'test', at: 't' });
    moveTask(s, t, 'IN_PROGRESS', 'test', 't');
    let blocked = false; try { moveTask(s, t, 'QA', 'test', 't'); } catch { blocked = true; } ok(blocked, 'QA without evidence must fail');
    let fake = false; try { addEvidence(s, t, { kind: 'tool_execution', ref: 'tex_does_not_exist', note: 'claimed' }); } catch { fake = true; } ok(fake, 'non-existent evidence must be rejected');
    const a = appendAudit(s, null, 't', { what: 'x' }); addEvidence(s, t, { kind: 'audit', ref: a.id, note: 'real' }); moveTask(s, t, 'QA', 'test', 't');
    let self = false; try { qaDecision(s, t, 'AI_DATA', true, 'self', 't', 'agent:ai-data'); } catch { self = true; } ok(self, 'self-QA must fail');
    qaDecision(s, t, 'AI_QA', true, 'ok', 't', 'agent:ai-qa'); ok(t.status === 'COMPLETED', 'completes with QA');
    let reopen = false; try { moveTask(s, t, 'IN_PROGRESS', 'test', 't'); } catch { reopen = true; } ok(reopen, 'completed is terminal');
    return ['4 guards'];
  } },

  // ------------------------------------------------------------------ DASHBOARD SPECIALIST
  { name: 'KPI calculations match hand-computed values', employee: 'AI_DASHBOARD', level: 'UNIT', async run() {
    const v = validateEmployeeMaster(SMALL_CSV); ok(v.ok && v.employees.length === 6, `validation ${JSON.stringify(v.issues)}`);
    const asOf = dataAsOf(v.employees); ok(asOf === '2025-06-30', `as-of ${asOf}`);
    const k = computeKpis(v.employees, asOf);
    for (const [key, want] of Object.entries(SMALL_EXPECTED)) ok((k as any)[key] === want, `${key}: got ${(k as any)[key]}, want ${want}`);
    return [JSON.stringify(k)];
  } },
  { name: 'data validation rejects unusable files', employee: 'AI_DASHBOARD', level: 'UNIT', async run() {
    ok(validateEmployeeMaster('employee_id,department,gender\nE1,Ops,M').missingColumns.join() === 'location,date_of_joining', 'missing columns');
    const dup = validateEmployeeMaster('employee_id,department,location,gender,date_of_joining\nE1,Ops,G,M,2024-01-01\nE1,Ops,G,M,2024-01-01');
    ok(dup.issues.some(i => /duplicate/.test(i.problem)), 'duplicate id');
    const bad = validateEmployeeMaster('employee_id,department,location,gender,date_of_joining\nE1,Ops,G,M,31/02/2024\nE2,Ops,G,M,2024-01-01');
    ok(!bad.ok && bad.issues[0].problem.includes('unreadable date'), 'impossible date');
    ok(!validateEmployeeMaster('employee_id,department,location,gender,date_of_joining,date_of_exit\nE1,Ops,G,M,2024-05-01,2024-01-01').ok, 'exit before joining');
    return ['4 rejections'];
  } },
  { name: 'build tools are registered only after passing self-tests', employee: 'AI_DASHBOARD', level: 'INTEGRATION', async run() {
    return withH({}, async h => {
      const s = await state(h);
      for (const n of ['csv.validate', 'dashboard.render', 'guide.render']) { const t = s.tools.find(x => x.name === n); ok(t?.status === 'ACTIVE' && t.lastTest?.passed, `${n} ${t?.status} ${t?.lastTest?.detail}`); }
      return s.tools.map(t => `${t.name}:${t.status}`);
    });
  } },
  { name: 'paid order → validated → built → QA → guide → delivered', employee: 'AI_DASHBOARD', level: 'FUNCTIONAL', async run() {
    return withH({}, async h => {
      const { cust, orderId } = await paidOrder(h);
      const r = await h.co.runOrderPipeline(orderId);
      ok(r.status === 'DELIVERED', `pipeline ended ${r.status}: ${r.log.join(' | ')}`);
      const s = await state(h); const o = s.orders.find(x => x.id === orderId)!;
      const tasks = s.tasks.filter(t => t.orderId === orderId);
      ok(tasks.length === 3 && tasks.every(t => t.status === 'COMPLETED' && t.evidence.length && t.qaBy === 'agent:ai-qa'), 'all 3 tasks completed with evidence and QA');
      const html = await h.co.deliverable(cust, orderId, 'dashboard'); const guide = await h.co.deliverable(cust, orderId, 'guide');
      ok(html.includes('id="f-department"') && guide.includes('<h2>Troubleshooting</h2>'), 'customer can download dashboard and guide');
      ok(s.emails.some(e => e.orderId === orderId && e.template === 'DASHBOARD_DELIVERED' && e.status === 'SENT'), 'delivery email recorded');
      return [orderId, o.deliverables.buildId!, ...tasks.map(t => t.id)];
    });
  } },
  { name: 'refuses to build an unpaid order', employee: 'AI_DASHBOARD', level: 'FAILURE', async run() {
    return withH({}, async h => {
      const c = await h.customer(); const pid = await h.activeProduct();
      const { order } = await h.co.createOrder(c, orderInput(pid)); await h.co.uploadFile(c, order.id, 'x.csv', generatedCsv());
      const r = await h.co.runOrderPipeline(order.id);
      ok(r.status === 'AWAITING_PAYMENT' && /blocked/.test(r.log[0]), `gate: ${r.status} ${r.log}`);
      const s = await state(h); ok(!s.tasks.some(t => t.orderId === order.id), 'no tasks for unpaid order');
      ok(s.audit.some(a => a.entityId === order.id && a.what === 'production.start' && a.result === 'DENIED'), 'denial audited');
      return [order.id];
    });
  } },
  { name: 'bad customer file → information required → corrected file → delivered', employee: 'AI_DASHBOARD', level: 'FAILURE', async run() {
    return withH({}, async h => {
      const { cust, orderId } = await paidOrder(h, 'employee_id,department,gender\nE1,Ops,M\n');
      const r1 = await h.co.runOrderPipeline(orderId);
      ok(r1.status === 'INFO_REQUIRED', `first run ${r1.status}`);
      let s = await state(h); ok(s.emails.some(e => e.orderId === orderId && e.template === 'INFORMATION_REQUIRED' && e.body.includes('location')), 'customer told which columns are missing');
      await h.co.uploadFile(cust, orderId, 'fixed.csv', generatedCsv());
      const r2 = await h.co.runOrderPipeline(orderId);
      ok(r2.status === 'DELIVERED', `after correction ${r2.status}: ${r2.log.join(' | ')}`);
      s = await state(h); return [orderId, s.orders.find(o => o.id === orderId)!.deliverables.buildId!];
    });
  } },
  { name: 'customers are isolated from each other', employee: 'AI_DASHBOARD', level: 'SECURITY', async run() {
    return withH({}, async h => {
      const a = await paidOrder(h); await h.co.runOrderPipeline(a.orderId);
      const b = await h.customer();
      await rejects(h.co.myOrder(b, a.orderId), 'NOT_FOUND', 'other customer order view');
      await rejects(h.co.deliverable(b, a.orderId, 'dashboard'), 'NOT_FOUND', 'other customer download');
      await rejects(h.co.uploadFile(b, a.orderId, 'x.csv', 'a,b'), 'NOT_FOUND', 'other customer upload');
      ok((await h.co.myOrders(b)).length === 0, 'B sees no orders');
      const s = await state(h); const qa = s.qaReports.find(q => q.orderId === a.orderId)!;
      ok(qa.checks.find(c => c.name === 'security.customer_isolation')?.passed, 'QA isolation check passed');
      return [a.orderId, qa.id];
    });
  } },
  { name: 'revision after delivery produces a new verified build', employee: 'AI_DASHBOARD', level: 'REGRESSION', async run() {
    return withH({}, async h => {
      const { cust, orderId } = await paidOrder(h); await h.co.runOrderPipeline(orderId);
      const first = (await state(h)).orders.find(o => o.id === orderId)!.deliverables.buildId;
      await h.co.uploadFile(cust, orderId, 'v2.csv', generatedCsv(180, 11));
      await h.co.requestRevision(cust, orderId, 'Please include the new joiners from September');
      const r = await h.co.runOrderPipeline(orderId);
      const s = await state(h); const o = s.orders.find(x => x.id === orderId)!;
      ok(r.status === 'DELIVERED' && o.deliverables.buildId !== first && o.revisionCount === 1, `revision ${r.status}`);
      ok(s.builds.find(b => b.id === o.deliverables.buildId)!.rowCount === 180, 'new build uses new file');
      return [first!, o.deliverables.buildId!];
    });
  } },

  // ------------------------------------------------------------------ QA OFFICER
  { name: 'QA recompute catches a falsified KPI', employee: 'AI_QA', level: 'UNIT', async run() {
    return withH({}, async h => {
      const s = await state(h); const t = s.tools.find(x => x.name === 'qa.dashboard')!;
      ok(t.status === 'ACTIVE' && t.lastTest?.passed, `qa.dashboard self-test: ${t.lastTest?.detail}`);
      return [`self-test ${t.lastTest!.at}`];
    });
  } },
  { name: 'QA tool is registered and permissioned only for AI_QA', employee: 'AI_QA', level: 'INTEGRATION', async run() {
    return withH({}, async h => {
      const s = await state(h); const t = s.tools.find(x => x.name === 'qa.dashboard')!;
      ok(JSON.stringify(t.permissions) === '["AI_QA"]', 'only AI_QA may run QA');
      await rejects(h.co.tx(st => h.co.tools.execute(st, 'AI_DASHBOARD', 'qa.dashboard', {}, { at: () => 't' })), 'FORBIDDEN', 'producer running QA tool');
      return ['permissions ok'];
    });
  } },
  { name: 'delivered orders carry a passing QA report with every check', employee: 'AI_QA', level: 'FUNCTIONAL', async run() {
    return withH({}, async h => {
      const { orderId } = await paidOrder(h); await h.co.runOrderPipeline(orderId);
      const s = await state(h); const q = s.qaReports.find(x => x.orderId === orderId)!;
      ok(q && q.passed && q.checks.length >= 30, `QA ${q?.passed} ${q?.checks.length}`);
      ok(q.checks.filter(c => c.name.startsWith('calc.')).length === 8, 'all KPI recomputes present');
      return [q.id, `${q.checks.length} checks`];
    });
  } },
  { name: 'QA fails a build with missing files and blocks delivery', employee: 'AI_QA', level: 'FAILURE', async run() {
    return withH({}, async h => {
      const { orderId } = await paidOrder(h); await h.co.runOrderPipeline(orderId);
      const s = await state(h); const b = s.builds.find(x => x.orderId === orderId)!; const p = s.products.find(x => x.id === b.productId)!;
      await rm(b.guidePath!);
      const rep = await runDashboardQA({ orderId, build: b, product: p, rawCsv: generatedCsv(), otherCustomersIds: [], at: 't' });
      ok(!rep.passed && rep.checks.some(c => c.name === 'delivery.guide_file' && !c.passed), 'missing guide detected');
      return [`${rep.checks.filter(c => !c.passed).length} failed checks`];
    });
  } },
  { name: 'QA detects another customer’s data in a dashboard', employee: 'AI_QA', level: 'SECURITY', async run() {
    return withH({}, async h => {
      const { orderId } = await paidOrder(h); await h.co.runOrderPipeline(orderId);
      const s = await state(h); const b = s.builds.find(x => x.orderId === orderId)!; const p = s.products.find(x => x.id === b.productId)!;
      const html = await readFile(b.dashboardPath, 'utf8'); await writeFile(b.dashboardPath, html.replace('</footer>', 'cus_intruder00001</footer>'));
      const rep = await runDashboardQA({ orderId, build: b, product: p, rawCsv: generatedCsv(), otherCustomersIds: ['cus_intruder00001'], at: 't' });
      ok(rep.checks.find(c => c.name === 'security.customer_isolation')?.passed === false, 'leak detected');
      return ['isolation failure detected'];
    });
  } },
  { name: 'an employee cannot QA its own work', employee: 'AI_QA', level: 'REGRESSION', async run() {
    const s = emptyCompany(); const t = createTask(s, { title: 'x', type: 'X', agent: 'AI_QA', createdBy: 't', at: 't' });
    moveTask(s, t, 'IN_PROGRESS', 't', 't'); addEvidence(s, t, { kind: 'audit', ref: appendAudit(s, null, 't', { what: 'x' }).id, note: '' }); moveTask(s, t, 'QA', 't', 't');
    let denied = false; try { qaDecision(s, t, 'AI_QA', true, 'self', 't', 'agent:ai-qa'); } catch { denied = true; }
    ok(denied, 'self-review denied'); return ['self-review denied'];
  } },

  // ------------------------------------------------------------------ FINANCE (payments)
  { name: 'checkout and webhook HMAC signatures verified per Razorpay spec', employee: 'AI_FINANCE', level: 'UNIT', async run() {
    const rp = new Razorpay({ keyId: 'rzp_test_x', keySecret: 'secret123', webhookSecret: 'wh456' });
    const sig = hmacHex('secret123', 'order_1|pay_1');
    ok(rp.verifyCheckoutSignature('order_1', 'pay_1', sig), 'valid checkout signature');
    ok(!rp.verifyCheckoutSignature('order_1', 'pay_2', sig), 'signature bound to payment id');
    ok(!rp.verifyCheckoutSignature('order_1', 'pay_1', sig.replace(/.$/, c => (c === '0' ? '1' : '0'))), 'tampered signature');
    const raw = Buffer.from('{"event":"payment.captured"}');
    ok(rp.verifyWebhook(raw, hmacHex('wh456', raw)), 'valid webhook');
    ok(!rp.verifyWebhook(Buffer.from('{"event":"payment.captured" }'), hmacHex('wh456', raw)), 'raw body must match byte-for-byte');
    ok(new Razorpay(null).configured === false, 'no keys → not configured');
    return ['6 signature cases'];
  } },
  { name: 'gateway order creation and payment fetch go through the REST API', employee: 'AI_FINANCE', level: 'INTEGRATION', async run() {
    return withH({}, async h => {
      const { orderId } = await paidOrder(h);
      ok(h.gw.calls.includes('POST /v1/orders') && h.gw.calls.some(c => c.startsWith('GET /v1/payments/pay_')), `calls ${h.gw.calls}`);
      const s = await state(h); const p = s.payments.find(x => x.orderId === orderId && x.verified)!;
      ok(p && p.evidence.startsWith('tool_execution:'), 'verification cites the fetch execution');
      return [p.id, p.evidence];
    });
  } },
  { name: 'verified checkout → PAID, receipt email, specialist tasks', employee: 'AI_FINANCE', level: 'FUNCTIONAL', async run() {
    return withH({}, async h => {
      const { orderId, confirm } = await paidOrder(h);
      ok((confirm as any).verified && confirm.status === 'PAID', `confirm ${JSON.stringify(confirm)}`);
      const s = await state(h);
      ok(s.emails.some(e => e.orderId === orderId && e.template === 'PAYMENT_SUCCESSFUL'), 'receipt email');
      ok(s.tasks.filter(t => t.orderId === orderId).length === 3, 'specialist tasks planned');
      return [orderId];
    });
  } },
  { name: 'failed payment → email → retry → paid; mismatches rejected', employee: 'AI_FINANCE', level: 'FAILURE', async run() {
    return withH({}, async h => {
      const c = await h.customer(); const pid = await h.activeProduct();
      const { order, checkout } = await h.co.createOrder(c, orderInput(pid));
      const failed = h.gw.pay((checkout as any).gatewayOrderId, { status: 'failed' });
      const wh = h.gw.webhook('payment.failed', failed.payment);
      await h.co.handleWebhook(wh.raw, wh.headers);
      let s = await state(h); ok(s.orders.find(o => o.id === order.id)!.status === 'PAYMENT_FAILED', 'PAYMENT_FAILED');
      ok(s.emails.some(e => e.orderId === order.id && e.template === 'PAYMENT_FAILED'), 'failure email');
      const retry = await h.co.retryPayment(c, order.id);
      const short = h.gw.pay((retry.checkout as any).gatewayOrderId, { amount: 100 });
      const r1 = await h.co.confirmCheckout(c, order.id, short);
      ok(!(r1 as any).verified && (r1 as any).problems.some((p: string) => /amount/.test(p)), 'underpayment rejected');
      const good = h.gw.pay((retry.checkout as any).gatewayOrderId);
      const r2 = await h.co.confirmCheckout(c, order.id, good);
      ok((r2 as any).verified && r2.status === 'PAID', `retry paid: ${JSON.stringify(r2)}`);
      await h.co.handleWebhook(h.gw.webhook('payment.captured', good.payment).raw, h.gw.webhook('payment.captured', good.payment).headers);
      s = await state(h); ok(s.payments.filter(p => p.orderId === order.id && p.verified).length >= 1, 'verified');
      return [order.id];
    });
  } },
  { name: 'payment claims: gateway decides; screenshots and unconfigured gateways never pay', employee: 'AI_FINANCE', level: 'FAILURE', async run() {
    const out: string[] = [];
    await withH({}, async h => {
      const c = await h.customer(); const pid = await h.activeProduct();
      const { order } = await h.co.createOrder(c, orderInput(pid));
      await rejects(h.co.claimPayment(c, order.id, { paymentId: 'pay_doesnotexist01' }), 'GATEWAY', 'unknown payment id');
      const { order: o2, checkout } = await h.co.createOrder(c, orderInput(pid));
      const p = h.gw.pay((checkout as any).gatewayOrderId);
      const r = await h.co.claimPayment(c, o2.id, { paymentId: p.razorpay_payment_id });
      ok(r.status === 'VERIFIED', `valid claim ${JSON.stringify(r)}`);
      const r2 = await h.co.claimPayment(c, order.id, { paymentId: p.razorpay_payment_id });
      ok(r2.status === 'REJECTED', 'payment for another order rejected');
      out.push(o2.id);
    });
    await withH({ gateway: false }, async h => {
      const c = await h.customer(); const pid = await h.activeProduct();
      const { order, checkout } = await h.co.createOrder(c, orderInput(pid));
      ok(checkout.status === 'NOT_CONFIGURED', 'checkout honestly NOT_CONFIGURED');
      const r = await h.co.claimPayment(c, order.id, { paymentId: 'pay_ABCDEFGHIJ1234' });
      ok(r.status === 'PENDING_GATEWAY', 'claim pending, not paid');
      const run = await h.co.runOrderPipeline(order.id); ok(run.status === 'PAYMENT_REVIEW', 'production still blocked');
      out.push(order.id);
    });
    return out;
  } },
  { name: 'forged signatures, forged webhooks, duplicates and reused payments are rejected', employee: 'AI_FINANCE', level: 'SECURITY', async run() {
    return withH({}, async h => {
      const c = await h.customer(); const pid = await h.activeProduct();
      const { order, checkout } = await h.co.createOrder(c, orderInput(pid));
      const p = h.gw.pay((checkout as any).gatewayOrderId);
      await rejects(h.co.confirmCheckout(c, order.id, { ...p, razorpay_signature: 'f'.repeat(64) }), 'VALIDATION', 'forged checkout signature');
      const wh = h.gw.webhook('payment.captured', p.payment);
      await rejects(h.co.handleWebhook(wh.raw, { ...wh.headers, 'x-razorpay-signature': 'bad' }), 'UNAUTHENTICATED', 'forged webhook');
      let s = await state(h); ok(s.orders.find(o => o.id === order.id)!.status === 'AWAITING_PAYMENT', 'still unpaid after forgeries');
      await h.co.handleWebhook(wh.raw, wh.headers);
      const dup = await h.co.handleWebhook(wh.raw, wh.headers);
      ok((dup as any).duplicate === true, 'duplicate event ignored');
      s = await state(h); ok(s.payments.filter(x => x.orderId === order.id && x.verified).length === 1, 'one verified payment');
      const { order: o2 } = await h.co.createOrder(c, orderInput(pid));
      const reuse = await h.co.claimPayment(c, o2.id, { paymentId: p.razorpay_payment_id });
      ok(reuse.status === 'REJECTED', 'payment reuse across orders rejected');
      return [order.id, o2.id];
    });
  } },
  { name: 'refund: yellow approval, rejection restores, approval refunds via gateway', employee: 'AI_FINANCE', level: 'REGRESSION', async run() {
    return withH({}, async h => {
      const { orderId } = await paidOrder(h);
      const ap = await h.co.requestRefund(h.founder, orderId, { reason: 'Customer cancelled within 24 hours' });
      ok(ap.tier === 'YELLOW', `tier ${ap.tier}`);
      await rejects(h.co.decideApproval(h.founder, ap.id, 'reject', ''), 'VALIDATION', 'rejection needs a reason');
      await h.co.decideApproval(h.founder, ap.id, 'reject', 'Work already started');
      let s = await state(h); ok(s.orders.find(o => o.id === orderId)!.status === 'PAID', 'restored to PAID');
      ok(h.gw.refunds.length === 0, 'no money moved on rejection');
      const ap2 = await h.co.requestRefund(h.founder, orderId, { reason: 'Founder goodwill refund' });
      await h.co.decideApproval(h.founder, ap2.id, 'approve', '');
      s = await state(h); ok(s.orders.find(o => o.id === orderId)!.status === 'REFUNDED' && h.gw.refunds.length === 1, 'refunded once via gateway');
      return [ap.id, ap2.id, h.gw.refunds[0].id];
    });
  } },

  // ------------------------------------------------------------------ FOUNDER OVERRIDE (Boss integration)
  { name: 'production override is RED, stays blocked when rejected, runs when approved', employee: 'AI_BOSS', level: 'REGRESSION', async run() {
    return withH({}, async h => {
      const c = await h.customer(); const pid = await h.activeProduct();
      const { order } = await h.co.createOrder(c, orderInput(pid)); await h.co.uploadFile(c, order.id, 'x.csv', generatedCsv());
      const ap = await h.co.requestProductionOverride(h.founder, order.id, 'Repeat customer; bank outage today');
      ok(ap.tier === 'RED', `tier ${ap.tier}`);
      ok((await h.co.runOrderPipeline(order.id)).status === 'AWAITING_PAYMENT', 'blocked while pending');
      await h.co.decideApproval(h.founder, ap.id, 'reject', 'Wait for payment');
      ok((await h.co.runOrderPipeline(order.id)).status === 'AWAITING_PAYMENT', 'blocked after rejection');
      const ap2 = await h.co.requestProductionOverride(h.founder, order.id, 'Founder call: proceed, invoice follows');
      await h.co.decideApproval(h.founder, ap2.id, 'approve', '');
      const r = await h.co.runOrderPipeline(order.id);
      ok(r.status === 'DELIVERED', `after override ${r.status}: ${r.log}`);
      const s = await state(h); ok(s.audit.some(a => a.what === 'override.recorded' && a.approvalId === ap2.id), 'override recorded in audit');
      return [ap.id, ap2.id];
    });
  } },

  // ------------------------------------------------------------------ SECURITY OFFICER
  { name: 'detects a tampered audit log', employee: 'AI_SECURITY', level: 'UNIT', async run() {
    const s = emptyCompany(); for (let i = 0; i < 5; i++) appendAudit(s, null, 't', { what: `e${i}` });
    ok(verifyAuditChain(s.audit).ok, 'intact');
    s.audit[2].detail = 'edited'; ok(!verifyAuditChain(s.audit).ok, 'edit detected'); s.audit[2].detail = '';
    const removed = [...s.audit.slice(0, 1), ...s.audit.slice(2)]; ok(!verifyAuditChain(removed).ok, 'deletion detected');
    return ['edit + deletion detected'];
  } },
  { name: 'security scan runs as a registered tool', employee: 'AI_SECURITY', level: 'INTEGRATION', async run() {
    return withH({}, async h => {
      const r = await h.co.tx(s => h.co.tools.execute<any[]>(s, 'AI_SECURITY', 'security.scan', s, { at: () => 't' }));
      ok(r.execution.status === 'OK' && r.output.length >= 10, 'scan executed');
      return [r.execution.id];
    });
  } },
  { name: 'scan reports every check with a result', employee: 'AI_SECURITY', level: 'FUNCTIONAL', async run() {
    return withH({}, async h => {
      const f = await h.co.read(s => h.co.securityFindings(s));
      const crit = f.filter(x => x.severity === 'CRITICAL' && !x.ok);
      ok(!crit.length, `critical findings: ${crit.map(c => c.check)}`);
      return f.map(x => `${x.check}:${x.ok}`);
    });
  } },
  { name: 'missing webhook secret is flagged and webhooks refused', employee: 'AI_SECURITY', level: 'FAILURE', async run() {
    return withH({ webhook: false }, async h => {
      const f = await h.co.read(s => h.co.securityFindings(s));
      ok(f.find(x => x.check === 'webhook_secret_configured')?.ok === false, 'flagged');
      await rejects(h.co.handleWebhook(Buffer.from('{}'), {}), 'NOT_CONFIGURED', 'webhook without secret');
      return ['flagged + refused'];
    });
  } },
  { name: 'least privilege, hashed credentials, no secrets at rest, no anonymous access', employee: 'AI_SECURITY', level: 'SECURITY', async run() {
    return withH({}, async h => {
      for (const p of ['order.view.all', 'order.data.read', 'payment.verify', 'approval.decide', 'audit.view', 'admin.view']) ok(!can('CUSTOMER', p), `customer has ${p}`);
      const s = await state(h);
      ok(s.users.every(u => u.passwordHash.startsWith('scrypt$')), 'scrypt');
      ok(!JSON.stringify(s).includes('founder-test-password-1') && !JSON.stringify(s).includes('customer-pass-123'), 'no plaintext passwords stored');
      ok(s.sessions.every(x => /^[0-9a-f]{64}$/.test(x.tokenHash)), 'session tokens hashed');
      await rejects(h.co.founderOverview(null, 0), 'UNAUTHENTICATED', 'anonymous admin');
      const c = await h.customer(); await rejects(h.co.founderOverview(c, 0), 'FORBIDDEN', 'customer admin');
      await rejects(h.co.login(`founder@test.local`, 'wrong-password-xx', 'ip'), 'UNAUTHENTICATED', 'wrong password');
      return ['ok'];
    });
  } },
  { name: 'login brute force is rate-limited', employee: 'AI_SECURITY', level: 'REGRESSION', async run() {
    return withH({}, async h => {
      let limited = false;
      for (let i = 0; i < 12; i++) { try { await h.co.login('founder@test.local', 'nope-nope-nope', 'attacker'); } catch (e) { if ((e as any).code === 'RATE_LIMITED') { limited = true; break; } } }
      ok(limited, 'rate limit triggered'); return ['limited'];
    });
  } },

  // ------------------------------------------------------------------ DATA ANALYST
  { name: 'metrics come only from records; profit is not invented', employee: 'AI_DATA', level: 'UNIT', async run() {
    return withH({}, async h => {
      const m0 = await h.co.read(s => h.co.metrics(s, 0));
      ok(m0.totals.revenue === 0 && m0.totals.conversionPct === null && m0.totals.profit === null, 'empty company shows zeros / null, not guesses');
      const { orderId } = await paidOrder(h);
      const m1 = await h.co.read(s => h.co.metrics(s, 0));
      ok(m1.totals.revenue === 14999 && m1.pipeline.paid === 1 && m1.totals.conversionPct === 100, `metrics ${JSON.stringify(m1.totals)}`);
      return [orderId];
    });
  } },
  { name: 'report objective produces a verified metrics snapshot', employee: 'AI_DATA', level: 'FUNCTIONAL', async run() {
    return withH({}, async h => {
      await paidOrder(h);
      const t = await h.co.submitObjective(h.founder, 'Give me the revenue report');
      ok(t.status === 'COMPLETED' && (t.outputs as any).report.totals.revenue === 14999, `report task ${t.status}`);
      return [t.id];
    });
  } },
  { name: 'refunds reduce revenue', employee: 'AI_DATA', level: 'REGRESSION', async run() {
    return withH({}, async h => {
      const { orderId } = await paidOrder(h);
      const ap = await h.co.requestRefund(h.founder, orderId, { reason: 'Duplicate order placed', amount: 5000 });
      await h.co.decideApproval(h.founder, ap.id, 'approve', '');
      const m = await h.co.read(s => h.co.metrics(s, 0));
      ok(m.totals.revenue === 9999 && m.totals.refunds === 5000, `revenue ${m.totals.revenue}`);
      return [orderId];
    });
  } },
];

export async function runScenarios(filter?: (s: Scenario) => boolean): Promise<TestResult[]> {
  const out: TestResult[] = [];
  for (const sc of SCENARIOS.filter(filter ?? (() => true))) {
    const t0 = Date.now();
    try { const ev = await sc.run(); out.push({ scenario: sc.name, employee: sc.employee, level: sc.level, passed: true, detail: 'passed', evidence: ev.slice(0, 10), durationMs: Date.now() - t0 }); }
    catch (e) { out.push({ scenario: sc.name, employee: sc.employee, level: sc.level, passed: false, detail: (e as Error).message.slice(0, 500), evidence: [], durationMs: Date.now() - t0 }); }
  }
  return out;
}
