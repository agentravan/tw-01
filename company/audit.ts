import type { Actor, AuditEntry, CompanyState } from './types.js';
import { sha256, uid } from './util.js';

const GENESIS = 'GENESIS';
const material = (e: Omit<AuditEntry, 'hash'>) =>
  [e.seq, e.id, e.at, e.who, e.role, e.what, e.why, e.taskId, e.tool, e.entity, e.entityId, e.result, e.detail, e.approvalId, e.prevHash].join('␟');

export interface AuditInput {
  what: string; why?: string; taskId?: string | null; tool?: string | null; entity?: string | null; entityId?: string | null;
  result?: AuditEntry['result']; detail?: string; approvalId?: string | null;
}

/** Append-only, hash-chained audit log: WHO, WHAT, WHEN, WHY, TASK, TOOL, RESULT, APPROVAL. */
export function appendAudit(s: CompanyState, actor: Actor | null, at: string, input: AuditInput): AuditEntry {
  const prev = s.audit.at(-1);
  const base: Omit<AuditEntry, 'hash'> = {
    seq: (prev?.seq ?? 0) + 1, id: uid('aud'), at,
    who: actor ? `${actor.kind}:${actor.id}` : 'anonymous',
    role: actor ? (actor.kind === 'gateway' ? 'GATEWAY' : actor.role) : 'ANON',
    what: input.what, why: input.why ?? '', taskId: input.taskId ?? null, tool: input.tool ?? null,
    entity: input.entity ?? null, entityId: input.entityId ?? null, result: input.result ?? 'OK',
    detail: input.detail ?? '', approvalId: input.approvalId ?? null, prevHash: prev?.hash ?? GENESIS,
  };
  const entry: AuditEntry = { ...base, hash: sha256(material(base)) };
  s.audit.push(entry);
  return entry;
}

export function verifyAuditChain(entries: AuditEntry[]): { ok: boolean; checked: number; brokenAt: number | null; reason: string | null } {
  let prev = GENESIS;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.seq !== i + 1) return { ok: false, checked: i, brokenAt: e.seq, reason: 'sequence gap (entry removed or reordered)' };
    if (e.prevHash !== prev) return { ok: false, checked: i, brokenAt: e.seq, reason: 'previous-hash mismatch' };
    const { hash, ...rest } = e;
    if (sha256(material(rest)) !== hash) return { ok: false, checked: i, brokenAt: e.seq, reason: 'entry content was modified' };
    prev = hash;
  }
  return { ok: true, checked: entries.length, brokenAt: null, reason: null };
}
