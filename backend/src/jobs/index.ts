import cron from 'node-cron';
import { logger } from '../config/logger';
import { runMedicationReminderJob } from './medicationReminder.job';
import { emailService } from '../modules/email/email.service';

/**
 * Registers all background cron jobs. Each job is wrapped so an uncaught
 * error inside it is logged rather than crashing the process or the
 * scheduler.
 */
export function startBackgroundJobs(): void {
  // Every 5 minutes: send any medication reminders that have come due.
  cron.schedule('*/5 * * * *', async () => {
    try {
      const result = await runMedicationReminderJob();
      if (result.processed > 0) {
        logger.info(result, 'Medication reminder job completed');
      }
    } catch (err) {
      logger.error({ err }, 'Medication reminder job crashed');
    }
  });

  // Every 15 minutes: retry any emails that previously failed to send.
  cron.schedule('*/15 * * * *', async () => {
    try {
      const result = await emailService.retryFailedEmails();
      if (result.retried > 0) {
        logger.info(result, 'Email retry job completed');
      }
    } catch (err) {
      logger.error({ err }, 'Email retry job crashed');
    }
  });

  logger.info('Background jobs scheduled (medication reminders every 5m, email retry every 15m)');
}
