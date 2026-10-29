import { open as secretBoxOpen } from '../common/crypto/secret-box';
import type { NotificationDelivery } from '../common/notify/notification-delivery';
import type { OutboxJob } from '../db/repositories/outbox.repository';
import type { JobHandler } from './outbox.worker';

export const REPORT_NOTIFY_TOPIC = 'report.notify';

export interface ReportNotifyPayload {
  reportPublicId: string;
  action: string;
  status: string;
  scheduledFor: string | null;
  contactCiphertext: string;
}

export function parseReportNotifyPayload(job: OutboxJob): ReportNotifyPayload | null {
  const payload = job.payload;
  const reportPublicId = payload.reportPublicId;
  const action = payload.action;
  const status = payload.status;
  const contactCiphertext = payload.contactCiphertext;
  if (
    typeof reportPublicId !== 'string' ||
    typeof action !== 'string' ||
    typeof status !== 'string' ||
    typeof contactCiphertext !== 'string'
  ) {
    return null;
  }
  return {
    reportPublicId,
    action,
    status,
    scheduledFor: typeof payload.scheduledFor === 'string' ? payload.scheduledFor : null,
    contactCiphertext,
  };
}

export function createReportNotifyHandler(
  delivery: NotificationDelivery,
  cipherKey: Buffer,
): JobHandler {
  return async (job: OutboxJob): Promise<void> => {
    const payload = parseReportNotifyPayload(job);
    if (payload === null) {
      return;
    }
    const sealed = Buffer.from(payload.contactCiphertext, 'base64');
    let email: string;
    try {
      email = secretBoxOpen(sealed, cipherKey);
    } catch {
      return;
    }
    if (email.length === 0) {
      return;
    }
    await delivery.send({
      email,
      reportPublicId: payload.reportPublicId,
      action: payload.action,
      status: payload.status,
      scheduledFor: payload.scheduledFor,
    });
  };
}
