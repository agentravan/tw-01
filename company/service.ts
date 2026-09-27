import { mkdir } from 'node:fs/promises';
import { defaultBlobStore, type BlobStore } from './blobs.js';
import { resolve } from 'node:path';
import { JsonStore } from '../memory/store.js';
import { emptyCompany, type Actor, type CompanyState, type Customer, type Order, type OrderStatus, type PaymentRecord, type Role, type StoredFile, type Task, type User } from './types.js';
import { CompanyError, clip, email as vEmail, fail, indianMobile, isoDate, money, sha256, str, systemClock, uid, type Clock } from './util.js';
import { actorLabel, can, require as requirePerm, requireOwner, AGENT_ROLES } from './rbac.js';
import { appendAudit, verifyAuditChain, type AuditInput } from './audit.js';
import { createSession, hashPassword, RateLimiter, resolveSession, revokeSession, validatePassword, verifyPassword } from './auth.js';
import { hasApproved, needsApproval, requestApproval, tierFor } from './approvals.js';
import { addEvidence, createTask, failTask, moveTask, qaDecision } from './tasks.js';
import { ToolRuntime } from './tools.js';
import { EMPLOYEES, certification } from './agents.js';
import { seedProducts } from './products.js';
import { Razorpay, type GatewayPayment } from './razorpay.js';
import { deliver, render as renderEmail, type Mailer } from './email.js';
import { validateEmployeeMaster, type ValidationResult } from './hr-data.js';
import { dataAsOf, type KpiSet } from './hr-kpi.js';
import { renderHrDashboard } from './dashboard-build.js';
import { renderGuide } from './guide.js';
import { runDashboardQA } from './qa.js';

export interface CompanyOptions { blobs?: BlobStore; store?: JsonStore; razorpay?: Razorpay; mailer: Mailer; clock?: Clock; dataDir?: string; supportEmail?: string; allowedOrigin?: string; env?: NodeJS.ProcessEnv; }
const agent = (role: Role): Actor => ({ kind: 'agent', id: role.toLowerCase().replace(/_/g, '-'), role });
const PAID_STATES: OrderStatus[] = ['PAID', 'IN_PRODUCTION', 'INFO_REQUIRED', 'QA', 'REVISION', 'DELIVERED', 'REFUND_REQUESTED'];
const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  AWAITING_PAYMENT: ['PAID', 'PAYMENT_FAILED', 'PAYMENT_REVIEW', 'IN_PRODUCTION', 'CANCELLED'], // IN_PRODUCTION only via Founder override
  PAYMENT_FAILED: ['AWAITING_PAYMENT', 'PAID', 'PAYMENT_REVIEW', 'IN_PRODUCTION', 'CANCELLED'],
  PAYMENT_REVIEW: ['PAID', 'AWAITING_PAYMENT', 'IN_PRODUCTION', 'CANCELLED'],
  PAID: ['IN_PRODUCTION', 'REFUND_REQUESTED'],
  IN_PRODUCTION: ['INFO_REQUIRED', 'QA', 'REFUND_REQUESTED'],
  INFO_REQUIRED: ['IN_PRODUCTION', 'REFUND_REQUESTED'],
  QA: ['DELIVERED', 'REVISION', 'REFUND_REQUESTED'],
  REVISION: ['QA', 'INFO_REQUIRED', 'IN_PRODUCTION', 'REFUND_REQUESTED'],
  DELIVERED: ['REVISION', 'REFUND_REQUESTED'],
  REFUND_REQUESTED: ['REFUNDED', 'PAID', 'IN_PRODUCTION', 'INFO_REQUIRED', 'QA', 'REVISION', 'DELIVERED'],
  REFUNDED: [], CANCELLED: [],
};
/** What customers see. Internal AI operations are never exposed. */
export const CUSTOMER_STATUS: Record<OrderStatus, string> = {
  AWAITING_PAYMENT: 'Waiting for payment', PAYMENT_FAILED: 'Payment failed — please retry', PAYMENT_REVIEW: 'Checking your payment',
  PAID: 'Paid — starting soon', IN_PRODUCTION: 'Being built', INFO_REQUIRED: 'We need a corrected file', QA: 'Quality check',
  REVISION: 'Revision in progress', DELIVERED: 'Delivered', REFUND_REQUESTED: 'Refund under review', REFUNDED: 'Refunded', CANCELLED: 'Cancelled',
};

export class Company {
  readonly store: JsonStore; readonly razorpay: Razorpay; readonly mailer: Mailer; readonly clock: Clock; readonly dataDir: string; readonly supportEmail: string; readonly allowedOrigin: string; readonly env: NodeJS.ProcessEnv;
  readonly tools = new ToolRuntime();
  readonly blobs: BlobStore;
  readonly loginLimiter = new RateLimiter(8, 10 * 60_000);
  /** Per-account limit, independent of the (spoofable) client IP. */
  readonly accountLimiter = new RateLimiter(20, 15 * 60_000);
  /** IPs that have signed in successfully per account (in memory). They bypass the per-account limit, so strangers cannot lock the owner out. */
  private knownIps = new Map<string, Set<string>>();
  readonly registerLimiter = new RateLimiter(5, 60 * 60_000);
  /** Each claim may call the Razorpay API; cap per customer to protect gateway quota. */
  readonly claimLimiter = new RateLimiter(10, 60 * 60_000);
  private initialized = false;

  constructor(o: CompanyOptions) {
    this.store = o.store ?? new JsonStore(); this.razorpay = o.razorpay ?? new Razorpay(null); this.mailer = o.mailer; this.clock = o.clock ?? systemClock;
    this.dataDir = resolve(o.dataDir ?? 'data'); this.blobs = o.blobs ?? defaultBlobStore(this.dataDir); this.supportEmail = o.supportEmail ?? 'support@teamworksolutions.in'; this.allowedOrigin = o.allowedOrigin ?? ''; this.env = o.env ?? process.env;
  }
  now() { return this.clock.now().toISOString(); }
  /** Serialized transaction over the company state. Throws roll back automatically (state is not saved). */
  tx<T>(fn: (s: CompanyState) => T | Promise<T>): Promise<T> { return this.store.transact(async st => fn(st.company)); }
  read<T>(fn: (s: CompanyState) => T): Promise<T> { return this.store.read(st => fn(st.company)); }
  private audit(s: CompanyState, actor: Actor | null, input: AuditInput) { return appendAudit(s, actor, this.now(), input); }

  /** Records a denied/failed attempt in its own transaction, so rejections are auditable even though the command rolled back. */
  async recordDenied(actor: Actor | null, what: string, err: unknown, entityId: string | null = null) {
    const e = err as CompanyError;
    if (!(e instanceof CompanyError) || !['FORBIDDEN', 'BAD_STATE', 'APPROVAL_REQUIRED', 'PAUSED', 'UNAUTHENTICATED', 'GATEWAY', 'NOT_CONFIGURED', 'CONFLICT'].includes(e.code)) return;
    await this.tx(s => { this.audit(s, actor, { what, result: 'DENIED', detail: `[${e.code}] ${e.message}`, entityId }); });
  }

  // ---------------------------------------------------------------- bootstrap
  async init() {
    if (this.initialized) return;
    if (this.blobs.kind === 'fs') await mkdir(this.dataDir, { recursive: true });
    await this.tx(async s => {
      if (!s.products.length) { s.products = seedProducts(); this.audit(s, agent('AI_BOSS'), { what: 'products.seeded', detail: `${s.products.length} products, all inactive until the Founder sets prices` }); }
      const fe = this.env.FOUNDER_EMAIL, fp = this.env.FOUNDER_PASSWORD;
      if (!s.users.some(u => u.role === 'FOUNDER') && fe && fp) {
        validatePassword(fp);
        s.users.push({ id: uid('usr'), email: vEmail(fe), name: 'HARSHIT', role: 'FOUNDER', passwordHash: hashPassword(fp), customerId: null, createdAt: this.now(), disabled: false });
        this.audit(s, null, { what: 'founder.bootstrapped', why: 'FOUNDER_EMAIL/FOUNDER_PASSWORD present and no founder account existed', detail: vEmail(fe) });
      }
      await this.registerTools(s);
    });
    this.initialized = true;
  }

  private async registerTools(s: CompanyState) {
    const at = this.now();
    const sampleCsv = 'employee_id,department,location,gender,date_of_joining,date_of_exit\nE1,Ops,Gurugram,F,2024-01-10,\nE2,Ops,Gurugram,M,2023-05-01,2025-06-30\nE3,HR,Noida,M,2025-03-01,';
    const defs: Parameters<ToolRuntime['register']>[1][] = [
      { def: { name: 'csv.validate', purpose: 'Validate an employee master file', permissions: ['AI_DASHBOARD', 'AI_QA'], input: 'CSV text', output: 'ValidationResult', risk: 'GREEN', approval: 'NONE', timeoutMs: 20_000, retry: 0, version: '1.0.0' },
        run: (csv: string) => validateEmployeeMaster(csv),
        selfTest: () => { const r = validateEmployeeMaster(sampleCsv); if (!r.ok || r.employees.length !== 3) return 'sample file should validate with 3 rows'; const bad = validateEmployeeMaster('employee_id,gender\nE1,M'); return bad.ok || !bad.missingColumns.includes('department') ? 'missing columns not detected' : null; } },
      { def: { name: 'dashboard.render', purpose: 'Render an HR dashboard from validated employees', permissions: ['AI_DASHBOARD'], input: 'employees + as-of', output: 'HTML + KPIs', risk: 'GREEN', approval: 'NONE', timeoutMs: 30_000, retry: 1, version: '1.0.0' },
        run: (i: Parameters<typeof renderHrDashboard>[0]) => renderHrDashboard(i),
        selfTest: () => { const emps = validateEmployeeMaster(sampleCsv).employees; const r = renderHrDashboard({ buildId: 'selftest', productName: 'T', company: 'T', employees: emps, asOf: dataAsOf(emps), kpiKeys: ['headcount', 'exits_12m', 'attrition_pct_12m'] }); return r.kpis.headcount === 2 && r.kpis.exits_12m === 1 && r.html.includes('id="f-department"') ? null : `unexpected self-test output ${JSON.stringify(r.kpis)}`; } },
      { def: { name: 'guide.render', purpose: 'Render the guide book for a build', permissions: ['AI_DASHBOARD', 'AI_DOCS'], input: 'build facts', output: 'HTML', risk: 'GREEN', approval: 'NONE', timeoutMs: 10_000, retry: 1, version: '1.0.0' },
        run: (i: Parameters<typeof renderGuide>[0]) => renderGuide(i),
        selfTest: () => { const g = renderGuide({ buildId: 'b', productName: 'P', company: 'C', asOf: '2025-01-01', kpis: { headcount: 1 } as KpiSet, kpiKeys: ['headcount'], filters: { department: ['A'] }, rowCount: 1, supportEmail: 'x@y.z', orderId: 'o' }); return ['Purpose', 'Troubleshooting', 'Support'].every(h => g.includes(`<h2>${h}</h2>`)) ? null : 'guide sections missing'; } },
      { def: { name: 'qa.dashboard', purpose: 'Independent dashboard QA', permissions: ['AI_QA'], input: 'build + raw file', output: 'QA report', risk: 'GREEN', approval: 'NONE', timeoutMs: 30_000, retry: 0, version: '1.0.0' },
        run: (i: Parameters<typeof runDashboardQA>[0]) => runDashboardQA(i),
        selfTest: () => this.qaSelfTest(sampleCsv) },
      { def: { name: 'razorpay.fetch_payment', purpose: 'Fetch a payment from Razorpay to verify it', permissions: ['AI_FINANCE'], input: 'payment id', output: 'gateway payment', risk: 'GREEN', approval: 'NONE', timeoutMs: 12_000, retry: 1, version: '1.0.0' },
        run: (id: string) => this.razorpay.fetchPayment(id),
        selfTest: () => { try { this.razorpay.fetchPayment('not-a-payment-id'); return 'invalid id accepted'; } catch (e) { return (e as CompanyError).code === 'VALIDATION' || (e as CompanyError).code === 'NOT_CONFIGURED' ? null : `unexpected ${(e as Error).message}`; } } },
      { def: { name: 'razorpay.refund', purpose: 'Refund a captured payment (needs Founder approval)', permissions: ['AI_FINANCE'], input: 'payment id + amount', output: 'gateway refund', risk: 'YELLOW', approval: 'FOUNDER', timeoutMs: 12_000, retry: 0, version: '1.0.0' },
        run: (i: { paymentId: string; amountPaise: number; receipt: string }) => this.razorpay.refund(i.paymentId, i.amountPaise, i.receipt),
        selfTest: () => { try { this.razorpay.refund('pay_x', 5, 'r'); return 'sub-rupee refund accepted'; } catch (e) { return (e as CompanyError).code === 'VALIDATION' ? null : `unexpected ${(e as Error).message}`; } } },
      { def: { name: 'email.send', purpose: 'Send a templated email (records NOT_CONFIGURED when SMTP is absent)', permissions: ['AI_BOSS', 'AI_SUPPORT', 'AI_FINANCE', 'AI_DASHBOARD', 'AI_ORDER'], input: 'template + vars', output: 'Email record', risk: 'GREEN', approval: 'NONE', timeoutMs: 20_000, retry: 1, version: '1.0.0' },
        run: (i: { template: string; to: string; vars: Record<string, string | number>; orderId: string | null }) => deliver(this.mailer, i.template, i.to, i.vars, i.orderId, this.now()),
        selfTest: () => { const r = renderEmail('PAYMENT_FAILED', { name: 'A', orderId: 'ORD-1', reason: 'x' }); return /\{\{/.test(r.subject + r.body) || !r.body.includes('ORD-1') ? 'template placeholders not filled' : null; } },
      { def: { name: 'security.scan', purpose: 'Security checks over state and configuration', permissions: ['AI_SECURITY'], input: 'state', output: 'findings', risk: 'GREEN', approval: 'NONE', timeoutMs: 20_000, retry: 0, version: '1.0.0' },
        run: (st: CompanyState) => this.securityFindings(st),
        selfTest: () => { const st = emptyCompany(); const clean = this.securityFindings(st).find(f => f.check === 'audit_chain_intact'); appendAudit(st, null, 't', { what: 'x' }); appendAudit(st, null, 't', { what: 'y' }); st.audit[0].detail = 'tampered'; const dirty = this.securityFindings(st).find(f => f.check === 'audit_chain_intact'); return clean?.ok && dirty && !dirty.ok ? null : 'tamper not detected'; } },
    ];
    for (const d of defs) await this.tools.register(s, d, at);
  }

  /** QA tool self-test: a correct build must pass and a build with a falsified KPI must fail. */
  private async qaSelfTest(csv: string): Promise<string | null> {
    const mem = new Map<string, string>(); const read = async (k: string) => mem.get(k) ?? null;
    {
      const emps = validateEmployeeMaster(csv).employees; const asOf = dataAsOf(emps); const kpiKeys = ['headcount', 'exits_12m', 'attrition_pct_12m'] as (keyof KpiSet)[];
      const product = { ...seedProducts()[0], kpis: kpiKeys as string[] };
      const r = renderHrDashboard({ buildId: 'bld_selftest', productName: 'T', company: 'T', employees: emps, asOf, kpiKeys });
      const g = renderGuide({ buildId: 'bld_selftest', productName: 'T', company: 'T', asOf, kpis: r.kpis, kpiKeys, filters: r.filters, rowCount: emps.length, supportEmail: 'a@b.c', orderId: 'ORD-0' });
      const dp = 'selftest/d.html', gp = 'selftest/g.html'; mem.set(dp, r.html); mem.set(gp, g);
      const build = { id: 'bld_selftest', orderId: 'ORD-0', productId: product.id, at: 't', kpis: r.kpis as any, rowCount: emps.length, asOf, filters: r.filters, dashboardPath: dp, guidePath: gp, dataSha256: '' };
      const good = await runDashboardQA({ orderId: 'ORD-0', build, product, rawCsv: csv, otherCustomersIds: ['cus_other'], at: 't', read });
      if (!good.passed) return `correct build failed QA: ${good.checks.filter(c => !c.passed).map(c => c.name).join(', ')}`;
      mem.set(dp, r.html.replace(`"headcount":${r.kpis.headcount}`, `"headcount":${r.kpis.headcount + 7}`));
      const bad = await runDashboardQA({ orderId: 'ORD-0', build, product, rawCsv: csv, otherCustomersIds: [], at: 't', read });
      return bad.passed ? 'falsified KPI was not detected' : null;
    }
  }

  // ---------------------------------------------------------------- auth
  async actorFromToken(token: string | null): Promise<Actor | null> { return this.read(s => resolveSession(s, token, this.clock.now())); }

  async registerCustomer(input: any, ip: string) {
    this.registerLimiter.check(ip);
    const em = vEmail(input.email); const pw = validatePassword(input.password);
    const c: Customer = { id: uid('cus'), name: str(input.name, 'name', { max: 120 }), company: str(input.company, 'company', { max: 160 }), email: em, mobile: indianMobile(input.mobile), createdAt: this.now() };
    const hash = hashPassword(pw);
    return this.tx(s => {
      if (s.users.some(u => u.email === em)) fail('CONFLICT', 'An account with this email already exists. Sign in instead.');
      s.customers.push(c);
      const u: User = { id: uid('usr'), email: em, name: c.name, role: 'CUSTOMER', passwordHash: hash, customerId: c.id, createdAt: this.now(), disabled: false };
      s.users.push(u);
      this.audit(s, { kind: 'user', id: u.id, role: 'CUSTOMER', customerId: c.id }, { what: 'customer.registered', entity: 'customer', entityId: c.id });
      return { token: createSession(s, u, this.clock.now()), user: { id: u.id, name: u.name, role: u.role } };
    });
  }
  async login(emailIn: unknown, password: unknown, ip: string) {
    const em = vEmail(emailIn); if (!this.knownIps.get(em)?.has(ip)) this.accountLimiter.check(em); this.loginLimiter.check(`${ip}|${em}`);
    return this.tx(s => {
      const u = s.users.find(x => x.email === em && !x.disabled);
      // Always run scrypt so response time does not reveal whether the email exists.
      const ok = verifyPassword(String(password ?? ''), u?.passwordHash ?? hashPassword('dummy-password-for-timing'));
      if (!u || !ok) { this.audit(s, null, { what: 'auth.login', result: 'DENIED', detail: `failed login for ${em}` }); fail('UNAUTHENTICATED', 'Email or password is incorrect.'); }
      this.loginLimiter.reset(`${ip}|${em}`); this.knownIps.set(em, new Set([...(this.knownIps.get(em) ?? []), ip].slice(-20)));
      this.audit(s, { kind: 'user', id: u!.id, role: u!.role }, { what: 'auth.login' });
      return { token: createSession(s, u!, this.clock.now()), user: { id: u!.id, name: u!.name, role: u!.role } };
    });
  }
  async logout(token: string) { await this.tx(s => revokeSession(s, token)); }
  /** Change your own password. Signs out every other session of that account. */
  async changePassword(actor: Actor | null, current: unknown, next: unknown, keepToken: string) {
    if (!actor || actor.kind !== 'user') return fail('UNAUTHENTICATED', 'Sign in first.');
    const pw = validatePassword(next);
    const hash = hashPassword(pw);
    return this.tx(s => {
      const u = s.users.find(x => x.id === actor.id)!;
      if (!verifyPassword(String(current ?? ''), u.passwordHash)) { this.audit(s, actor, { what: 'auth.password_change', result: 'DENIED', detail: 'current password wrong' }); fail('UNAUTHENTICATED', 'Current password is incorrect.'); }
      if (verifyPassword(pw, u.passwordHash)) fail('VALIDATION', 'Choose a password different from the current one.');
      u.passwordHash = hash;
      const keep = sha256(keepToken);
      s.sessions = s.sessions.filter(x => x.userId !== u.id || x.tokenHash === keep);
      this.audit(s, actor, { what: 'auth.password_changed', entity: 'user', entityId: u.id, detail: 'other sessions signed out' });
      return { ok: true };
    });
  }

  // ---------------------------------------------------------------- products
  async listProducts(actor: Actor | null) {
    return this.read(s => (actor && can(actor.role, 'product.configure') ? s.products : s.products.filter(p => p.active && p.price != null)).map(p => ({ ...p })));
  }
  async configureProduct(actor: Actor | null, id: string, patch: { price?: unknown; active?: unknown; slaDays?: unknown }) {
    requirePerm(actor, 'product.configure');
    return this.tx(s => {
      const p = s.products.find(x => x.id === id) ?? fail('NOT_FOUND', 'Product not found.');
      const before = { price: p!.price, active: p!.active, slaDays: p!.slaDays };
      if (patch.price !== undefined) p!.price = money(patch.price, 'price');
      if (patch.slaDays !== undefined) { const n = Number(patch.slaDays); if (!Number.isInteger(n) || n < 1 || n > 60) fail('VALIDATION', 'SLA must be 1–60 days.'); p!.slaDays = n; }
      if (patch.active !== undefined) {
        const on = patch.active === true || patch.active === 'true';
        if (on && !p!.builder) fail('BAD_STATE', `${p!.name} has no build engine yet, so it cannot be sold. The AI Operator must build one first.`);
        if (on && p!.price == null) fail('BAD_STATE', 'Set a price before activating the product.');
        p!.active = on;
      }
      this.audit(s, actor, { what: 'product.configured', entity: 'product', entityId: p!.id, detail: `${JSON.stringify(before)} → ${JSON.stringify({ price: p!.price, active: p!.active, slaDays: p!.slaDays })}` });
      return { ...p! };
    });
  }

  // ---------------------------------------------------------------- orders
  private setStatus(s: CompanyState, o: Order, to: OrderStatus, by: Actor | null, note: string) {
    if (!ORDER_TRANSITIONS[o.status].includes(to)) fail('BAD_STATE', `Order ${o.id} cannot go from ${o.status} to ${to}.`);
    if (to === 'IN_PRODUCTION' && !['PAID', 'INFO_REQUIRED', 'REVISION', 'REFUND_REQUESTED'].includes(o.status)) {
      // Leaving an unpaid state straight into production requires the Founder's recorded override.
      if (!hasApproved(s, o.productionOverrideApprovalId, 'production.override', o.id)) fail('BAD_STATE', 'Production is blocked: payment is not verified and no Founder override is approved for this order.');
    }
    if (to === 'IN_PRODUCTION' && o.status === 'PAID' && !this.productionGate(s, o).ok) fail('BAD_STATE', this.productionGate(s, o).reason);
    const from = o.status; o.status = to; o.updatedAt = this.now();
    o.timeline.push({ at: this.now(), from, to, by: actorLabel(by), note });
    this.audit(s, by, { what: 'order.status', entity: 'order', entityId: o.id, detail: `${from} → ${to}${note ? ' — ' + note : ''}` });
  }
  /** THE production gate: gateway-verified payment for this order, or an approved Founder override for this order. */
  productionGate(s: CompanyState, o: Order): { ok: boolean; basis: 'payment' | 'override' | null; reason: string } {
    const pay = s.payments.find(p => p.orderId === o.id && p.verified);
    if (o.paymentVerified && pay) return { ok: true, basis: 'payment', reason: `payment ${pay.razorpay_payment_id} verified with the gateway` };
    if (hasApproved(s, o.productionOverrideApprovalId, 'production.override', o.id)) return { ok: true, basis: 'override', reason: `Founder override ${o.productionOverrideApprovalId}` };
    return { ok: false, basis: null, reason: 'Production is blocked: payment is not verified and no Founder override is approved for this order.' };
  }
  private getOrder(s: CompanyState, actor: Actor, id: string): Order {
    const o = s.orders.find(x => x.id === id);
    if (!o) return fail('NOT_FOUND', 'Order not found.');
    requireOwner(actor, o.customerId);
    return o;
  }
  private customerOf(s: CompanyState, o: Order) { return s.customers.find(c => c.id === o.customerId)!; }
  private async email(s: CompanyState, from: Role, template: string, o: Order, vars: Record<string, string | number> = {}) {
    const c = this.customerOf(s, o);
    const { execution, output } = await this.tools.execute(s, from, 'email.send', { template, to: c.email, orderId: o.id, vars: { name: c.name, orderId: o.id, product: o.productName, amount: o.amount.toLocaleString('en-IN'), ...vars } }, { at: () => this.now() });
    s.emails.push(output); if (s.emails.length > 5000) s.emails.splice(0, s.emails.length - 5000);
    this.audit(s, agent(from), { what: `email.${template}`, tool: 'email.send', entity: 'order', entityId: o.id, result: output.status === 'FAILED' ? 'FAILED' : 'OK', detail: `${output.status} → ${c.email} (execution ${execution.id})` });
    return output;
  }

  async createOrder(actor: Actor | null, input: any) {
    const a = requirePerm(actor, 'order.create');
    const productId = str(input.productId, 'productId', { max: 60 });
    const requirement = {
      company: str(input.company, 'company', { max: 160 }),
      employeeCount: String((() => { const n = Number(input.employeeCount); if (!Number.isInteger(n) || n < 1 || n > 1_000_000) fail('VALIDATION', 'employeeCount must be a whole number of employees.'); return n; })()),
      dataSource: str(input.dataSource, 'dataSource', { max: 300 }),
      requiredFormat: str(input.requiredFormat, 'requiredFormat', { optional: true, max: 60 }) || 'HTML dashboard',
      deadline: isoDate(input.deadline, 'deadline'),
      additional: str(input.additional, 'additional', { optional: true, max: 2000 }),
    };
    if (requirement.deadline < this.now().slice(0, 10)) fail('VALIDATION', 'deadline cannot be in the past.');
    return this.tx(async s => {
      const p = s.products.find(x => x.id === productId);
      if (!p || !p.active || p.price == null) fail('VALIDATION', 'That product is not available.');
      const o: Order = {
        id: `ORD-${(s.orders.length + 1001)}`, customerId: (a as any).customerId, productId: p!.id, productName: p!.name, amount: p!.price!, currency: 'INR', status: 'AWAITING_PAYMENT',
        requirement, files: [], gatewayOrderId: null, paymentVerified: false, paymentId: null, productionOverrideApprovalId: null, revisionCount: 0, revisionNotes: [],
        deliverables: { dashboard: null, guide: null, buildId: null }, timeline: [{ at: this.now(), from: null, to: 'AWAITING_PAYMENT', by: actorLabel(a), note: 'order submitted' }], createdAt: this.now(), updatedAt: this.now(),
      };
      s.orders.push(o);
      this.audit(s, a, { what: 'order.created', entity: 'order', entityId: o.id, detail: `${p!.name} ₹${o.amount}` });
      const checkout = await this.openGatewayOrder(s, o);
      await this.email(s, 'AI_BOSS', 'ORDER_RECEIVED', o);
      return { order: this.customerView(s, o), checkout };
    });
  }
  private async openGatewayOrder(s: CompanyState, o: Order) {
    if (!this.razorpay.configured) {
      this.audit(s, agent('AI_FINANCE'), { what: 'gateway.order', entity: 'order', entityId: o.id, result: 'FAILED', detail: 'Razorpay NOT_CONFIGURED; order stays unpaid' });
      return { status: 'NOT_CONFIGURED' as const, message: 'Online payment is not configured yet. The order is saved and will stay unpaid.' };
    }
    const g = await this.razorpay.createOrder(Math.round(o.amount * 100), o.id, { tw01_order_id: o.id });
    o.gatewayOrderId = g.id; o.gatewayOrderIds = [...(o.gatewayOrderIds ?? []), g.id];
    this.audit(s, agent('AI_FINANCE'), { what: 'gateway.order', entity: 'order', entityId: o.id, detail: `razorpay order ${g.id} (${g.amount} paise)` });
    return { status: 'READY' as const, keyId: this.razorpay.keyId, gatewayOrderId: g.id, amountPaise: g.amount, currency: 'INR', mode: this.razorpay.mode };
  }

  async uploadFile(actor: Actor | null, orderId: string, name: unknown, content: unknown) {
    const a = requirePerm(actor, 'order.upload.own');
    const fname = str(name, 'file name', { max: 120 });
    if (!/\.csv$/i.test(fname)) fail('VALIDATION', 'Upload the employee master as a .csv file.');
    const text = typeof content === 'string' ? content : fail('VALIDATION', 'File content is required.');
    const bytes = Buffer.byteLength(text!, 'utf8');
    if (bytes === 0 || bytes > 5 * 1024 * 1024) fail('VALIDATION', 'File must be between 1 byte and 5 MB.');
    if (/\u0000/.test(text!)) fail('VALIDATION', 'That is not a text CSV file.');
    return this.tx(async s => {
      const o = this.getOrder(s, a, orderId);
      if (['REFUNDED', 'CANCELLED', 'REFUND_REQUESTED'].includes(o.status)) fail('BAD_STATE', 'This order no longer accepts files.');
      const id = uid('fil');
      const path = `uploads/${o.id}/${id}.csv`; // server-chosen key: no path traversal via the client file name
      await this.blobs.put(path, text!);
      const f: StoredFile = { id, name: fname.replace(/[^\w.\- ]/g, '_'), path, bytes, sha256: sha256(text!), uploadedAt: this.now() };
      o.files.push(f);
      this.audit(s, a, { what: 'order.file_uploaded', entity: 'order', entityId: o.id, detail: `${f.name} ${bytes} bytes sha256 ${f.sha256.slice(0, 12)}` });
      // A corrected file un-blocks an INFO_REQUIRED order.
      if (o.status === 'INFO_REQUIRED') {
        this.setStatus(s, o, 'IN_PRODUCTION', agent('AI_BOSS'), 'customer uploaded a corrected file');
        for (const t of s.tasks.filter(t => t.orderId === o.id && t.status === 'WAITING')) moveTask(s, t, 'ASSIGNED', 'agent:ai-boss', this.now(), 'new file received');
      }
      return { id: f.id, name: f.name, bytes };
    });
  }

  /** Checkout success callback: signature must be valid AND the gateway must report the payment captured for this order and amount. */
  async confirmCheckout(actor: Actor | null, orderId: string, body: any) {
    const a = requirePerm(actor, 'payment.confirm.own');
    const rpOrder = str(body.razorpay_order_id, 'razorpay_order_id', { max: 60 }); const rpPay = str(body.razorpay_payment_id, 'razorpay_payment_id', { max: 60 }); const sig = str(body.razorpay_signature, 'razorpay_signature', { max: 200 });
    if (!this.razorpay.configured) fail('NOT_CONFIGURED', 'Online payment is not configured.');
    return this.tx(async s => {
      const o = this.getOrder(s, a, orderId);
      const mine = new Set([...(o.gatewayOrderIds ?? []), ...(o.gatewayOrderId ? [o.gatewayOrderId] : [])]);
      const sigOk = mine.has(rpOrder) && this.razorpay.verifyCheckoutSignature(rpOrder, rpPay, sig);
      if (o.paymentVerified) { if (sigOk && rpPay !== o.paymentId) this.flagDuplicatePayment(s, o, rpPay, null, 'checkout'); return { status: o.status, alreadyPaid: true, verified: rpPay === o.paymentId }; }
      if (!sigOk) {
        s.payments.push(this.payRec(o, 'CHECKOUT', rpOrder, rpPay, false, null, null, null, false, 'signature invalid or order mismatch'));
        this.audit(s, agent('AI_FINANCE'), { what: 'payment.checkout', entity: 'order', entityId: o.id, result: 'DENIED', detail: 'signature invalid or order mismatch' });
        return fail('VALIDATION', 'Payment could not be verified (signature mismatch). You have not been marked as paid.');
      }
      return this.verifyWithGateway(s, o, rpPay, 'CHECKOUT', true);
    });
  }
  private payRec(o: Order, source: PaymentRecord['source'], rpOrder: string | null, rpPay: string | null, sig: boolean | null, status: string | null, amount: number | null, method: string | null, verified: boolean, failure: string | null, evidence = ''): PaymentRecord {
    return { id: uid('pay'), orderId: o.id, source, razorpay_order_id: rpOrder, razorpay_payment_id: rpPay, signatureValid: sig, gatewayStatus: status, amountPaise: amount, method, verified, failureReason: failure, at: this.now(), evidence };
  }
  /** Fetches the payment from Razorpay and marks the order PAID only when captured, same order, same amount. */
  private async verifyWithGateway(s: CompanyState, o: Order, paymentId: string, source: PaymentRecord['source'], sig: boolean | null) {
    const fin = agent('AI_FINANCE');
    let gp: GatewayPayment; let execId: string;
    try { const r = await this.tools.execute<GatewayPayment>(s, 'AI_FINANCE', 'razorpay.fetch_payment', paymentId, { at: () => this.now() }); gp = r.output; execId = r.execution.id; }
    catch (e) { this.audit(s, fin, { what: 'payment.verify', entity: 'order', entityId: o.id, result: 'FAILED', detail: (e as Error).message }); throw e; }
    const expected = Math.round(o.amount * 100);
    const problems: string[] = [];
    if (gp.status !== 'captured') problems.push(`gateway status is ${gp.status}`);
    const binding = this.bindingProblem(s, o, gp.order_id, gp.id, gp.notes);
    if (binding) problems.push(binding);
    if (gp.amount !== expected) problems.push(`amount ${gp.amount} paise ≠ expected ${expected}`);
    if (gp.currency !== 'INR') problems.push(`currency ${gp.currency}`);
    const verified = problems.length === 0;
    const rec = this.payRec(o, source, gp.order_id, gp.id, sig, gp.status, gp.amount, gp.method, verified, verified ? null : problems.join('; ') + (gp.error_description ? ` (${gp.error_description})` : ''), `tool_execution:${execId}`);
    s.payments.push(rec);
    this.audit(s, fin, { what: 'payment.verify', tool: 'razorpay.fetch_payment', entity: 'order', entityId: o.id, result: verified ? 'OK' : 'DENIED', detail: verified ? `${gp.id} captured ₹${gp.amount / 100} via ${gp.method}` : problems.join('; ') });
    if (verified) await this.markPaid(s, o, rec);
    else if (gp.status === 'failed' && ['AWAITING_PAYMENT', 'PAYMENT_REVIEW'].includes(o.status)) { this.setStatus(s, o, 'PAYMENT_FAILED', fin, gp.error_description ?? 'payment failed'); await this.email(s, 'AI_FINANCE', 'PAYMENT_FAILED', o, { reason: gp.error_description ?? 'payment failed' }); }
    return { status: o.status, verified, problems };
  }
  /**
   * A payment belongs to an order only if Razorpay says it was made against one of the gateway orders
   * TW-01 opened for that order (or carries this order's id in its notes), and no other order already used it.
   */
  private bindingProblem(s: CompanyState, o: Order, gatewayOrderId: string | null, paymentId: string, notes?: Record<string, string>): string | null {
    const mine = new Set([...(o.gatewayOrderIds ?? []), ...(o.gatewayOrderId ? [o.gatewayOrderId] : [])]);
    const bound = (gatewayOrderId && mine.has(gatewayOrderId)) || notes?.tw01_order_id === o.id;
    if (!bound) return 'payment was not made for this order';
    if (s.payments.some(p => p.verified && p.razorpay_payment_id === paymentId && p.orderId !== o.id)) return 'payment already used for another order';
    return null;
  }
  /** A second captured payment on an order that is already paid: record it and escalate a refund review (once per payment). */
  private flagDuplicatePayment(s: CompanyState, o: Order, paymentId: string, amountPaise: number | null, source: string) {
    if (!paymentId || paymentId === o.paymentId) return;
    if (s.tasks.some(t => t.type === 'DUPLICATE_PAYMENT' && t.inputs.paymentId === paymentId)) return;
    const t = createTask(s, { title: `Duplicate payment ${paymentId} on ${o.id}: refund review needed`, type: 'DUPLICATE_PAYMENT', agent: 'AI_FINANCE', priority: 'HIGH', orderId: o.id, inputs: { paymentId, amountPaise, source, orderPaymentId: o.paymentId }, createdBy: 'agent:ai-finance', at: this.now(), maxRetries: 0 });
    moveTask(s, t, 'WAITING', 'agent:ai-finance', this.now(), 'customer paid twice');
    moveTask(s, t, 'ESCALATED', 'agent:ai-finance', this.now(), 'Founder decision: refund the extra payment (refunds need approval)');
    this.audit(s, agent('AI_FINANCE'), { what: 'payment.duplicate', entity: 'order', entityId: o.id, taskId: t.id, result: 'FAILED', detail: `${paymentId} (${source}) arrived after ${o.paymentId}; escalated ${t.id}` });
  }
  private async markPaid(s: CompanyState, o: Order, rec: PaymentRecord) {
    o.paymentVerified = true; o.paymentId = rec.razorpay_payment_id;
    if (['AWAITING_PAYMENT', 'PAYMENT_FAILED', 'PAYMENT_REVIEW'].includes(o.status)) {
      this.setStatus(s, o, 'PAID', agent('AI_FINANCE'), `payment ${rec.razorpay_payment_id} verified (${rec.source})`);
      this.planOrderTasks(s, o);
    } else {
      // Work already started under a Founder override: record the payment without rewinding the order.
      this.audit(s, agent('AI_FINANCE'), { what: 'payment.received_after_override', entity: 'order', entityId: o.id, detail: `payment ${rec.razorpay_payment_id} verified while order is ${o.status}` });
    }
    await this.email(s, 'AI_FINANCE', 'PAYMENT_SUCCESSFUL', o, { paymentId: rec.razorpay_payment_id ?? '' });
  }

  /** Razorpay webhook. Trust comes only from the HMAC over the raw body; duplicates are ignored by event id. */
  async handleWebhook(raw: Buffer, headers: Record<string, string | string[] | undefined>) {
    const sig = String(headers['x-razorpay-signature'] ?? ''); const eventId = String(headers['x-razorpay-event-id'] ?? '');
    const gw: Actor = { kind: 'gateway', id: 'razorpay', role: 'AI_FINANCE' };
    const valid = this.razorpay.verifyWebhook(raw, sig); // throws NOT_CONFIGURED without secret
    return this.tx(async s => {
      if (!valid) { this.audit(s, gw, { what: 'webhook.rejected', result: 'DENIED', detail: 'invalid X-Razorpay-Signature' }); return fail('UNAUTHENTICATED', 'invalid signature'); }
      let body: any; try { body = JSON.parse(raw.toString('utf8')); } catch { return fail('VALIDATION', 'invalid JSON'); }
      const id = eventId || `${body.event}:${body.payload?.payment?.entity?.id ?? ''}:${body.created_at ?? ''}`;
      // The event-id header is not signed, so also dedupe on the signed content (event + payment id).
      const contentKey = `${body.event}:${body.payload?.payment?.entity?.id ?? ''}`;
      if (s.webhookEvents.some(e => e.processed && (e.eventId === id || e.note.startsWith(`key=${contentKey};`)))) { return { duplicate: true }; }
      const ev = { eventId: id, event: String(body.event), receivedAt: this.now(), signatureValid: true, processed: false, note: `key=${contentKey};` };
      s.webhookEvents.push(ev);
      const p = body.payload?.payment?.entity;
      const orderRef = p?.notes?.tw01_order_id as string | undefined;
      const o = s.orders.find(x => (p?.order_id && (x.gatewayOrderId === p.order_id || (x.gatewayOrderIds ?? []).includes(p.order_id))) || (orderRef && x.id === orderRef));
      if (!o) { ev.note += ' no matching order'; ev.processed = true; this.audit(s, gw, { what: `webhook.${ev.event}`, detail: 'no matching order' }); return { ok: true, matched: false }; }
      if (body.event === 'payment.captured' && o.paymentVerified && p?.id && p.id !== o.paymentId && !this.bindingProblem(s, o, p.order_id ?? null, p.id, p.notes)) {
        this.flagDuplicatePayment(s, o, p.id, p.amount ?? null, 'webhook');
      } else if (body.event === 'payment.captured' && !o.paymentVerified) {
        // Webhook body is authenticated by HMAC; still confirm amount/order before marking paid.
        const expected = Math.round(o.amount * 100); const problems: string[] = [];
        if (p.amount !== expected) problems.push(`amount ${p.amount} ≠ ${expected}`);
        const binding = this.bindingProblem(s, o, p.order_id ?? null, p.id, p.notes);
        if (binding) problems.push(binding);
        if (p.currency !== 'INR') problems.push(`currency ${p.currency}`);
        const rec = this.payRec(o, 'WEBHOOK', p.order_id ?? null, p.id, true, 'captured', p.amount, p.method ?? null, problems.length === 0, problems.join('; ') || null, `webhook:${id}`);
        s.payments.push(rec);
        this.audit(s, gw, { what: 'webhook.payment.captured', entity: 'order', entityId: o.id, result: problems.length ? 'DENIED' : 'OK', detail: problems.join('; ') || p.id });
        if (!problems.length && !['REFUNDED', 'CANCELLED', 'REFUND_REQUESTED'].includes(o.status)) await this.markPaid(s, o, rec);
      } else if (body.event === 'payment.failed' && !o.paymentVerified && o.status === 'AWAITING_PAYMENT' && p.order_id === o.gatewayOrderId) {
        s.payments.push(this.payRec(o, 'WEBHOOK', p.order_id ?? null, p.id, true, 'failed', p.amount, p.method ?? null, false, p.error_description ?? 'failed', `webhook:${id}`));
        this.setStatus(s, o, 'PAYMENT_FAILED', gw, p.error_description ?? 'payment failed');
        await this.email(s, 'AI_FINANCE', 'PAYMENT_FAILED', o, { reason: p.error_description ?? 'payment failed' });
      } else this.audit(s, gw, { what: `webhook.${ev.event}`, entity: 'order', entityId: o.id, detail: 'recorded; no state change' });
      ev.processed = true;
      return { ok: true, matched: true, status: o.status, orderId: o.id };
    });
  }

  async retryPayment(actor: Actor | null, orderId: string) {
    const a = requirePerm(actor, 'payment.confirm.own');
    return this.tx(async s => {
      const o = this.getOrder(s, a, orderId);
      if (!['PAYMENT_FAILED', 'AWAITING_PAYMENT', 'PAYMENT_REVIEW'].includes(o.status) || o.paymentVerified) fail('BAD_STATE', 'This order does not need a payment.');
      if (o.status !== 'AWAITING_PAYMENT') this.setStatus(s, o, 'AWAITING_PAYMENT', a, 'customer retrying payment');
      return { checkout: await this.openGatewayOrder(s, o) };
    });
  }

  /** Customer says they paid. Only the gateway decides; a screenshot is stored for the record but never marks an order paid. */
  async claimPayment(actor: Actor | null, orderId: string, input: any) {
    const a = requirePerm(actor, 'payment.claim.own');
    const paymentId = str(input.paymentId, 'paymentId', { max: 60 });
    this.claimLimiter.check(a.id);
    return this.tx(async s => {
      const o = this.getOrder(s, a, orderId);
      if (o.paymentVerified) {
        if (paymentId !== o.paymentId && this.razorpay.configured) { const r = await this.tools.execute<GatewayPayment>(s, 'AI_FINANCE', 'razorpay.fetch_payment', paymentId, { at: () => this.now() }); if (r.output.status === 'captured' && !this.bindingProblem(s, o, r.output.order_id, r.output.id, r.output.notes)) this.flagDuplicatePayment(s, o, r.output.id, r.output.amount, 'claim'); }
        return { status: 'VERIFIED', note: 'This order is already paid.' };
      }
      if (['REFUNDED', 'CANCELLED', 'REFUND_REQUESTED'].includes(o.status)) fail('BAD_STATE', 'This order does not need a payment.');
      const claim = { id: uid('clm'), orderId: o.id, customerId: o.customerId, paymentId, screenshot: null, status: 'PENDING_GATEWAY' as 'PENDING_GATEWAY' | 'VERIFIED' | 'REJECTED', note: '', at: this.now() };
      s.claims.push(claim);
      if (!this.razorpay.configured) {
        claim.note = 'Gateway not configured; cannot verify. Production stays blocked.';
        if (o.status !== 'PAYMENT_REVIEW') this.setStatus(s, o, 'PAYMENT_REVIEW', a, 'payment claim awaiting gateway verification');
        this.audit(s, agent('AI_FINANCE'), { what: 'payment.claim', entity: 'order', entityId: o.id, result: 'FAILED', detail: claim.note });
        return { status: claim.status, note: claim.note };
      }
      const r = await this.verifyWithGateway(s, o, paymentId, 'CLAIM', null);
      claim.status = r.verified ? 'VERIFIED' : 'REJECTED'; claim.note = r.verified ? 'Confirmed with Razorpay.' : r.problems.join('; ');
      if (!r.verified) await this.email(s, 'AI_FINANCE', 'PAYMENT_PROOF_REQUIRED', o, { paymentId, reason: claim.note });
      return { status: claim.status, note: claim.note };
    });
  }

  // ---------------------------------------------------------------- approvals & overrides
  async requestProductionOverride(actor: Actor | null, orderId: string, reason: unknown) {
    const a = requirePerm(actor, 'production.override.request');
    const why = str(reason, 'reason', { min: 10, max: 500 });
    return this.tx(s => {
      const o = this.getOrder(s, a, orderId);
      if (o.paymentVerified) fail('BAD_STATE', 'Payment is already verified; no override needed.');
      if (!['AWAITING_PAYMENT', 'PAYMENT_FAILED', 'PAYMENT_REVIEW'].includes(o.status)) fail('BAD_STATE', 'Override applies only to unpaid orders.');
      const ap = requestApproval(s, { action: 'production.override', entity: 'order', entityId: o.id, reason: 'Starting production without verified payment breaks the payment rule; only the Founder may allow it.', summary: `Start production on ${o.id} (₹${o.amount}) before payment is verified. Justification: ${why}`, requestedBy: actorLabel(a), at: this.now() });
      this.audit(s, a, { what: 'approval.requested', entity: 'order', entityId: o.id, approvalId: ap.id, detail: `RED production.override: ${why}` });
      return ap;
    });
  }
  async requestRefund(actor: Actor | null, orderId: string, input: any) {
    const a = requirePerm(actor, 'refund.request');
    const reason = str(input.reason, 'reason', { min: 5, max: 500 });
    return this.tx(s => {
      const o = this.getOrder(s, a, orderId);
      if (!o.paymentVerified || !o.paymentId) fail('BAD_STATE', 'Nothing to refund: payment was never verified.');
      if (!ORDER_TRANSITIONS[o.status].includes('REFUND_REQUESTED')) fail('BAD_STATE', `A refund cannot be requested while the order is ${o.status}.`);
      const amount = input.amount == null ? o.amount : money(input.amount, 'amount');
      if (amount > o.amount) fail('VALIDATION', 'Refund cannot exceed the amount paid.');
      const prev = o.status;
      if (!needsApproval(s, 'refund', { amount })) fail('BAD_STATE', 'Auto-refund below threshold is not enabled in this version.');
      const ap = requestApproval(s, { action: 'refund', entity: 'order', entityId: o.id, amount, reason: tierFor(s, 'refund', { amount }) === 'RED' ? `Large payment reversal (≥ ₹${s.settings.largePaymentRedThreshold}).` : 'Refunds need Founder approval.', summary: `Refund ₹${amount} of ${o.id} to ${this.customerOf(s, o).company}. Reason: ${reason}`, payload: { amount, previousStatus: prev }, requestedBy: actorLabel(a), at: this.now() });
      this.setStatus(s, o, 'REFUND_REQUESTED', a, `refund ₹${amount} awaiting Founder (${ap.id})`);
      for (const t of s.tasks.filter(t => t.orderId === o.id && ['ASSIGNED', 'IN_PROGRESS'].includes(t.status))) moveTask(s, t, 'WAITING', 'agent:ai-boss', this.now(), 'paused: refund pending');
      return ap;
    });
  }
  async decideApproval(actor: Actor | null, id: string, decision: unknown, reason: unknown) {
    const a = requirePerm(actor, 'approval.decide');
    if (a.kind !== 'user') fail('FORBIDDEN', 'Only a signed-in Founder can decide approvals.');
    return this.tx(async s => {
      const ap = s.approvals.find(x => x.id === id) ?? fail('NOT_FOUND', 'Approval not found.');
      if (ap!.status !== 'PENDING') fail('BAD_STATE', `Approval is already ${ap!.status}.`);
      ap!.decidedBy = actorLabel(a); ap!.decidedAt = this.now();
      if (decision === 'approve') {
        ap!.status = 'APPROVED';
        this.audit(s, a, { what: 'approval.approved', entity: ap!.entity, entityId: ap!.entityId, approvalId: ap!.id, detail: `${ap!.tier} ${ap!.action}` });
        await this.applyApproval(s, ap!);
      } else if (decision === 'reject') {
        ap!.status = 'REJECTED'; ap!.rejectionReason = str(reason, 'rejection reason', { min: 3, max: 500 });
        this.audit(s, a, { what: 'approval.rejected', entity: ap!.entity, entityId: ap!.entityId, approvalId: ap!.id, detail: `${ap!.action} stays blocked: ${ap!.rejectionReason}` });
        if (ap!.action === 'refund') { const o = s.orders.find(x => x.id === ap!.entityId)!; this.setStatus(s, o, ap!.payload.previousStatus as OrderStatus, a, `refund rejected: ${ap!.rejectionReason}`); for (const t of s.tasks.filter(t => t.orderId === o.id && t.status === 'WAITING')) moveTask(s, t, 'ASSIGNED', 'agent:ai-boss', this.now(), 'refund rejected; work resumes'); }
      } else fail('VALIDATION', 'decision must be approve or reject');
      return { ...ap! };
    });
  }
  private async applyApproval(s: CompanyState, ap: CompanyState['approvals'][number]) {
    const o = s.orders.find(x => x.id === ap.entityId);
    if (ap.action === 'production.override' && o) {
      o.productionOverrideApprovalId = ap.id;
      this.audit(s, agent('AI_BOSS'), { what: 'override.recorded', entity: 'order', entityId: o.id, approvalId: ap.id, detail: 'Founder override recorded; production may start without verified payment' });
      this.planOrderTasks(s, o);
    }
    if (ap.action === 'refund' && o) {
      const amount = Number(ap.payload.amount);
      const { output, execution } = await this.tools.execute<any>(s, 'AI_FINANCE', 'razorpay.refund', { paymentId: o.paymentId!, amountPaise: Math.round(amount * 100), receipt: `${o.id}-refund` }, { at: () => this.now() });
      this.setStatus(s, o, 'REFUNDED', agent('AI_FINANCE'), `refund ${output.id} (${output.status}) via execution ${execution.id}`);
      for (const t of s.tasks.filter(t => t.orderId === o.id && !['COMPLETED', 'CANCELLED'].includes(t.status))) { if (t.status === 'WAITING' || t.status === 'ASSIGNED' || t.status === 'ESCALATED') moveTask(s, t, 'CANCELLED', 'agent:ai-boss', this.now(), 'order refunded'); }
      await this.email(s, 'AI_FINANCE', 'REFUND_STARTED', o, { amount: amount.toLocaleString('en-IN') });
    }
  }

  // ---------------------------------------------------------------- AI Boss: task planning & the dashboard pipeline
  /** Creates the Specialist's tasks for a paid (or Founder-overridden) order. Idempotent. */
  private planOrderTasks(s: CompanyState, o: Order) {
    if (s.tasks.some(t => t.orderId === o.id && t.inputs.round === o.revisionCount && !['CANCELLED'].includes(t.status))) return;
    const by = 'agent:ai-boss'; const at = this.now(); const round = o.revisionCount;
    const t1 = createTask(s, { title: `Validate customer data for ${o.id}`, type: 'DATA_VALIDATION', agent: 'AI_DASHBOARD', priority: 'HIGH', orderId: o.id, inputs: { round }, createdBy: by, at });
    const t2 = createTask(s, { title: `Build ${o.productName} + guide for ${o.id}`, type: 'DASHBOARD_BUILD', agent: 'AI_DASHBOARD', priority: 'HIGH', orderId: o.id, inputs: { round }, dependencies: [t1.id], createdBy: by, at });
    createTask(s, { title: `Deliver ${o.id} to customer`, type: 'DELIVERY', agent: 'AI_DASHBOARD', priority: 'HIGH', orderId: o.id, inputs: { round }, dependencies: [t2.id], createdBy: by, at });
    this.audit(s, agent('AI_BOSS'), { what: 'tasks.planned', entity: 'order', entityId: o.id, detail: `3 tasks for round ${round}` });
  }

  /**
   * Runs the order pipeline as far as it can go: production gate → data validation → build → independent QA → delivery.
   * Each step records tool executions as evidence; each task completes only through a QA decision by AI_QA.
   */
  async runOrderPipeline(orderId: string, trigger: Actor = agent('AI_BOSS')) {
    return this.tx(async s => {
      const o = s.orders.find(x => x.id === orderId) ?? fail('NOT_FOUND', 'Order not found.');
      const order = o!; const log: string[] = [];
      if (['REFUND_REQUESTED', 'REFUNDED', 'CANCELLED', 'DELIVERED'].includes(order.status)) return { status: order.status, log: [`nothing to do (${order.status})`] };
      if (s.pausedAgents.includes('AI_DASHBOARD')) return { status: order.status, log: ['AI_DASHBOARD is paused by the Founder'] };
      if (['AWAITING_PAYMENT', 'PAYMENT_FAILED', 'PAYMENT_REVIEW', 'PAID'].includes(order.status)) {
        const gate = this.productionGate(s, order);
        if (!gate.ok) { this.audit(s, trigger, { what: 'production.start', entity: 'order', entityId: order.id, result: 'DENIED', detail: gate.reason }); return { status: order.status, log: [gate.reason] }; }
        this.planOrderTasks(s, order);
        this.setStatus(s, order, 'IN_PRODUCTION', agent('AI_DASHBOARD'), gate.basis === 'override' ? `started under Founder override ${order.productionOverrideApprovalId}` : 'started — payment verified');
        await this.email(s, 'AI_DASHBOARD', 'PRODUCTION_STARTED', order);
        log.push('production started');
      }
      const tasks = () => s.tasks.filter(t => t.orderId === order.id && t.inputs.round === order.revisionCount).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.type.localeCompare(b.type));
      const byType = (ty: string) => tasks().find(t => t.type === ty)!;
      for (const ty of ['DATA_VALIDATION', 'DASHBOARD_BUILD', 'DELIVERY']) {
        const t = byType(ty);
        if (!t || t.status === 'COMPLETED') continue;
        if (!['ASSIGNED', 'IN_PROGRESS'].includes(t.status)) { log.push(`${ty}: ${t.status}`); break; }
        const ok = await this.workTask(s, order, t, log);
        if (!ok) break;
      }
      return { status: order.status, log };
    });
  }

  private latestFile(o: Order) { return o.files.at(-1) ?? null; }

  private async workTask(s: CompanyState, o: Order, t: Task, log: string[]): Promise<boolean> {
    const at = () => this.now(); const me = 'agent:ai-dashboard'; const qa = 'agent:ai-qa';
    if (t.status === 'ASSIGNED') moveTask(s, t, 'IN_PROGRESS', me, at());
    try {
      if (t.type === 'DATA_VALIDATION') {
        const f = this.latestFile(o);
        if (!f) return this.needInfo(s, o, t, ['No employee master file has been uploaded yet.'], log);
        const csv = (await this.blobs.get(f.path)) ?? '';
        if (sha256(csv) !== f.sha256) throw new Error(`stored file ${f.id} is missing or does not match its recorded hash`);
        const { execution, output } = await this.tools.execute<ValidationResult>(s, 'AI_DASHBOARD', 'csv.validate', csv, { taskId: t.id, at });
        if (!output.ok) {
          const issues = output.missingColumns.length ? [`Missing required columns: ${output.missingColumns.join(', ')}`] : output.issues.slice(0, 10).map(i => `Row ${i.row}, ${i.column}: ${i.problem}`);
          return this.needInfo(s, o, t, issues, log);
        }
        t.outputs = { fileId: f.id, validRows: output.employees.length, rejectedRows: output.issues.length };
        addEvidence(s, t, { kind: 'tool_execution', ref: execution.id, note: `${output.employees.length} valid rows, ${output.issues.length} rejected` });
        moveTask(s, t, 'QA', me, at());
        // QA: re-run validation independently on the same bytes; must agree and be usable.
        const again = validateEmployeeMaster(csv);
        qaDecision(s, t, 'AI_QA', again.ok && again.employees.length === output.employees.length, `independent re-validation: ${again.employees.length} rows`, at(), qa);
        if (t.status !== 'COMPLETED') { failTask(s, t, 'independent re-validation disagreed with the producer', me, at()); log.push('validation QA failed'); return false; }
        log.push(`validated ${output.employees.length} rows`);
        return true;
      }
      if (t.type === 'DASHBOARD_BUILD') {
        const p = s.products.find(x => x.id === o.productId)!;
        if (p.builder !== 'hr_employee_master') throw Object.assign(new Error(`no build engine for ${p.name}`), { noRetry: true });
        // Build from exactly the file that passed validation (not whatever was uploaded last), and re-check its integrity.
        const vt = s.tasks.find(x => x.id === t.dependencies[0]);
        const f = o.files.find(x => x.id === vt?.outputs.fileId);
        if (!f) throw Object.assign(new Error('validated file not found'), { noRetry: true });
        const csv = (await this.blobs.get(f.path)) ?? '';
        if (sha256(csv) !== f.sha256) throw Object.assign(new Error(`stored file ${f.id} is missing or does not match its recorded hash`), { noRetry: true });
        const v = await this.tools.execute<ValidationResult>(s, 'AI_DASHBOARD', 'csv.validate', csv, { taskId: t.id, at });
        if (!v.output.ok) throw Object.assign(new Error('validated file no longer validates'), { noRetry: true });
        const emps = v.output.employees; const asOf = dataAsOf(emps); const buildId = uid('bld');
        const c = this.customerOf(s, o);
        const r = await this.tools.execute<ReturnType<typeof renderHrDashboard>>(s, 'AI_DASHBOARD', 'dashboard.render', { buildId, productName: p.name, company: c.company, employees: emps, asOf, kpiKeys: p.kpis as (keyof KpiSet)[] }, { taskId: t.id, at });
        const g = await this.tools.execute<string>(s, 'AI_DASHBOARD', 'guide.render', { buildId, productName: p.name, company: c.company, asOf, kpis: r.output.kpis, kpiKeys: p.kpis as (keyof KpiSet)[], filters: r.output.filters, rowCount: emps.length, supportEmail: this.supportEmail, orderId: o.id }, { taskId: t.id, at });
        const dashboardPath = `deliverables/${o.id}/${buildId}/dashboard.html`; const guidePath = `deliverables/${o.id}/${buildId}/guide.html`;
        await this.blobs.put(dashboardPath, r.output.html); await this.blobs.put(guidePath, g.output);
        const build = { id: buildId, orderId: o.id, productId: p.id, at: at(), kpis: r.output.kpis as unknown as Record<string, number>, rowCount: emps.length, asOf, filters: r.output.filters, dashboardPath, guidePath, dataSha256: f.sha256 };
        s.builds.push(build);
        for (const e of [v.execution, r.execution, g.execution]) addEvidence(s, t, { kind: 'tool_execution', ref: e.id, note: e.tool });
        addEvidence(s, t, { kind: 'file', ref: buildId, note: 'dashboard.html + guide.html' });
        moveTask(s, t, 'QA', me, at());
        if (o.status === 'IN_PRODUCTION' || o.status === 'REVISION') this.setStatus(s, o, 'QA', agent('AI_DASHBOARD'), `build ${buildId} submitted to QA`);
        // Independent QA by AI_QA.
        const others = s.customers.filter(x => x.id !== o.customerId).flatMap(x => [x.id, x.email]).concat(s.orders.filter(x => x.customerId !== o.customerId).map(x => x.id));
        const q = await this.tools.execute<Awaited<ReturnType<typeof runDashboardQA>>>(s, 'AI_QA', 'qa.dashboard', { orderId: o.id, build, product: p, rawCsv: csv, otherCustomersIds: others, at: at(), read: (k: string) => this.blobs.get(k) }, { taskId: t.id, at });
        s.qaReports.push(q.output);
        addEvidence(s, t, { kind: 'file', ref: q.output.id, note: `QA report ${q.output.passed ? 'passed' : 'failed'}` });
        const failed = q.output.checks.filter(c => !c.passed);
        this.audit(s, agent('AI_QA'), { what: 'qa.dashboard', tool: 'qa.dashboard', taskId: t.id, entity: 'order', entityId: o.id, result: q.output.passed ? 'OK' : 'FAILED', detail: q.output.passed ? `${q.output.checks.length} checks passed` : failed.map(c => `${c.name}: ${c.detail}`).join('; ') });
        qaDecision(s, t, 'AI_QA', q.output.passed, q.output.passed ? `${q.output.checks.length}/${q.output.checks.length} checks` : failed.map(c => c.name).join(', '), at(), qa);
        if (!q.output.passed) {
          this.setStatus(s, o, 'REVISION', agent('AI_QA'), `QA failed: ${failed.map(c => c.name).join(', ')}`);
          const res = failTask(s, t, `QA failed: ${failed.map(c => c.name).join(', ')}`, me, at());
          log.push(`QA failed (${failed.length} checks); ${res === 'RETRY' ? 'will rebuild' : 'escalated to Founder'}`);
          return false;
        }
        o.deliverables = { dashboard: dashboardPath, guide: guidePath, buildId };
        await this.email(s, 'AI_DASHBOARD', 'DASHBOARD_READY', o);
        log.push(`built ${buildId}; QA passed ${q.output.checks.length} checks`);
        return true;
      }
      if (t.type === 'DELIVERY') {
        if (!o.deliverables.buildId) throw new Error('no QA-passed build to deliver');
        const qaOk = s.qaReports.some(r => r.buildId === o.deliverables.buildId && r.passed);
        if (!qaOk) throw Object.assign(new Error('build has no passing QA report'), { noRetry: true });
        const files = await Promise.all([o.deliverables.dashboard!, o.deliverables.guide!].map(p => this.blobs.get(p).then(b => !!b && b.length > 0, () => false)));
        if (!files.every(Boolean)) throw new Error('deliverable files missing');
        // Files are now downloadable from the portal: that is the delivery.
        this.setStatus(s, o, 'DELIVERED', agent('AI_DASHBOARD'), `build ${o.deliverables.buildId} available in the customer portal`);
        const mail = await this.email(s, 'AI_DASHBOARD', 'DASHBOARD_DELIVERED', o);
        addEvidence(s, t, { kind: 'file', ref: o.deliverables.buildId, note: 'delivered build' });
        if (mail.status !== 'SENT') {
          // The task claims "customer notified". Without a sent email that claim would be false: escalate instead.
          t.maxRetries = 0;
          failTask(s, t, `customer not notified: delivery email ${mail.status}${mail.error ? ' (' + mail.error + ')' : ''}; files are in the portal, notify the customer manually`, me, at());
          log.push(`delivered to portal; customer NOT notified (email ${mail.status}) → escalated`);
          return true;
        }
        addEvidence(s, t, { kind: 'email', ref: mail.id, note: 'delivery email SENT' });
        moveTask(s, t, 'QA', me, at());
        qaDecision(s, t, 'AI_QA', true, 'deliverable files exist and delivery email was sent', at(), qa);
        log.push('delivered');
        return true;
      }
      throw new Error(`unknown task type ${t.type}`);
    } catch (e) {
      const msg = (e as Error).message;
      if (e instanceof CompanyError && ['FORBIDDEN', 'PAUSED'].includes(e.code)) throw e;
      if (t.status === 'IN_PROGRESS' || t.status === 'QA') { const res = failTask(s, t, clip(msg, 300), me, at()); log.push(`${t.type} failed: ${msg} → ${res}`); }
      this.audit(s, agent('AI_DASHBOARD'), { what: `task.${t.type}`, taskId: t.id, entity: 'order', entityId: o.id, result: 'FAILED', detail: clip(msg, 300) });
      return false;
    }
  }
  private async needInfo(s: CompanyState, o: Order, t: Task, issues: string[], log: string[]) {
    moveTask(s, t, 'WAITING', 'agent:ai-dashboard', this.now(), `information required: ${clip(issues.join('; '), 200)}`);
    if (o.status !== 'INFO_REQUIRED') this.setStatus(s, o, 'INFO_REQUIRED', agent('AI_DASHBOARD'), clip(issues.join('; '), 200));
    await this.email(s, 'AI_DASHBOARD', 'INFORMATION_REQUIRED', o, { issues: issues.map(i => '- ' + i).join('\n') });
    log.push(`information required: ${issues.join('; ')}`);
    return false;
  }

  async requestRevision(actor: Actor | null, orderId: string, note: unknown) {
    const a = requirePerm(actor, 'revision.request.own');
    const n = str(note, 'revision note', { min: 5, max: 1000 });
    return this.tx(async s => {
      const o = this.getOrder(s, a, orderId);
      if (o.status !== 'DELIVERED') fail('BAD_STATE', 'Revisions can be requested after delivery.');
      o.revisionCount++; o.revisionNotes.push(n); o.deliverables = { dashboard: o.deliverables.dashboard, guide: o.deliverables.guide, buildId: o.deliverables.buildId };
      this.setStatus(s, o, 'REVISION', a, `revision ${o.revisionCount}: ${clip(n, 120)}`);
      this.planOrderTasks(s, o);
      await this.email(s, 'AI_BOSS', 'REVISION_REQUESTED', o);
      return this.customerView(s, o);
    });
  }

  // ---------------------------------------------------------------- AI Boss: founder objectives
  static readonly ROUTES: { re: RegExp; role: Role; type: string }[] = [
    { re: /\b(security|audit log|vulnerab|scan)\b/i, role: 'AI_SECURITY', type: 'SECURITY_SCAN' },
    { re: /\b(certif|self-?test|test (the )?(employees|workforce)|run tests?)\b/i, role: 'AI_QA', type: 'CERTIFICATION_RUN' },
    { re: /\bORD-\d+\b/, role: 'AI_DASHBOARD', type: 'ORDER_PIPELINE' },
    { re: /\b(report|kpi|metrics?|revenue|summary)\b/i, role: 'AI_DATA', type: 'METRICS_REPORT' },
    { re: /\b(lead|prospect|outreach|sales)\b/i, role: 'AI_SALES', type: 'SALES' },
    { re: /\b(seo|linkedin|content|campaign|marketing)\b/i, role: 'AI_MARKETING', type: 'MARKETING' },
    { re: /\b(payroll|pf|esic|lwf|tds|compliance|recruit)/i, role: 'AI_HR', type: 'HR_SERVICE' },
    { re: /\b(dropship|supplier|shipping|cod)\b/i, role: 'AI_ORDER', type: 'DROPSHIP' },
    { re: /\b(build|create|automate|integrat)\w*\b.*\b(tool|api|website|integration|automation|portal)\b/i, role: 'AI_OPERATOR', type: 'CAPABILITY_BUILD' },
    { re: /\b(customer|ticket|complain|support)\b/i, role: 'AI_SUPPORT', type: 'SUPPORT' },
    { re: /\b(research|documentation|compare)\b/i, role: 'AI_RESEARCHER', type: 'RESEARCH' },
  ];
  /** Deterministic routing (no model call). Unknown or unbuilt capabilities are escalated, never faked. */
  async submitObjective(actor: Actor | null, text: unknown, runCertification?: () => Promise<{ runId: string; passed: number; failed: number }>) {
    const a = requirePerm(actor, 'objective.submit');
    const objective = str(text, 'objective', { min: 5, max: 1000 });
    const route = Company.ROUTES.find(r => r.re.test(objective));
    const boss = 'agent:ai-boss';
    // Plan in one transaction
    const { taskId, execType, orderRef } = await this.tx(s => {
      this.audit(s, a, { what: 'objective.received', detail: clip(objective, 300) });
      if (!route) {
        const t = createTask(s, { title: clip(objective, 120), description: objective, type: 'UNROUTED', agent: 'AI_BOSS', priority: 'MEDIUM', createdBy: boss, at: this.now(), maxRetries: 0 });
        moveTask(s, t, 'WAITING', boss, this.now(), 'no employee matches this objective');
        moveTask(s, t, 'ESCALATED', boss, this.now(), 'AI Boss could not route this objective; Founder decision needed');
        return { taskId: t.id, execType: null, orderRef: null };
      }
      const def = EMPLOYEES.find(e => e.role === route.role)!;
      const t = createTask(s, { title: clip(objective, 120), description: objective, type: route.type, agent: route.role, priority: 'MEDIUM', createdBy: boss, at: this.now(), inputs: { objective } });
      if (!def.implemented) {
        moveTask(s, t, 'WAITING', boss, this.now(), `${def.name} is not built yet`);
        const op = createTask(s, { title: `Build capability for ${def.name}: ${clip(objective, 80)}`, type: 'CAPABILITY_BUILD', agent: 'AI_OPERATOR', priority: 'MEDIUM', createdBy: boss, at: this.now(), inputs: { forTask: t.id } });
        moveTask(s, op, 'WAITING', boss, this.now(), 'AI Operator has no build executor yet');
        moveTask(s, op, 'ESCALATED', boss, this.now(), 'Needs a human/engineering session to build this capability');
        moveTask(s, t, 'ESCALATED', boss, this.now(), `blocked on ${op.id}`);
        return { taskId: t.id, execType: null, orderRef: null };
      }
      return { taskId: t.id, execType: route.type, orderRef: /\bORD-\d+\b/.exec(objective)?.[0] ?? null };
    });
    // Execute
    if (execType === 'ORDER_PIPELINE' && orderRef) {
      const r = await this.runOrderPipeline(orderRef).catch(e => ({ status: 'ERROR', log: [(e as Error).message] }));
      await this.tx(s => {
        const t = s.tasks.find(x => x.id === taskId)!; const o = s.orders.find(x => x.id === orderRef);
        const statusEvent = s.audit.filter(x => x.entityId === orderRef && x.what === 'order.status').at(-1)?.id ?? null;
        this.finishObjectiveTask(s, t, r.log.join('; '), statusEvent, o?.status ?? 'NOT_FOUND');
      });
    } else if (execType === 'SECURITY_SCAN') {
      await this.tx(async s => {
        const t = s.tasks.find(x => x.id === taskId)!; moveTask(s, t, 'IN_PROGRESS', 'agent:ai-security', this.now());
        const { execution, output } = await this.tools.execute<ReturnType<Company['securityFindings']>>(s, 'AI_SECURITY', 'security.scan', s, { taskId: t.id, at: () => this.now() });
        t.outputs = { findings: output };
        addEvidence(s, t, { kind: 'tool_execution', ref: execution.id, note: `${output.filter(f => !f.ok).length} findings` });
        moveTask(s, t, 'QA', 'agent:ai-security', this.now());
        const complete = output.length >= 10 && output.every(f => typeof f.ok === 'boolean' && f.check);
        qaDecision(s, t, 'AI_QA', complete, complete ? `${output.length} checks recorded` : 'scan output incomplete', this.now(), 'agent:ai-qa');
        if (t.status !== 'COMPLETED') failTask(s, t, 'incomplete scan output', 'agent:ai-security', this.now());
      });
    } else if (execType === 'METRICS_REPORT') {
      await this.tx(s => {
        const t = s.tasks.find(x => x.id === taskId)!; moveTask(s, t, 'IN_PROGRESS', 'agent:ai-data', this.now());
        const m = this.metrics(s, 0);
        const e = this.audit(s, agent('AI_DATA'), { what: 'report.generated', taskId: t.id, detail: JSON.stringify(m.today) });
        t.outputs = { report: m }; addEvidence(s, t, { kind: 'audit', ref: e.id, note: 'metrics snapshot' });
        moveTask(s, t, 'QA', 'agent:ai-data', this.now());
        // QA: recount orders independently
        qaDecision(s, t, 'AI_QA', m.pipeline.total === s.orders.length, `orders recount ${s.orders.length}`, this.now(), 'agent:ai-qa');
      });
    } else if (execType === 'CERTIFICATION_RUN' && runCertification) {
      const r = await runCertification();
      await this.tx(s => { const t = s.tasks.find(x => x.id === taskId)!; moveTask(s, t, 'IN_PROGRESS', 'agent:ai-qa', this.now()); addEvidence(s, t, { kind: 'test_run', ref: r.runId, note: `${r.passed} passed, ${r.failed} failed` }); moveTask(s, t, 'QA', 'agent:ai-qa', this.now()); qaDecision(s, t, 'AI_BOSS', r.failed === 0, `${r.failed} failures`, this.now(), 'agent:ai-boss'); if (t.status !== 'COMPLETED') failTask(s, t, `${r.failed} scenario(s) failed`, 'agent:ai-qa', this.now()); });
    }
    return this.read(s => s.tasks.find(x => x.id === taskId)!);
  }
  /** An order objective is COMPLETED only when the order is DELIVERED. Waiting on the customer or payment → WAITING; anything else → ESCALATED. */
  private finishObjectiveTask(s: CompanyState, t: Task, summary: string, statusEventId: string | null, orderStatus: string) {
    moveTask(s, t, 'IN_PROGRESS', 'agent:ai-dashboard', this.now());
    t.outputs = { summary, orderStatus };
    if (statusEventId) addEvidence(s, t, { kind: 'audit', ref: statusEventId, note: `order status ${orderStatus}` });
    if (orderStatus === 'DELIVERED' && t.evidence.length) {
      moveTask(s, t, 'QA', 'agent:ai-dashboard', this.now());
      qaDecision(s, t, 'AI_QA', true, 'order status is DELIVERED', this.now(), 'agent:ai-qa');
      return;
    }
    if (['INFO_REQUIRED', 'AWAITING_PAYMENT', 'PAYMENT_FAILED', 'PAYMENT_REVIEW'].includes(orderStatus)) { moveTask(s, t, 'WAITING', 'agent:ai-boss', this.now(), `order is ${orderStatus}: ${clip(summary, 200)}`); return; }
    t.maxRetries = 0; failTask(s, t, `order is ${orderStatus}: ${clip(summary, 250)}`, 'agent:ai-dashboard', this.now());
  }

  // ---------------------------------------------------------------- security officer
  securityFindings(s: CompanyState) {
    const f: { check: string; ok: boolean; severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFO'; detail: string }[] = [];
    const chain = verifyAuditChain(s.audit);
    f.push({ check: 'audit_chain_intact', ok: chain.ok, severity: 'CRITICAL', detail: chain.ok ? `${chain.checked} entries verified` : `broken at #${chain.brokenAt}: ${chain.reason}` });
    f.push({ check: 'founder_account_exists', ok: s.users.some(u => u.role === 'FOUNDER' && !u.disabled), severity: 'HIGH', detail: 'set FOUNDER_EMAIL and FOUNDER_PASSWORD on first start' });
    f.push({ check: 'passwords_hashed', ok: s.users.every(u => /^scrypt\$\d+\$\d+\$\d+\$[\w-]+\$[\w-]+$/.test(u.passwordHash)), severity: 'CRITICAL', detail: 'all users use scrypt hashes' });
    f.push({ check: 'sessions_hashed', ok: s.sessions.every(x => /^[0-9a-f]{64}$/.test(x.tokenHash)), severity: 'CRITICAL', detail: 'only SHA-256 of session tokens stored' });
    const internal = ['order.view.all', 'order.data.read', 'payment.verify', 'approval.decide', 'audit.view', 'admin.view', 'production.start'];
    f.push({ check: 'customer_least_privilege', ok: internal.every(p => !can('CUSTOMER', p)), severity: 'CRITICAL', detail: 'customers hold no internal permissions' });
    f.push({ check: 'webhook_secret_configured', ok: this.razorpay.webhookConfigured, severity: 'HIGH', detail: this.razorpay.webhookConfigured ? 'webhooks verified by HMAC' : 'RAZORPAY_WEBHOOK_SECRET missing — webhooks are refused' });
    const secrets = ['RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'SMTP_PASSWORD', 'FOUNDER_PASSWORD', 'TW01_AUTH_TOKEN'].map(k => this.env[k]).filter((v): v is string => !!v && v.length >= 8);
    const blob = JSON.stringify(s);
    f.push({ check: 'no_plaintext_secrets_in_data', ok: secrets.every(v => !blob.includes(v)), severity: 'CRITICAL', detail: `${secrets.length} configured secrets checked against stored data` });
    f.push({ check: 'cors_restricted', ok: !!this.allowedOrigin && this.allowedOrigin !== '*', severity: 'MEDIUM', detail: this.allowedOrigin ? `allowed origin ${this.allowedOrigin}` : 'set TW01_ALLOWED_ORIGIN; company API sends no CORS headers until then' });
    f.push({ check: 'razorpay_mode', ok: this.razorpay.mode !== 'unknown' || !this.razorpay.configured, severity: 'INFO', detail: this.razorpay.configured ? `key mode: ${this.razorpay.mode}` : 'not configured' });
    const rejectedTools = s.tools.filter(t => t.status !== 'ACTIVE');
    f.push({ check: 'tools_self_tested', ok: rejectedTools.length === 0, severity: 'HIGH', detail: rejectedTools.length ? `rejected: ${rejectedTools.map(t => t.name).join(', ')}` : `${s.tools.length} tools active` });
    return f;
  }

  // ---------------------------------------------------------------- read models
  customerView(s: CompanyState, o: Order) {
    return { id: o.id, product: o.productName, amount: o.amount, currency: o.currency, status: CUSTOMER_STATUS[o.status], statusCode: o.status, paid: o.paymentVerified, createdAt: o.createdAt, updatedAt: o.updatedAt, requirement: o.requirement, files: o.files.map(f => ({ id: f.id, name: f.name, bytes: f.bytes, uploadedAt: f.uploadedAt })), deliverables: { dashboard: !!o.deliverables.dashboard && o.status === 'DELIVERED', guide: !!o.deliverables.guide && o.status === 'DELIVERED' }, revisionCount: o.revisionCount, canPay: ['AWAITING_PAYMENT', 'PAYMENT_FAILED'].includes(o.status) && !o.paymentVerified, canRevise: o.status === 'DELIVERED' };
  }
  async myOrders(actor: Actor | null) {
    const a = requirePerm(actor, 'order.view.own');
    return this.read(s => s.orders.filter(o => a.kind === 'user' && o.customerId === a.customerId).map(o => this.customerView(s, o)).reverse());
  }
  async myOrder(actor: Actor | null, id: string) {
    const a = requirePerm(actor, 'order.view.own');
    return this.read(s => {
      const o = this.getOrder(s, a, id);
      const pays = s.payments.filter(p => p.orderId === o.id).map(p => ({ at: p.at, paymentId: p.razorpay_payment_id, status: p.verified ? 'Verified' : p.gatewayStatus === 'failed' ? 'Failed' : 'Not verified', note: p.verified ? '' : p.failureReason }));
      return { ...this.customerView(s, o), payments: pays, timeline: o.timeline.map(t => ({ at: t.at, status: CUSTOMER_STATUS[t.to] })), gatewayOrderId: o.gatewayOrderId, razorpayKeyId: this.razorpay.keyId, paymentConfigured: this.razorpay.configured };
    });
  }
  async deliverable(actor: Actor | null, orderId: string, which: 'dashboard' | 'guide') {
    const a = requirePerm(actor, actor?.role === 'CUSTOMER' ? 'deliverable.download.own' : 'order.view.all');
    const path = await this.read(s => {
      const o = this.getOrder(s, a, orderId);
      if (a.role === 'CUSTOMER' && o.status !== 'DELIVERED') fail('BAD_STATE', 'Not delivered yet.');
      const p = o.deliverables[which]; if (!p) fail('NOT_FOUND', 'No file yet.');
      return p!;
    });
    await this.tx(s => { this.audit(s, a, { what: `deliverable.download.${which}`, entity: 'order', entityId: orderId }); });
    const content = await this.blobs.get(path);
    if (content == null) fail('NOT_FOUND', 'File is missing from storage.');
    return content!;
  }

  metrics(s: CompanyState, leadsCount: number) {
    const today = this.now().slice(0, 10);
    const verified = s.payments.filter(p => p.verified);
    const uniquePaid = new Map<string, number>(); for (const p of verified) uniquePaid.set(p.orderId, (p.amountPaise ?? 0) / 100);
    const refunded = s.orders.filter(o => o.status === 'REFUNDED');
    const refundTotal = refunded.reduce((a, o) => a + Number(s.approvals.find(x => x.action === 'refund' && x.entityId === o.id && x.status === 'APPROVED')?.payload.amount ?? 0), 0);
    const revenue = [...uniquePaid.values()].reduce((a, b) => a + b, 0) - refundTotal;
    const revenueToday = verified.filter(p => p.at.slice(0, 10) === today).reduce((a, p) => a + (p.amountPaise ?? 0) / 100, 0);
    const count = (...st: OrderStatus[]) => s.orders.filter(o => st.includes(o.status)).length;
    return {
      today: { revenue: revenueToday, orders: s.orders.filter(o => o.createdAt.slice(0, 10) === today).length },
      totals: { revenue, refunds: refundTotal, orders: s.orders.length, customers: s.customers.length, leads: leadsCount, conversionPct: s.orders.length ? Math.round((uniquePaid.size / s.orders.length) * 1000) / 10 : null, profit: null as number | null, profitNote: 'Profit needs expense records; none are tracked yet, so it is not shown.', pendingPayments: count('AWAITING_PAYMENT', 'PAYMENT_FAILED', 'PAYMENT_REVIEW') },
      pipeline: { total: s.orders.length, paid: count('PAID'), pending: count('AWAITING_PAYMENT', 'PAYMENT_FAILED', 'PAYMENT_REVIEW'), production: count('IN_PRODUCTION', 'INFO_REQUIRED'), qa: count('QA'), delivered: count('DELIVERED'), revision: count('REVISION'), refund: count('REFUND_REQUESTED', 'REFUNDED') },
    };
  }

  async founderOverview(actor: Actor | null, leadsCount: number) {
    requirePerm(actor, 'admin.view');
    return this.read(s => {
      const workforce = EMPLOYEES.map(def => {
        const cert = certification(s, def);
        const active = s.tasks.filter(t => t.agent === def.role && ['IN_PROGRESS', 'QA'].includes(t.status)).at(-1);
        const lastTask = [...s.tasks].reverse().find(t => t.agent === def.role);
        const lastExec = [...s.toolExecutions].reverse().find(e => e.agent === def.role);
        const lastEvent = lastTask ? [...s.taskEvents].reverse().find(e => e.taskId === lastTask.id) : undefined;
        const blocked = s.tasks.filter(t => t.agent === def.role && ['WAITING', 'ESCALATED'].includes(t.status)).length;
        return { ...cert, paused: s.pausedAgents.includes(def.role), activity: {
          state: s.pausedAgents.includes(def.role) ? 'PAUSED' : active ? 'WORKING' : blocked ? 'BLOCKED' : lastTask ? 'IDLE' : 'NO_ACTIVITY',
          task: (active ?? lastTask)?.title ?? null, taskStatus: (active ?? lastTask)?.status ?? null,
          currentTool: active ? lastExec?.tool ?? null : null, lastEvent: lastEvent ? `${lastEvent.to}${lastEvent.note ? ' — ' + lastEvent.note : ''}` : null, lastEventAt: lastEvent?.at ?? null,
          evidence: (active ?? lastTask)?.evidence.at(-1)?.ref ?? null, openBlocked: blocked } };
      });
      return {
        metrics: this.metrics(s, leadsCount), workforce,
        approvals: s.approvals.filter(a => a.status === 'PENDING').reverse(),
        orders: s.orders.slice().reverse().map(o => ({ id: o.id, customer: this.customerOf(s, o)?.company, product: o.productName, amount: o.amount, status: o.status, paymentVerified: o.paymentVerified, gate: this.productionGate(s, o), updatedAt: o.updatedAt })),
        tasks: s.tasks.slice(-200).reverse(),
        gateway: { razorpay: this.razorpay.configured ? `CONFIGURED (${this.razorpay.mode})` : 'NOT_CONFIGURED', webhook: this.razorpay.webhookConfigured ? 'CONFIGURED' : 'NOT_CONFIGURED', smtp: this.mailer.configured ? 'CONFIGURED' : 'NOT_CONFIGURED' },
      };
    });
  }
  async adminList(actor: Actor | null, what: string) {
    requirePerm(actor, what === 'audit' ? 'audit.view' : 'admin.view');
    return this.read(s => {
      switch (what) {
        case 'audit': return { entries: s.audit.slice(-500).reverse(), chain: verifyAuditChain(s.audit) };
        case 'approvals': return s.approvals.slice().reverse();
        case 'payments': return s.payments.slice().reverse();
        case 'customers': return s.customers.map(c => ({ ...c, orders: s.orders.filter(o => o.customerId === c.id).length }));
        case 'tools': return { tools: s.tools, executions: s.toolExecutions.slice(-200).reverse() };
        case 'emails': return s.emails.slice(-200).reverse();
        case 'products': return s.products;
        case 'tests': return s.testRuns.slice(-20).reverse();
        case 'webhooks': return s.webhookEvents.slice(-200).reverse();
        case 'task-events': return s.taskEvents.slice(-500).reverse();
        default: return fail('NOT_FOUND', 'Unknown list.');
      }
    });
  }
  async orderDetail(actor: Actor | null, id: string) {
    requirePerm(actor, 'order.view.all');
    return this.read(s => {
      const o = s.orders.find(x => x.id === id) ?? fail('NOT_FOUND', 'Order not found.');
      return { order: o, customer: this.customerOf(s, o!), gate: this.productionGate(s, o!), payments: s.payments.filter(p => p.orderId === id), claims: s.claims.filter(c => c.orderId === id), tasks: s.tasks.filter(t => t.orderId === id), approvals: s.approvals.filter(a => a.entityId === id), builds: s.builds.filter(b => b.orderId === id), qa: s.qaReports.filter(q => q.orderId === id), emails: s.emails.filter(e => e.orderId === id), audit: s.audit.filter(a => a.entityId === id) };
    });
  }
  /** Stores a real test run. Certification status is computed from these records only. */
  async recordTestRun(actor: Actor | null, results: import('./types.js').TestResult[], environment: 'local' | 'production', baseUrl: string | null, trigger: string) {
    const a = requirePerm(actor, 'certification.run');
    if (environment === 'production' && !/^https:\/\//.test(baseUrl ?? '')) fail('VALIDATION', 'A production run needs the deployed https:// base URL.');
    if (environment === 'production' && results.some(r => r.level !== 'PRODUCTION')) fail('VALIDATION', 'Production runs contain PRODUCTION-level checks only.');
    if (environment === 'local' && results.some(r => r.level === 'PRODUCTION')) fail('VALIDATION', 'PRODUCTION-level results can only come from a run against a deployed URL.');
    return this.tx(s => {
      const run = { id: uid('run'), at: this.now(), trigger, environment, baseUrl, results, passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length, codeVersion: this.env.TW01_CODE_VERSION || this.env.VERCEL_GIT_COMMIT_SHA || 'unversioned' };
      s.testRuns.push(run); if (s.testRuns.length > 50) s.testRuns.splice(0, s.testRuns.length - 50);
      this.audit(s, a, { what: 'certification.recorded', entity: 'test_run', entityId: run.id, detail: `${environment}: ${run.passed} passed, ${run.failed} failed` });
      return { runId: run.id, passed: run.passed, failed: run.failed };
    });
  }
  async certifications(actor: Actor | null) {
    requirePerm(actor, 'admin.view');
    return this.read(s => EMPLOYEES.map(d => certification(s, d)));
  }
  async setAgentPaused(actor: Actor | null, role: unknown, paused: boolean) {
    const a = requirePerm(actor, 'agent.pause');
    const r = String(role) as Role;
    if (!AGENT_ROLES.includes(r)) fail('VALIDATION', 'Unknown employee.');
    return this.tx(s => {
      s.pausedAgents = paused ? [...new Set([...s.pausedAgents, r])] : s.pausedAgents.filter(x => x !== r);
      this.audit(s, a, { what: paused ? 'agent.paused' : 'agent.resumed', entity: 'agent', entityId: r });
      return { paused: s.pausedAgents };
    });
  }
  async health() {
    const started = Date.now();
    const r = await this.read(s => ({ chain: verifyAuditChain(s.audit), tools: s.tools.map(t => ({ name: t.name, status: t.status, lastTest: t.lastTest })), counts: { orders: s.orders.length, tasks: s.tasks.length, audit: s.audit.length, pendingApprovals: s.approvals.filter(a => a.status === 'PENDING').length, escalated: s.tasks.filter(t => t.status === 'ESCALATED').length, failedToolExecutions24h: s.toolExecutions.filter(e => e.status !== 'OK' && Date.parse(e.at) > Date.now() - 864e5).length }, lastTestRun: s.testRuns.at(-1) ? { id: s.testRuns.at(-1)!.id, at: s.testRuns.at(-1)!.at, passed: s.testRuns.at(-1)!.passed, failed: s.testRuns.at(-1)!.failed } : null }));
    return {
      status: r.chain.ok && r.tools.every(t => t.status === 'ACTIVE') ? 'OK' : 'DEGRADED', checkedAt: this.now(), storeLatencyMs: Date.now() - started,
      store: { kind: this.store.backend.kind, path: this.store.path, durableOnServerless: this.store.backend.durableOnServerless, files: this.blobs.kind },
      runtime: { serverless: !!(this.env.VERCEL || this.env.AWS_LAMBDA_FUNCTION_NAME || this.env.NETLIFY), node: process.version },
      integrations: { razorpay: this.razorpay.configured ? 'CONFIGURED' : 'NOT_CONFIGURED', razorpayWebhook: this.razorpay.webhookConfigured ? 'CONFIGURED' : 'NOT_CONFIGURED', smtp: this.mailer.configured ? 'CONFIGURED' : 'NOT_CONFIGURED' },
      auditChain: r.chain, tools: r.tools, counts: r.counts, lastTestRun: r.lastTestRun,
    };
  }
}
