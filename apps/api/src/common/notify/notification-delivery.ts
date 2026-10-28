import { Logger } from '@nestjs/common';
import { maskEmail } from '../auth/otp-delivery';

export interface NotificationMessage {
  email: string;
  reportPublicId: string;
  action: string;
  status: string;
  scheduledFor: string | null;
}

export interface NotificationDelivery {
  send(message: NotificationMessage): Promise<void>;
}

export const NOTIFICATION_DELIVERY = Symbol('NOTIFICATION_DELIVERY');

export class LogNotificationDelivery implements NotificationDelivery {
  private readonly logger = new Logger(LogNotificationDelivery.name);

  async send(message: NotificationMessage): Promise<void> {
    this.logger.log(
      `Notifikasi ${message.action} untuk ${message.reportPublicId} ke ${maskEmail(message.email)} (status ${message.status})`,
    );
  }
}
