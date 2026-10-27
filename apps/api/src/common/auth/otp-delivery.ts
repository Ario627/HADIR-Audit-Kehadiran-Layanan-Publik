import { Logger } from '@nestjs/common';

export interface OtpMessage {
  email: string;
  code: string;
  expiresInSeconds: number;
  requestId: string;
}

export interface OtpDelivery {
  send(message: OtpMessage): Promise<void>;
}

export const OTP_DELIVERY = Symbol('OTP_DELIVERY');

export class LogOtpDelivery implements OtpDelivery {
  private readonly logger = new Logger(LogOtpDelivery.name);

  async send(message: OtpMessage): Promise<void> {
    this.logger.log(
      `OTP untuk ${maskEmail(message.email)} berlaku ${message.expiresInSeconds}s (request ${message.requestId})`,
    );
  }
}

export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) {
    return '***';
  }
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${'*'.repeat(Math.max(1, local.length - head.length))}@${domain}`;
}
