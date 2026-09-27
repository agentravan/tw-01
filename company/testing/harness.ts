import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStore } from '../../memory/store.js';
import { Company } from '../service.js';
import { Razorpay } from '../razorpay.js';
import type { Mailer } from '../email.js';
import type { Actor } from '../types.js';
import { RazorpayDouble } from './gateway-double.js';

export const FOUNDER_EMAIL = 'founder@test.local';
export const FOUNDER_PASSWORD = 'founder-test-password-1';

/** Records emails instead of sending them. Test double: never used by the server. */
export class RecordingMailer implements Mailer { sent: { to: string; subject: string }[] = []; constructor(public configured = true) {} async send(to: string, subject: string) { this.sent.push({ to, subject }); return { messageId: `test-${this.sent.length}` }; } }

export interface Harness { co: Company; gw: RazorpayDouble; mail: RecordingMailer; dir: string; founder: Actor; cleanup(): Promise<void>; customer(email?: string): Promise<Actor>; activeProduct(price?: number): Promise<string>; }

/** A fresh, isolated company (temp data dir) with the Razorpay test double and a recording mailer. */
export async function harness(opts: { gateway?: boolean; webhook?: boolean; mailer?: boolean } = {}): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'tw01-cert-'));
  const gw = new RazorpayDouble();
  const rp = opts.gateway === false ? new Razorpay(null) : new Razorpay({ keyId: gw.keyId, keySecret: gw.keySecret, webhookSecret: opts.webhook === false ? '' : gw.webhookSecret }, gw.fetch);
  const mail = new RecordingMailer(opts.mailer !== false);
  const co = new Company({ store: new JsonStore(join(dir, 'state.json')), razorpay: rp, mailer: mail, dataDir: dir, env: { FOUNDER_EMAIL, FOUNDER_PASSWORD }, allowedOrigin: 'https://example.test' });
  await co.init();
  const { token } = await co.login(FOUNDER_EMAIL, FOUNDER_PASSWORD, 'test');
  const founder = (await co.actorFromToken(token))!;
  let n = 0;
  return {
    co, gw, mail, dir, founder,
    cleanup: () => rm(dir, { recursive: true, force: true }),
    async customer(email?: string) { n++; const r = await co.registerCustomer({ email: email ?? `buyer${n}@client${n}.in`, password: 'customer-pass-123', name: `Buyer ${n}`, company: `Client ${n} Pvt Ltd`, mobile: `98${String(10000000 + n).slice(-8)}` }, `ip${n}`); return (await co.actorFromToken(r.token))!; },
    async activeProduct(price = 14999) { await co.configureProduct(founder, 'hr-master', { price, active: true }); return 'hr-master'; },
  };
}

export const orderInput = (productId: string) => ({ productId, company: 'Client Pvt Ltd', employeeCount: 150, dataSource: 'Zoho People export', requiredFormat: 'HTML dashboard', deadline: '2099-12-31', additional: 'Department-wise attrition' });
