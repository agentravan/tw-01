// TW-01 Company OS — entity types. Everything the founder sees is derived from these records.

export type Role =
  | 'FOUNDER' | 'AI_BOSS' | 'AI_OPERATOR' | 'AI_RESEARCHER' | 'AI_DASHBOARD' | 'AI_SALES' | 'AI_MARKETING'
  | 'AI_FINANCE' | 'AI_HR' | 'AI_ORDER' | 'AI_SUPPLIER' | 'AI_SUPPORT' | 'AI_DATA' | 'AI_QA' | 'AI_SECURITY'
  | 'AI_DOCS' | 'CUSTOMER';

export interface User {
  id: string; email: string; name: string; role: 'FOUNDER' | 'CUSTOMER';
  passwordHash: string; // scrypt$N$r$p$salt$hash
  customerId: string | null; createdAt: string; disabled: boolean;
}
export interface Session { tokenHash: string; userId: string; createdAt: string; expiresAt: string; }

/** Who performed an action. Humans are users; AI employees are agents. */
export type Actor = { kind: 'user'; id: string; role: Role; customerId?: string | null } | { kind: 'agent'; id: string; role: Role } | { kind: 'system'; id: 'system'; role: 'AI_BOSS' } | { kind: 'gateway'; id: 'razorpay'; role: 'AI_FINANCE' };

export interface AuditEntry {
  seq: number; id: string; at: string;
  who: string; role: Role | 'GATEWAY' | 'ANON'; what: string; why: string;
  taskId: string | null; tool: string | null; entity: string | null; entityId: string | null;
  result: 'OK' | 'DENIED' | 'FAILED'; detail: string; approvalId: string | null;
  prevHash: string; hash: string;
}

export type Tier = 'GREEN' | 'YELLOW' | 'RED';
export interface Approval {
  id: string; action: string; tier: Tier; entity: string; entityId: string;
  reason: string; summary: string; payload: Record<string, unknown>;
  status: 'PENDING' | 'APPROVED' | 'REJECTED'; requestedBy: string; requestedAt: string;
  decidedBy: string | null; decidedAt: string | null; rejectionReason: string | null;
}

export type TaskStatus = 'PLANNED' | 'ASSIGNED' | 'IN_PROGRESS' | 'WAITING' | 'QA' | 'COMPLETED' | 'FAILED' | 'ESCALATED' | 'CANCELLED';
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export interface Evidence { kind: 'tool_execution' | 'audit' | 'file' | 'test_run' | 'payment' | 'email'; ref: string; note: string; }
export interface Task {
  id: string; title: string; description: string; type: string; agent: Role; priority: Priority; status: TaskStatus;
  inputs: Record<string, unknown>; outputs: Record<string, unknown>; dependencies: string[];
  approvalId: string | null; evidence: Evidence[]; errors: string[]; retryCount: number; maxRetries: number;
  orderId: string | null; createdBy: string; qaBy: string | null;
  createdAt: string; updatedAt: string; completedAt: string | null;
}
export interface TaskEvent { id: string; taskId: string; at: string; by: string; from: TaskStatus | null; to: TaskStatus; note: string; }

export interface ToolDef {
  name: string; purpose: string; permissions: Role[]; input: string; output: string;
  risk: Tier; approval: 'NONE' | 'FOUNDER'; timeoutMs: number; retry: number; version: string;
  status: 'ACTIVE' | 'REJECTED'; lastTest: { at: string; passed: boolean; detail: string } | null;
}
export interface ToolExecution {
  id: string; tool: string; version: string; agent: Role; taskId: string | null; at: string; durationMs: number;
  attempts: number; status: 'OK' | 'FAILED' | 'TIMEOUT' | 'DENIED'; inputSummary: string; outputSummary: string; error: string | null;
}

export interface Product {
  id: string; name: string; category: 'DASHBOARD'; price: number | null; paymentMode: 'ONLINE';
  deliveryType: 'HTML_DASHBOARD'; requiredFields: string[]; requiredFiles: { name: string; columns: string[] }[];
  assignedSpecialist: Role; slaDays: number; guideTemplate: string; builder: 'hr_employee_master' | null;
  active: boolean; kpis: string[];
}

export type OrderStatus = 'AWAITING_PAYMENT' | 'PAYMENT_FAILED' | 'PAYMENT_REVIEW' | 'PAID' | 'IN_PRODUCTION' | 'INFO_REQUIRED'
  | 'QA' | 'REVISION' | 'DELIVERED' | 'REFUND_REQUESTED' | 'REFUNDED' | 'CANCELLED';
export interface Customer { id: string; name: string; company: string; email: string; mobile: string; createdAt: string; }
export interface Order {
  id: string; customerId: string; productId: string; productName: string; amount: number; currency: 'INR';
  status: OrderStatus; requirement: Record<string, string>; files: StoredFile[];
  gatewayOrderId: string | null; paymentVerified: boolean; paymentId: string | null;
  productionOverrideApprovalId: string | null; revisionCount: number; revisionNotes: string[];
  deliverables: { dashboard: string | null; guide: string | null; buildId: string | null };
  timeline: { at: string; from: OrderStatus | null; to: OrderStatus; by: string; note: string }[];
  createdAt: string; updatedAt: string;
}
export interface StoredFile { id: string; name: string; path: string; bytes: number; sha256: string; uploadedAt: string; }
export interface PaymentRecord {
  id: string; orderId: string; source: 'CHECKOUT' | 'WEBHOOK' | 'CLAIM';
  razorpay_order_id: string | null; razorpay_payment_id: string | null; signatureValid: boolean | null;
  gatewayStatus: string | null; amountPaise: number | null; method: string | null; verified: boolean;
  failureReason: string | null; at: string; evidence: string;
}
export interface WebhookEvent { eventId: string; event: string; receivedAt: string; signatureValid: boolean; processed: boolean; note: string; }
export interface PaymentClaim { id: string; orderId: string; customerId: string; paymentId: string; screenshot: StoredFile | null; status: 'VERIFIED' | 'REJECTED' | 'PENDING_GATEWAY'; note: string; at: string; }

export interface Email { id: string; template: string; to: string; subject: string; body: string; orderId: string | null; status: 'SENT' | 'NOT_CONFIGURED' | 'FAILED'; providerId: string | null; error: string | null; at: string; }

export interface DashboardBuild {
  id: string; orderId: string; productId: string; at: string; kpis: Record<string, number>;
  rowCount: number; asOf: string; filters: Record<string, string[]>; dashboardPath: string; guidePath: string | null;
  dataSha256: string;
}
export interface QAReport { id: string; orderId: string; buildId: string; by: Role; at: string; passed: boolean; checks: { name: string; passed: boolean; detail: string }[]; }

export type CertLevel = 'UNIT' | 'INTEGRATION' | 'FUNCTIONAL' | 'FAILURE' | 'SECURITY' | 'REGRESSION' | 'PRODUCTION';
export interface TestResult { scenario: string; employee: Role; level: CertLevel; passed: boolean; detail: string; evidence: string[]; durationMs: number; }
export interface TestRun { id: string; at: string; trigger: string; environment: 'local' | 'production'; baseUrl: string | null; results: TestResult[]; passed: number; failed: number; codeVersion: string; }

export interface CompanyState {
  version: 1;
  users: User[]; sessions: Session[]; customers: Customer[];
  audit: AuditEntry[]; approvals: Approval[];
  tasks: Task[]; taskEvents: TaskEvent[];
  tools: ToolDef[]; toolExecutions: ToolExecution[];
  products: Product[]; orders: Order[]; payments: PaymentRecord[]; webhookEvents: WebhookEvent[]; claims: PaymentClaim[];
  emails: Email[]; builds: DashboardBuild[]; qaReports: QAReport[];
  testRuns: TestRun[]; pausedAgents: Role[];
  settings: { yellowRefundAutoLimit: number; largePaymentRedThreshold: number };
}

export function emptyCompany(): CompanyState {
  return {
    version: 1, users: [], sessions: [], customers: [], audit: [], approvals: [], tasks: [], taskEvents: [],
    tools: [], toolExecutions: [], products: [], orders: [], payments: [], webhookEvents: [], claims: [],
    emails: [], builds: [], qaReports: [], testRuns: [], pausedAgents: [],
    settings: { yellowRefundAutoLimit: 0, largePaymentRedThreshold: 50000 },
  };
}
