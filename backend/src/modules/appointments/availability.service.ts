import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/ApiError';

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}
function endOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

export const availabilityService = {
  /** Returns whether a doctor is on approved leave covering the given date. */
  async isDoctorOnLeave(doctorId: string, date: Date): Promise<boolean> {
    const day = startOfDay(date);
    const leave = await prisma.doctorLeave.findFirst({
      where: {
        doctorId,
        startDate: { lte: endOfDay(date) },
        endDate: { gte: day },
      },
    });
    return !!leave;
  },

  /** Lists open (bookable) slot start times for a doctor on a given calendar date. */
  async getAvailableSlots(doctorId: string, date: Date): Promise<Date[]> {
    const doctor = await prisma.doctor.findUnique({
      where: { id: doctorId },
      include: { workingHours: true },
    });
    if (!doctor) throw ApiError.notFound('Doctor not found');

    if (await this.isDoctorOnLeave(doctorId, date)) return [];

    const dayOfWeek = date.getDay();
    const hoursForDay = doctor.workingHours.filter((wh) => wh.dayOfWeek === dayOfWeek);
    if (hoursForDay.length === 0) return [];

    const takenSlots = await prisma.slotLock.findMany({
      where: { doctorId, slotStart: { gte: startOfDay(date), lte: endOfDay(date) } },
      select: { slotStart: true },
    });
    const takenSet = new Set(takenSlots.map((s) => s.slotStart.getTime()));

    const slots: Date[] = [];
    const now = new Date();

    for (const window of hoursForDay) {
      const [startH, startM] = window.startTime.split(':').map(Number);
      const [endH, endM] = window.endTime.split(':').map(Number);

      const cursor = new Date(date);
      cursor.setHours(startH, startM, 0, 0);
      const windowEnd = new Date(date);
      windowEnd.setHours(endH, endM, 0, 0);

      while (cursor.getTime() + doctor.slotDurationMinutes * 60_000 <= windowEnd.getTime()) {
        if (cursor > now && !takenSet.has(cursor.getTime())) {
          slots.push(new Date(cursor));
        }
        cursor.setMinutes(cursor.getMinutes() + doctor.slotDurationMinutes);
      }
    }

    return slots;
  },

  /** Validates that a requested slotStart is actually a legitimate, currently-open slot. */
  async assertSlotIsBookable(doctorId: string, slotStart: Date): Promise<void> {
    if (slotStart.getTime() <= Date.now()) {
      throw ApiError.badRequest('Cannot book a slot in the past');
    }
    if (await this.isDoctorOnLeave(doctorId, slotStart)) {
      throw ApiError.badRequest('The doctor is on leave on this date');
    }

    const available = await this.getAvailableSlots(doctorId, slotStart);
    const match = available.some((s) => s.getTime() === slotStart.getTime());
    if (!match) {
      throw ApiError.badRequest('The requested slot is not a valid, open slot for this doctor');
    }
  },
};
