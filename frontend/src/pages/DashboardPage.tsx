import { useAuth } from '../context/AuthContext';
import { PatientDashboardPage } from './PatientDashboardPage';
import { DoctorDashboardPage } from './DoctorDashboardPage';
import { AdminDashboardPage } from './AdminDashboardPage';

export function DashboardPage() {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role === 'DOCTOR') return <DoctorDashboardPage />;
  if (user.role === 'ADMIN') return <AdminDashboardPage />;
  return <PatientDashboardPage />;
}
