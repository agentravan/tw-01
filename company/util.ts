import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export class CompanyError extends Error {
  constructor(public code: 'VALIDATION' | 'FORBIDDEN' | 'UNAUTHENTICATED' | 'NOT_FOUND' | 'BAD_STATE' | 'APPROVAL_REQUIRED' | 'NOT_CONFIGURED' | 'GATEWAY' | 'RATE_LIMITED' | 'PAUSED' | 'CONFLICT', message: string, public httpStatus = 0) {
    super(message);
    if (!httpStatus) this.httpStatus = ({ VALIDATION: 400, FORBIDDEN: 403, UNAUTHENTICATED: 401, NOT_FOUND: 404, BAD_STATE: 409, APPROVAL_REQUIRED: 409, NOT_CONFIGURED: 503, GATEWAY: 502, RATE_LIMITED: 429, PAUSED: 409, CONFLICT: 409 } as const)[code];
  }
}
export const fail = (code: CompanyError['code'], msg: string): never => { throw new CompanyError(code, msg); };

export interface Clock { now(): Date }
export const systemClock: Clock = { now: () => new Date() };

export const uid = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
export const hmacHex = (key: string, msg: string | Buffer) => createHmac('sha256', key).update(msg).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** Constant-time comparison of two hex/ascii strings. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function str(v: unknown, field: string, opts: { min?: number; max?: number; optional?: boolean } = {}): string {
  if (v == null || v === '') { if (opts.optional) return ''; fail('VALIDATION', `${field} is required.`); }
  if (typeof v !== 'string' && typeof v !== 'number') fail('VALIDATION', `${field} must be text.`);
  const s = String(v).trim();
  if (opts.min != null && s.length < opts.min) fail('VALIDATION', `${field} must be at least ${opts.min} characters.`);
  if (s.length > (opts.max ?? 2000)) fail('VALIDATION', `${field} must be at most ${opts.max ?? 2000} characters.`);
  return s;
}
export function email(v: unknown, field = 'email'): string {
  const s = str(v, field, { max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) fail('VALIDATION', `${field} is not a valid email address.`);
  return s;
}
export function indianMobile(v: unknown): string {
  const digits = str(v, 'mobile', { max: 20 }).replace(/[\s-]/g, '').replace(/^\+?91/, '');
  if (!/^[6-9]\d{9}$/.test(digits)) fail('VALIDATION', 'mobile must be a 10-digit Indian mobile number (optionally with +91).');
  return '+91' + digits;
}
export function money(v: unknown, field: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 10_000_000) fail('VALIDATION', `${field} must be a positive amount in rupees.`);
  return Math.round(n * 100) / 100;
}
export function isoDate(v: unknown, field: string, optional = false): string {
  const s = str(v, field, { optional, max: 10 });
  if (!s) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s + 'T00:00:00Z'))) fail('VALIDATION', `${field} must be a date (YYYY-MM-DD).`);
  return s;
}
export const clip = (s: string, n = 200) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
export const summarize = (v: unknown, n = 300) => { try { return clip(typeof v === 'string' ? v : JSON.stringify(v), n); } catch { return '[unserializable]'; } };
export const escapeHtml = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
