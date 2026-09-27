import { describe, it, expect } from 'vitest';
import { JsonStore, SupabaseBackend, StoreConflictError } from '../memory/store.js';
import { SupabaseBlobStore } from '../company/blobs.js';
import { SupabaseDouble } from '../company/testing/supabase-double.js';
import { Company } from '../company/service.js';
import { Razorpay } from '../company/razorpay.js';
import { RazorpayDouble } from '../company/testing/gateway-double.js';
import { RecordingMailer, orderInput } from '../company/testing/harness.js';
import { generatedCsv } from '../company/testing/fixtures.js';

describe('Supabase storage backend', () => {
  it('round-trips state and bumps the version', async () => {
    const db = new SupabaseDouble(); const store = new JsonStore(new SupabaseBackend(db.config(), 't1'));
    await store.update(s => { s.memory.push({ id: 'm1', kind: 'fact', text: 'x', tags: [], created_at: '' }); });
    expect((await store.load()).memory.length).toBe(1);
    expect(db.state.get('t1')!.version).toBe(1);
  });
  it('detects a write by another instance (compare-and-swap) and never overwrites it', async () => {
    const db = new SupabaseDouble();
    const a = new JsonStore(new SupabaseBackend(db.config(), 't2'));
    await a.update(s => { s.memory.push({ id: 'first', kind: 'f', text: '', tags: [], created_at: '' }); });
    let conflict = false;
    await a.transact(async s => {
      // another server instance writes in between
      db.state.set('t2', { version: db.state.get('t2')!.version + 1, data: { ...(db.state.get('t2')!.data as any), memory: [{ id: 'other-instance' }] } });
      s.memory.push({ id: 'mine', kind: 'f', text: '', tags: [], created_at: '' });
    }).catch(e => { conflict = e instanceof StoreConflictError; });
    expect(conflict).toBe(true);
    expect(JSON.stringify(db.state.get('t2')!.data).includes('other-instance')).toBe(true);
  });
  it('pure updates retry after a conflict and keep both writes', async () => {
    const db = new SupabaseDouble(); const store = new JsonStore(new SupabaseBackend(db.config(), 't3'));
    await store.update(s => { s.memory.push({ id: 'a', kind: 'f', text: '', tags: [], created_at: '' }); });
    let injected = false;
    await store.update(s => {
      if (!injected) { injected = true; const cur = db.state.get('t3')!; db.state.set('t3', { version: cur.version + 1, data: { ...(cur.data as any), memory: [...(cur.data as any).memory, { id: 'b', kind: 'f', text: '', tags: [], created_at: '' }] } }); }
      s.memory.push({ id: 'c', kind: 'f', text: '', tags: [], created_at: '' });
    });
    expect((await store.load()).memory.map(m => m.id).sort().join()).toBe('a,b,c');
  });
  it('refuses a wrong secret', async () => {
    const db = new SupabaseDouble(); const store = new JsonStore(new SupabaseBackend({ ...db.config(), secret: 'wrong' }, 't4'));
    let msg = ''; try { await store.load(); } catch (e) { msg = (e as Error).message; }
    expect(msg.includes('HTTP 403')).toBe(true);
  });
  it('blob store keeps customer files and rejects unsafe keys', async () => {
    const db = new SupabaseDouble(); const blobs = new SupabaseBlobStore(db.config());
    await blobs.put('uploads/ORD-1/f.csv', 'a,b'); expect(await blobs.get('uploads/ORD-1/f.csv')).toBe('a,b');
    await blobs.remove('uploads/ORD-1/f.csv'); expect(await blobs.get('uploads/ORD-1/f.csv')).toBeNull();
    let bad = false; try { await blobs.put('../etc/passwd', 'x'); } catch { bad = true; } expect(bad).toBe(true);
  });
  it('a full paid order runs end to end on Supabase storage', async () => {
    const db = new SupabaseDouble(); const gw = new RazorpayDouble();
    const co = new Company({ store: new JsonStore(new SupabaseBackend(db.config(), 'e2e')), blobs: new SupabaseBlobStore(db.config()), razorpay: new Razorpay({ keyId: gw.keyId, keySecret: gw.keySecret, webhookSecret: gw.webhookSecret }, gw.fetch), mailer: new RecordingMailer(), env: { FOUNDER_EMAIL: 'f@x.in', FOUNDER_PASSWORD: 'founder-password-1' } });
    await co.init();
    const F = (await co.actorFromToken((await co.login('f@x.in', 'founder-password-1', 'ip')).token))!;
    await co.configureProduct(F, 'hr-master', { price: 14999, active: true });
    const C = (await co.actorFromToken((await co.registerCustomer({ email: 'c@y.in', password: 'customer-pass-1', name: 'C', company: 'Y', mobile: '9876543210' }, 'ip2')).token))!;
    const { order, checkout } = await co.createOrder(C, orderInput('hr-master'));
    await co.uploadFile(C, order.id, 'e.csv', generatedCsv());
    await co.confirmCheckout(C, order.id, gw.pay((checkout as any).gatewayOrderId));
    const r = await co.runOrderPipeline(order.id);
    expect(r.status).toBe('DELIVERED');
    expect([...db.blobs.keys()].some(k => k.endsWith('dashboard.html'))).toBe(true);
    expect((await co.health()).store.kind).toBe('supabase-postgres');
  });
});
