import { createHash } from 'node:crypto';

/**
 * TEST DOUBLE of the Supabase RPC endpoints created by supabase/migrations/0001_tw01_secure_store.sql
 * (tw01_load / tw01_save / tw01_blob_put / tw01_blob_get / tw01_blob_delete), with the same secret check
 * and compare-and-swap semantics. The real functions were exercised against the live database; this double
 * lets tests and the local Vercel-bundle run use the same client code without network access.
 */
export class SupabaseDouble {
  state = new Map<string, { version: number; data: unknown }>(); blobs = new Map<string, string>(); calls: string[] = [];
  constructor(readonly apiKey = 'sb_publishable_double', readonly secret = 'double-db-secret-0123456789') {}
  private sha = (s: string) => createHash('sha256').update(s).digest('hex');

  fetch = (async (input: any, init: any = {}) => {
    const url = new URL(String(input)); const fn = url.pathname.replace('/rest/v1/rpc/', '');
    this.calls.push(fn);
    if ((init.headers?.apikey ?? '') !== this.apiKey) return json(401, { message: 'Invalid API key' });
    const a = JSON.parse(init.body ?? '{}');
    if (this.sha(String(a.p_secret ?? '')) !== this.sha(this.secret)) return json(403, { code: '42501', message: 'forbidden' });
    switch (fn) {
      case 'tw01_load': { const r = this.state.get(a.p_key); return json(200, r ? { version: r.version, data: r.data } : null); }
      case 'tw01_save': {
        const cur = this.state.get(a.p_key);
        if (a.p_expected === 0) { if (cur) return json(200, -1); this.state.set(a.p_key, { version: 1, data: a.p_data }); return json(200, 1); }
        if (!cur || cur.version !== a.p_expected) return json(200, -1);
        this.state.set(a.p_key, { version: cur.version + 1, data: a.p_data }); return json(200, cur.version + 1);
      }
      case 'tw01_blob_put': this.blobs.set(a.p_path, a.p_content); return json(200, Buffer.byteLength(a.p_content));
      case 'tw01_blob_get': return json(200, this.blobs.get(a.p_path) ?? null);
      case 'tw01_blob_delete': this.blobs.delete(a.p_path); return json(200, null);
      default: return json(404, { message: 'no such function' });
    }
  }) as typeof fetch;

  config(url = 'https://double.supabase.test') { return { url, apiKey: this.apiKey, secret: this.secret, fetch: this.fetch }; }
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
