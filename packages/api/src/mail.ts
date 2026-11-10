import nodemailer from 'nodemailer';
import type { SmtpConfig } from './config.ts';

export interface Mailer {
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

export function createMailer(config: SmtpConfig): Mailer {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.tls === 'tls',
    requireTLS: config.tls === 'starttls',
    ignoreTLS: config.tls === 'none',
    auth: config.user ? { user: config.user, pass: config.password } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
    logger: false,
    debug: false,
  });
  return {
    async send(message) {
      try {
        await transport.sendMail({ from: config.from, to: message.to, subject: message.subject, text: message.text });
      } catch {
        // SMTP replies can echo credentials and message content. Do not retain the original error.
        throw new Error('Mail delivery failed');
      }
    },
  };
}
