import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { SecondaryButton } from './ui';

export function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link to="/" className="text-lg font-bold text-brand-700">
          🏥 ClinicCare
        </Link>
        <nav className="flex items-center gap-4">
          {user ? (
            <>
              <Link to="/dashboard" className="text-sm font-medium text-slate-600 hover:text-brand-700">
                Dashboard
              </Link>
              {user.role === 'PATIENT' && (
                <Link to="/doctors" className="text-sm font-medium text-slate-600 hover:text-brand-700">
                  Find a Doctor
                </Link>
              )}
              <span className="text-sm text-slate-500">Hi, {user.fullName.split(' ')[0]}</span>
              <SecondaryButton
                onClick={() => {
                  logout();
                  navigate('/login');
                }}
              >
                Log out
              </SecondaryButton>
            </>
          ) : (
            <>
              <Link to="/login" className="text-sm font-medium text-slate-600 hover:text-brand-700">
                Log in
              </Link>
              <Link to="/register" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
