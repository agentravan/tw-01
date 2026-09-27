import type { CompanyState, Role, ToolDef, ToolExecution } from './types.js';
import { CompanyError, fail, summarize, uid } from './util.js';

export interface ToolImpl<I = any, O = any> {
  def: Omit<ToolDef, 'status' | 'lastTest'>;
  run(input: I): Promise<O> | O;
  /** Must exercise the real implementation and return a failure message, or null on pass. */
  selfTest(): Promise<string | null> | string | null;
}

/**
 * Tool registry. A tool becomes ACTIVE only after its self-test passes at registration.
 * Every execution is recorded (ToolExecutions) and its id is what tasks cite as evidence.
 */
export class ToolRuntime {
  private impls = new Map<string, ToolImpl>();

  async register(s: CompanyState, impl: ToolImpl, at: string): Promise<ToolDef> {
    let detail = 'pass'; let passed = false;
    try { const r = await withTimeout(Promise.resolve(impl.selfTest()), impl.def.timeoutMs, 'self-test'); passed = r == null; if (r) detail = r; }
    catch (e) { detail = `self-test threw: ${(e as Error).message}`; }
    const def: ToolDef = { ...impl.def, status: passed ? 'ACTIVE' : 'REJECTED', lastTest: { at, passed, detail } };
    const i = s.tools.findIndex(t => t.name === def.name);
    if (i >= 0) s.tools[i] = def; else s.tools.push(def);
    if (passed) this.impls.set(def.name, impl); else this.impls.delete(def.name);
    return def;
  }

  async execute<O = any>(s: CompanyState, agent: Role, name: string, input: unknown, ctx: { taskId?: string | null; at: () => string; inputSummary?: string; outputSummary?: (output: unknown) => string }): Promise<{ execution: ToolExecution; output: O }> {
    const def = s.tools.find(t => t.name === name);
    const impl = this.impls.get(name);
    const rec = (status: ToolExecution['status'], attempts: number, ms: number, out: unknown, error: string | null): ToolExecution => {
      const e: ToolExecution = { id: uid('tex'), tool: name, version: def?.version ?? '?', agent, taskId: ctx.taskId ?? null, at: ctx.at(), durationMs: ms, attempts, status, inputSummary: ctx.inputSummary?.slice(0, 200) ?? summarize(input, 200), outputSummary: ctx.outputSummary ? ctx.outputSummary(out).slice(0, 300) : summarize(out, 300), error };
      s.toolExecutions.push(e);
      if (s.toolExecutions.length > 5000) s.toolExecutions.splice(0, s.toolExecutions.length - 5000);
      return e;
    };
    if (!def || def.status !== 'ACTIVE' || !impl) { rec('DENIED', 0, 0, null, 'tool not registered or failed its self-test'); fail('BAD_STATE', `Tool ${name} is not active.`); }
    if (!def!.permissions.includes(agent)) { rec('DENIED', 0, 0, null, `${agent} lacks permission`); fail('FORBIDDEN', `${agent} may not use tool ${name}.`); }
    if (s.pausedAgents.includes(agent)) { rec('DENIED', 0, 0, null, 'agent paused'); fail('PAUSED', `${agent} is paused by the Founder.`); }
    const started = Date.now(); let attempts = 0; let lastErr = ''; let lastCode: CompanyError['code'] | null = null;
    while (attempts <= def!.retry) { // bounded: at most retry+1 attempts
      attempts++;
      try {
        const output = await withTimeout(Promise.resolve(impl!.run(input)), def!.timeoutMs, name);
        return { execution: rec('OK', attempts, Date.now() - started, output, null), output: output as O };
      } catch (e) {
        lastErr = (e as Error).message;
        lastCode = e instanceof CompanyError ? e.code : null;
        // Do not retry errors that cannot succeed on retry (bad input, missing configuration).
        if ((e as any)?.noRetry || lastCode === 'VALIDATION' || lastCode === 'NOT_CONFIGURED') break;
      }
    }
    const timedOut = /timed out/.test(lastErr);
    const ex = rec(timedOut ? 'TIMEOUT' : 'FAILED', attempts, Date.now() - started, null, lastErr);
    const msg = `Tool ${name} failed after ${attempts} attempt(s): ${lastErr}`;
    // Keep the original error class: gateway/config/validation errors map to their HTTP status; internal bugs stay 500.
    const err: any = lastCode ? new CompanyError(lastCode, msg) : timedOut ? new CompanyError('GATEWAY', msg) : new Error(msg);
    err.execution = ex; throw err;
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([p, new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms); })]).finally(() => clearTimeout(t));
}
