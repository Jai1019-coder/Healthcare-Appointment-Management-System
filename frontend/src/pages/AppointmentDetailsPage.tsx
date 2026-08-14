import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiClient, apiErrorMessage } from '../api/client';
import { Appointment } from '../types';
import { useAuth } from '../context/AuthContext';
import { Button, Card, ErrorAlert, Spinner, StatusBadge, SuccessAlert } from '../components/ui';

interface PrescriptionRow {
  medicationName: string;
  dosage: string;
  frequencyPerDay: number;
  durationDays: number;
  instructions?: string;
}

export function AppointmentDetailsPage() {
  const { appointmentId } = useParams<{ appointmentId: string }>();
  const { user } = useAuth();
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);

  // Doctor post-visit form state
  const [clinicalNotes, setClinicalNotes] = useState('');
  const [prescriptions, setPrescriptions] = useState<PrescriptionRow[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    if (!appointmentId) return;
    apiClient
      .get(`/appointments/${appointmentId}`)
      .then((res) => setAppointment(res.data.data))
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(load, [appointmentId]);

  const addPrescriptionRow = () =>
    setPrescriptions((p) => [...p, { medicationName: '', dosage: '', frequencyPerDay: 1, durationDays: 5 }]);

  const updateRow = (idx: number, patch: Partial<PrescriptionRow>) =>
    setPrescriptions((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const submitPostVisit = async () => {
    if (!appointmentId) return;
    setSubmitting(true);
    setError('');
    try {
      await apiClient.post(`/appointments/${appointmentId}/post-visit`, { clinicalNotes, prescriptions });
      setSuccess('Post-visit summary submitted. The patient-friendly summary is being generated.');
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Spinner />;
  if (!appointment) return <ErrorAlert message={error || 'Appointment not found'} />;

  const preVisit = appointment.aiSummaries.find((s) => s.type === 'PRE_VISIT');
  const postVisit = appointment.aiSummaries.find((s) => s.type === 'POST_VISIT');
  const isDoctorView = user?.role === 'DOCTOR';

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Card>
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-slate-900">
            {isDoctorView ? appointment.patient.user.fullName : `Dr. ${appointment.doctor.user.fullName}`}
          </h1>
          <StatusBadge status={appointment.status} />
        </div>
        <p className="mt-1 text-sm text-slate-600">
          {new Date(appointment.slotStart).toLocaleString([], { dateStyle: 'full', timeStyle: 'short' })}
        </p>
        {!isDoctorView && <p className="text-sm text-brand-700">{appointment.doctor.specialization}</p>}

        {appointment.symptomReport && (
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
            <p className="font-medium text-slate-800">Reported symptoms</p>
            <p className="mt-1 text-slate-600">{appointment.symptomReport.description}</p>
            {appointment.symptomReport.severity && (
              <p className="mt-1 text-xs text-slate-500">Severity: {appointment.symptomReport.severity}</p>
            )}
          </div>
        )}

        {isDoctorView && preVisit && !preVisit.failed && (
          <div className="mt-4 rounded-lg bg-brand-50 p-3 text-sm">
            <p className="font-medium text-brand-800">AI pre-visit summary ({preVisit.urgency} urgency)</p>
            <p className="mt-1 text-slate-700">{preVisit.chiefComplaint}</p>
            <ul className="mt-2 list-disc pl-5 text-slate-600">
              {preVisit.suggestedQuestions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </div>
        )}

        {appointment.postVisitNote && (
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
            <p className="font-medium text-slate-800">Doctor's notes</p>
            <p className="mt-1 whitespace-pre-wrap text-slate-600">{appointment.postVisitNote.clinicalNotes}</p>
          </div>
        )}

        {!isDoctorView && postVisit && !postVisit.failed && (
          <div className="mt-4 rounded-lg bg-brand-50 p-3 text-sm">
            <p className="font-medium text-brand-800">Your visit summary</p>
            <p className="mt-1 text-slate-700">{postVisit.patientSummary}</p>
            {postVisit.followUpInstructions && (
              <p className="mt-2 text-slate-600">
                <span className="font-medium">Follow-up: </span>
                {postVisit.followUpInstructions}
              </p>
            )}
          </div>
        )}

        {appointment.prescriptions.length > 0 && (
          <div className="mt-4">
            <p className="font-medium text-slate-800">Prescriptions</p>
            <ul className="mt-2 space-y-1 text-sm text-slate-600">
              {appointment.prescriptions.map((p) => (
                <li key={p.id}>
                  {p.medicationName} - {p.dosage}, {p.frequencyPerDay}x/day for {p.durationDays} days
                </li>
              ))}
            </ul>
          </div>
        )}

        {isDoctorView && appointment.status === 'CONFIRMED' && (
          <div className="mt-6 border-t border-slate-200 pt-4">
            <p className="font-medium text-slate-800">Submit post-visit notes</p>
            <textarea
              rows={4}
              placeholder="Clinical notes..."
              value={clinicalNotes}
              onChange={(e) => setClinicalNotes(e.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <div className="mt-3 space-y-2">
              {prescriptions.map((row, idx) => (
                <div key={idx} className="grid grid-cols-4 gap-2">
                  <input
                    placeholder="Medication"
                    value={row.medicationName}
                    onChange={(e) => updateRow(idx, { medicationName: e.target.value })}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <input
                    placeholder="Dosage"
                    value={row.dosage}
                    onChange={(e) => updateRow(idx, { dosage: e.target.value })}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <input
                    type="number"
                    placeholder="Times/day"
                    value={row.frequencyPerDay}
                    onChange={(e) => updateRow(idx, { frequencyPerDay: Number(e.target.value) })}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <input
                    type="number"
                    placeholder="Days"
                    value={row.durationDays}
                    onChange={(e) => updateRow(idx, { durationDays: Number(e.target.value) })}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </div>
              ))}
              <button onClick={addPrescriptionRow} className="text-sm font-medium text-brand-700 hover:underline">
                + Add medication
              </button>
            </div>
            <ErrorAlert message={error} />
            <SuccessAlert message={success} />
            <Button onClick={submitPostVisit} disabled={submitting || !clinicalNotes.trim()} className="mt-3 w-full">
              {submitting ? 'Submitting...' : 'Submit post-visit summary'}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
