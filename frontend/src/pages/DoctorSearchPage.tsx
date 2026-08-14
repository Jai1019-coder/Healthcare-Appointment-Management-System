import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient, apiErrorMessage } from '../api/client';
import { Doctor } from '../types';
import { Button, Card, EmptyState, ErrorAlert, Spinner } from '../components/ui';

export function DoctorSearchPage() {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [specialization, setSpecialization] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDoctors = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/doctors', { params: { specialization: specialization || undefined, q: q || undefined } });
      setDoctors(res.data.data);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load doctors'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDoctors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-bold text-slate-900">Find a doctor</h1>

      <div className="mt-4 flex flex-wrap gap-3">
        <input
          placeholder="Search by name"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <input
          placeholder="Filter by specialization"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={specialization}
          onChange={(e) => setSpecialization(e.target.value)}
        />
        <Button onClick={fetchDoctors}>Search</Button>
      </div>

      <div className="mt-6">
        <ErrorAlert message={error} />
        {loading ? (
          <Spinner />
        ) : doctors.length === 0 ? (
          <EmptyState>No doctors match your search.</EmptyState>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {doctors.map((doc) => (
              <Card key={doc.id}>
                <h3 className="font-semibold text-slate-900">Dr. {doc.user.fullName}</h3>
                <p className="text-sm text-brand-700">{doc.specialization}</p>
                {doc.bio && <p className="mt-2 text-sm text-slate-600">{doc.bio}</p>}
                <p className="mt-2 text-xs text-slate-500">{doc.slotDurationMinutes}-minute appointments</p>
                <Link to={`/book/${doc.id}`} className="mt-4 inline-block">
                  <Button>Book appointment</Button>
                </Link>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
