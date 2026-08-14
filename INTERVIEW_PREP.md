# Interview Prep: Healthcare Appointment & Follow-up Manager

This is a complete Q&A walkthrough of the project, organized the way an
interview usually flows: architecture first, then deep into the hardest
part (booking/concurrency), then each subsystem, then testing/security/
scaling. Every answer references the real file it's implemented in — open
that file alongside this guide while you rehearse.

**How to use this:** don't memorize the answers verbatim. Read each one
once, then close the file and try to explain it out loud in your own words
using the code as your mental model. If you can trace the actual file path
without looking, you're ready for that question.

---

## Table of Contents

1. [High-level architecture](#1-high-level-architecture)
2. [Database design & Prisma](#2-database-design--prisma)
3. [Double-booking & concurrency (the deep-dive section)](#3-double-booking--concurrency-the-deep-dive-section)
4. [Booking, reschedule, cancel flows](#4-booking-reschedule-cancel-flows)
5. [Doctor leave & bulk cancellation](#5-doctor-leave--bulk-cancellation)
6. [Authentication & authorization](#6-authentication--authorization)
7. [LLM integration (Gemini)](#7-llm-integration-gemini)
8. [Email system & retries](#8-email-system--retries)
9. [Google Calendar integration](#9-google-calendar-integration)
10. [Background jobs](#10-background-jobs)
11. [Error handling & validation](#11-error-handling--validation)
12. [Frontend architecture](#12-frontend-architecture)
13. [Security](#13-security)
14. [Testing strategy](#14-testing-strategy)
15. [Scaling & what you'd do differently](#15-scaling--what-youd-do-differently)
16. [Rapid-fire / curveball questions](#16-rapid-fire--curveball-questions)

---

## 1. High-level architecture

### Q: Walk me through the architecture at a high level.

A three-tier system: a React SPA talks to an Express/TypeScript REST API
over JSON, which talks to a single PostgreSQL database through Prisma. The
backend is organized as **feature modules** rather than by technical layer
globally — `src/modules/{auth,doctors,leave,appointments,llm,email,calendar}/`
— and each module internally follows schema → service → controller → routes
(`backend/src/modules/appointments/`). Three external services sit at the
edges and are only ever called from their one owning module: Gemini (LLM
module only), an SMTP provider (Email module only), Google Calendar API
(Calendar module only). Two `node-cron` jobs run in-process for medication
reminders and email retry (`backend/src/jobs/index.ts`).

### Q: Why feature-based modules instead of a classic layered `controllers/`, `services/`, `models/` split?

Because most changes in a real system touch one feature end-to-end, not one
layer across all features. Adding "doctor leave" meant touching a leave
schema, service, controller, and routes file — all colocated in
`backend/src/modules/leave/` — instead of hunting through a global
`controllers/` folder for the relevant one among thirty others. It also
makes ownership and testing boundaries obvious: `appointments.service.ts`
only imports from `email`, `calendar`, and `llm` modules (declared
dependencies, visible at the top of the file), it never reaches into
`doctors` internals directly.

### Q: What's the request lifecycle for, say, `POST /api/appointments`?

1. `backend/src/app.ts` — Helmet → CORS → `express.json()` → rate limiter, all
   applied globally to `/api`.
2. `backend/src/modules/appointments/appointments.routes.ts` — `authenticate`
   (verifies JWT) → `authorize(Role.PATIENT)` (role guard) → `validate({body:
   bookAppointmentSchema})` (Zod) → `appointmentsController.book`.
3. `appointments.controller.ts` — thin, just extracts `req.user.userId` and
   `req.body`, calls `appointmentsService.book(...)`, wraps the response in
   `sendSuccess`.
4. `appointments.service.ts` — all real logic: availability check, DB
   transaction, then best-effort side effects (email, calendar, LLM).
5. Any thrown error anywhere in that chain is caught by
   `asyncHandler` (`backend/src/utils/asyncHandler.ts`) and forwarded to
   the centralized `errorHandler` in
   `backend/src/middleware/error.middleware.ts`.

### Q: Why is the controller so thin?

Testability and reuse. `appointmentsService.book()` has zero dependency on
`req`/`res` — it takes plain arguments and returns a plain object — so it
can be unit tested without spinning up Express, and it could be reused from
a CLI script or a cron job without going through HTTP at all. The
controller's only job is translating HTTP ↔ service calls
(`backend/src/modules/appointments/appointments.controller.ts`).

---

## 2. Database design & Prisma

**File:** `backend/prisma/schema.prisma`

### Q: Walk me through the schema.

Core identity: `User` (role: `ADMIN`/`DOCTOR`/`PATIENT`, holds the
`passwordHash`) has an optional 1-1 `Doctor` or `Patient` profile — this
mirrors how a real hospital system separates "can log in" from "clinical
role data." `Doctor` has many `DoctorWorkingHour` (recurring weekly
availability) and `DoctorLeave` (date-range blackouts). `Appointment` is the
hub: it belongs to one `Patient` and one `Doctor`, and has optional 1-1
children `SymptomReport`, `PostVisitNote`, `CalendarEvent`, plus 1-many
`AISummary`, `Prescription`, `EmailLog`. `Prescription` has many
`MedicationReminder`. Every write-side action is designed to be traceable:
`EmailLog` and `AuditLog` exist purely for observability, not for the
happy-path logic.

### Q: Why is `SlotLock` a separate table instead of a unique index on `Appointment` itself?

This is the single most important schema decision in the project — see
[Section 3](#3-double-booking--concurrency-the-deep-dive-section) for the
full answer, but the short version: appointments are never deleted, only
status-changed (`CANCELLED`, `RESCHEDULED`), so a unique constraint directly
on `Appointment(doctorId, slotStart)` would permanently block that
timestamp forever, even after cancellation. `SlotLock` rows, by contrast,
are deleted in the same transaction as a cancel/reschedule, so the
constraint only ever blocks *currently active* double-bookings.

```prisma
// backend/prisma/schema.prisma
model SlotLock {
  id            String   @id @default(uuid())
  doctorId      String
  slotStart     DateTime
  appointmentId String   @unique
  createdAt     DateTime @default(now())

  @@unique([doctorId, slotStart], name: "doctor_slot_lock_unique")
}
```

### Q: Why UUIDs instead of auto-increment integers for primary keys?

Two reasons worth citing: (1) UUIDs can be generated client-side or in
application code before the row is inserted, which matters when you need
the ID before a transaction commits (not exploited heavily here, but it's
the general reason); (2) they don't leak sequential information (e.g. "how
many total users exist," "was this the 4th or 400th appointment") the way
auto-increment IDs do, which is a mild but real consideration for a
healthcare system.

### Q: Why `Json` type for `medicationSchedule` on `AISummary` instead of a normalized table?

It's LLM-generated, semi-structured output whose exact shape depends on the
prompt response, not something the app writes queries against directly (we
never filter/sort appointments by "which medication schedule item").
Normalizing it would mean designing a rigid schema around something
inherently free-form, for no query benefit. `Prescription` — the
data the app *does* query/join/schedule reminders from — is fully
normalized instead (`medicationName`, `dosage`, `frequencyPerDay`,
`durationDays` are real columns).

### Q: What indexes are defined and why?

```prisma
// on Appointment
@@index([patientId])
@@index([doctorId, slotStart])
@@index([status])
```
`(doctorId, slotStart)` supports the two hottest read paths: computing
availability for a doctor on a date, and the leave-cancellation lookup
(`slotStart` range scan per doctor). `status` supports dashboard queries
that filter by `CONFIRMED`/`COMPLETED`. `EmailLog` and `MedicationReminder`
have similar targeted indexes (`status`, `[scheduledAt, sent]`) supporting
exactly the queries the two cron jobs run.

### Q: How would you find this doctor's confirmed appointments for tomorrow, in Prisma?

```ts
prisma.appointment.findMany({
  where: {
    doctorId,
    status: 'CONFIRMED',
    slotStart: { gte: startOfTomorrow, lte: endOfTomorrow },
  },
  include: { patient: { include: { user: true } } },
});
```
This is effectively what `leaveService.createLeave` does in
`backend/src/modules/leave/leave.service.ts` to find appointments affected
by a leave date range.

---

## 3. Double-booking & concurrency (the deep-dive section)

This is where interviewers spend the most time on a booking system — know
this section cold.

**Files:** `backend/prisma/schema.prisma` (SlotLock model),
`backend/src/modules/appointments/appointments.service.ts` (the `book`
method), `backend/src/middleware/error.middleware.ts` (P2002 handling).

### Q: How do you prevent two patients from booking the same slot?

Two layers, and it's important to explain *why both* rather than just one:

**Layer 1 — application-level pre-check** (fast, good UX, not
concurrency-safe alone):
```ts
// availability.service.ts, called before opening a transaction
await availabilityService.assertSlotIsBookable(input.doctorId, input.slotStart);
```
This checks working hours, doctor leave, and currently-known taken slots.
It gives a clean, specific 400 error for the common case (slot doesn't
exist, doctor on leave) — but by itself it's a classic TOCTOU
(time-of-check-to-time-of-use) race: two requests can both pass this check
before either has written anything.

**Layer 2 — database-level atomic guarantee** (the actual correctness
proof):
```ts
// appointments.service.ts — book()
appointment = await prisma.$transaction(async (tx) => {
  const created = await tx.appointment.create({ data: { ...} });
  // This insert is the atomic double-booking gate:
  await tx.slotLock.create({
    data: { doctorId: doctor.id, slotStart: input.slotStart, appointmentId: created.id },
  });
  return created;
});
```
`SlotLock` has `@@unique([doctorId, slotStart])`. If two transactions race
to insert a `SlotLock` row for the same doctor+time, Postgres guarantees
only one `INSERT` succeeds — the other gets a unique-constraint violation
at the database engine level, which is a hard guarantee independent of
application timing, unlike a `SELECT`-then-`INSERT` check.

### Q: What happens to the losing request?

Prisma surfaces the Postgres unique violation as
`PrismaClientKnownRequestError` with `code === 'P2002'`. The service catches
it specifically and converts it to a domain-appropriate error:
```ts
} catch (err) {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw ApiError.conflict('This slot was just booked by someone else. Please choose another time.');
  }
  throw err;
}
```
`ApiError.conflict` maps to **HTTP 409**, and the whole transaction is
rolled back automatically by Postgres — the loser's `Appointment` row never
persists either, since it was created in the same transaction as the failed
`SlotLock` insert.

### Q: Why not just use a unique index on `Appointment(doctorId, slotStart)` directly — isn't that simpler?

That was the first design I considered, and it's wrong for this domain.
Appointments are **never deleted** — cancelling sets `status = CANCELLED`,
rescheduling sets `status = RESCHEDULED` and creates a *new* row. If the
unique constraint lived on `Appointment` itself, a cancelled row would
permanently occupy that `(doctorId, slotStart)` pair — nobody could ever
book that exact doctor+time again, forever, even though the slot is
obviously free. `SlotLock` solves this because it's a separate row that
gets `DELETE`d in the same transaction as the cancellation:
```ts
// cancel()
await prisma.$transaction(async (tx) => {
  await tx.appointment.update({ where: { id: existing.id }, data: { status: 'CANCELLED' } });
  await tx.slotLock.deleteMany({ where: { appointmentId: existing.id } });
});
```
So the constraint only ever blocks *currently active* conflicts, and the
slot is atomically freed the instant it's cancelled.

### Q: Why not use `SELECT ... FOR UPDATE` / a Postgres advisory lock instead?

Both are valid alternative solutions and worth mentioning to show breadth,
but they have real trade-offs I chose to avoid here: `SELECT FOR UPDATE`
requires the row to already exist (you'd lock an existing row, but there's
no row yet for a slot nobody has booked — you'd have to lock something else,
like a synthetic "slot" row per doctor per day, adding a table anyway).
Advisory locks (`pg_advisory_xact_lock`) work on arbitrary integer keys and
would work here, but they're a Postgres-specific, somewhat "invisible"
mechanism — nothing in the schema documents that a lock exists, which hurts
maintainability. A unique constraint is self-documenting (any engineer
reading the schema immediately understands the invariant), portable in
spirit to any RDBMS, and is enforced the same way regardless of which code
path tries to violate it — even a stray manual `INSERT` in a psql console
would be caught.

### Q: What isolation level does the transaction run at, and does it matter here?

Prisma's default for `$transaction` on Postgres is `Read Committed`. It's
worth knowing that *for this specific mechanism, isolation level doesn't
matter* — the correctness comes from the unique constraint being enforced
at the storage layer on `INSERT`, not from the isolation level preventing a
particular anomaly. Even at `Read Committed`, two concurrent `INSERT`s
into a uniquely-constrained column can never both succeed. This is a good
point to raise proactively — it shows you understand *why* the guarantee
holds rather than just that it does.

### Q: How would you actually test this race condition?

Fire two concurrent booking requests for the identical `doctorId` +
`slotStart` and assert exactly one returns 201 and the other 409. See
`RUNNING_AND_TESTING.md` §5.4 for the literal `curl … &` / `wait` script
used to verify this manually; the equivalent in an automated test would use
`Promise.all([bookA(), bookB()])` and assert on `Promise.allSettled` results.

### Q: What's the "slot hold" mechanism — do you reserve a slot while the user is filling out the form?

No, and that's a deliberate simplification documented in
`system_design.md`. There's no separate "reserve" step with a timeout —
availability is computed live from `SlotLock` rows on every read, and a
slot only becomes unavailable the instant a booking transaction actually
commits. The trade-off: no "this slot is reserved for you for 5 minutes
while you finish checkout" UX. Given there's no payment step in this
assignment, that complexity wasn't justified — the atomic-insert approach
already fully prevents double-booking without it.

---

## 4. Booking, reschedule, cancel flows

**File:** `backend/src/modules/appointments/appointments.service.ts`,
`backend/src/modules/appointments/availability.service.ts`

### Q: How is availability computed?

`availability.service.ts`'s `getAvailableSlots(doctorId, date)`:
1. Loads the doctor's `DoctorWorkingHour` rows matching that date's
   `dayOfWeek` (0–6).
2. Short-circuits to `[]` if `isDoctorOnLeave(doctorId, date)` is true.
3. Loads all `SlotLock` rows for that doctor on that date into a `Set` of
   timestamps (`O(1)` membership check).
4. Walks each working-hour window in `slotDurationMinutes` increments,
   keeping any timestamp that's (a) in the future and (b) not in the taken
   set.

```ts
// availability.service.ts
while (cursor.getTime() + doctor.slotDurationMinutes * 60_000 <= windowEnd.getTime()) {
  if (cursor > now && !takenSet.has(cursor.getTime())) {
    slots.push(new Date(cursor));
  }
  cursor.setMinutes(cursor.getMinutes() + doctor.slotDurationMinutes);
}
```

### Q: What does `assertSlotIsBookable` actually protect against, given the DB does the "real" check?

It's about **error quality**, not correctness. Without it, a request for an
invalid slot (outside working hours, in the past, or on a leave day) would
still hit the transaction, and — since no `SlotLock` conflict exists for a
nonsensical slot nobody's ever booked — it would actually *succeed* and
create a bogus appointment at 3am on a Sunday, say. `assertSlotIsBookable`
catches that class of error with a specific, useful 400 message before any
DB write happens.

### Q: Walk me through reschedule — why create a new row instead of just updating `slotStart` on the existing one?

```ts
// appointments.service.ts — reschedule()
await tx.appointment.update({ where: { id: existing.id }, data: { status: 'RESCHEDULED' } });
await tx.slotLock.deleteMany({ where: { appointmentId: existing.id } });

const created = await tx.appointment.create({
  data: { ...sameParties, slotStart: newSlotStart, slotEnd: newSlotEnd,
           status: 'CONFIRMED', rescheduledFromId: existing.id },
});
await tx.slotLock.create({ data: { doctorId: existing.doctorId, slotStart: newSlotStart, appointmentId: created.id } });
```
Two reasons: (1) **audit trail** — you can always answer "what was this
appointment before it was rescheduled?" by following `rescheduledFromId`
(a self-relation, `@@unique` on that FK, defined in `schema.prisma`); (2) it
reuses the exact same double-booking-safe insert path as a fresh booking —
no separate "move" logic to get wrong. The whole thing (mark old row
`RESCHEDULED`, free its lock, create+lock the new row) happens in one
transaction, so a reschedule can never leave the system in a state where
the old slot is freed but the new one failed to be claimed.

### Q: What happens if the new slot the user is rescheduling to gets taken by someone else in the same instant?

Same `P2002` → 409 path as a fresh booking. Because it's all one
transaction, the *original* appointment's cancellation is also rolled back
— the patient doesn't lose their existing confirmed slot just because their
reschedule attempt collided with someone else. That atomicity is the reason
the whole operation is wrapped in a single `$transaction` rather than two
separate calls to `cancel()` then `book()`.

### Q: Why do side effects (email, calendar, LLM) happen *after* the transaction rather than inside it?

Because they're not part of the correctness-critical write, and calling an
external HTTP API (Gemini, SMTP, Google) from inside a database transaction
would hold row/table locks open for however long that network call takes —
potentially seconds, during which other bookings for that doctor could be
needlessly blocked or the transaction could time out. Instead:
```ts
await runSideEffectsSafely('booking confirmation emails', () => sendBookingEmails(appointment));
await runSideEffectsSafely('calendar sync', () => syncCalendarForNewAppointment(appointment));
```
Each is wrapped so a failure is logged, not thrown — see
[Section 8/9](#8-email-system--retries) for how each integration further
protects itself.

---

## 5. Doctor leave & bulk cancellation

**File:** `backend/src/modules/leave/leave.service.ts`

### Q: Walk me through what happens when an admin marks a doctor on leave.

```ts
async createLeave(doctorId: string, input: CreateLeaveInput) {
  const leave = await prisma.doctorLeave.create({ data: { doctorId, ...input } });

  const affected = await prisma.appointment.findMany({
    where: { doctorId, status: 'CONFIRMED', slotStart: { gte: input.startDate, lte: input.endDate } },
    include: { patient: { include: { user: true } } },
  });

  for (const appointment of affected) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.appointment.update({ where: { id: appointment.id }, data: { status: 'CANCELLED' } });
        await tx.slotLock.deleteMany({ where: { appointmentId: appointment.id } });
      });
      await emailService.sendAndLog({ ...doctorLeaveNotice... });
      await calendarService.deleteEvent(appointment.id, doctor.user.id);
      notified++;
    } catch (err) {
      logger.error({ err, appointmentId: appointment.id }, 'Failed to fully process leave-related cancellation');
    }
  }
  return { leave, affectedAppointments: affected.length, notified };
}
```
1. Insert the `DoctorLeave` row (this alone makes the date range
   unbookable going forward, via `isDoctorOnLeave` in availability service).
2. Query every `CONFIRMED` appointment in that date range.
3. **Loop with a per-appointment `try/catch`** — cancel + free the slot lock
   in its own transaction, send the notice email, delete the calendar
   event.

### Q: Why is the per-appointment `try/catch` important — what would break without it?

If you processed all affected appointments inside one giant transaction or
one unguarded loop, a single failure (say, patient #3's email address
bounces, or their calendar delete call times out) would either roll back
*every* cancellation in the batch (if in one transaction) or halt the loop
entirely partway through (if unguarded) — leaving some patients'
appointments silently still `CONFIRMED` for a doctor who is, in reality, on
leave. Wrapping each iteration independently means one patient's
notification failure never prevents the other nine from being correctly
cancelled and notified. This is the same "side effects must not compromise
correctness" principle applied at leave time.

### Q: How does the admin know if some notifications failed?

The endpoint returns a summary: `{ affectedAppointments: 10, notified: 9 }`.
A gap between those two numbers is the signal that something needs manual
follow-up — visible directly in the API response
(`leave.controller.ts` → `leaveController.create`), not something you have
to dig into logs to discover.

### Q: Does marking a leave block *new* bookings on that date too?

Yes — `availabilityService.isDoctorOnLeave` is checked first thing inside
`getAvailableSlots` (`availability.service.ts`), so any date covered by an
active `DoctorLeave` row returns an empty slots array before working hours
are even considered. Leave doesn't just clean up the past, it prevents the
future too.

---

## 6. Authentication & authorization

**Files:** `backend/src/modules/auth/auth.service.ts`,
`backend/src/middleware/auth.middleware.ts`

### Q: Walk me through login.

```ts
// auth.service.ts
async login(input: LoginInput) {
  const user = await prisma.user.findUnique({ where: { email: input.email }, include: {...} });
  const hashToCompare = user?.passwordHash ?? '$2b$10$invalidsaltinvalidsaltinvalidsaltinva';
  const valid = await bcrypt.compare(input.password, hashToCompare);
  if (!user || !valid) throw ApiError.unauthorized('Invalid email or password');
  if (!user.isActive) throw ApiError.forbidden('This account has been deactivated');
  const token = issueToken(user.id, user.role, user.email);
  return { token, user: sanitizeUser(user) };
}
```

### Q: Why compare against a dummy hash when the user isn't found, instead of just returning early?

**Timing-attack resistance.** If the code short-circuited with `if (!user)
throw ...` before ever calling `bcrypt.compare`, a nonexistent email would
return noticeably faster than an existing email with a wrong password
(bcrypt is deliberately slow, ~100ms+). An attacker could time responses to
enumerate which emails are registered. Always running `bcrypt.compare`
against *some* hash — real or dummy — keeps response timing roughly
constant regardless of whether the account exists.

### Q: What's actually inside the JWT, and why those fields specifically?

```ts
{ userId, role, email }
```
`userId` to identify the actor for ownership checks, `role` so
`authorize()` can check permissions **without a DB round-trip on every
request** (the whole point of JWTs over server-side sessions), `email` for
convenience/logging. Notably *not* included: anything sensitive
(`passwordHash` obviously never touches it) or anything that changes
frequently — if `role` needs to change, the user needs to re-log-in to get
a fresh token, which is an accepted trade-off for statelessness.

### Q: Where's the "log out" implemented, given JWTs are stateless?

There isn't a server-side logout/blacklist in this implementation — logout
is client-side only (`AuthContext.logout()` in
`frontend/src/context/AuthContext.tsx` clears `localStorage`). This is a
known, explicitly-documented limitation (see README "Future Improvements":
refresh tokens / shorter-lived access tokens). If asked "how would you add
real revocation," the answer is: either move to short-lived access tokens +
refresh tokens with a server-side refresh-token store you can invalidate,
or maintain a denylist of revoked JWT IDs (`jti` claim) checked on each
request — at the cost of reintroducing a DB/cache lookup per request.

### Q: How does role-based authorization work at the route level?

```ts
// auth.middleware.ts
export function authorize(...allowedRoles: Role[]) {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!allowedRoles.includes(req.user.role)) return next(ApiError.forbidden(...));
    next();
  };
}
```
Composed declaratively per-route:
```ts
// doctors.routes.ts
router.post('/', authenticate, authorize(Role.ADMIN), validate({ body: createDoctorSchema }), doctorsController.create);
```
`authenticate` must run first to populate `req.user`; `authorize` then
checks it. This ordering is enforced by convention (route definitions list
them in the right order) rather than the framework — worth mentioning as a
known "trust the developer" spot if asked about weaknesses.

### Q: Beyond role checks, how do you stop Patient A from viewing/cancelling Patient B's appointment (object-level authorization)?

`assertOwnership` in `appointments.service.ts`:
```ts
function assertOwnership(ownerUserId: string, actingUserId: string) {
  if (ownerUserId !== actingUserId) throw ApiError.forbidden('You do not have access to this appointment');
}
```
Called in both `reschedule()` and `cancel()` after loading the appointment,
comparing the *actual resource owner* (`existing.patient.userId`) against
the *requester* (`req.user.userId`, passed down as `actingUserId`). This is
distinct from role-based authorization — `authorize(Role.PATIENT)` only
proves "you're *a* patient," not "you own *this* appointment." Missing this
check is a classic IDOR (Insecure Direct Object Reference) vulnerability.

---

## 7. LLM integration (Gemini)

**Files:** `backend/src/modules/llm/llm.service.ts`,
`backend/src/modules/llm/gemini.client.ts`

### Q: What are the two prompts, and why did you design them to return JSON?

```ts
// llm.service.ts — buildPreVisitPrompt
`Analyse these symptoms and return ONLY a JSON object (no markdown, no code fences) with exactly these keys:
{ "urgency": "Low" | "Medium" | "High", "chiefComplaint": string, "suggestedQuestions": [string, string, string] }
Symptoms: ${symptoms}`
```
```ts
// buildPostVisitPrompt
`Convert these clinical notes into a patient-friendly summary. Return ONLY a JSON object ... :
{ "patientSummary": string, "medicationSchedule": [...], "followUpInstructions": string }
Clinical notes: ${clinicalNotes}`
```
JSON output because the result needs to be stored in structured DB columns
(`AISummary.urgency`, `.chiefComplaint`, `.suggestedQuestions[]`) and
rendered in specific UI slots (a badge for urgency, a bulleted list for
questions) — free-text prose would require fragile parsing/regex to extract
those pieces.

### Q: LLMs don't reliably follow "return only JSON" instructions — how do you handle that?

Defensively, at the parsing layer:
```ts
function extractJson(raw: string): unknown {
  // Gemini sometimes wraps JSON in ```json fences despite instructions
  const cleaned = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned);
}
```
And if `JSON.parse` still throws (genuinely malformed output), it's caught
and the summary is stored as `failed: true` with the raw text preserved in
`rawResponse` for debugging — never an unhandled exception bubbling up to
the user.

### Q: What's the retry strategy, and why is it capped at 2 attempts with backoff instead of, say, 5?

```ts
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;
...
if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS * attempt);
```
This runs **synchronously inside the booking/post-visit request** (it's
`await`ed before the API responds), so retry count is a direct trade-off
against request latency — the patient/doctor is waiting on this call. 2
attempts with a short linear backoff catches transient network blips
without making a booking request hang for many seconds. If this needed to
be more resilient, the right move is to make it *asynchronous* (queue the
summary generation, return immediately, let the UI poll or receive a
websocket push) rather than just cranking up retry count on a blocking call
— a good "what would you improve" answer.

### Q: What's the actual failure-handling guarantee — what does "never crashes" mean concretely?

Every path — missing API key, network error, non-2xx response, malformed
JSON — ends in an `AISummary` row being created, just with `failed: true`
and `errorMessage` set instead of the parsed fields:
```ts
if ('error' in result) {
  return prisma.aISummary.create({
    data: { appointmentId, type: 'PRE_VISIT', model: env.GEMINI_MODEL, failed: true, errorMessage: result.error },
  });
}
```
The frontend checks `aiSummary.failed` and renders "AI summary unavailable"
instead of a blank/broken UI (see `DoctorDashboardPage.tsx`:
`{preVisit?.failed && <p>AI summary unavailable for this visit.</p>}`). The
booking or post-visit-submission API call itself always still returns
200/201 regardless of LLM outcome — this is enforced by calling
`llmService.generate...Summary` through `runSideEffectsSafely` in
`appointments.service.ts`, the same safety wrapper used for email/calendar.

### Q: What happens if `GEMINI_API_KEY` isn't set at all?

`gemini.client.ts`'s `getClient()` returns `null`, and `generateText` throws
a plain `Error('GEMINI_API_KEY is not configured')` immediately — no
network call attempted. That error is caught by the same retry/failure path
above, so the app runs fully functionally with AI features simply reporting
"unavailable" everywhere. This was deliberately tested in
`RUNNING_AND_TESTING.md` §6.1.

---

## 8. Email system & retries

**Files:** `backend/src/modules/email/email.service.ts`,
`email.transport.ts`, `email.templates.ts`

### Q: How does email delivery degrade gracefully in local dev without real SMTP credentials?

```ts
// email.transport.ts
if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) {
  transporter = nodemailer.createTransport({ host: env.SMTP_HOST, ... });
} else {
  logger.warn('SMTP not configured - emails will be logged, not sent.');
  transporter = nodemailer.createTransport({ jsonTransport: true });
}
```
Nodemailer's built-in `jsonTransport` "sends" mail by just serializing it to
an object instead of making a network call — no errors, no crash, and the
rest of the booking/notification pipeline behaves identically whether or
not a real mail provider is configured.

### Q: Explain the two-level retry: immediate + background.

```ts
// email.service.ts — sendAndLog
for (let attempt = 1; attempt <= MAX_IMMEDIATE_ATTEMPTS; attempt++) {   // = 2
  try {
    await sendMail(...);
    await prisma.emailLog.update({ data: { status: 'SENT', attempts: attempt } });
    return;
  } catch (err) { lastError = err; }
}
await prisma.emailLog.update({ data: { status: 'FAILED', attempts: MAX_IMMEDIATE_ATTEMPTS, lastError: ... } });
```
Every send is logged to `EmailLog` regardless of outcome — this is the key
design choice: **the function never throws**, so a downstream email outage
can never break the booking flow that triggered it. Two immediate retries
handle transient blips. Anything still failing after that is left
`status: FAILED` in the DB, picked up later by the background retry job
(`jobs/index.ts`, every 15 minutes, capped at 5 total attempts before it's
left for manual review — see `emailService.retryFailedEmails`).

### Q: Why log every attempt to a DB table instead of just retrying in-memory / relying on the mail provider's own retry?

Observability and recoverability across restarts. An in-memory retry queue
is lost on server restart or crash; a `FAILED` row in Postgres survives and
gets picked up by the next cron run whenever the process comes back. It
also gives the admin/ops a queryable audit trail: "did this patient
actually get their cancellation email?" is answerable with one query
instead of grepping logs.

---

## 9. Google Calendar integration

**Files:** `backend/src/modules/calendar/googleClient.ts`,
`calendar.service.ts`, `calendar.routes.ts`

### Q: Walk me through the OAuth2 flow.

1. Doctor (already logged into the app) hits `GET /api/calendar/connect`
   (authenticated route) → server builds a Google consent URL via
   `oauth2Client.generateAuthUrl(...)`, passing their **own JWT `userId` as
   the OAuth `state` parameter** — this is the trick that lets us tie the
   OAuth callback back to the right user:
   ```ts
   router.get('/connect', authenticate, asyncHandler(async (req, res) => {
     const url = getGoogleAuthUrl(req.user.userId);   // userId → state
     return sendSuccess(res, 200, { url });
   }));
   ```
2. Doctor is redirected to Google, grants access.
3. Google redirects to `GET /api/calendar/callback?code=...&state=<userId>`
   — this route is **unauthenticated** (Google isn't carrying our JWT), so
   `state` is how we know whose account to attach the resulting tokens to.
4. `handleOAuthCallback(state, code)` exchanges the code for tokens and
   `upsert`s a `GoogleAuthToken` row keyed on that `userId`.

### Q: Why is the refresh token stored per-user rather than one shared service-account credential?

Because events need to be created **on each individual doctor's own Google
Calendar**, with the patient added as an attendee — that's the actual
requirement ("Google Calendar event created for both on booking"). A single
service-account credential could only write to one calendar (or would
require domain-wide delegation, which needs Google Workspace admin
privileges most clinics won't have). Per-user OAuth is the standard pattern
for "act on behalf of this specific user's calendar."

### Q: What happens if calendar sync fails — walk me through the failure path.

Every calendar operation is wrapped so it **never throws to the caller**:
```ts
// calendar.service.ts — createEvent
try {
  const client = await getAuthedClientForUser(input.organizerUserId);
  if (!client) {
    await upsertRecord(input.appointmentId, { syncStatus: 'FAILED', lastError: 'Doctor has not connected Google Calendar' });
    return;
  }
  const event = await calendar.events.insert({ ... });
  await upsertRecord(input.appointmentId, { googleEventId: event.data.id, syncStatus: 'SYNCED' });
} catch (err) {
  logger.error({ err }, 'Google Calendar event creation failed');
  await upsertRecord(input.appointmentId, { syncStatus: 'FAILED', lastError: err.message });
}
```
Outcome (success or failure) is always persisted to `CalendarEvent`
(`syncStatus`, `lastError`), and the booking API response is completely
unaffected either way. This is the default state in local dev, since
connecting Google Calendar is an optional manual step — see
`RUNNING_AND_TESTING.md` §6.3.

### Q: How does reschedule handle the calendar event — one update call, or delete+recreate?

Delete + recreate:
```ts
await calendarService.deleteEvent(existing.id, newAppointment.doctor.user.id);
await syncCalendarForNewAppointment(newAppointment);
```
There *is* an `updateEvent` method available (a `PATCH` to the existing
Google event), but the reschedule flow deletes the old `CalendarEvent`
record and creates a fresh one, mirroring how the underlying `Appointment`
itself is handled (old row marked `RESCHEDULED`, new row created) rather
than mutating in place — keeps the calendar and appointment lifecycles
consistent with each other. (Worth noting as a possible future
optimization: switching to `updateEvent` would avoid a delete/recreate
round-trip to Google and preserve the event's history/comments on Google's
side.)

---

## 10. Background jobs

**Files:** `backend/src/jobs/index.ts`,
`backend/src/jobs/medicationReminder.job.ts`

### Q: What runs on a schedule, and why `node-cron` instead of a proper job queue?

Two jobs, registered in-process at server startup
(`startBackgroundJobs()` called from `server.ts`):
```ts
cron.schedule('*/5 * * * *', async () => { ... runMedicationReminderJob() ... });
cron.schedule('*/15 * * * *', async () => { ... emailService.retryFailedEmails() ... });
```
`node-cron` was chosen deliberately for this project's scope: it needs zero
additional infrastructure (no Redis), which matters given the assignment's
"minimal dependencies" constraint. The explicit trade-off (documented in
`system_design.md`'s Scaling Notes): it only works with a single backend
process — if you horizontally scale to multiple API instances, every
instance would independently fire the same cron schedule and double-process
reminders. BullMQ+Redis is the noted upgrade path once that matters.

### Q: How does the reminder job avoid sending the same reminder twice?

Every `MedicationReminder` row has a `sent: Boolean` flag, checked and
flipped atomically per-row:
```ts
const due = await prisma.medicationReminder.findMany({
  where: { sent: false, scheduledAt: { lte: new Date() } }, take: 100,
});
for (const reminder of due) {
  try {
    await emailService.sendAndLog({ ... });
    await prisma.medicationReminder.update({ where: { id: reminder.id }, data: { sent: true, sentAt: new Date() } });
  } catch (err) { logger.error(...) }   // this reminder stays sent:false, retried next run
}
```
If the email send throws, the row is simply left `sent: false` and picked
up again on the next 5-minute run — no separate retry-tracking needed for
this job specifically, since re-running the query is itself the retry
mechanism. (Contrast with `EmailLog`'s explicit `attempts` counter, which
exists because that job's granularity is "one attempt = one row," whereas
here "not yet sent" already captures everything needed.)

### Q: How are reminder times actually computed from a prescription?

```ts
// appointments.service.ts
function buildReminderTimes(frequencyPerDay: number, durationDays: number): Date[] {
  const intervalHours = Math.max(1, Math.floor(24 / frequencyPerDay));
  const start = new Date(); start.setMinutes(0,0,0); start.setHours(start.getHours() + 1);
  for (let day = 0; day < durationDays; day++)
    for (let dose = 0; dose < frequencyPerDay; dose++)
      reminders.push(/* start + day days + dose*intervalHours hours */);
  return reminders;
}
```
E.g. `frequencyPerDay: 3, durationDays: 5` → 15 reminder rows, spaced ~8
hours apart (`24/3`), starting ~1 hour after the prescription is submitted.
This is a simplification worth being upfront about if asked: it doesn't
account for the patient's actual waking hours/timezone (a 3am reminder is
possible with a naive interval split) — a real product would let the
patient set a preferred first-dose time.

---

## 11. Error handling & validation

**Files:** `backend/src/middleware/error.middleware.ts`,
`backend/src/utils/ApiError.ts`, `backend/src/middleware/validate.middleware.ts`

### Q: What's the shape of your centralized error handling?

`ApiError` is a typed exception (`backend/src/utils/ApiError.ts`) with
static factories (`ApiError.notFound()`, `.conflict()`, `.forbidden()`,
etc.) so services throw semantically instead of manually setting status
codes everywhere. The single Express error-handling middleware (arity-4,
registered last in `app.ts`) pattern-matches on error type:
```ts
if (err instanceof ApiError) return res.status(err.statusCode).json({ success: false, message: err.message, details: err.details });
if (err instanceof ZodError) return res.status(400).json({ success: false, message: 'Validation failed', details: err.flatten() });
if (err instanceof Prisma.PrismaClientKnownRequestError) {
  if (err.code === 'P2002') return res.status(409).json({ ... 'A record with these details already exists' });
  if (err.code === 'P2025') return res.status(404).json({ ... 'Record not found.' });
}
// fallback: 500, logged, generic message to the client
```
Every route uses `asyncHandler` (`utils/asyncHandler.ts`) to catch rejected
promises and forward them to `next(err)` — without it, an unhandled
rejection in an `async` Express route handler would crash the process
instead of hitting this middleware.

### Q: Why is P2002 handled in *two* places — the generic error handler and specifically inside `appointments.service.ts`?

Deliberately different scopes. The generic handler in
`error.middleware.ts` is a **safety net** — a reasonable default message
for *any* unhandled unique-constraint violation anywhere in the app,
including ones nobody thought to special-case. The specific `catch` block
inside `appointmentsService.book()`/`reschedule()` exists because that
particular P2002 (a `SlotLock` collision) has a much better, situation-
specific message ("this slot was just booked by someone else") than the
generic one ("a record with these details already exists"). The specific
handler runs first (it's closer to where the error is thrown) and only
re-throws if it's *not* the case it knows how to explain; anything else
falls through to the generic handler.

### Q: How does request validation work?

Zod schemas per module (e.g. `appointments.schema.ts`), applied via a
generic `validate({body, params, query})` middleware:
```ts
export function validate(schemas) {
  return (req, _res, next) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      ...
      next();
    } catch (err) { next(err); }  // ZodError caught by the centralized handler
  };
}
```
Notice it *reassigns* `req.body` to the parsed result, not just validates
it — this means `z.coerce.date()` (used for `slotStart`, `dateOfBirth`
etc.) actually converts incoming ISO strings to real `Date` objects before
the controller ever sees them, so services can assume correctly-typed
input rather than re-parsing.

---

## 12. Frontend architecture

**Files:** `frontend/src/api/client.ts`, `frontend/src/context/AuthContext.tsx`,
`frontend/src/components/ProtectedRoute.tsx`, `frontend/src/App.tsx`

### Q: How does the frontend handle auth state and protected routes?

`AuthContext` (`context/AuthContext.tsx`) holds the current user, backed by
`localStorage` for persistence across reloads, and exposes `login`,
`register`, `logout`. `ProtectedRoute` (`components/ProtectedRoute.tsx`)
wraps route elements:
```tsx
export function ProtectedRoute({ children, allow }: { children: ReactNode; allow?: Role[] }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (allow && !allow.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
```
Used declaratively per-route in `App.tsx`, e.g.
`<Route path="/doctors" element={<ProtectedRoute allow={['PATIENT']}><DoctorSearchPage/></ProtectedRoute>} />`.

### Q: How does the JWT actually get attached to every API request?

An Axios request interceptor, not manually per-call:
```ts
// api/client.ts
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
```
And symmetrically, a response interceptor handles global session expiry:
```ts
apiClient.interceptors.response.use((r) => r, (error) => {
  if (error.response?.status === 401) {
    localStorage.removeItem('token'); localStorage.removeItem('user');
    if (window.location.pathname !== '/login') window.location.href = '/login';
  }
  return Promise.reject(error);
});
```
This means individual page components never think about tokens at all —
they just call `apiClient.get(...)` and any expired-session handling
happens centrally.

### Q: One dashboard route (`/dashboard`), three different components — how does that work?

`DashboardPage.tsx` is a thin role-switch, not a route per role:
```tsx
export function DashboardPage() {
  const { user } = useAuth();
  if (user.role === 'DOCTOR') return <DoctorDashboardPage />;
  if (user.role === 'ADMIN') return <AdminDashboardPage />;
  return <PatientDashboardPage />;
}
```
Keeps the URL structure simple (one bookmark-able `/dashboard` for
everyone) while keeping each role's dashboard as a fully separate,
independently-testable component — `PatientDashboardPage.tsx`,
`DoctorDashboardPage.tsx`, `AdminDashboardPage.tsx` don't share state or
props with each other.

### Q: Why React Hook Form instead of controlled `useState` per field?

Mainly demonstrated in `LoginPage.tsx`/`RegisterPage.tsx` — it avoids a
re-render on every keystroke (uncontrolled inputs registered via `ref`) and
gives declarative validation (`{...register('password', {required: true,
minLength: 8})}`) colocated with the field instead of a separate manual
validation function. `BookingPage.tsx`, by contrast, uses plain `useState`
because its state is more interdependent/dynamic (selected slot, dynamic
symptom fields) — a good example of picking the right tool per screen
rather than dogmatically using one pattern everywhere.

---

## 13. Security

### Q: Summarize the security measures end-to-end.

| Concern | Mitigation | File |
|---|---|---|
| Passwords at rest | bcrypt hash, never store plaintext | `auth.service.ts` |
| Timing attacks on login | dummy-hash compare when user not found | `auth.service.ts` |
| Auth | JWT, verified per-request | `auth.middleware.ts` |
| Authorization (role) | `authorize(...roles)` middleware | `auth.middleware.ts` |
| Authorization (object) | `assertOwnership` per-resource check | `appointments.service.ts` |
| Injection | Prisma parameterizes all queries — no raw string SQL anywhere | throughout |
| XSS-relevant headers | Helmet (CSP, HSTS, noSniff, etc.) | `app.ts` |
| CSRF-adjacent | CORS locked to `FRONTEND_URL`, not `*` | `app.ts` |
| Brute force / abuse | `express-rate-limit`, per-IP window | `app.ts` |
| Input validation | Zod on every route body/params/query | `validate.middleware.ts` + per-module `.schema.ts` |
| Secrets | `.env`, never committed (`.gitignore`), validated at boot | `config/env.ts` |
| PII in JWT | Only `userId/role/email`, never `passwordHash` | `auth.service.ts` |

### Q: You said "Prisma prevents SQL injection" — can you actually explain *how*, not just cite it?

Prisma's query builder never string-concatenates user input into SQL — every
value passed to `where: { email: input.email }` becomes a bound parameter
in the underlying prepared statement, the same mechanism as parameterized
queries in raw SQL drivers. The class of vulnerability that comes from
`SELECT * FROM users WHERE email = '${input}'` string interpolation
simply isn't reachable through the Prisma API — the only way to reintroduce
it would be deliberately dropping to `prisma.$queryRawUnsafe` with
interpolated input, which this codebase never does (only the ORM's typed
methods are used throughout).

### Q: What's *not* covered — what would you flag as a known gap if asked directly?

Good to have ready, shows self-awareness rather than overselling: no
refresh-token/logout revocation (Section 6), no CSRF token (mitigated
mostly by CORS + the fact that this is a Bearer-token API rather than
cookie-session-based, but worth naming), no field-level encryption for
`SymptomReport`/`PostVisitNote` at rest (they're protected by DB access
control and TLS in transit, but not application-level encryption — real
HIPAA-grade healthcare software would need that plus BAAs with every
third-party vendor, which is explicitly out of scope for this assignment).

---

## 14. Testing strategy

*(No automated suite is included — see README "Known Limitations," a
deliberate scope call to match the assignment's "minimal, only what's
required" submission guideline. Be ready to talk about what you *would*
test and how, since this often comes up.)*

### Q: If you had time to add automated tests, where would you start and why?

`appointments.service.ts`'s `book()` method, specifically the concurrency
path — it's the highest-value, highest-risk piece of logic in the app. I'd
write an integration test (real test-database, not mocked Prisma, since the
whole guarantee depends on actual Postgres constraint behavior) that fires
`Promise.allSettled([bookA(), bookB()])` for the same slot and asserts one
resolves and one rejects with the 409-mapped error — mirroring
`RUNNING_AND_TESTING.md` §5.4 manually. After that: `availabilityService`
(pure functions, easy unit tests — working hours ∩ leave ∩ taken slots),
then the leave-cancellation loop's partial-failure behavior (mock the email
service to throw for one appointment, assert the others still get
processed).

### Q: How would you test the LLM/email/calendar failure-tolerance claims specifically?

Dependency-inject or mock the client at the boundary
(`gemini.client.ts`'s `generateText`, `email.transport.ts`'s `sendMail`,
`googleClient.ts`'s `getAuthedClientForUser`) to throw, then assert the
*calling* service (`appointmentsService.book`) still returns a successful
result and that the corresponding `AISummary`/`EmailLog`/`CalendarEvent`
row reflects the failure. This is exactly what
`RUNNING_AND_TESTING.md` §6 does manually (unset `GEMINI_API_KEY`, point
`SMTP_HOST` at an invalid host) — the automated version is the same idea
with a mock instead of misconfiguring real env vars.

---

## 15. Scaling & what you'd do differently

**File:** `system_design.md` (the full write-up this section summarizes)

### Q: This runs as a single process — what breaks first if traffic grows, and what would you change?

The two `node-cron` background jobs — they'd double-fire per instance if
you horizontally scale the API (Section 10). Move them to BullMQ+Redis so
only one worker picks up each job. Next: `getAvailableSlots` recomputes
slots from scratch on every request by scanning `SlotLock` rows — fine at
single-clinic scale, but a short-TTL cache in front of it would help for
high-traffic doctors. Beyond that: partition `Appointment`/`SlotLock` by
clinic/doctor if this became multi-tenant.

### Q: If this needed to support multiple clinics, what schema change is needed?

Add a `Clinic` model, FK it onto `Doctor` (and probably `User`, since admins
would be scoped to one clinic), and add `clinicId` to any query that's
currently "all doctors" / "all appointments" to scope it correctly. The
`SlotLock` unique constraint would need to become
`(clinicId, doctorId, slotStart)` — trivial change, same mechanism.

### Q: What would you change about the LLM calls to make them not block the request?

Make summary generation asynchronous: return the booking response
immediately after the DB transaction, publish an event/queue message,
process the LLM call in a worker, and either have the frontend poll
`GET /appointments/:id` until `aiSummaries` populates, or push it over a
websocket. This removes Gemini's latency (and its 2-retry backoff) from the
patient/doctor-facing request entirely — currently it's `await`ed inline in
`appointmentsService.book()` via `runSideEffectsSafely`.

---

## 16. Rapid-fire / curveball questions

Short, punchy ones interviewers sometimes throw in — one-liner answers
with a file pointer in case they want you to go deeper.

- **"What's a repository pattern, and where is it here?"** — Prisma's
  generated client *is* the repository layer (`prisma.appointment.findMany`
  etc.); services never write raw SQL, so swapping the underlying DB
  access strategy would only touch the Prisma layer, not every service.
- **"Why Zod over Joi/express-validator?"** — TypeScript-first: `z.infer<>`
  derives static types directly from the schema (see the `export type
  BookAppointmentInput = z.infer<typeof bookAppointmentSchema>` pattern in
  every `.schema.ts` file), so validation and TypeScript types can't drift
  out of sync.
- **"What does `satisfies Prisma.AppointmentInclude` do in
  `appointments.service.ts`?"** — Type-checks the `appointmentInclude`
  object against Prisma's generated include type *without widening its
  literal type* the way a type annotation (`:`) would — keeps full
  autocomplete/inference downstream while still catching typos in included
  relation names at compile time.
- **"Why `findUniqueOrThrow` at the end of `book()` instead of just
  returning what the transaction already built?"** — Readability/safety:
  it re-fetches with the full `appointmentInclude` after side effects run,
  guaranteeing the response reflects anything the side effects wrote (e.g.
  the `CalendarEvent`/`AISummary` rows created after the transaction
  committed), rather than returning a snapshot from mid-transaction that
  would be missing those relations.
- **"What's `PENDING` status used for if booking always creates
  `CONFIRMED` directly?"** — It's modeled in the schema/enum for
  extensibility (e.g. a future payment-confirmation step) but the current
  `book()` flow never produces it — worth being upfront that it's currently
  unused rather than claiming a pending-hold flow exists.
- **"Why does `cancel()` check for both `CONFIRMED` and `PENDING`
  status?"** — Defensive/forward-compatible with the unused `PENDING`
  state above — if a future flow does introduce pending appointments, they
  should also be cancellable without a code change here.
