import type { Company } from '../company/service.js';
import type { Actor, Role } from '../company/types.js';
import { LocalAI } from './ollama.js';

export type JarvisIntent =
  | 'SECURITY_SCAN'
  | 'CERTIFICATION_RUN'
  | 'ORDER_PIPELINE'
  | 'METRICS_REPORT'
  | 'PRODUCT_MANAGEMENT'
  | 'STATUS'
  | 'UNKNOWN';

export interface JarvisPlan {
  assistant: 'JARVIS';
  executor: 'EDITH';
  intent: JarvisIntent;
  employee: Role | null;
  summary: string;
  steps: string[];
  requiresFounderApproval: boolean;
  mode: 'DETERMINISTIC' | 'OLLAMA_ASSISTED';
}

export interface JarvisResult {
  plan: JarvisPlan;
  task: Awaited<ReturnType<Company['submitObjective']>> | null;
  response: string;
}

const rules: Array<{ re: RegExp; intent: JarvisIntent; employee: Role | null; summary: string; steps: string[] }> = [
  { re: /security|audit|vulnerab|scan/i, intent: 'SECURITY_SCAN', employee: 'AI_SECURITY',
    summary: 'Run a security scan and record the findings.', steps: ['Route to AI Security', 'Execute the registered security tool', 'Record audit evidence'] },
  { re: /certif|self.?test|run tests?|test the workforce/i, intent: 'CERTIFICATION_RUN', employee: 'AI_QA',
    summary: 'Run the workforce certification suite and record the result.', steps: ['Route to AI QA', 'Run isolated certification scenarios', 'Record pass/fail evidence'] },
  { re: /ORD-\d+|order pipeline|deliver .*customer/i, intent: 'ORDER_PIPELINE', employee: 'AI_DASHBOARD',
    summary: 'Continue the requested order through the verified production pipeline.', steps: ['Resolve the order', 'Run the bounded production pipeline', 'Verify QA before delivery'] },
  { re: /revenue|kpi|metrics?|summary|business report/i, intent: 'METRICS_REPORT', employee: 'AI_DATA',
    summary: 'Generate a report from recorded company data.', steps: ['Read recorded business state', 'Compute metrics from source records', 'Return evidence-backed results'] },
  { re: /product management|manage products|seller dashboard|add .*product|edit .*product|activate.*product|deactivate.*product/i, intent: 'PRODUCT_MANAGEMENT', employee: 'AI_DASHBOARD',
    summary: 'Open and operate the existing e-commerce product-management capability.', steps: ['Route to the dashboard specialist', 'Verify the product-management capability exists', 'Use Founder-controlled product configuration for price, SLA and activation'] },
  { re: /status|health|what.*doing|workforce|employees/i, intent: 'STATUS', employee: 'AI_BOSS',
    summary: 'Read the current AI workforce state.', steps: ['Read recorded tasks and certifications', 'Report blocked, active and completed work'] },
];

function classify(text: string) {
  const hit = rules.find(x => x.re.test(text));
  return hit ?? { intent: 'UNKNOWN' as const, employee: null, summary: 'I do not have a verified executor for this request yet.', steps: ['Keep the request visible', 'Do not fake completion', 'Escalate when no verified capability exists'] };
}

export class JarvisEngine {
  private readonly local = new LocalAI();

  async plan(text: string): Promise<JarvisPlan> {
    const clean = String(text ?? '').trim();
    if (!clean) throw new Error('Give JARVIS a command.');
    const c = classify(clean);
    const ollama = process.env.JARVIS_OLLAMA === 'true' ? await this.local.status() : 'OFF';
    return {
      assistant: 'JARVIS',
      executor: 'EDITH',
      intent: c.intent,
      employee: c.employee,
      summary: c.summary,
      steps: c.steps,
      requiresFounderApproval: /refund|delete|disable|activate|payment|deploy|send/i.test(clean),
      mode: ollama === 'CONNECTED' ? 'OLLAMA_ASSISTED' : 'DETERMINISTIC',
    };
  }

  async execute(
    actor: Actor,
    text: string,
    submit: (text: string) => Promise<Awaited<ReturnType<Company['submitObjective']>>>,
  ): Promise<JarvisResult> {
    const plan = await this.plan(text);
    if (plan.intent === 'UNKNOWN' || plan.intent === 'STATUS') {
      return {
        plan,
        task: null,
        response: plan.intent === 'STATUS'
          ? 'JARVIS: I can report recorded workforce state from the Command Center. For execution, give me a concrete objective.'
          : 'JARVIS: I do not have a verified employee for that capability yet, so I will not pretend the work is complete.',
      };
    }
    const task = await submit(text);
    const response = task.status === 'COMPLETED'
      ? `JARVIS: Objective completed. EDITH verified the recorded result as ${task.id}.`
      : `JARVIS: Objective accepted as ${task.id}, but it is currently ${task.status}. I will not claim success until evidence is recorded.`;
    return { plan, task, response };
  }
}
