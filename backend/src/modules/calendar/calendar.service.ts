import { google } from 'googleapis';
import { prisma } from '../../config/prisma';
import { logger } from '../../config/logger';
import { getAuthedClientForUser } from './googleClient';

interface EventInput {
  appointmentId: string;
  organizerUserId: string; // doctor's user id - event lives on the doctor's calendar
  attendeeEmails: string[];
  summary: string;
  description: string;
  startTime: Date;
  endTime: Date;
}

/**
 * Calendar sync is best-effort: it must never block or fail the booking
 * flow. Every outcome (success or failure) is recorded on CalendarEvent so
 * a background job or admin can inspect and retry sync failures.
 */
export const calendarService = {
  async createEvent(input: EventInput): Promise<void> {
    try {
      const client = await getAuthedClientForUser(input.organizerUserId);
      if (!client) {
        await upsertRecord(input.appointmentId, { syncStatus: 'FAILED', lastError: 'Doctor has not connected Google Calendar' });
        return;
      }

      const calendar = google.calendar({ version: 'v3', auth: client });
      const event = await calendar.events.insert({
        calendarId: 'primary',
        sendUpdates: 'all',
        requestBody: {
          summary: input.summary,
          description: input.description,
          start: { dateTime: input.startTime.toISOString() },
          end: { dateTime: input.endTime.toISOString() },
          attendees: input.attendeeEmails.map((email) => ({ email })),
        },
      });

      await upsertRecord(input.appointmentId, {
        googleEventId: event.data.id ?? undefined,
        organizerCalendarId: 'primary',
        syncStatus: 'SYNCED',
        lastError: null,
      });
    } catch (err) {
      logger.error({ err, appointmentId: input.appointmentId }, 'Google Calendar event creation failed');
      await upsertRecord(input.appointmentId, {
        syncStatus: 'FAILED',
        lastError: err instanceof Error ? err.message : 'Unknown calendar error',
      });
    }
  },

  async updateEvent(appointmentId: string, organizerUserId: string, startTime: Date, endTime: Date): Promise<void> {
    try {
      const record = await prisma.calendarEvent.findUnique({ where: { appointmentId } });
      const client = await getAuthedClientForUser(organizerUserId);
      if (!record?.googleEventId || !client) return;

      const calendar = google.calendar({ version: 'v3', auth: client });
      await calendar.events.patch({
        calendarId: record.organizerCalendarId ?? 'primary',
        eventId: record.googleEventId,
        sendUpdates: 'all',
        requestBody: {
          start: { dateTime: startTime.toISOString() },
          end: { dateTime: endTime.toISOString() },
        },
      });

      await upsertRecord(appointmentId, { syncStatus: 'SYNCED', lastError: null });
    } catch (err) {
      logger.error({ err, appointmentId }, 'Google Calendar event update failed');
      await upsertRecord(appointmentId, { syncStatus: 'FAILED', lastError: err instanceof Error ? err.message : 'Unknown error' });
    }
  },

  async deleteEvent(appointmentId: string, organizerUserId: string): Promise<void> {
    try {
      const record = await prisma.calendarEvent.findUnique({ where: { appointmentId } });
      const client = await getAuthedClientForUser(organizerUserId);
      if (!record?.googleEventId || !client) return;

      const calendar = google.calendar({ version: 'v3', auth: client });
      await calendar.events.delete({
        calendarId: record.organizerCalendarId ?? 'primary',
        eventId: record.googleEventId,
        sendUpdates: 'all',
      });

      await upsertRecord(appointmentId, { syncStatus: 'SYNCED', lastError: null, googleEventId: null });
    } catch (err) {
      logger.error({ err, appointmentId }, 'Google Calendar event deletion failed');
      await upsertRecord(appointmentId, { syncStatus: 'FAILED', lastError: err instanceof Error ? err.message : 'Unknown error' });
    }
  },
};

async function upsertRecord(
  appointmentId: string,
  data: { googleEventId?: string | null; organizerCalendarId?: string; syncStatus: string; lastError?: string | null }
) {
  await prisma.calendarEvent.upsert({
    where: { appointmentId },
    create: { appointmentId, ...data },
    update: data,
  });
}
