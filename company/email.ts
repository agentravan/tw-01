import type { Email } from './types.js';
import { uid } from './util.js';

export const TEMPLATES: Record<string, { subject: string; body: string }> = {
  ORDER_RECEIVED: { subject: 'We received your dashboard order {{orderId}}', body: 'Hello {{name}},\n\nThank you for ordering the {{product}}. Your order {{orderId}} is waiting for payment of ₹{{amount}}.\n\n— Team Work Solutions' },
  PAYMENT_SUCCESSFUL: { subject: 'Payment received for order {{orderId}}', body: 'Hello {{name}},\n\nWe have verified your payment of ₹{{amount}} (payment {{paymentId}}). Work on your dashboard starts now.\n\n— Team Work Solutions' },
  PAYMENT_FAILED: { subject: 'Payment for order {{orderId}} did not go through', body: 'Hello {{name}},\n\nYour payment for order {{orderId}} was not completed ({{reason}}). No money has been taken for this attempt. You can retry from your portal.\n\n— Team Work Solutions' },
  PAYMENT_RETRY: { subject: 'Reminder: complete payment for order {{orderId}}', body: 'Hello {{name}},\n\nOrder {{orderId}} is still waiting for payment of ₹{{amount}}. You can pay from your portal.\n\n— Team Work Solutions' },
  PAYMENT_PROOF_REQUIRED: { subject: 'We could not verify your payment for {{orderId}}', body: 'Hello {{name}},\n\nWe could not confirm payment {{paymentId}} with the payment gateway ({{reason}}). Please check the payment id or contact support.\n\n— Team Work Solutions' },
  PRODUCTION_STARTED: { subject: 'Work has started on order {{orderId}}', body: 'Hello {{name}},\n\nOur team has started building your {{product}}.\n\n— Team Work Solutions' },
  INFORMATION_REQUIRED: { subject: 'We need a corrected file for order {{orderId}}', body: 'Hello {{name}},\n\nWe could not use the uploaded file for order {{orderId}}:\n{{issues}}\n\nPlease upload a corrected file from your portal.\n\n— Team Work Solutions' },
  DASHBOARD_READY: { subject: 'Your dashboard for {{orderId}} passed QA', body: 'Hello {{name}},\n\nYour {{product}} has passed quality checks and is being packaged for delivery.\n\n— Team Work Solutions' },
  DASHBOARD_DELIVERED: { subject: 'Your dashboard is ready: order {{orderId}}', body: 'Hello {{name}},\n\nYour {{product}} and its guide book are ready to download from your portal.\n\n— Team Work Solutions' },
  REVISION_REQUESTED: { subject: 'Revision received for order {{orderId}}', body: 'Hello {{name}},\n\nWe received your revision request for order {{orderId}} and will update the dashboard.\n\n— Team Work Solutions' },
  REFUND_STARTED: { subject: 'Refund started for order {{orderId}}', body: 'Hello {{name}},\n\nA refund of ₹{{amount}} for order {{orderId}} has been approved and started.\n\n— Team Work Solutions' },
};

export function render(template: string, vars: Record<string, string | number>): { subject: string; body: string } {
  const t = TEMPLATES[template]; if (!t) throw new Error(`Unknown email template ${template}`);
  const fill = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ''));
  return { subject: fill(t.subject), body: fill(t.body) };
}

export interface Mailer { configured: boolean; send(to: string, subject: string, text: string): Promise<{ messageId: string }>; }

/** SMTP mailer via nodemailer when SMTP_* is set. Otherwise emails are recorded as NOT_CONFIGURED — never as sent. */
export function smtpMailer(env: NodeJS.ProcessEnv = process.env): Mailer {
  const configured = !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD);
  return {
    configured,
    async send(to, subject, text) {
      if (!configured) throw new Error('SMTP not configured');
      const nodemailer = (await import('nodemailer')).default;
      const t = nodemailer.createTransport({ host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587), secure: env.SMTP_SECURE === 'true', auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } });
      const info = await t.sendMail({ from: env.SMTP_FROM || env.SMTP_USER, to, subject, text });
      return { messageId: String(info.messageId) };
    },
  };
}

export async function deliver(mailer: Mailer, template: string, to: string, vars: Record<string, string | number>, orderId: string | null, at: string): Promise<Email> {
  const { subject, body } = render(template, vars);
  const e: Email = { id: uid('eml'), template, to, subject, body, orderId, status: 'NOT_CONFIGURED', providerId: null, error: null, at };
  if (!mailer.configured) return e;
  try { const r = await mailer.send(to, subject, body); e.status = 'SENT'; e.providerId = r.messageId; }
  catch (err) { e.status = 'FAILED'; e.error = (err as Error).message.slice(0, 300); }
  return e;
}
