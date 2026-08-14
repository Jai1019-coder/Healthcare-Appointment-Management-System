import { z } from 'zod';

const workingHourSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Expected HH:MM 24h format'),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Expected HH:MM 24h format'),
});

export const createDoctorSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(2),
  phone: z.string().min(7).optional(),
  specialization: z.string().min(2),
  slotDurationMinutes: z.number().int().min(5).max(240).default(30),
  bio: z.string().optional(),
  workingHours: z.array(workingHourSchema).default([]),
});

export const updateDoctorSchema = z.object({
  fullName: z.string().min(2).optional(),
  phone: z.string().min(7).optional(),
  specialization: z.string().min(2).optional(),
  slotDurationMinutes: z.number().int().min(5).max(240).optional(),
  bio: z.string().optional(),
  isActive: z.boolean().optional(),
});

export const setWorkingHoursSchema = z.object({
  workingHours: z.array(workingHourSchema).min(1),
});

export const createLeaveSchema = z
  .object({
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    reason: z.string().optional(),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  });

export const doctorIdParamSchema = z.object({ doctorId: z.string().uuid() });
export const leaveIdParamSchema = z.object({ doctorId: z.string().uuid(), leaveId: z.string().uuid() });

export const searchDoctorsQuerySchema = z.object({
  specialization: z.string().optional(),
  q: z.string().optional(),
});

export type CreateDoctorInput = z.infer<typeof createDoctorSchema>;
export type UpdateDoctorInput = z.infer<typeof updateDoctorSchema>;
export type CreateLeaveInput = z.infer<typeof createLeaveSchema>;
