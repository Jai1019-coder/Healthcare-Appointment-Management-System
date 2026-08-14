import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../../config/env';
import { logger } from '../../config/logger';

let transporter: Transporter | null = null;

/**
 * Lazily builds the SMTP transporter. If SMTP credentials are not configured
 * (e.g. local development without a mail provider), falls back to a JSON
 * transport that logs the message instead of sending it - so the rest of the
 * system (bookings, reminders) keeps working without a live mail account.
 */
function getTransporter(): Transporter {
  if (transporter) return transporter;

  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT ?? 587,
      secure: env.SMTP_PORT === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
  } else {
    logger.warn('SMTP not configured - emails will be logged, not sent. Set SMTP_* env vars to enable delivery.');
    transporter = nodemailer.createTransport({ jsonTransport: true });
  }

  return transporter;
}

export async function sendMail(to: string, subject: string, html: string): Promise<void> {
  const t = getTransporter();
  await t.sendMail({ from: env.EMAIL_FROM, to, subject, html });
}
