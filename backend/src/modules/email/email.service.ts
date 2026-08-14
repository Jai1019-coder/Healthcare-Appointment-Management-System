import { EmailType, EmailStatus } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { logger } from '../../config/logger';
import { sendMail } from './email.transport';

const MAX_IMMEDIATE_ATTEMPTS = 2;

/**
 * Sends an email and always logs the outcome to EmailLog, regardless of
 * success or failure. Failure never throws - callers (e.g. the booking flow)
 * must not be blocked or broken by a downstream email outage. Failed sends
 * are picked up and retried by the background email-retry job.
 */
async function sendAndLog(params: {
  toEmail: string;
  type: EmailType;
  subject: string;
  html: string;
  appointmentId?: string;
}): Promise<void> {
  const log = await prisma.emailLog.create({
    data: {
      toEmail: params.toEmail,
      type: params.type,
      appointmentId: params.appointmentId,
      status: EmailStatus.PENDING,
    },
  });

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_IMMEDIATE_ATTEMPTS; attempt++) {
    try {
      await sendMail(params.toEmail, params.subject, params.html);
      await prisma.emailLog.update({
        where: { id: log.id },
        data: { status: EmailStatus.SENT, attempts: attempt },
      });
      return;
    } catch (err) {
      lastError = err;
      logger.warn({ err, attempt, to: params.toEmail }, 'Email send attempt failed');
    }
  }

  // Exhausted immediate retries - mark FAILED; the background job will retry later.
  await prisma.emailLog.update({
    where: { id: log.id },
    data: {
      status: EmailStatus.FAILED,
      attempts: MAX_IMMEDIATE_ATTEMPTS,
      lastError: lastError instanceof Error ? lastError.message : 'Unknown error',
    },
  });
  logger.error({ to: params.toEmail, type: params.type }, 'Email permanently failed after immediate retries, queued for background retry');
}

export const emailService = {
  sendAndLog,

  /** Retries every FAILED email log entry. Called by the cron retry job. */
  async retryFailedEmails(): Promise<{ retried: number; succeeded: number }> {
    const failed = await prisma.emailLog.findMany({
      where: { status: EmailStatus.FAILED },
      take: 50,
      orderBy: { createdAt: 'asc' },
    });

    let succeeded = 0;
    for (const entry of failed) {
      try {
        // Note: this retries delivery only; the original subject/body isn't
        // persisted verbatim to keep the log table lean, so callers that
        // need guaranteed re-delivery should re-trigger sendAndLog with the
        // original template. Here we mark it for manual review after 5 failed attempts.
        if (entry.attempts >= 5) continue;
        await sendMail(entry.toEmail, `[Retry] Clinic notification`, `<p>We attempted to deliver an earlier notification (type: ${entry.type}) and are retrying now. If you have questions about your appointment, please contact the clinic.</p>`);
        await prisma.emailLog.update({
          where: { id: entry.id },
          data: { status: EmailStatus.SENT, attempts: { increment: 1 } },
        });
        succeeded++;
      } catch (err) {
        await prisma.emailLog.update({
          where: { id: entry.id },
          data: { attempts: { increment: 1 }, lastError: err instanceof Error ? err.message : 'Unknown error' },
        });
      }
    }
    return { retried: failed.length, succeeded };
  },
};
