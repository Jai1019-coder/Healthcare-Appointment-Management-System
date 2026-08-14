import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient, apiErrorMessage } from '../api/client';
import { Appointment } from '../types';
import { Button, Card, EmptyState, ErrorAlert, SecondaryButton, Spinner, StatusBadge } from '../components/ui';

export function PatientDashboardPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actingId, setActingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/appointments/mine');
      setAppointments(res.data.data);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCancel = async (id: string) => {
    if (!confirm('Cancel this appointment?')) return;
    setActingId(id);
    try {
      await apiClient.patch(`/appointments/${id}/cancel`, {});
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not cancel appointment'));
    } finally {
      setActingId(null);
    }
  };

  if (loading) return <Spinner />;

  const upcoming = appointments.filter((a) => a.status === 'CONFIRMED' || a.status === 'PENDING');
  const past = appointments.filter((a) => a.status !== 'CONFIRMED' && a.status !== 'PENDING');

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">My appointments</h1>
        <Link to="/doctors">
          <Button>Book new appointment</Button>
        </Link>
      </div>

      <ErrorAlert message={error} />

      <h2 className="mt-8 text-lg font-semibold text-slate-800">Upcoming</h2>
      {upcoming.length === 0 ? (
        <EmptyState>No upcoming appointments.</EmptyState>
      ) : (
        <div className="mt-3 space-y-3">
          {upcoming.map((a) => (
            <Card key={a.id} className="flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-900">Dr. {a.doctor.user.fullName} ({a.doctor.specialization})</p>
                <p className="text-sm text-slate-600">{new Date(a.slotStart).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</p>
                <div className="mt-1"><StatusBadge status={a.status} /></div>
              </div>
              <div className="flex gap-2">
                <Link to={`/appointments/${a.id}`}>
                  <SecondaryButton>View</SecondaryButton>
                </Link>
                <SecondaryButton disabled={actingId === a.id} onClick={() => handleCancel(a.id)}>
                  Cancel
                </SecondaryButton>
              </div>
            </Card>
          ))}
        </div>
      )}

      <h2 className="mt-8 text-lg font-semibold text-slate-800">Past</h2>
      {past.length === 0 ? (
        <EmptyState>No past appointments yet.</EmptyState>
      ) : (
        <div className="mt-3 space-y-3">
          {past.map((a) => (
            <Card key={a.id} className="flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-900">Dr. {a.doctor.user.fullName}</p>
                <p className="text-sm text-slate-600">{new Date(a.slotStart).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</p>
                <div className="mt-1"><StatusBadge status={a.status} /></div>
              </div>
              <Link to={`/appointments/${a.id}`}>
                <SecondaryButton>View</SecondaryButton>
              </Link>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
