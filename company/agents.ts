import type { CertLevel, CompanyState, Role, TestRun } from './types.js';
import { PERMISSIONS } from './rbac.js';

export interface EmployeeDef {
  role: Role; name: string; version: string; mission: string; inputs: string[]; tools: string[]; outputs: string[];
  acceptance: string[]; failureStrategy: string;
  /** true only when an executor exists in code. Unimplemented employees are listed honestly as DEVELOPMENT. */
  implemented: boolean;
}

export const EMPLOYEES: EmployeeDef[] = [
  { role: 'AI_BOSS', name: 'AI Boss', version: '1.0.0', implemented: true,
    mission: 'Receive founder objectives, break them into tasks, assign the right employee, verify evidence, escalate and report.',
    inputs: ['founder objectives', 'task states', 'evidence records'], tools: ['task engine', 'routing rules', 'report generator'],
    outputs: ['tasks', 'assignments', 'daily report'], failureStrategy: 'Bounded retries per task (max 3), then ESCALATED to the Founder.',
    acceptance: ['Routes a known objective to the correct employee', 'Never completes a task without validated evidence and a QA pass by another employee', 'Escalates after retries are exhausted', 'Unroutable objectives are escalated, not guessed'] },
  { role: 'AI_DASHBOARD', name: 'AI Dashboard Specialist', version: '1.0.0', implemented: true,
    mission: 'Turn a paid order and the customer’s data into a correct, tested dashboard and guide book.',
    inputs: ['paid order', 'requirement form', 'employee master CSV'], tools: ['csv.validate', 'hr.kpi', 'dashboard.render', 'guide.render'],
    outputs: ['dashboard.html', 'guide.html', 'build record'], failureStrategy: 'Invalid data → INFO_REQUIRED email to customer; build errors retried, then escalated.',
    acceptance: ['Refuses to start before verified payment or Founder override', 'Rejects files missing required columns', 'KPIs match an independent recompute', 'Filters, charts and table present', 'Guide lists every KPI in the build'] },
  { role: 'AI_QA', name: 'AI QA Officer', version: '1.0.0', implemented: true,
    mission: 'Independently verify other employees’ work; never trust the producer’s claim.',
    inputs: ['build record', 'raw customer file', 'dashboard and guide files'], tools: ['qa.dashboard'],
    outputs: ['QA report with per-check evidence'], failureStrategy: 'Any failed check sends the work back to the producer as REVISION.',
    acceptance: ['Detects a wrong KPI', 'Detects leaked data from another customer', 'Detects a missing guide', 'Cannot QA its own work'] },
  { role: 'AI_FINANCE', name: 'AI Finance Officer', version: '1.0.0', implemented: true,
    mission: 'Verify payments with the gateway, track revenue and refunds from actual records only.',
    inputs: ['Razorpay checkout responses', 'Razorpay webhooks', 'payment claims'], tools: ['razorpay.verify_signature', 'razorpay.fetch_payment', 'razorpay.verify_webhook'],
    outputs: ['payment records', 'revenue figures'], failureStrategy: 'Unverifiable payments stay unpaid; claims without gateway confirmation go to PAYMENT_REVIEW.',
    acceptance: ['Accepts only valid HMAC signatures', 'Rejects amount or order mismatch', 'Ignores duplicate webhook events', 'Never treats a screenshot as proof'] },
  { role: 'AI_SECURITY', name: 'AI Security Officer', version: '1.0.0', implemented: true,
    mission: 'Check authentication, authorization, secrets, audit integrity, webhook trust and data isolation.',
    inputs: ['company state', 'environment configuration'], tools: ['security.scan'], outputs: ['security report'],
    failureStrategy: 'Critical findings block production readiness and are reported to the Founder.',
    acceptance: ['Detects a tampered audit log', 'Detects missing webhook secret', 'Verifies customers hold no internal permissions', 'Detects plaintext secrets in stored data'] },
  { role: 'AI_DATA', name: 'AI Data Analyst', version: '1.0.0', implemented: true,
    mission: 'Produce KPIs and reports from actual company records.',
    inputs: ['orders', 'payments', 'tasks'], tools: ['report.metrics'], outputs: ['command-center metrics', 'daily report'],
    failureStrategy: 'Missing data is reported as missing, never estimated.', acceptance: ['Revenue equals sum of verified payments minus refunds', 'Counts match records'] },
  { role: 'AI_SUPPORT', name: 'AI Customer Support Officer', version: '0.1.0', implemented: false,
    mission: 'Handle customer questions on payments, orders, delivery and revisions; escalate uncertain or high-risk issues.', inputs: ['customer messages'], tools: [], outputs: ['replies', 'escalations'], failureStrategy: 'Escalate to Founder.', acceptance: ['Not yet defined in code'] },
  { role: 'AI_OPERATOR', name: 'AI Operator', version: '0.1.0', implemented: false,
    mission: 'Build, test and register new capabilities and tools requested by the AI Boss.', inputs: ['capability requests'], tools: ['tool registry'], outputs: ['registered tools'], failureStrategy: 'Do not report success when self-tests fail.', acceptance: ['Not yet defined in code'] },
  { role: 'AI_RESEARCHER', name: 'AI Researcher', version: '0.1.0', implemented: false, mission: 'Research official documentation, APIs and products.', inputs: ['questions'], tools: [], outputs: ['cited findings'], failureStrategy: 'Prefer official sources; report uncertainty.', acceptance: ['Not yet defined in code'] },
  { role: 'AI_SALES', name: 'AI Sales Officer', version: '0.1.0', implemented: false, mission: 'Lead → qualification → contact → follow-up → demo → proposal → payment. The existing TW-01 sales engine covers lead scoring and drafts; it is not yet certified under this harness.', inputs: ['leads'], tools: ['existing sales engine'], outputs: ['pipeline updates'], failureStrategy: 'Outbound actions need approval.', acceptance: ['Not yet defined in code'] },
  { role: 'AI_MARKETING', name: 'AI Marketing Officer', version: '0.1.0', implemented: false, mission: 'SEO, LinkedIn, content, email, case studies.', inputs: [], tools: [], outputs: [], failureStrategy: 'Escalate.', acceptance: ['Not yet defined in code'] },
  { role: 'AI_HR', name: 'AI HR Officer', version: '0.1.0', implemented: false, mission: 'Routine payroll, PF, ESIC, PT, LWF, TDS and compliance workflows with human review for statutory matters.', inputs: [], tools: [], outputs: [], failureStrategy: 'Human review for statutory/legal matters.', acceptance: ['Not yet defined in code'] },
  { role: 'AI_ORDER', name: 'AI Order Officer', version: '0.1.0', implemented: false, mission: 'Dropshipping orders: payment status, supplier order, tracking, delivery, returns, refunds.', inputs: [], tools: [], outputs: [], failureStrategy: 'Escalate.', acceptance: ['Not yet defined in code'] },
  { role: 'AI_SUPPLIER', name: 'AI Supplier Officer', version: '0.1.0', implemented: false, mission: 'Track suppliers, costs, margins, stock, shipping and return rates.', inputs: [], tools: [], outputs: [], failureStrategy: 'Escalate.', acceptance: ['Not yet defined in code'] },
  { role: 'AI_DOCS', name: 'AI Documentation Officer', version: '0.1.0', implemented: false, mission: 'Keep README, SOPs, agent and tool docs matching the implementation.', inputs: [], tools: [], outputs: [], failureStrategy: 'Escalate.', acceptance: ['Not yet defined in code'] },
];

export const LEVELS: CertLevel[] = ['UNIT', 'INTEGRATION', 'FUNCTIONAL', 'FAILURE', 'SECURITY', 'REGRESSION', 'PRODUCTION'];
export type LevelResult = 'PASS' | 'FAIL' | 'NOT_RUN';
export type ProductionStatus = 'PRODUCTION_READY' | 'TESTING' | 'FAILED' | 'DEVELOPMENT' | 'BLOCKED';

/**
 * Certification is computed only from recorded test runs. A level is PASS only if the most recent run
 * that exercised it passed every scenario at that level. PRODUCTION needs a run against a deployed URL.
 */
export function certification(s: CompanyState, def: EmployeeDef) {
  const levels = {} as Record<CertLevel, { result: LevelResult; runId: string | null; at: string | null; passed: number; failed: number }>;
  for (const lvl of LEVELS) {
    const runs = [...s.testRuns].reverse().filter(r => r.results.some(x => x.employee === def.role && x.level === lvl) && (lvl !== 'PRODUCTION' || r.environment === 'production'));
    const r: TestRun | undefined = runs[0];
    if (!r) { levels[lvl] = { result: 'NOT_RUN', runId: null, at: null, passed: 0, failed: 0 }; continue; }
    const rs = r.results.filter(x => x.employee === def.role && x.level === lvl);
    const failed = rs.filter(x => !x.passed).length;
    levels[lvl] = { result: failed ? 'FAIL' : 'PASS', runId: r.id, at: r.at, passed: rs.length - failed, failed };
  }
  const vals = Object.values(levels).map(v => v.result);
  const status: ProductionStatus = !def.implemented ? 'DEVELOPMENT' : vals.includes('FAIL') ? 'FAILED' : vals.every(v => v === 'PASS') ? 'PRODUCTION_READY' : vals.some(v => v === 'PASS') ? 'TESTING' : 'DEVELOPMENT';
  const last = Object.values(levels).map(v => v.at).filter(Boolean).sort().at(-1) ?? null;
  return { employee: def.name, role: def.role, version: def.version, mission: def.mission, implemented: def.implemented, levels, status, lastVerified: last,
    permissions: Object.entries(PERMISSIONS).filter(([, roles]) => roles.includes(def.role)).map(([p]) => p) };
}
