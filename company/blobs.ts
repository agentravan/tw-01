import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { supabaseConfigFromEnv, supabaseRpc, type SupabaseConfig } from '../memory/supabase.js';

/**
 * Storage for customer uploads and delivered dashboards. Keys are relative paths such as
 * "uploads/ORD-1001/fil_x.csv". Local runs use the data folder; hosted runs use Postgres (tw01_blobs).
 */
export interface BlobStore {
  readonly kind: 'fs' | 'supabase';
  put(key: string, content: string): Promise<void>;
  get(key: string): Promise<string | null>;
  remove(key: string): Promise<void>;
}

const checkKey = (key: string) => { if (!/^[A-Za-z0-9_\-./]+$/.test(key) || key.includes('..') || key.startsWith('/')) throw new Error(`invalid blob key ${key}`); return key; };

export class FsBlobStore implements BlobStore {
  readonly kind = 'fs';
  constructor(private root: string) {}
  private path(key: string) { const p = resolve(this.root, checkKey(key)); if (!p.startsWith(resolve(this.root) + sep)) throw new Error('blob key escapes root'); return p; }
  async put(key: string, content: string) { const p = this.path(key); await mkdir(dirname(p), { recursive: true }); await writeFile(p, content, 'utf8'); }
  async get(key: string) { try { return await readFile(this.path(key), 'utf8'); } catch (e: any) { if (e?.code === 'ENOENT') return null; throw e; } }
  async remove(key: string) { await rm(this.path(key), { force: true }); }
}

export class SupabaseBlobStore implements BlobStore {
  readonly kind = 'supabase';
  constructor(private cfg: SupabaseConfig) {}
  async put(key: string, content: string) { await supabaseRpc(this.cfg, 'tw01_blob_put', { p_path: checkKey(key), p_content: content }); }
  async get(key: string) { return supabaseRpc<string | null>(this.cfg, 'tw01_blob_get', { p_path: checkKey(key) }); }
  async remove(key: string) { await supabaseRpc(this.cfg, 'tw01_blob_delete', { p_path: checkKey(key) }); }
}

export function defaultBlobStore(dataDir: string): BlobStore {
  const sb = supabaseConfigFromEnv();
  return sb ? new SupabaseBlobStore(sb) : new FsBlobStore(dataDir);
}
