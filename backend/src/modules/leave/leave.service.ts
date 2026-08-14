import { AppointmentStatus, EmailType } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { logger } from '../../config/logger';
import { ApiError } from '../../utils/ApiError';
import { emailService } from '../email/email.service';
import { emailTemplates } from '../email/email.templates';
import { calendarService } from '../calendar/calendar.service';
import { CreateLeaveInput } from '../doctors/doctors.schema';

export const leaveService = {
  /**
   * Marks a doctor on leave for a date range. Any CONFIRMED appointments
   * that fall inside the range are cancelled, their patients notified by
   * email, and their calendar events removed. Each affected appointment is
   * processed independently so one failure (e.g. a bad email address)
   * doesn't stop the rest from being handled.
   */
  async createLeave(doctorId: string, input: CreateLeaveInput) {
    const doctor = await prisma.doctor.findUnique({ where: { id: doctorId }, include: { user: true } });
    if (!doctor) throw ApiError.notFound('Doctor not found');

    const leave = await prisma.doctorLeave.create({
      data: { doctorId, startDate: input.startDate, endDate: input.endDate, reason: input.reason },
    });

    const affected = await prisma.appointment.findMany({
      where: {
        doctorId,
        status: AppointmentStatus.CONFIRMED,
        slotStart: { gte: input.startDate, lte: input.endDate },
      },
      include: { patient: { include: { user: true } } },
    });

    let notified = 0;
    for (const appointment of affected) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.appointment.update({ where: { id: appointment.id }, data: { status: AppointmentStatus.CANCELLED } });
          await tx.slotLock.deleteMany({ where: { appointmentId: appointment.id } });
        });

        await emailService.sendAndLog({
          toEmail: appointment.patient.user.email,
          type: EmailType.DOCTOR_LEAVE_NOTICE,
          subject: 'Your appointment has been cancelled - doctor on leave',
          html: emailTemplates.doctorLeaveNotice({
            recipientName: appointment.patient.user.fullName,
            otherPartyName: doctor.user.fullName,
            slotStart: appointment.slotStart,
            reason: input.reason,
          }),
          appointmentId: appointment.id,
        });

        await calendarService.deleteEvent(appointment.id, doctor.user.id);
        notified++;
      } catch (err) {
        logger.error({ err, appointmentId: appointment.id }, 'Failed to fully process leave-related cancellation for appointment');
      }
    }

    return { leave, affectedAppointments: affected.length, notified };
  },

  async list(doctorId: string) {
    return prisma.doctorLeave.findMany({ where: { doctorId }, orderBy: { startDate: 'desc' } });
  },

  async remove(doctorId: string, leaveId: string) {
    const leave = await prisma.doctorLeave.findFirst({ where: { id: leaveId, doctorId } });
    if (!leave) throw ApiError.notFound('Leave record not found');
    await prisma.doctorLeave.delete({ where: { id: leaveId } });
    return { deleted: true };
  },
};
