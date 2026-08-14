import { EmailType } from '@prisma/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { emailService } from '../modules/email/email.service';
import { emailTemplates } from '../modules/email/email.templates';

/**
 * Finds all medication reminders whose scheduled time has passed and have
 * not yet been sent, emails the patient, and marks them sent. Runs on a
 * cron schedule (see jobs/index.ts). Each reminder is processed
 * independently so a single failure doesn't block the rest of the batch.
 */
export async function runMedicationReminderJob(): Promise<{ processed: number; sent: number }> {
  const due = await prisma.medicationReminder.findMany({
    where: { sent: false, scheduledAt: { lte: new Date() } },
    include: {
      prescription: {
        include: {
          appointment: { include: { patient: { include: { user: true } } } },
        },
      },
    },
    take: 100,
  });

  let sent = 0;
  for (const reminder of due) {
    try {
      const patientUser = reminder.prescription.appointment.patient.user;
      await emailService.sendAndLog({
        toEmail: patientUser.email,
        type: EmailType.MEDICATION_REMINDER,
        subject: 'Time to take your medication',
        html: emailTemplates.medicationReminder(patientUser.fullName, reminder.prescription.medicationName, reminder.prescription.dosage),
        appointmentId: reminder.prescription.appointmentId,
      });
      await prisma.medicationReminder.update({ where: { id: reminder.id }, data: { sent: true, sentAt: new Date() } });
      sent++;
    } catch (err) {
      logger.error({ err, reminderId: reminder.id }, 'Failed to process medication reminder');
    }
  }

  return { processed: due.length, sent };
}
