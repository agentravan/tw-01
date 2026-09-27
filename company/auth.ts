import { scryptSync } from 'node:crypto';
import type { Actor, CompanyState, User } from './types.js';
import { fail, randomToken, safeEqual, sha256 } from './util.js';

const N = 16384, R = 8, P = 1, KEYLEN = 32;
export const SESSION_HOURS = 12;

export function hashPassword(password: string, salt = randomToken(16)): string {
  const hash = scryptSync(password, salt, KEYLEN, { N, r: R, p: P }).toString('base64url');
  return `scrypt$${N}$${R}$${P}$${salt}$${hash}`;
}
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts;
  const got = scryptSync(password, salt, KEYLEN, { N: Number(n), r: Number(r), p: Number(p) }).toString('base64url');
  return safeEqual(got, hash);
}
export function validatePassword(pw: unknown): string {
  if (typeof pw !== 'string' || pw.length < 10) fail('VALIDATION', 'Password must be at least 10 characters.');
  if ((pw as string).length > 200) fail('VALIDATION', 'Password is too long.');
  return pw as string;
}

/** Creates a server-side session. Only the SHA-256 of the token is stored, so a leaked data file cannot be replayed. */
export function createSession(s: CompanyState, user: User, now: Date): string {
  const token = randomToken(32);
  s.sessions = s.sessions.filter(x => new Date(x.expiresAt) > now); // prune expired
  s.sessions.push({ tokenHash: sha256(token), userId: user.id, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + SESSION_HOURS * 3600e3).toISOString() });
  return token;
}
export function resolveSession(s: CompanyState, token: string | null, now: Date): Actor | null {
  if (!token) return null;
  const h = sha256(token);
  const sess = s.sessions.find(x => safeEqual(x.tokenHash, h));
  if (!sess || new Date(sess.expiresAt) <= now) return null;
  const u = s.users.find(x => x.id === sess.userId);
  if (!u || u.disabled) return null;
  return { kind: 'user', id: u.id, role: u.role, customerId: u.customerId };
}
export function revokeSession(s: CompanyState, token: string) {
  const h = sha256(token);
  s.sessions = s.sessions.filter(x => x.tokenHash !== h);
}

/** In-memory sliding-window limiter for login/registration abuse. Per process; adequate for a single instance. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private limit: number, private windowMs: number) {}
  check(key: string, now = Date.now()) {
    const arr = (this.hits.get(key) ?? []).filter(t => now - t < this.windowMs);
    if (arr.length >= this.limit) fail('RATE_LIMITED', 'Too many attempts. Wait a few minutes and try again.');
    arr.push(now); this.hits.set(key, arr);
  }
  reset(key: string) { this.hits.delete(key); }
}
