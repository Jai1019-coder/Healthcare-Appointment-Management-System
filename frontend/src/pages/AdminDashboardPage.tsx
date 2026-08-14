import { useEffect, useState } from 'react';
import { apiClient, apiErrorMessage } from '../api/client';
import { Doctor } from '../types';
import { Button, Card, EmptyState, ErrorAlert, SecondaryButton, Spinner, SuccessAlert } from '../components/ui';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface NewDoctorForm {
  fullName: string;
  email: string;
  password: string;
  specialization: string;
  slotDurationMinutes: number;
}

export function AdminDashboardPage() {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);

  const [form, setForm] = useState<NewDoctorForm>({
    fullName: '',
    email: '',
    password: '',
    specialization: '',
    slotDurationMinutes: 30,
  });
  const [creating, setCreating] = useState(false);

  const [workingHours, setWorkingHours] = useState<{ dayOfWeek: number; startTime: string; endTime: string }[]>([]);
  const [leaveStart, setLeaveStart] = useState('');
  const [leaveEnd, setLeaveEnd] = useState('');
  const [leaveReason, setLeaveReason] = useState('');

  const loadDoctors = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/doctors');
      setDoctors(res.data.data);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDoctors();
  }, []);

  const openDoctor = async (doctor: Doctor) => {
    const res = await apiClient.get(`/doctors/${doctor.id}`);
    setSelectedDoctor(res.data.data);
    setWorkingHours(res.data.data.workingHours.map((wh: any) => ({ dayOfWeek: wh.dayOfWeek, startTime: wh.startTime, endTime: wh.endTime })));
  };

  const createDoctor = async () => {
    setCreating(true);
    setError('');
    setSuccess('');
    try {
      await apiClient.post('/doctors', { ...form, workingHours: [] });
      setSuccess('Doctor created. Set their working hours below.');
      setForm({ fullName: '', email: '', password: '', specialization: '', slotDurationMinutes: 30 });
      loadDoctors();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const toggleDay = (day: number) => {
    setWorkingHours((prev) =>
      prev.some((w) => w.dayOfWeek === day)
        ? prev.filter((w) => w.dayOfWeek !== day)
        : [...prev, { dayOfWeek: day, startTime: '09:00', endTime: '17:00' }]
    );
  };

  const updateDayHours = (day: number, patch: Partial<{ startTime: string; endTime: string }>) => {
    setWorkingHours((prev) => prev.map((w) => (w.dayOfWeek === day ? { ...w, ...patch } : w)));
  };

  const saveWorkingHours = async () => {
    if (!selectedDoctor) return;
    try {
      await apiClient.put(`/doctors/${selectedDoctor.id}/working-hours`, { workingHours });
      setSuccess('Working hours updated.');
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  };

  const submitLeave = async () => {
    if (!selectedDoctor || !leaveStart || !leaveEnd) return;
    try {
      const res = await apiClient.post(`/doctors/${selectedDoctor.id}/leave`, {
        startDate: leaveStart,
        endDate: leaveEnd,
        reason: leaveReason || undefined,
      });
      setSuccess(`Leave recorded. ${res.data.data.notified} patient(s) notified of cancelled appointments.`);
      setLeaveStart('');
      setLeaveEnd('');
      setLeaveReason('');
      openDoctor(selectedDoctor);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-bold text-slate-900">Admin - Manage doctors</h1>
      <ErrorAlert message={error} />
      <SuccessAlert message={success} />

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="font-semibold text-slate-900">Add a doctor</h2>
          <div className="mt-3 space-y-2">
            <input placeholder="Full name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input type="password" placeholder="Temporary password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input placeholder="Specialization" value={form.specialization} onChange={(e) => setForm({ ...form, specialization: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <div>
              <label className="text-xs text-slate-600">Slot duration (minutes)</label>
              <input type="number" value={form.slotDurationMinutes} onChange={(e) => setForm({ ...form, slotDurationMinutes: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <Button onClick={createDoctor} disabled={creating} className="w-full">
              {creating ? 'Creating...' : 'Create doctor'}
            </Button>
          </div>
        </Card>

        <Card>
          <h2 className="font-semibold text-slate-900">Doctors</h2>
          {doctors.length === 0 ? (
            <EmptyState>No doctors yet.</EmptyState>
          ) : (
            <ul className="mt-3 space-y-2">
              {doctors.map((d) => (
                <li key={d.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <span>
                    Dr. {d.user.fullName} - {d.specialization}
                  </span>
                  <SecondaryButton onClick={() => openDoctor(d)}>Manage</SecondaryButton>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {selectedDoctor && (
        <Card className="mt-6">
          <h2 className="font-semibold text-slate-900">Managing Dr. {selectedDoctor.user.fullName}</h2>

          <div className="mt-4">
            <p className="text-sm font-medium text-slate-700">Working days & hours</p>
            <div className="mt-2 space-y-2">
              {DAYS.map((label, day) => {
                const entry = workingHours.find((w) => w.dayOfWeek === day);
                return (
                  <div key={day} className="flex items-center gap-3 text-sm">
                    <label className="flex w-16 items-center gap-2">
                      <input type="checkbox" checked={!!entry} onChange={() => toggleDay(day)} />
                      {label}
                    </label>
                    {entry && (
                      <>
                        <input type="time" value={entry.startTime} onChange={(e) => updateDayHours(day, { startTime: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-1 text-sm" />
                        <span>to</span>
                        <input type="time" value={entry.endTime} onChange={(e) => updateDayHours(day, { endTime: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-1 text-sm" />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <SecondaryButton onClick={saveWorkingHours} className="mt-3">
              Save working hours
            </SecondaryButton>
          </div>

          <div className="mt-6 border-t border-slate-200 pt-4">
            <p className="text-sm font-medium text-slate-700">Mark leave (auto-cancels & notifies affected patients)</p>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs text-slate-600">Start date</label>
                <input type="date" value={leaveStart} onChange={(e) => setLeaveStart(e.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="text-xs text-slate-600">End date</label>
                <input type="date" value={leaveEnd} onChange={(e) => setLeaveEnd(e.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
              </div>
              <input placeholder="Reason (optional)" value={leaveReason} onChange={(e) => setLeaveReason(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
              <Button onClick={submitLeave}>Record leave</Button>
            </div>
            {selectedDoctor.leaves && selectedDoctor.leaves.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm text-slate-600">
                {selectedDoctor.leaves.map((l) => (
                  <li key={l.id}>
                    {new Date(l.startDate).toLocaleDateString()} - {new Date(l.endDate).toLocaleDateString()} {l.reason ? `(${l.reason})` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
