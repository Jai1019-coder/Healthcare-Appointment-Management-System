export type Role = 'ADMIN' | 'DOCTOR' | 'PATIENT';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  phone?: string | null;
}

export interface Doctor {
  id: string;
  specialization: string;
  slotDurationMinutes: number;
  bio?: string | null;
  user: { id: string; fullName: string; email: string; phone?: string | null };
  workingHours: { id: string; dayOfWeek: number; startTime: string; endTime: string }[];
  leaves?: { id: string; startDate: string; endDate: string; reason?: string | null }[];
}

export type AppointmentStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'RESCHEDULED';

export interface AISummary {
  id: string;
  type: 'PRE_VISIT' | 'POST_VISIT';
  urgency?: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  chiefComplaint?: string | null;
  suggestedQuestions: string[];
  patientSummary?: string | null;
  medicationSchedule?: unknown;
  followUpInstructions?: string | null;
  failed: boolean;
  errorMessage?: string | null;
}

export interface Appointment {
  id: string;
  slotStart: string;
  slotEnd: string;
  status: AppointmentStatus;
  patient: { user: { id: string; fullName: string; email: string } };
  doctor: { specialization: string; user: { id: string; fullName: string; email: string } };
  symptomReport?: { description: string; durationDays?: number | null; severity?: string | null } | null;
  aiSummaries: AISummary[];
  postVisitNote?: { clinicalNotes: string } | null;
  prescriptions: { id: string; medicationName: string; dosage: string; frequencyPerDay: number; durationDays: number; instructions?: string | null }[];
  calendarEvent?: { syncStatus: string } | null;
}
