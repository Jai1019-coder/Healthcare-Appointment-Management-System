interface AppointmentEmailData {
  recipientName: string;
  otherPartyName: string;
  specialization?: string;
  slotStart: Date;
  reason?: string;
}

function baseLayout(title: string, bodyHtml: string): string {
  return `
  <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937;">
    <h2 style="color: #0f766e;">${title}</h2>
    ${bodyHtml}
    <hr style="margin-top: 24px; border: none; border-top: 1px solid #e5e7eb;" />
    <p style="font-size: 12px; color: #6b7280;">This is an automated message from your clinic's appointment system.</p>
  </div>`;
}

const fmt = (d: Date) =>
  d.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });

export const emailTemplates = {
  bookingConfirmation: (data: AppointmentEmailData) =>
    baseLayout(
      'Appointment Confirmed',
      `<p>Hi ${data.recipientName},</p>
       <p>Your appointment with <strong>${data.otherPartyName}</strong>${data.specialization ? ` (${data.specialization})` : ''} is confirmed for:</p>
       <p style="font-size: 18px; font-weight: bold;">${fmt(data.slotStart)}</p>
       <p>A calendar invite has been sent separately. You'll receive a reminder before your visit.</p>`
    ),

  doctorNewBooking: (data: AppointmentEmailData) =>
    baseLayout(
      'New Appointment Booked',
      `<p>Hi ${data.recipientName},</p>
       <p>A new appointment has been booked with patient <strong>${data.otherPartyName}</strong> for:</p>
       <p style="font-size: 18px; font-weight: bold;">${fmt(data.slotStart)}</p>`
    ),

  reminder: (data: AppointmentEmailData) =>
    baseLayout(
      'Upcoming Appointment Reminder',
      `<p>Hi ${data.recipientName},</p>
       <p>This is a reminder of your upcoming appointment with <strong>${data.otherPartyName}</strong> on:</p>
       <p style="font-size: 18px; font-weight: bold;">${fmt(data.slotStart)}</p>`
    ),

  cancellation: (data: AppointmentEmailData) =>
    baseLayout(
      'Appointment Cancelled',
      `<p>Hi ${data.recipientName},</p>
       <p>Your appointment with <strong>${data.otherPartyName}</strong> originally scheduled for:</p>
       <p style="font-size: 18px; font-weight: bold;">${fmt(data.slotStart)}</p>
       <p>has been cancelled.${data.reason ? ` Reason: ${data.reason}` : ''} Please book a new slot at your convenience.</p>`
    ),

  reschedule: (data: AppointmentEmailData) =>
    baseLayout(
      'Appointment Rescheduled',
      `<p>Hi ${data.recipientName},</p>
       <p>Your appointment with <strong>${data.otherPartyName}</strong> has been rescheduled to:</p>
       <p style="font-size: 18px; font-weight: bold;">${fmt(data.slotStart)}</p>`
    ),

  doctorLeaveNotice: (data: AppointmentEmailData) =>
    baseLayout(
      'Your Appointment Was Cancelled (Doctor Leave)',
      `<p>Hi ${data.recipientName},</p>
       <p>Unfortunately Dr. ${data.otherPartyName} is on leave and your appointment scheduled for:</p>
       <p style="font-size: 18px; font-weight: bold;">${fmt(data.slotStart)}</p>
       <p>has been cancelled. We're sorry for the inconvenience - please book a new slot at your convenience.</p>`
    ),

  medicationReminder: (patientName: string, medicationName: string, dosage: string) =>
    baseLayout(
      'Medication Reminder',
      `<p>Hi ${patientName},</p>
       <p>This is a reminder to take your medication: <strong>${medicationName}</strong> (${dosage}).</p>`
    ),
};
