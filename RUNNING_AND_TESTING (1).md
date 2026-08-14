# Running & Testing Guide

This walks through getting the project running locally and manually
exercising every core piece of functionality — including the parts that are
hardest to verify by just clicking around (double-booking under a race
condition, doctor-leave cancellation, and graceful degradation when
email/calendar/LLM aren't configured).

Also see `README.md` for the one-time setup steps this guide assumes you've
already done, and `system_design.md` for *why* things are built this way.

---

## 1. Prerequisites

- Node.js 18+
- PostgreSQL 14+ running locally (or a connection string to a hosted instance)
- `curl` and `jq` (optional but makes the API tests below much easier to read)

```bash
# macOS
brew install jq

# Debian/Ubuntu
sudo apt-get install jq
```

---

## 2. First-time setup

```bash
# 1. Database
createdb healthcare_appointments

# 2. Backend
cd backend
cp .env.example .env
# Open .env and set at minimum: DATABASE_URL, JWT_SECRET
npm install
npm run prisma:migrate    # creates all tables
npm run prisma:seed       # creates a bootstrap admin + one sample doctor

# 3. Frontend (separate terminal)
cd frontend
cp .env.example .env
npm install
```

The seed script prints two accounts you'll use throughout this guide:

```
Admin ready: admin@clinic.example.com (password: ChangeMe123!)
Sample doctor ready: dr.sarah@clinic.example.com (password: DoctorPass123!)
```

---

## 3. Running it

```bash
# Terminal 1
cd backend && npm run dev
# → API listening on http://localhost:4000, logs "Background jobs scheduled"

# Terminal 2
cd frontend && npm run dev
# → UI on http://localhost:5173
```

**Sanity check:**

```bash
curl -s http://localhost:4000/api/health | jq
```
Expect: `{ "success": true, "message": "OK", "timestamp": "..." }`

If this fails, check:
- Postgres is running and `DATABASE_URL` in `backend/.env` is correct
- Port 4000 isn't already in use

---

## 4. Manual UI walkthrough (happy path)

Fastest way to confirm the whole system wires together correctly:

1. Go to `http://localhost:5173`, click **Log in**, sign in as the seeded
   admin.
2. Admin dashboard → **Manage** next to "Dr. Sarah Chen" → set working hours
   (the seed already gives her Mon–Fri hours, so you can skip this) → note
   the "Save working hours" button works without error.
3. Log out, click **Sign up**, register a new patient account.
4. **Find a Doctor** → search/select Dr. Sarah Chen → **Book appointment**.
5. Pick a date within her working hours (a weekday), confirm slots appear.
6. Select a time slot, type a few sentences into the symptoms box (e.g.
   *"headache for 3 days, worse in the evening, mild fever"*), set severity,
   confirm booking.
7. You should land on the appointment detail page showing status
   `CONFIRMED`.
8. Log out, log back in as the doctor
   (`dr.sarah@clinic.example.com` / `DoctorPass123!`).
9. Doctor dashboard should show the new appointment under "Upcoming visits."
   If `GEMINI_API_KEY` is set in `backend/.env`, you should see an **AI
   pre-visit summary** box with urgency + suggested questions within a few
   seconds of booking (it's generated synchronously during booking, so it's
   already there on page load).
10. Open the visit → fill in clinical notes + at least one medication row →
    **Submit post-visit summary**.
11. Log back in as the patient → open the same appointment → you should see
    the **AI-generated patient-friendly summary** (if Gemini is configured)
    and the prescription listed.

If every step above works, the core booking → symptoms → AI summary →
post-visit → prescription loop is verified end-to-end.

---

## 5. API-level testing (curl)

Useful when you want to test faster than clicking through the UI, or need to
hit endpoints the UI doesn't expose a button for.

### 5.1 Auth

```bash
# Register a patient
curl -s -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"patient1@test.com","password":"Password123!","fullName":"Jane Patient"}' | jq

# Log in as admin
ADMIN_TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@clinic.example.com","password":"ChangeMe123!"}' | jq -r '.data.token')

echo $ADMIN_TOKEN   # should be a JWT, not "null"

# Log in as the patient you just registered
PATIENT_TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"patient1@test.com","password":"Password123!"}' | jq -r '.data.token')

# Log in as the seeded doctor
DOCTOR_TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"dr.sarah@clinic.example.com","password":"DoctorPass123!"}' | jq -r '.data.token')
```

**Negative cases to try:**

```bash
# Duplicate registration → expect 409 Conflict
curl -s -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"patient1@test.com","password":"Password123!","fullName":"Jane Again"}' | jq
# → { "success": false, "message": "An account with this email already exists" }

# Wrong password → expect 401
curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"patient1@test.com","password":"WrongPassword"}' | jq

# Missing Authorization header on a protected route → expect 401
curl -s http://localhost:4000/api/appointments/mine | jq

# Malformed body (password too short) → expect 400 with Zod validation details
curl -s -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"bad@test.com","password":"123","fullName":"X"}' | jq
```

### 5.2 Doctors & availability

```bash
DOCTOR_ID=$(curl -s http://localhost:4000/api/doctors \
  -H "Authorization: Bearer $PATIENT_TOKEN" | jq -r '.data[0].id')

# Check availability for a weekday (e.g. next Monday)
curl -s "http://localhost:4000/api/appointments/availability/$DOCTOR_ID?date=2026-08-10" \
  -H "Authorization: Bearer $PATIENT_TOKEN" | jq
```

### 5.3 Booking, reschedule, cancel

```bash
# Pick the first available slot from the previous call
SLOT=$(curl -s "http://localhost:4000/api/appointments/availability/$DOCTOR_ID?date=2026-08-10" \
  -H "Authorization: Bearer $PATIENT_TOKEN" | jq -r '.data.slots[0]')

APPT=$(curl -s -X POST http://localhost:4000/api/appointments \
  -H "Authorization: Bearer $PATIENT_TOKEN" -H "Content-Type: application/json" \
  -d "{\"doctorId\":\"$DOCTOR_ID\",\"slotStart\":\"$SLOT\",\"symptoms\":{\"description\":\"sore throat and cough for 2 days\",\"severity\":\"Mild\"}}")
echo $APPT | jq
APPT_ID=$(echo $APPT | jq -r '.data.id')

# Invalid slot (not a real open slot) → expect 400
curl -s -X POST http://localhost:4000/api/appointments \
  -H "Authorization: Bearer $PATIENT_TOKEN" -H "Content-Type: application/json" \
  -d "{\"doctorId\":\"$DOCTOR_ID\",\"slotStart\":\"2026-08-10T03:15:00.000Z\"}" | jq

# Reschedule to another open slot
NEXT_SLOT=$(curl -s "http://localhost:4000/api/appointments/availability/$DOCTOR_ID?date=2026-08-10" \
  -H "Authorization: Bearer $PATIENT_TOKEN" | jq -r '.data.slots[1]')
curl -s -X PATCH "http://localhost:4000/api/appointments/$APPT_ID/reschedule" \
  -H "Authorization: Bearer $PATIENT_TOKEN" -H "Content-Type: application/json" \
  -d "{\"newSlotStart\":\"$NEXT_SLOT\"}" | jq

# Cancel (use the *new* appointment id returned by reschedule above)
NEW_APPT_ID=$(curl -s http://localhost:4000/api/appointments/mine \
  -H "Authorization: Bearer $PATIENT_TOKEN" | jq -r '.data[0].id')
curl -s -X PATCH "http://localhost:4000/api/appointments/$NEW_APPT_ID/cancel" \
  -H "Authorization: Bearer $PATIENT_TOKEN" -H "Content-Type: application/json" \
  -d '{"reason":"schedule conflict"}' | jq

# Unauthorized access: try cancelling someone else's appointment as a different patient → expect 403
```

### 5.4 Simultaneous booking (the important one)

This is the test that actually proves the double-booking guard works. Book
the *same* slot from two concurrent requests and confirm exactly one
succeeds with a `409 Conflict`:

```bash
SLOT=$(curl -s "http://localhost:4000/api/appointments/availability/$DOCTOR_ID?date=2026-08-11" \
  -H "Authorization: Bearer $PATIENT_TOKEN" | jq -r '.data.slots[0]')

# Register a second patient to book against the same slot
curl -s -X POST http://localhost:4000/api/auth/register -H "Content-Type: application/json" \
  -d '{"email":"patient2@test.com","password":"Password123!","fullName":"Sam Patient"}' > /dev/null
PATIENT2_TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"patient2@test.com","password":"Password123!"}' | jq -r '.data.token')

# Fire both requests at (as close to) the same instant as possible
curl -s -X POST http://localhost:4000/api/appointments \
  -H "Authorization: Bearer $PATIENT_TOKEN" -H "Content-Type: application/json" \
  -d "{\"doctorId\":\"$DOCTOR_ID\",\"slotStart\":\"$SLOT\"}" > /tmp/booking_a.json &

curl -s -X POST http://localhost:4000/api/appointments \
  -H "Authorization: Bearer $PATIENT2_TOKEN" -H "Content-Type: application/json" \
  -d "{\"doctorId\":\"$DOCTOR_ID\",\"slotStart\":\"$SLOT\"}" > /tmp/booking_b.json &

wait
jq '.success, .message' /tmp/booking_a.json
jq '.success, .message' /tmp/booking_b.json
```

**Expected:** one file shows `success: true` with a `CONFIRMED` appointment;
the other shows `success: false` with message *"This slot was just booked by
someone else. Please choose another time."* If you want a harsher stress
test, wrap the two curl calls in a loop of 20 parallel requests for the same
slot — exactly one should ever succeed. This is what `system_design.md`
describes under "Double-Booking Prevention."

### 5.5 Doctor leave → auto-cancel & notify

```bash
# Book an appointment on a date you're about to mark as leave
SLOT=$(curl -s "http://localhost:4000/api/appointments/availability/$DOCTOR_ID?date=2026-08-12" \
  -H "Authorization: Bearer $PATIENT_TOKEN" | jq -r '.data.slots[0]')
curl -s -X POST http://localhost:4000/api/appointments \
  -H "Authorization: Bearer $PATIENT_TOKEN" -H "Content-Type: application/json" \
  -d "{\"doctorId\":\"$DOCTOR_ID\",\"slotStart\":\"$SLOT\"}" | jq '.data.id, .data.status'

# Now mark the doctor on leave for that date, as admin
curl -s -X POST "http://localhost:4000/api/doctors/$DOCTOR_ID/leave" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"startDate":"2026-08-12","endDate":"2026-08-12","reason":"Conference"}' | jq
```

**Expected:** response includes `"affectedAppointments": 1, "notified": 1`.
Confirm the appointment is now `CANCELLED`:

```bash
curl -s http://localhost:4000/api/appointments/mine \
  -H "Authorization: Bearer $PATIENT_TOKEN" | jq '.data[] | {id, status, slotStart}'
```

Also confirm the slot is bookable again by a new patient (proves `SlotLock`
was correctly released):

```bash
curl -s "http://localhost:4000/api/appointments/availability/$DOCTOR_ID?date=2026-08-12" \
  -H "Authorization: Bearer $PATIENT_TOKEN" | jq
# → the leave date itself should show an EMPTY slots array (doctor is on leave),
#   which is correct - the point of this test is the *old* appointment status + freed lock,
#   not that the day is bookable again while the leave is still in effect.
```

### 5.6 Post-visit + prescriptions → medication reminders scheduled

```bash
# As the doctor, submit post-visit notes on a CONFIRMED appointment
curl -s -X POST "http://localhost:4000/api/appointments/$APPT_ID/post-visit" \
  -H "Authorization: Bearer $DOCTOR_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "clinicalNotes":"Viral pharyngitis, supportive care recommended.",
    "prescriptions":[{"medicationName":"Paracetamol","dosage":"500mg","frequencyPerDay":3,"durationDays":5}]
  }' | jq
```

**Expected:** appointment status becomes `COMPLETED`, and a
`POST_VISIT` `AISummary` is generated. To confirm medication reminders were
actually scheduled, check the database directly:

```bash
cd backend && npx prisma studio
# → open MedicationReminder table, filter by the prescription's appointmentId
#   you should see 15 rows (3/day × 5 days) with scheduledAt timestamps and sent=false
```

---

## 6. Failure-mode testing (this is where "graceful degradation" gets proven)

The whole point of the LLM/email/calendar design is that none of them can
break the core booking flow. Prove it:

### 6.1 LLM (Gemini) failure

```bash
# In backend/.env, comment out or leave GEMINI_API_KEY empty, then restart the server
```
- Book a new appointment with symptoms, or submit a post-visit note.
- **Expected:** booking/post-visit still succeeds normally (check the HTTP
  response is 200/201). Query the appointment afterward — its `aiSummaries`
  array should contain an entry with `"failed": true` and an `errorMessage`,
  instead of the request failing or hanging.

```bash
curl -s http://localhost:4000/api/appointments/$APPT_ID \
  -H "Authorization: Bearer $PATIENT_TOKEN" | jq '.data.aiSummaries'
```

### 6.2 Email "failure" (no SMTP configured)

By default (`SMTP_HOST` unset in `.env`), the app uses a JSON transport
instead of actually sending mail — this is expected, not a bug. Confirm it's
working as designed:
- Book an appointment.
- Check the backend terminal logs — you should **not** see errors; emails
  are silently logged instead of delivered.
- Check the `EmailLog` table via `npx prisma studio` — rows should show
  `status: SENT` (the JSON transport "succeeds" locally, it just doesn't
  deliver anywhere).

To test genuine failure + retry, set `SMTP_HOST` to something invalid (e.g.
`smtp.invalid.test`) and restart:
- Book an appointment → the `EmailLog` row should end up `status: FAILED`
  after 2 immediate retry attempts, with `lastError` populated, and the
  booking API call should still return `201` successfully.
- Wait up to 15 minutes (or temporarily edit the cron schedule in
  `backend/src/jobs/index.ts` to `*/1 * * * *` for faster testing) and
  confirm the retry job picks it up — check backend logs for "Email retry
  job completed."

### 6.3 Calendar failure (doctor hasn't connected Google)

This is actually the default state unless you complete the OAuth flow, so
it's tested automatically by every booking you make above:
```bash
curl -s http://localhost:4000/api/appointments/$APPT_ID \
  -H "Authorization: Bearer $PATIENT_TOKEN" | jq '.data.calendarEvent'
# → { "syncStatus": "FAILED", "lastError": "Doctor has not connected Google Calendar", ... }
```
**Expected:** the booking still succeeds (already proven by every test
above returning 200/201) — calendar sync failing never blocks or rolls back
the appointment.

To test the success path, complete the OAuth flow:
```bash
curl -s http://localhost:4000/api/calendar/connect \
  -H "Authorization: Bearer $DOCTOR_TOKEN" | jq -r '.data.url'
# open that URL in a browser, log in with the Google account you configured
# in Google Cloud Console, grant access → you'll be redirected back
```
Then book a new appointment and re-check `calendarEvent` — `syncStatus`
should be `SYNCED` with a real `googleEventId`, and the event should appear
in the doctor's actual Google Calendar.

---

## 7. Edge cases & validation checklist

Run through these quickly — each should return a clean 4xx with a useful
message, never a 500 or a stack trace:

| Scenario | How to trigger | Expected |
|---|---|---|
| Empty required field | `POST /auth/register` with `fullName` omitted | 400, Zod field error |
| Invalid email format | `email: "not-an-email"` | 400 |
| Boundary: password exactly 8 chars | `password: "12345678"` | 201 (accepted) |
| Boundary: password 7 chars | `password: "1234567"` | 400 |
| Expired/garbage JWT | `Authorization: Bearer garbage.token.here` | 401 |
| Wrong role accessing admin route | Patient token on `POST /doctors` | 403 |
| Booking a slot in the past | any `slotStart` before now | 400 |
| Booking outside working hours | a time not in the doctor's working windows | 400 |
| Booking on a doctor's leave day | after running §5.5 | 400, "doctor is on leave" |
| Rescheduling a cancelled appointment | reschedule after cancel | 400 |
| Cancelling someone else's appointment | patient A tries to cancel patient B's appt id | 403 |
| SQL-injection-style input | `email: "' OR 1=1 --"` in login | 400 (Zod rejects non-email format) or 401 (no match) — never a DB error, since Prisma parameterizes all queries |

---

## 8. Troubleshooting

| Symptom | Likely cause |
|---|---|
| `npm run prisma:migrate` fails to connect | Postgres not running, or `DATABASE_URL` wrong |
| Backend crashes on startup listing missing env vars | Check `.env` against `.env.example` — `DATABASE_URL` and `JWT_SECRET` are required, everything else is optional |
| Frontend shows CORS errors in console | `FRONTEND_URL` in `backend/.env` doesn't match the port Vite is actually running on |
| Booking succeeds but no AI summary ever appears | `GEMINI_API_KEY` not set — this is expected degraded behavior, not a bug (see §6.1) |
| `403 Forbidden` on every request as a doctor | Logged in with a patient/admin token by mistake — check which account you last logged in with |
| Availability always empty | Doctor has no `workingHours` set for that day of week, or the date falls on a `DoctorLeave` |
