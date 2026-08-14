import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiClient, apiErrorMessage } from '../api/client';
import { Doctor } from '../types';
import { Button, Card, ErrorAlert, Spinner } from '../components/ui';

function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function BookingPage() {
  const { doctorId } = useParams<{ doctorId: string }>();
  const navigate = useNavigate();

  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [date, setDate] = useState(toDateInputValue(new Date()));
  const [slots, setSlots] = useState<string[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [symptoms, setSymptoms] = useState('');
  const [severity, setSeverity] = useState('Mild');
  const [durationDays, setDurationDays] = useState<number | ''>('');
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiClient.get(`/doctors/${doctorId}`).then((res) => setDoctor(res.data.data));
  }, [doctorId]);

  useEffect(() => {
    if (!doctorId || !date) return;
    setLoadingSlots(true);
    setSelectedSlot(null);
    apiClient
      .get(`/appointments/availability/${doctorId}`, { params: { date } })
      .then((res) => setSlots(res.data.data.slots))
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoadingSlots(false));
  }, [doctorId, date]);

  const handleBook = async () => {
    if (!selectedSlot) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await apiClient.post('/appointments', {
        doctorId,
        slotStart: selectedSlot,
        symptoms: symptoms.trim()
          ? { description: symptoms.trim(), severity, durationDays: durationDays === '' ? undefined : Number(durationDays) }
          : undefined,
      });
      navigate(`/appointments/${res.data.data.id}`);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not book this slot - it may have just been taken.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!doctor) return <Spinner />;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-bold text-slate-900">Book with Dr. {doctor.user.fullName}</h1>
      <p className="text-sm text-brand-700">{doctor.specialization}</p>

      <Card className="mt-6">
        <label className="text-sm font-medium text-slate-700">Choose a date</label>
        <input
          type="date"
          value={date}
          min={toDateInputValue(new Date())}
          onChange={(e) => setDate(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />

        <div className="mt-4">
          <label className="text-sm font-medium text-slate-700">Available times</label>
          {loadingSlots ? (
            <Spinner />
          ) : slots.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No open slots on this date. Try another day.</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {slots.map((slot) => (
                <button
                  key={slot}
                  onClick={() => setSelectedSlot(slot)}
                  className={`rounded-lg border px-3 py-1.5 text-sm ${
                    selectedSlot === slot ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {new Date(slot).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-6 border-t border-slate-200 pt-4">
          <label className="text-sm font-medium text-slate-700">Describe your symptoms (optional but recommended)</label>
          <textarea
            rows={4}
            value={symptoms}
            onChange={(e) => setSymptoms(e.target.value)}
            placeholder="e.g. persistent headache for 3 days, mild fever in the evenings..."
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          {symptoms.trim() && (
            <div className="mt-3 flex gap-4">
              <div>
                <label className="text-xs font-medium text-slate-600">Severity</label>
                <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
                  <option>Mild</option>
                  <option>Moderate</option>
                  <option>Severe</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Duration (days)</label>
                <input
                  type="number"
                  min={0}
                  value={durationDays}
                  onChange={(e) => setDurationDays(e.target.value === '' ? '' : Number(e.target.value))}
                  className="mt-1 block w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
            </div>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Sharing symptoms lets our AI prepare a pre-visit summary for your doctor, so they walk in already informed.
          </p>
        </div>

        <ErrorAlert message={error} />

        <Button onClick={handleBook} disabled={!selectedSlot || submitting} className="mt-4 w-full">
          {submitting ? 'Booking...' : 'Confirm booking'}
        </Button>
      </Card>
    </div>
  );
}
