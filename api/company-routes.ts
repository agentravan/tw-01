import type { IncomingMessage, ServerResponse } from 'node:http';
import { Company } from '../company/service.js';
import { CompanyError } from '../company/util.js';
import { runScenarios } from '../company/testing/scenarios.js';
import { verifyProduction } from '../company/testing/production.js';
import type { Actor } from '../company/types.js';

const MAX_JSON = 256 * 1024, MAX_UPLOAD = 7 * 1024 * 1024; // upload JSON carries a ≤5 MB CSV

export async function readRaw(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > limit) throw new CompanyError('VALIDATION', `Request body too large (limit ${Math.round(limit / 1024)} KB).`, 413); chunks.push(c as Buffer); }
  return Buffer.concat(chunks);
}
async function readJson(req: IncomingMessage, limit = MAX_JSON): Promise<any> {
  const raw = await readRaw(req, limit); if (!raw.length) return {};
  try { return JSON.parse(raw.toString('utf8')); } catch { throw new CompanyError('VALIDATION', 'Body must be JSON.'); }
}
export const bearer = (req: IncomingMessage) => { const h = String(req.headers.authorization ?? ''); return h.startsWith('Bearer ') ? h.slice(7).trim() : null; };
/** Client IP for rate limiting. X-Forwarded-For is client-controlled, so it is used only when TW01_TRUST_PROXY=true (behind your own proxy). */
export function clientIp(req: IncomingMessage, trustProxy = process.env.TW01_TRUST_PROXY === 'true') {
  // Proxies append to X-Forwarded-For, so the right-most entry is the one your own proxy added; earlier entries are client-supplied.
  const fwd = trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',').map(x => x.trim()).filter(Boolean).at(-1) ?? '' : '';
  return fwd || req.socket.remoteAddress || 'unknown';
}

function headers(co: Company, req: IncomingMessage, extra: Record<string, string> = {}) {
  const h: Record<string, string> = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store', 'x-frame-options': 'DENY', ...extra };
  const origin = String(req.headers.origin ?? '');
  // CORS only for the configured origin. Same-origin pages (the console/portal served by this server) need none.
  if (co.allowedOrigin && origin === co.allowedOrigin) Object.assign(h, { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type,authorization' });
  return h;
}
function send(co: Company, req: IncomingMessage, res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, headers(co, req, { 'content-type': 'application/json; charset=utf-8' })); res.end(JSON.stringify(body));
}

/** Runs the order pipeline after the response, so payment callbacks return fast. Failures are recorded by the pipeline itself. */
function kick(co: Company, orderId: string) { setImmediate(() => { co.runOrderPipeline(orderId).catch(e => console.error('[tw01] pipeline', orderId, (e as Error).message)); }); }

/** Handles /api/co/*. Returns false if the path is not a company route. */
export async function handleCompany(co: Company, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const p = url.pathname; if (!p.startsWith('/api/co/')) return false;
  const m = req.method ?? 'GET'; let actor: Actor | null = null;
  const route = `${m} ${p.replace(/ORD-\d+/g, ':id').replace(/apr_\w+/g, ':id')}`;
  try {
    if (m === 'OPTIONS') { res.writeHead(204, headers(co, req)); res.end(); return true; }
    // Webhook first: needs the raw body and no session.
    if (m === 'POST' && p === '/api/co/webhooks/razorpay') {
      const raw = await readRaw(req, MAX_JSON);
      const r: any = await co.handleWebhook(raw, req.headers as any);
      if (r?.matched && r?.status === 'PAID' && r.orderId) kick(co, r.orderId);
      send(co, req, res, 200, { ok: true }); return true;
    }
    actor = await co.actorFromToken(bearer(req));
    const ok = (b: unknown, s = 200) => { send(co, req, res, s, b); return true; };
    let mm: RegExpExecArray | null;

    // Public
    if (m === 'GET' && p === '/api/co/products') return ok(await co.listProducts(actor));
    if (m === 'GET' && p === '/api/co/health') { const h = await co.health(); return ok(actor?.role === 'FOUNDER' ? h : { status: h.status, checkedAt: h.checkedAt }); }
    if (m === 'POST' && p === '/api/co/auth/register') return ok(await co.registerCustomer(await readJson(req), clientIp(req)), 201);
    if (m === 'POST' && p === '/api/co/auth/login') { const b = await readJson(req); return ok(await co.login(b.email, b.password, clientIp(req))); }
    if (m === 'POST' && p === '/api/co/auth/logout') { const t = bearer(req); if (t) await co.logout(t); return ok({ ok: true }); }
    if (m === 'GET' && p === '/api/co/me') { if (!actor) throw new CompanyError('UNAUTHENTICATED', 'Sign in first.'); return ok(await co.read(s => { const u = s.users.find(x => x.id === actor!.id)!; return { id: u.id, name: u.name, email: u.email, role: u.role }; })); }

    // Customer portal
    if (m === 'GET' && p === '/api/co/orders') return ok(await co.myOrders(actor));
    if (m === 'POST' && p === '/api/co/orders') return ok(await co.createOrder(actor, await readJson(req)), 201);
    if ((mm = /^\/api\/co\/orders\/(ORD-\d+)$/.exec(p)) && m === 'GET') return ok(await co.myOrder(actor, mm[1]));
    if ((mm = /^\/api\/co\/orders\/(ORD-\d+)\/files$/.exec(p)) && m === 'POST') { const b = await readJson(req, MAX_UPLOAD); const r = await co.uploadFile(actor, mm[1], b.name, b.content); kick(co, mm[1]); return ok(r, 201); }
    if ((mm = /^\/api\/co\/orders\/(ORD-\d+)\/checkout\/confirm$/.exec(p)) && m === 'POST') { const r = await co.confirmCheckout(actor, mm[1], await readJson(req)); if ((r as any).verified) kick(co, mm[1]); return ok(r); }
    if ((mm = /^\/api\/co\/orders\/(ORD-\d+)\/checkout\/retry$/.exec(p)) && m === 'POST') return ok(await co.retryPayment(actor, mm[1]));
    if ((mm = /^\/api\/co\/orders\/(ORD-\d+)\/claim$/.exec(p)) && m === 'POST') { const r = await co.claimPayment(actor, mm[1], await readJson(req)); if (r.status === 'VERIFIED') kick(co, mm[1]); return ok(r); }
    if ((mm = /^\/api\/co\/orders\/(ORD-\d+)\/revision$/.exec(p)) && m === 'POST') { const b = await readJson(req); const r = await co.requestRevision(actor, mm[1], b.note); kick(co, mm[1]); return ok(r); }
    if ((mm = /^\/api\/co\/orders\/(ORD-\d+)\/download\/(dashboard|guide)$/.exec(p)) && m === 'GET') {
      const html = await co.deliverable(actor, mm[1], mm[2] as 'dashboard' | 'guide');
      // Attachment + sandbox CSP: the customer's dashboard never executes on this origin.
      res.writeHead(200, headers(co, req, { 'content-type': 'text/html; charset=utf-8', 'content-disposition': `attachment; filename="${mm[1]}-${mm[2]}.html"`, 'content-security-policy': 'sandbox' }));
      res.end(html); return true;
    }

    // Founder admin
    if (m === 'GET' && p === '/api/co/admin/overview') { const leads = await co.store.read(s => s.leads.length); return ok(await co.founderOverview(actor, leads)); }
    if ((mm = /^\/api\/co\/admin\/list\/([a-z-]+)$/.exec(p)) && m === 'GET') return ok(await co.adminList(actor, mm[1]));
    if ((mm = /^\/api\/co\/admin\/orders\/(ORD-\d+)$/.exec(p)) && m === 'GET') return ok(await co.orderDetail(actor, mm[1]));
    if (m === 'GET' && p === '/api/co/admin/certifications') return ok(await co.certifications(actor));
    if (m === 'GET' && p === '/api/co/admin/security') { if (!actor || !['FOUNDER', 'AI_SECURITY'].includes(actor.role)) throw new CompanyError(actor ? 'FORBIDDEN' : 'UNAUTHENTICATED', 'Founder only.'); return ok(await co.read(s => co.securityFindings(s))); }
    if (m === 'POST' && p === '/api/co/admin/certify') {
      if (!actor || actor.role !== 'FOUNDER') throw new CompanyError(actor ? 'FORBIDDEN' : 'UNAUTHENTICATED', 'Founder only.');
      const results = await runScenarios();
      return ok(await co.recordTestRun(actor, results, 'local', null, 'founder console'));
    }
    if (m === 'POST' && p === '/api/co/admin/verify-production') {
      if (!actor || actor.role !== 'FOUNDER') throw new CompanyError(actor ? 'FORBIDDEN' : 'UNAUTHENTICATED', 'Founder only.');
      const b = await readJson(req); const baseUrl = String(b.baseUrl ?? '');
      if (!/^https:\/\/[^\s/]+/.test(baseUrl)) throw new CompanyError('VALIDATION', 'Give the deployed https:// URL.');
      const results = await verifyProduction(baseUrl, bearer(req)!);
      return ok({ ...(await co.recordTestRun(actor, results, 'production', baseUrl, 'founder console')), results });
    }
    if (m === 'POST' && p === '/api/co/admin/objective') {
      const b = await readJson(req);
      const task = await co.submitObjective(actor, b.text, async () => co.recordTestRun(actor, await runScenarios(), 'local', null, 'AI Boss objective'));
      return ok(task);
    }
    if ((mm = /^\/api\/co\/admin\/approvals\/(apr_\w+)$/.exec(p)) && m === 'POST') {
      const b = await readJson(req); const r = await co.decideApproval(actor, mm[1], b.decision, b.reason);
      if (r.status === 'APPROVED' && r.action === 'production.override') kick(co, r.entityId);
      return ok(r);
    }
    if ((mm = /^\/api\/co\/admin\/products\/([a-z0-9-]+)$/.exec(p)) && m === 'POST') return ok(await co.configureProduct(actor, mm[1], await readJson(req)));
    if ((mm = /^\/api\/co\/admin\/agents\/(AI_[A-Z]+)\/pause$/.exec(p)) && m === 'POST') { const b = await readJson(req); return ok(await co.setAgentPaused(actor, mm[1], b.paused !== false)); }
    if ((mm = /^\/api\/co\/admin\/orders\/(ORD-\d+)\/override$/.exec(p)) && m === 'POST') { const b = await readJson(req); return ok(await co.requestProductionOverride(actor, mm[1], b.reason), 201); }
    if ((mm = /^\/api\/co\/admin\/orders\/(ORD-\d+)\/refund$/.exec(p)) && m === 'POST') return ok(await co.requestRefund(actor, mm[1], await readJson(req)), 201);
    if ((mm = /^\/api\/co\/admin\/orders\/(ORD-\d+)\/run$/.exec(p)) && m === 'POST') {
      if (!actor || actor.role !== 'FOUNDER') throw new CompanyError(actor ? 'FORBIDDEN' : 'UNAUTHENTICATED', 'Founder only.');
      return ok(await co.runOrderPipeline(mm[1], actor));
    }
    return ok({ error: 'not found' }, 404);
  } catch (e) {
    const err = e as CompanyError;
    if (err instanceof CompanyError) {
      await co.recordDenied(actor, `api ${route}`, err, (/ORD-\d+/.exec(p) ?? [null])[0]).catch(() => undefined);
      send(co, req, res, err.httpStatus, { error: err.message, code: err.code });
    } else {
      console.error('[tw01] unhandled', route, e);
      send(co, req, res, 500, { error: 'Internal error. It has been logged.', code: 'INTERNAL' });
    }
    return true;
  }
}
