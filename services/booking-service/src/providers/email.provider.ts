import nodemailer from 'nodemailer';
import { config } from '../config';
import { ConfigurationError } from '../errors';

export interface ConfirmationEmail {
  bookingId: string;
  to: string;
  clientName: string;
  consultantName: string;
  startAt: Date;
  endAt: Date;
  meetingUrl: string;
}

export interface EmailProvider {
  sendConfirmation(message: ConfirmationEmail): Promise<void>;
}

export class NodemailerAdapter implements EmailProvider {
  async sendConfirmation(message: ConfirmationEmail): Promise<void> {
    const { SMTP_HOST, SMTP_USER, SMTP_PASS, EMAIL_FROM, SMTP_PORT } = config;
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !EMAIL_FROM) throw new ConfigurationError('Email');
    const transport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    await transport.sendMail({
      from: EMAIL_FROM,
      to: message.to,
      messageId: `<booking-${message.bookingId}@booking-service.local>`,
      subject: `Consultation confirmed with ${message.consultantName}`,
      text: [
        `Hello ${message.clientName},`,
        `Your consultation with ${message.consultantName} is confirmed.`,
        `Start: ${message.startAt.toISOString()}`,
        `End: ${message.endAt.toISOString()}`,
        message.meetingUrl ? `Meeting: ${message.meetingUrl}` : '',
      ].filter(Boolean).join('\n'),
    });
  }
}
