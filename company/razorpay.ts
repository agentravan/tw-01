import { CompanyError, hmacHex, safeEqual } from './util.js';

/**
 * Razorpay gateway client, per Razorpay's published docs (checked 2026-09):
 *  - Create order:  POST https://api.razorpay.com/v1/orders   (Basic auth key_id:key_secret; amount in paise)
 *  - Fetch payment: GET  https://api.razorpay.com/v1/payments/{id}
 *  - Checkout signature: HMAC-SHA256(order_id + "|" + razorpay_payment_id, key_secret), hex
 *  - Webhook signature:  HMAC-SHA256(raw request body, webhook_secret), header X-Razorpay-Signature;
 *    duplicates identified by the x-razorpay-event-id header.
 * Nothing here simulates a payment. Without keys every call reports NOT_CONFIGURED.
 */
export interface RazorpayConfig { keyId: string; keySecret: string; webhookSecret: string; baseUrl?: string; }
export type Fetch = typeof fetch;

export interface GatewayOrder { id: string; entity: 'order'; amount: number; amount_paid: number; amount_due: number; currency: string; receipt: string; status: 'created' | 'attempted' | 'paid'; created_at: number; }
export interface GatewayPayment { id: string; entity: 'payment'; amount: number; currency: string; status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed'; order_id: string | null; method: string; captured: boolean; error_code: string | null; error_description: string | null; created_at: number; notes?: Record<string, string>; }

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): RazorpayConfig | null {
  const keyId = env.RAZORPAY_KEY_ID ?? '', keySecret = env.RAZORPAY_KEY_SECRET ?? '', webhookSecret = env.RAZORPAY_WEBHOOK_SECRET ?? '';
  // RAZORPAY_API_BASE lets the HTTP end-to-end test point at a local gateway double. It is ignored unless NODE_ENV=test,
  // so a production deployment always talks to api.razorpay.com.
  const baseUrl = env.NODE_ENV === 'test' && env.RAZORPAY_API_BASE ? env.RAZORPAY_API_BASE : undefined;
  return keyId && keySecret ? { keyId, keySecret, webhookSecret, baseUrl } : null;
}

export class Razorpay {
  constructor(private cfg: RazorpayConfig | null, private http: Fetch = fetch) {}
  get configured() { return !!this.cfg; }
  get webhookConfigured() { return !!this.cfg?.webhookSecret; }
  get keyId() { return this.cfg?.keyId ?? null; }
  get mode(): 'live' | 'test' | 'unknown' { const k = this.cfg?.keyId ?? ''; return k.startsWith('rzp_live_') ? 'live' : k.startsWith('rzp_test_') ? 'test' : 'unknown'; }

  private need(): RazorpayConfig { if (!this.cfg) throw new CompanyError('NOT_CONFIGURED', 'Razorpay is not configured (set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET).'); return this.cfg; }
  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const c = this.need();
    let res: Response;
    try {
      res = await this.http(`${c.baseUrl ?? 'https://api.razorpay.com'}/v1${path}`, {
        method, headers: { authorization: 'Basic ' + Buffer.from(`${c.keyId}:${c.keySecret}`).toString('base64'), 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10_000),
      });
    } catch (e) { throw new CompanyError('GATEWAY', `Razorpay unreachable: ${(e as Error).message}`); }
    const text = await res.text(); let json: any = null; try { json = JSON.parse(text); } catch { /* keep null */ }
    if (!res.ok) throw new CompanyError('GATEWAY', `Razorpay ${method} ${path} → HTTP ${res.status}: ${json?.error?.description ?? text.slice(0, 200)}`);
    return json as T;
  }

  createOrder(amountPaise: number, receipt: string, notes: Record<string, string>) {
    if (!Number.isInteger(amountPaise) || amountPaise < 100) throw new CompanyError('VALIDATION', 'Amount must be at least ₹1.');
    return this.call<GatewayOrder>('POST', '/orders', { amount: amountPaise, currency: 'INR', receipt: receipt.slice(0, 40), notes });
  }
  fetchPayment(paymentId: string) {
    if (!/^pay_[A-Za-z0-9]{6,40}$/.test(paymentId)) throw new CompanyError('VALIDATION', 'That does not look like a Razorpay payment id (pay_…).');
    return this.call<GatewayPayment>('GET', `/payments/${encodeURIComponent(paymentId)}`);
  }
  /** POST /v1/payments/{id}/refund. Money moves: callers must hold an APPROVED Founder approval. */
  refund(paymentId: string, amountPaise: number, receipt: string) {
    if (!Number.isInteger(amountPaise) || amountPaise < 100) throw new CompanyError('VALIDATION', 'Refund amount must be at least ₹1.');
    return this.call<{ id: string; entity: 'refund'; amount: number; payment_id: string; status: 'pending' | 'processed' | 'failed' }>('POST', `/payments/${encodeURIComponent(paymentId)}/refund`, { amount: amountPaise, receipt: receipt.slice(0, 40) });
  }
  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
    const c = this.need();
    return safeEqual(hmacHex(c.keySecret, `${orderId}|${paymentId}`), String(signature));
  }
  verifyWebhook(rawBody: Buffer | string, signature: string | undefined): boolean {
    const c = this.need();
    if (!c.webhookSecret) throw new CompanyError('NOT_CONFIGURED', 'RAZORPAY_WEBHOOK_SECRET is not set; webhooks cannot be trusted.');
    if (!signature) return false;
    return safeEqual(hmacHex(c.webhookSecret, rawBody), signature);
  }
}
