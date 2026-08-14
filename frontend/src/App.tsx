import { Routes, Route } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DoctorSearchPage } from './pages/DoctorSearchPage';
import { BookingPage } from './pages/BookingPage';
import { PatientDashboardPage } from './pages/PatientDashboardPage';
import { AppointmentDetailsPage } from './pages/AppointmentDetailsPage';
import { DashboardPage } from './pages/DashboardPage';

function App() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/doctors"
          element={
            <ProtectedRoute allow={['PATIENT']}>
              <DoctorSearchPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/book/:doctorId"
          element={
            <ProtectedRoute allow={['PATIENT']}>
              <BookingPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/appointments/:appointmentId"
          element={
            <ProtectedRoute allow={['PATIENT', 'DOCTOR']}>
              <AppointmentDetailsPage />
            </ProtectedRoute>
          }
        />
        {/* kept for direct linking / bookmarking a patient's list */}
        <Route
          path="/my-appointments"
          element={
            <ProtectedRoute allow={['PATIENT']}>
              <PatientDashboardPage />
            </ProtectedRoute>
          }
        />
      </Routes>
    </div>
  );
}

export default App;
