import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { logger } from './logger.js';

const EMAIL_ENABLED = process.env.EMAIL_ENABLED === 'true';

let _transport: Transporter | null = null;

function getTransport(): Transporter {
  if (!_transport) {
    _transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'localhost',
      port: parseInt(process.env.SMTP_PORT || '1025', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  }
  return _transport;
}

export interface MailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendMail(opts: MailOptions): Promise<void> {
  if (!EMAIL_ENABLED) {
    logger.info({ to: opts.to, subject: opts.subject }, '[email-dry-run] would send email');
    return;
  }
  await getTransport().sendMail({
    from: process.env.SMTP_FROM || 'noreply@loopnest.example',
    ...opts,
  });
}
