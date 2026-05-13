import { Navigate, useLocation } from 'react-router-dom';
import LoadingState from './LoadingState.jsx';
import { useAuth } from '../state/AuthContext.jsx';

export default function AuthGuard({ children, role }) {
  const { user, loading, configured, roleError } = useAuth();
  const location = useLocation();

  if (!configured) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20">
        <div className="glass-panel rounded-lg p-8">
          <h1 className="text-2xl font-black">Clerk is not configured</h1>
          <p className="mt-3 text-white/65">Add `VITE_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` to `.env` before using authenticated pages.</p>
        </div>
      </div>
    );
  }

  if (loading) return <LoadingState label="Checking session" />;
  if (roleError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20">
        <div className="glass-panel rounded-lg p-8">
          <h1 className="text-2xl font-black">Unable to load your role</h1>
          <p className="mt-3 text-white/65">{roleError}</p>
          <p className="mt-3 text-sm text-white/45">Restart `npm run dev`, then sign out and back in if this persists.</p>
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (role && user.role !== role) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20">
        <div className="glass-panel rounded-lg p-8">
          <h1 className="text-2xl font-black">Admin access required</h1>
          <p className="mt-3 text-white/65">Your account can generate articles and view your own drafts, but it cannot manage site-wide content.</p>
        </div>
      </div>
    );
  }
  return children;
}
