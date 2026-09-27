/**
 * Minimal Supabase client for TW-01 (no SDK dependency): calls the secret-gated Postgres functions
 * created by supabase/migrations/0001_tw01_secure_store.sql through the PostgREST RPC endpoint.
 */
export interface SupabaseConfig { url: string; apiKey: string; secret: string; fetch?: typeof fetch }

export function supabaseConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SupabaseConfig | null {
  const url = env.TW01_SUPABASE_URL ?? '', apiKey = env.TW01_SUPABASE_KEY ?? '', secret = env.TW01_DB_SECRET ?? '';
  if (!url && !apiKey && !secret) return null;
  if (!url || !apiKey || !secret) throw new Error('Supabase storage is partly configured: set TW01_SUPABASE_URL, TW01_SUPABASE_KEY and TW01_DB_SECRET together.');
  return { url: url.replace(/\/+$/, ''), apiKey, secret };
}

export async function supabaseRpc<T>(cfg: SupabaseConfig, fn: string, args: Record<string, unknown>): Promise<T> {
  const http = cfg.fetch ?? fetch;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await http(`${cfg.url}/rest/v1/rpc/${fn}`, {
        method: 'POST', signal: AbortSignal.timeout(15_000),
        headers: { apikey: cfg.apiKey, authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ p_secret: cfg.secret, ...args }),
      });
      const text = await res.text();
      if (res.ok) return (text ? JSON.parse(text) : null) as T;
      const err = new Error(`Supabase ${fn} → HTTP ${res.status}: ${text.slice(0, 200)}`);
      if (res.status < 500) throw Object.assign(err, { noRetry: true }); // auth/validation errors do not improve on retry
      lastErr = err;
    } catch (e) {
      if ((e as any)?.noRetry) throw e;
      lastErr = e;
    }
    await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
  }
  throw lastErr;
}
