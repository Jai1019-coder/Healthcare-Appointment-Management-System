import { AppointmentStatus, EmailType, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { logger } from '../../config/logger';
import { ApiError } from '../../utils/ApiError';
import { availabilityService } from './availability.service';
import { emailService } from '../email/email.service';
import { emailTemplates } from '../email/email.templates';
import { calendarService } from '../calendar/calendar.service';
import { llmService } from '../llm/llm.service';
import { BookAppointmentInput, PostVisitInput } from './appointments.schema';

const appointmentInclude = {
  patient: { include: { user: true } },
  doctor: { include: { user: true } },
  symptomReport: true,
  aiSummaries: true,
  postVisitNote: true,
  prescriptions: true,
  calendarEvent: true,
} satisfies Prisma.AppointmentInclude;

function computeSlotEnd(slotStart: Date, durationMinutes: number): Date {
  return new Date(slotStart.getTime() + durationMinutes * 60_000);
}

export const appointmentsService = {
  /**
   * Books an appointment. Double-booking protection works in two layers:
   *  1. Application-level: `assertSlotIsBookable` checks working hours, leave,
   *     and currently-known taken slots before opening a transaction (fast
   *     fail for the common case, good error messages).
   *  2. Database-level (the real guarantee under concurrency): the
   *     appointment row and its SlotLock row are created in a single
   *     transaction. SlotLock has a unique constraint on (doctorId,
   *     slotStart), so if two requests race for the same slot, Postgres
   *     guarantees only one transaction's INSERT succeeds - the loser gets a
   *     unique-constraint violation (P2002), which we translate into a 409.
   */
  async book(patientUserId: string, input: BookAppointmentInput) {
    const patient = await prisma.patient.findUnique({ where: { userId: patientUserId } });
    if (!patient) throw ApiError.notFound('Patient profile not found');

    const doctor = await prisma.doctor.findUnique({ where: { id: input.doctorId } });
    if (!doctor) throw ApiError.notFound('Doctor not found');

    await availabilityService.assertSlotIsBookable(input.doctorId, input.slotStart);
    const slotEnd = computeSlotEnd(input.slotStart, doctor.slotDurationMinutes);

    let appointment;
    try {
      appointment = await prisma.$transaction(async (tx) => {
        const created = await tx.appointment.create({
          data: {
            patientId: patient.id,
            doctorId: doctor.id,
            slotStart: input.slotStart,
            slotEnd,
            status: AppointmentStatus.CONFIRMED,
            symptomReport: input.symptoms
              ? {
                  create: {
                    description: input.symptoms.description,
                    durationDays: input.symptoms.durationDays,
                    severity: input.symptoms.severity,
                  },
                }
              : undefined,
          },
          include: appointmentInclude,
        });

        // This insert is the atomic double-booking gate - see doc comment above.
        await tx.slotLock.create({
          data: { doctorId: doctor.id, slotStart: input.slotStart, appointmentId: created.id },
        });

        return created;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw ApiError.conflict('This slot was just booked by someone else. Please choose another time.');
      }
      throw err;
    }

    // Best-effort side effects - each independently guarded so a failure in
    // one (e.g. calendar) never blocks or rolls back the confirmed booking,
    // and never prevents the others from running.
    await runSideEffectsSafely('booking confirmation emails', () => sendBookingEmails(appointment));
    await runSideEffectsSafely('calendar sync', () => syncCalendarForNewAppointment(appointment));
    if (input.symptoms) {
      await runSideEffectsSafely('pre-visit LLM summary', () =>
        llmService.generatePreVisitSummary(appointment.id, input.symptoms!.description)
      );
    }

    return prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id }, include: appointmentInclude });
  },

  async reschedule(actingUserId: string, appointmentId: string, newSlotStart: Date) {
    const existing = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { patient: true, doctor: true },
    });
    if (!existing) throw ApiError.notFound('Appointment not found');
    assertOwnership(existing.patient.userId, actingUserId);
    if (existing.status !== AppointmentStatus.CONFIRMED) {
      throw ApiError.badRequest('Only confirmed appointments can be rescheduled');
    }

    await availabilityService.assertSlotIsBookable(existing.doctorId, newSlotStart);
    const newSlotEnd = computeSlotEnd(newSlotStart, existing.doctor.slotDurationMinutes);

    let newAppointment;
    try {
      newAppointment = await prisma.$transaction(async (tx) => {
        await tx.appointment.update({
          where: { id: existing.id },
          data: { status: AppointmentStatus.RESCHEDULED },
        });
        await tx.slotLock.deleteMany({ where: { appointmentId: existing.id } });

        const created = await tx.appointment.create({
          data: {
            patientId: existing.patientId,
            doctorId: existing.doctorId,
            slotStart: newSlotStart,
            slotEnd: newSlotEnd,
            status: AppointmentStatus.CONFIRMED,
            rescheduledFromId: existing.id,
          },
          include: appointmentInclude,
        });
        await tx.slotLock.create({
          data: { doctorId: existing.doctorId, slotStart: newSlotStart, appointmentId: created.id },
        });
        return created;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw ApiError.conflict('This slot was just booked by someone else. Please choose another time.');
      }
      throw err;
    }

    await runSideEffectsSafely('reschedule emails', () => sendRescheduleEmails(newAppointment));
    await runSideEffectsSafely('calendar update', async () => {
      await calendarService.deleteEvent(existing.id, newAppointment.doctor.user.id);
      await syncCalendarForNewAppointment(newAppointment);
    });

    return newAppointment;
  },

  async cancel(actingUserId: string, appointmentId: string, reason?: string) {
    const existing = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { patient: true, doctor: { include: { user: true } } },
    });
    if (!existing) throw ApiError.notFound('Appointment not found');
    assertOwnership(existing.patient.userId, actingUserId);
    if (existing.status !== AppointmentStatus.CONFIRMED && existing.status !== AppointmentStatus.PENDING) {
      throw ApiError.badRequest('This appointment cannot be cancelled');
    }

    await prisma.$transaction(async (tx) => {
      await tx.appointment.update({ where: { id: existing.id }, data: { status: AppointmentStatus.CANCELLED } });
      await tx.slotLock.deleteMany({ where: { appointmentId: existing.id } });
    });

    await runSideEffectsSafely('cancellation emails', () => sendCancellationEmails(existing, reason));
    await runSideEffectsSafely('calendar deletion', () => calendarService.deleteEvent(existing.id, existing.doctor.user.id));

    return { cancelled: true };
  },

  async listForPatient(patientUserId: string) {
    const patient = await prisma.patient.findUnique({ where: { userId: patientUserId } });
    if (!patient) throw ApiError.notFound('Patient profile not found');
    return prisma.appointment.findMany({
      where: { patientId: patient.id },
      include: appointmentInclude,
      orderBy: { slotStart: 'desc' },
    });
  },

  async listForDoctor(doctorUserId: string) {
    const doctor = await prisma.doctor.findUnique({ where: { userId: doctorUserId } });
    if (!doctor) throw ApiError.notFound('Doctor profile not found');
    return prisma.appointment.findMany({
      where: { doctorId: doctor.id },
      include: appointmentInclude,
      orderBy: { slotStart: 'asc' },
    });
  },

  async getById(appointmentId: string) {
    const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId }, include: appointmentInclude });
    if (!appointment) throw ApiError.notFound('Appointment not found');
    return appointment;
  },

  /** Doctor submits post-visit notes + prescriptions; triggers post-visit LLM summary and medication reminder scheduling. */
  async submitPostVisit(doctorUserId: string, appointmentId: string, input: PostVisitInput) {
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { doctor: true, patient: { include: { user: true } } },
    });
    if (!appointment) throw ApiError.notFound('Appointment not found');
    if (appointment.doctor.userId !== doctorUserId) throw ApiError.forbidden('Not your appointment');

    await prisma.$transaction(async (tx) => {
      await tx.postVisitNote.upsert({
        where: { appointmentId },
        create: { appointmentId, clinicalNotes: input.clinicalNotes },
        update: { clinicalNotes: input.clinicalNotes },
      });
      await tx.prescription.deleteMany({ where: { appointmentId } });
      for (const p of input.prescriptions) {
        const prescription = await tx.prescription.create({ data: { appointmentId, ...p } });
        const reminders = buildReminderTimes(prescription.frequencyPerDay, prescription.durationDays);
        if (reminders.length) {
          await tx.medicationReminder.createMany({
            data: reminders.map((scheduledAt) => ({ prescriptionId: prescription.id, scheduledAt })),
          });
        }
      }
      await tx.appointment.update({ where: { id: appointmentId }, data: { status: AppointmentStatus.COMPLETED } });
    });

    await runSideEffectsSafely('post-visit LLM summary', () =>
      llmService.generatePostVisitSummary(appointmentId, input.clinicalNotes)
    );

    return this.getById(appointmentId);
  },
};

function assertOwnership(ownerUserId: string, actingUserId: string) {
  if (ownerUserId !== actingUserId) throw ApiError.forbidden('You do not have access to this appointment');
}

async function runSideEffectsSafely(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    // Side effects (email, calendar, LLM) must never break the primary flow.
    logger.error({ err, label }, `Non-critical side effect failed: ${label}`);
  }
}

type AppointmentWithParties = Prisma.AppointmentGetPayload<{ include: typeof appointmentInclude }>;

async function sendBookingEmails(appointment: AppointmentWithParties) {
  await emailService.sendAndLog({
    toEmail: appointment.patient.user.email,
    type: EmailType.BOOKING_CONFIRMATION,
    subject: 'Your appointment is confirmed',
    html: emailTemplates.bookingConfirmation({
      recipientName: appointment.patient.user.fullName,
      otherPartyName: `Dr. ${appointment.doctor.user.fullName}`,
      slotStart: appointment.slotStart,
    }),
    appointmentId: appointment.id,
  });

  await emailService.sendAndLog({
    toEmail: appointment.doctor.user.email,
    type: EmailType.DOCTOR_NEW_BOOKING,
    subject: 'New appointment booked',
    html: emailTemplates.doctorNewBooking({
      recipientName: `Dr. ${appointment.doctor.user.fullName}`,
      otherPartyName: appointment.patient.user.fullName,
      slotStart: appointment.slotStart,
    }),
    appointmentId: appointment.id,
  });
}

async function sendRescheduleEmails(appointment: AppointmentWithParties) {
  await emailService.sendAndLog({
    toEmail: appointment.patient.user.email,
    type: EmailType.RESCHEDULE,
    subject: 'Your appointment has been rescheduled',
    html: emailTemplates.reschedule({
      recipientName: appointment.patient.user.fullName,
      otherPartyName: `Dr. ${appointment.doctor.user.fullName}`,
      slotStart: appointment.slotStart,
    }),
    appointmentId: appointment.id,
  });
}

async function sendCancellationEmails(
  appointment: Prisma.AppointmentGetPayload<{ include: { patient: { include: { user: true } }; doctor: { include: { user: true } } } }>,
  reason?: string
) {
  await emailService.sendAndLog({
    toEmail: appointment.patient.user.email,
    type: EmailType.CANCELLATION,
    subject: 'Your appointment has been cancelled',
    html: emailTemplates.cancellation({
      recipientName: appointment.patient.user.fullName,
      otherPartyName: `Dr. ${appointment.doctor.user.fullName}`,
      slotStart: appointment.slotStart,
      reason,
    }),
    appointmentId: appointment.id,
  });
}

async function syncCalendarForNewAppointment(appointment: AppointmentWithParties) {
  await calendarService.createEvent({
    appointmentId: appointment.id,
    organizerUserId: appointment.doctor.user.id,
    attendeeEmails: [appointment.patient.user.email],
    summary: `Appointment with Dr. ${appointment.doctor.user.fullName}`,
    description: `Patient: ${appointment.patient.user.fullName}`,
    startTime: appointment.slotStart,
    endTime: appointment.slotEnd,
  });
}

function buildReminderTimes(frequencyPerDay: number, durationDays: number): Date[] {
  const reminders: Date[] = [];
  const intervalHours = Math.max(1, Math.floor(24 / frequencyPerDay));
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1); // first reminder ~1 hour from prescribing

  for (let day = 0; day < durationDays; day++) {
    for (let dose = 0; dose < frequencyPerDay; dose++) {
      const time = new Date(start);
      time.setDate(time.getDate() + day);
      time.setHours(time.getHours() + dose * intervalHours);
      reminders.push(time);
    }
  }
  return reminders;
}
