import { hmacHex } from '../util.js';
import type { Fetch } from '../razorpay.js';

/**
 * TEST DOUBLE of the Razorpay REST API, used only by the self-test harness and unit tests.
 * It implements the three endpoints TW-01 calls and signs exactly as Razorpay documents,
 * so the production verification code is exercised unchanged. It is never wired into the server.
 */
export class RazorpayDouble {
  orders = new Map<string, any>(); payments = new Map<string, any>(); refunds: any[] = []; calls: string[] = [];
  down = false; private n = 0;
  constructor(readonly keyId = 'rzp_test_double0001', readonly keySecret = 'double_key_secret_0001', readonly webhookSecret = 'double_webhook_secret_0001') {}
  private id(p: string) { return `${p}_${(++this.n).toString().padStart(14, '0')}`; }

  fetch: Fetch = (async (input: any, init: any = {}) => {
    const url = new URL(String(input)); const method = init.method ?? 'GET'; this.calls.push(`${method} ${url.pathname}`);
    if (this.down) throw new TypeError('fetch failed (double: network down)');
    const auth = String(init.headers?.authorization ?? '');
    if (auth !== 'Basic ' + Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')) return json(401, { error: { description: 'Authentication failed' } });
    const body = init.body ? JSON.parse(init.body) : {};
    if (method === 'POST' && url.pathname === '/v1/orders') {
      const o = { id: this.id('order'), entity: 'order', amount: body.amount, amount_paid: 0, amount_due: body.amount, currency: body.currency, receipt: body.receipt, status: 'created', notes: body.notes, created_at: 1 };
      this.orders.set(o.id, o); return json(200, o);
    }
    let m = /^\/v1\/payments\/([^/]+)$/.exec(url.pathname);
    if (method === 'GET' && m) { const p = this.payments.get(decodeURIComponent(m[1])); return p ? json(200, p) : json(400, { error: { description: 'The id provided does not exist' } }); }
    m = /^\/v1\/payments\/([^/]+)\/refund$/.exec(url.pathname);
    if (method === 'POST' && m) { const p = this.payments.get(m[1]); if (!p || p.status !== 'captured') return json(400, { error: { description: 'Payment not captured' } }); const r = { id: this.id('rfnd'), entity: 'refund', amount: body.amount, payment_id: p.id, status: 'processed' }; this.refunds.push(r); return json(200, r); }
    return json(404, { error: { description: 'not found' } });
  }) as Fetch;

  /** Simulates the customer completing Checkout: returns what Razorpay hands the browser. */
  pay(orderId: string, opts: { amount?: number; status?: 'captured' | 'authorized' | 'failed'; method?: string } = {}) {
    const o = this.orders.get(orderId); if (!o) throw new Error('double: unknown order');
    const p = { id: this.id('pay'), entity: 'payment', amount: opts.amount ?? o.amount, currency: 'INR', status: opts.status ?? 'captured', order_id: o.id, method: opts.method ?? 'upi', captured: (opts.status ?? 'captured') === 'captured', error_code: opts.status === 'failed' ? 'BAD_REQUEST_ERROR' : null, error_description: opts.status === 'failed' ? 'Payment failed due to insufficient funds' : null, created_at: 1, notes: o.notes };
    this.payments.set(p.id, p);
    return { razorpay_order_id: o.id, razorpay_payment_id: p.id, razorpay_signature: hmacHex(this.keySecret, `${o.id}|${p.id}`), payment: p };
  }
  webhook(event: string, payment: any, eventId = this.id('evt')) {
    const raw = Buffer.from(JSON.stringify({ entity: 'event', event, payload: { payment: { entity: payment } }, created_at: 2 }));
    return { raw, headers: { 'x-razorpay-signature': hmacHex(this.webhookSecret, raw), 'x-razorpay-event-id': eventId } };
  }
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
