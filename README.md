# Healthcare Appointment & Follow-up Manager

A clinic platform with separate portals for **patients**, **doctors**, and an
**admin**. Patients book appointments and share symptoms in advance; doctors
get an AI-generated pre-visit summary and produce a patient-friendly
post-visit summary; both sides stay in sync via email and Google Calendar.

See [`system_design.md`](./system_design.md) for the design write-up covering
double-booking prevention, doctor leave handling, the slot-hold mechanism,
and notification failure handling.

## Tech Stack

| Layer      | Technology                                              |
|------------|----------------------------------------------------------|
| Frontend   | React, TypeScript, Vite, Tailwind CSS, React Router, React Hook Form, Axios |
| Backend    | Node.js, Express, TypeScript                              |
| Database   | PostgreSQL via Prisma ORM                                  |
| Auth       | JWT + bcrypt, role-based authorization                     |
| Validation | Zod                                                        |
| LLM        | Gemini API (`@google/generative-ai`)                        |
| Email      | Nodemailer (falls back to console logging if unconfigured) |
| Calendar   | Google Calendar API + OAuth2                                |
| Jobs       | node-cron (medication reminders, email retry)                |

## Project Structure

```
.
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma      # DB schema
│   │   └── seed.ts            # bootstrap admin + sample doctor
│   └── src/
│       ├── config/            # env validation, logger, prisma client
│       ├── middleware/        # auth, validation, centralized error handling
│       ├── modules/
│       │   ├── auth/
│       │   ├── doctors/
│       │   ├── leave/
│       │   ├── appointments/  # booking, reschedule, cancel, post-visit
│       │   ├── llm/           # Gemini pre/post-visit summaries
│       │   ├── email/         # nodemailer + retry logging
│       │   └── calendar/      # Google Calendar OAuth2 + event sync
│       ├── jobs/               # cron: medication reminders, email retry
│       └── routes/
├── frontend/
│   └── src/
│       ├── api/                # axios client
│       ├── context/             # auth context
│       ├── components/
│       └── pages/               # Landing, Login, Register, dashboards, booking, details
└── system_design.md
```

## Features

**Admin** — create/manage doctors, set specialization & slot duration, set
weekly working hours, mark doctor leave (auto-cancels affected appointments
and notifies patients).

**Patient** — register/login, search doctors by specialization, view
profiles, see live availability, book a slot, optionally describe symptoms,
view/cancel/reschedule appointments, see AI-generated visit summaries and
prescriptions.

**Doctor** — login, view upcoming/completed appointments, see the AI
pre-visit summary (urgency, chief complaint, suggested questions), submit
post-visit clinical notes and prescriptions, which trigger an AI
patient-friendly summary.

**System** — booking confirmation, reminder, cancellation, reschedule, and
doctor-leave-notice emails; medication reminders scheduled from prescription
frequency; Google Calendar event created on booking, updated on reschedule,
deleted on cancellation; all double-booking-safe under concurrent requests.

## Prerequisites

- Node.js 18+
- PostgreSQL 14+ (local install or a hosted instance)
- A Gemini API key (optional — app runs without one, AI summaries just report "unavailable")
- Google Cloud OAuth2 credentials (optional — app runs without them, calendar sync is simply skipped)

## Setup

### 1. Database

Create a Postgres database, e.g.:

```bash
createdb healthcare_appointments
```

### 2. Backend

```bash
cd backend
cp .env.example .env
# edit .env — at minimum set DATABASE_URL and JWT_SECRET
npm install
npm run prisma:migrate      # creates tables
npm run prisma:seed         # creates a bootstrap admin + sample doctor
npm run dev                 # starts API on http://localhost:4000
```

The seed script prints the admin login (default `admin@clinic.example.com` /
`ChangeMe123!` unless overridden via `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`
in `.env`) and a sample doctor login. **Change the admin password after first
login in a real deployment.**

### 3. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev                 # starts UI on http://localhost:5173
```

### 4. Try it out

1. Log in as the seeded admin, set the sample doctor's working hours (Admin
   dashboard → Manage → working hours), or create a new doctor.
2. Register a patient account, search for the doctor, book a slot, optionally
   describe symptoms.
3. Log in as the doctor to see the AI pre-visit summary and submit post-visit
   notes + prescriptions.
4. Log back in as the patient to see the AI-generated patient-friendly
   summary and prescriptions.

## Environment Variables

See [`backend/.env.example`](./backend/.env.example) and
[`frontend/.env.example`](./frontend/.env.example) — every variable is
documented inline. Key ones:

- `DATABASE_URL` — Postgres connection string (required)
- `JWT_SECRET` — any long random string (required)
- `GEMINI_API_KEY` — from https://aistudio.google.com/app/apikey (optional)
- `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` — mail provider credentials (optional; emails are logged, not sent, if omitted)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` — Google Calendar OAuth2 (optional)

## Google Calendar Setup

1. In [Google Cloud Console](https://console.cloud.google.com/), create a
   project and enable the **Google Calendar API**.
2. Under **Credentials**, create an **OAuth 2.0 Client ID** (type: Web
   application). Add `http://localhost:4000/api/calendar/callback` as an
   authorized redirect URI (adjust for your deployed backend URL).
3. Copy the client ID/secret into `backend/.env` as `GOOGLE_CLIENT_ID` /
   `GOOGLE_CLIENT_SECRET`.
4. A logged-in doctor connects their calendar by visiting
   `GET /api/calendar/connect` (returns a Google consent URL) — the
   frontend can wire a "Connect Google Calendar" button to this endpoint.
   Once connected, all their appointment bookings will sync automatically.

## LLM Prompts

**Pre-visit** (`llm.service.ts`):
> Analyse these symptoms and return ONLY a JSON object with: `urgency`
> ("Low"/"Medium"/"High"), `chiefComplaint`, `suggestedQuestions` (3 strings).

**Post-visit**:
> Convert these clinical notes into a patient-friendly summary. Return ONLY
> a JSON object with: `patientSummary`, `medicationSchedule`,
> `followUpInstructions`.

Both calls retry up to twice on failure and always persist an `AISummary` row
(with `failed: true` on error) so the rest of the app keeps working even if
Gemini is unreachable or misconfigured.

## Database Schema

See [`backend/prisma/schema.prisma`](./backend/prisma/schema.prisma) for the
full normalized schema (Users, Patients, Doctors, WorkingHours, DoctorLeave,
Appointments, SlotLock, SymptomReport, AISummary, PostVisitNote,
Prescription, MedicationReminder, CalendarEvent, EmailLog, AuditLog) with
foreign keys, indexes, and the `SlotLock` unique-constraint mechanism that
prevents double-booking — explained in `system_design.md`.

## API Overview

All endpoints are under `/api`. Authenticated routes require
`Authorization: Bearer <token>`.

| Method | Endpoint                                     | Who        | Purpose                          |
|--------|-----------------------------------------------|------------|-----------------------------------|
| POST   | `/auth/register`                              | Public     | Patient self-registration          |
| POST   | `/auth/login`                                 | Public     | Login (all roles)                  |
| GET    | `/auth/me`                                    | Any        | Current session                    |
| GET    | `/doctors`                                    | Any        | Search doctors                     |
| GET    | `/doctors/:doctorId`                          | Any        | Doctor profile                     |
| POST   | `/doctors`                                    | Admin      | Create doctor                      |
| PATCH  | `/doctors/:doctorId`                          | Admin      | Update doctor                      |
| DELETE | `/doctors/:doctorId`                          | Admin      | Deactivate doctor                  |
| PUT    | `/doctors/:doctorId/working-hours`            | Admin      | Set weekly hours                   |
| POST   | `/doctors/:doctorId/leave`                    | Admin      | Record leave (cancels + notifies)  |
| GET    | `/doctors/:doctorId/leave`                    | Admin/Doc  | List leave                         |
| DELETE | `/doctors/:doctorId/leave/:leaveId`           | Admin      | Remove leave record                |
| GET    | `/appointments/availability/:doctorId?date=`  | Any        | Open slots for a date              |
| POST   | `/appointments`                               | Patient    | Book a slot                        |
| GET    | `/appointments/mine`                          | Patient/Doc| List own appointments              |
| GET    | `/appointments/:appointmentId`                | Any        | Appointment detail                 |
| PATCH  | `/appointments/:appointmentId/reschedule`     | Patient    | Reschedule                         |
| PATCH  | `/appointments/:appointmentId/cancel`         | Patient    | Cancel                             |
| POST   | `/appointments/:appointmentId/post-visit`     | Doctor     | Submit notes + prescriptions       |
| GET    | `/calendar/connect`                           | Any        | Get Google OAuth consent URL       |
| GET    | `/calendar/callback`                          | Public     | OAuth2 redirect target             |

Every response follows `{ success, message, data }`. Errors return
`{ success: false, message, details? }` with the appropriate HTTP status
(400 validation, 401 auth, 403 forbidden, 404 not found, 409 conflict — e.g.
double-booking, 500 unexpected).

## Deployment

- **Backend**: deploy to Render/Railway as a Node web service; set all
  `backend/.env.example` variables in the platform's environment settings;
  run `npm run build && npm run prisma:deploy && npm start`.
- **Frontend**: deploy to Vercel; set `VITE_API_BASE_URL` to the deployed
  backend URL.
- Update `FRONTEND_URL` (backend) and `GOOGLE_REDIRECT_URI` to the deployed
  URLs once live.

## Known Limitations

- No payment/insurance flow (out of scope for this assignment).
- Google Calendar sync is per-doctor OAuth; a doctor must connect their
  account once via `/api/calendar/connect` before events sync.
- Email retry gives up after 5 attempts and needs manual follow-up beyond that.
- No automated test suite is included, to keep the submission within the
  "minimal, only what's required" guideline — the transactional booking
  logic in `appointments.service.ts` is the highest-value place to add
  Jest/Supertest coverage first if extending this project.

## Future Improvements

- Move background jobs to a queue (BullMQ/Redis) for horizontal scaling.
- Add refresh tokens / shorter-lived access tokens.
- Doctor-side calendar availability sync (block slots the doctor manually
  marks busy on Google Calendar).
