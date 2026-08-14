# System Design Write-up

## Double-Booking Prevention

The core guarantee is enforced at the database level, not just in application
code, because application-level checks alone ("query for conflicts, then
insert") are vulnerable to race conditions when two requests run concurrently
between the check and the write.

Each doctor-slot combination is protected by a dedicated `SlotLock` table with
a **unique constraint on `(doctorId, slotStart)`**. Booking a slot is a single
Prisma transaction that (1) creates the `Appointment` row and (2) inserts a
matching `SlotLock` row. If two patients race for the same slot, both
transactions attempt to insert the same `SlotLock` key; Postgres allows only
one to succeed, and the loser's insert fails with a unique-constraint
violation (Prisma error `P2002`). The service layer catches this specific
error and returns a `409 Conflict` ("this slot was just taken") rather than a
generic 500, so the client can immediately show fresh availability.

A separate lock table (rather than a unique index directly on `Appointment`)
was chosen deliberately: appointments are never deleted, only status-changed
(`CANCELLED`, `RESCHEDULED`, `COMPLETED`), so a unique index on the
appointment table itself would permanently block that slot even after
cancellation. The `SlotLock` row, by contrast, is deleted in the same
transaction as a cancellation or reschedule, which atomically frees the slot
for a new booking. This gives correctness (no double-booking, ever) without
sacrificing the ability to re-book a freed slot.

## Slot Hold Mechanism

Rather than a separate "hold" step (reserve → pay/confirm → release-on-
timeout), a slot is *available* only if no active `SlotLock` exists for that
doctor/time. This means a slot is effectively "held" the instant a booking
transaction commits, with no partial state where a slot looks taken but no
real appointment exists. Availability queries
(`GET /appointments/availability/:doctorId`) always read `SlotLock` rows
live, so the UI never shows a stale slot as open. The trade-off is no
"reserve while filling out the form" UX; given the assignment's scope this
was judged unnecessary, since the atomic-insert approach above already fully
prevents double-booking without it.

## Doctor Leave Conflict Handling

When an admin records a `DoctorLeave` (start/end date range), the leave
service runs as its own workflow, independent of the booking transaction
path:

1. Insert the `DoctorLeave` row.
2. Query all `CONFIRMED` appointments for that doctor whose `slotStart` falls
   inside the leave window.
3. For each affected appointment, run an isolated transaction that sets its
   status to `CANCELLED` and deletes its `SlotLock` (freeing the slot).
4. Independently of step 3's DB transaction, send a cancellation-notice email
   to the patient and delete the associated Google Calendar event.

Each affected appointment is processed in its own `try/catch` inside a loop,
so if step 4 fails for one patient (e.g. a bad calendar token), the DB state
for that appointment is still correctly updated, and processing continues for
the remaining patients rather than aborting the whole leave operation. The
leave endpoint returns a summary (`affectedAppointments`, `notified` count)
so the admin can see if some notifications need manual follow-up. Going
forward, the same "on leave" check also blocks new bookings from being made
during the leave window, since `getAvailableSlots` treats any leave-covered
date as fully unavailable before even considering working hours.

## Notification Failure Handling (Email, Calendar, LLM)

All three integrations - email, Google Calendar, and the LLM - follow the
same design principle: **they are side effects of a booking/visit event, not
preconditions for it.** The appointment transaction itself never depends on
any of them succeeding.

- **Email**: every send attempt is logged to an `EmailLog` row (`PENDING` →
  `SENT`/`FAILED`) with an attempt counter. The send path retries twice
  in-line; if both fail, the row is left `FAILED` and a cron job (every 15
  minutes) re-attempts delivery for any `FAILED` log up to 5 total attempts,
  after which it's left for manual review rather than retried forever.
- **Calendar**: create/update/delete calls are wrapped in `try/catch`; any
  failure is recorded on the `CalendarEvent.syncStatus`/`lastError` fields
  and logged, but never thrown back to the caller - a doctor without a
  connected Google account, or a transient Google API error, does not block
  booking, rescheduling, or cancellation.
- **LLM (Gemini)**: pre- and post-visit summary generation retries up to
  twice with a short backoff. On any failure - missing API key, network
  error, or a malformed/non-JSON response - an `AISummary` row is still
  created with `failed: true` and an `errorMessage`, so the doctor/patient UI
  can show "summary unavailable" instead of breaking the page. The rest of
  the booking or post-visit flow completes normally either way.

## Scaling Notes

The current design scales vertically (single Postgres instance), sufficient
for a single clinic. For multi-clinic scale: partition `Appointment`/
`SlotLock` by clinic/doctor, move background jobs (reminders, email retry)
from `node-cron` to a queue (BullMQ/Redis) for horizontal workers, and add a
short-TTL cache in front of `getAvailableSlots` for high-traffic doctors.
