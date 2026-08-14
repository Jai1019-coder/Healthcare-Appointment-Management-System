import { Link } from 'react-router-dom';
import { Button, Card } from '../components/ui';

export function LandingPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-16">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-slate-900">Healthcare, without the waiting-room guesswork</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">
          Book appointments in seconds, share your symptoms ahead of time, and get a doctor who already knows
          what to expect. Confirmations and reminders land in your email and calendar automatically.
        </p>
        <div className="mt-8 flex justify-center gap-4">
          <Link to="/register">
            <Button className="px-6 py-3 text-base">Book an appointment</Button>
          </Link>
          <Link to="/login">
            <Button className="bg-white px-6 py-3 text-base text-brand-700 ring-1 ring-brand-600 hover:bg-brand-50">
              I already have an account
            </Button>
          </Link>
        </div>
      </div>

      <div className="mt-16 grid gap-6 md:grid-cols-3">
        <Card>
          <h3 className="font-semibold text-slate-900">Share symptoms in advance</h3>
          <p className="mt-2 text-sm text-slate-600">
            Your doctor gets an AI-generated pre-visit summary with urgency level and suggested questions -
            no more re-explaining everything at the desk.
          </p>
        </Card>
        <Card>
          <h3 className="font-semibold text-slate-900">Never miss a dose</h3>
          <p className="mt-2 text-sm text-slate-600">
            After your visit, get a plain-language summary of your prescription plus automatic medication
            reminders by email.
          </p>
        </Card>
        <Card>
          <h3 className="font-semibold text-slate-900">Always in sync</h3>
          <p className="mt-2 text-sm text-slate-600">
            Every booking, reschedule, and cancellation updates your Google Calendar and sends a confirmation
            email automatically.
          </p>
        </Card>
      </div>
    </div>
  );
}
