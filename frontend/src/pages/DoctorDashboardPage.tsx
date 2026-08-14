import { useEffect, useState } from 'react';
import { apiClient, apiErrorMessage } from '../api/client';
import { Appointment } from '../types';
import { Card, EmptyState, ErrorAlert, Spinner, StatusBadge } from '../components/ui';
import { Link } from 'react-router-dom';

export function DoctorDashboardPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    apiClient
      .get('/appointments/mine')
      .then((res) => setAppointments(res.data.data))
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;

  const upcoming = appointments.filter((a) => a.status === 'CONFIRMED');
  const completed = appointments.filter((a) => a.status === 'COMPLETED');

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold text-slate-900">My schedule</h1>
      <ErrorAlert message={error} />

      <h2 className="mt-8 text-lg font-semibold text-slate-800">Upcoming visits</h2>
      {upcoming.length === 0 ? (
        <EmptyState>No upcoming visits.</EmptyState>
      ) : (
        <div className="mt-3 space-y-3">
          {upcoming.map((a) => {
            const preVisit = a.aiSummaries.find((s) => s.type === 'PRE_VISIT');
            return (
              <Card key={a.id}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-900">{a.patient.user.fullName}</p>
                    <p className="text-sm text-slate-600">{new Date(a.slotStart).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {preVisit?.urgency && <StatusBadge status={preVisit.urgency} />}
                    <StatusBadge status={a.status} />
                  </div>
                </div>
                {preVisit && !preVisit.failed && (
                  <div className="mt-3 rounded-lg bg-brand-50 p-3 text-sm">
                    <p className="font-medium text-brand-800">AI Pre-visit summary</p>
                    <p className="mt-1 text-slate-700">{preVisit.chiefComplaint}</p>
                    {preVisit.suggestedQuestions?.length > 0 && (
                      <ul className="mt-2 list-disc pl-5 text-slate-600">
                        {preVisit.suggestedQuestions.map((q, i) => (
                          <li key={i}>{q}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {preVisit?.failed && <p className="mt-2 text-xs text-slate-500">AI summary unavailable for this visit.</p>}
                <Link to={`/appointments/${a.id}`} className="mt-3 inline-block text-sm font-medium text-brand-700 hover:underline">
                  Open visit →
                </Link>
              </Card>
            );
          })}
        </div>
      )}

      <h2 className="mt-8 text-lg font-semibold text-slate-800">Completed visits</h2>
      {completed.length === 0 ? (
        <EmptyState>No completed visits yet.</EmptyState>
      ) : (
        <div className="mt-3 space-y-3">
          {completed.map((a) => (
            <Card key={a.id} className="flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-900">{a.patient.user.fullName}</p>
                <p className="text-sm text-slate-600">{new Date(a.slotStart).toLocaleDateString()}</p>
              </div>
              <Link to={`/appointments/${a.id}`} className="text-sm font-medium text-brand-700 hover:underline">
                View →
              </Link>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
