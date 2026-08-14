import { z } from 'zod';

export const bookAppointmentSchema = z.object({
  doctorId: z.string().uuid(),
  slotStart: z.coerce.date(),
  symptoms: z
    .object({
      description: z.string().min(5, 'Please describe your symptoms in a bit more detail'),
      durationDays: z.number().int().min(0).optional(),
      severity: z.enum(['Mild', 'Moderate', 'Severe']).optional(),
    })
    .optional(),
});

export const rescheduleAppointmentSchema = z.object({
  newSlotStart: z.coerce.date(),
});

export const cancelAppointmentSchema = z.object({
  reason: z.string().optional(),
});

export const availabilityQuerySchema = z.object({
  date: z.coerce.date(),
});

export const postVisitSchema = z.object({
  clinicalNotes: z.string().min(10),
  prescriptions: z
    .array(
      z.object({
        medicationName: z.string().min(1),
        dosage: z.string().min(1),
        frequencyPerDay: z.number().int().min(1).max(12),
        durationDays: z.number().int().min(1).max(365),
        instructions: z.string().optional(),
      })
    )
    .default([]),
});

export const appointmentIdParamSchema = z.object({ appointmentId: z.string().uuid() });

export type BookAppointmentInput = z.infer<typeof bookAppointmentSchema>;
export type PostVisitInput = z.infer<typeof postVisitSchema>;
