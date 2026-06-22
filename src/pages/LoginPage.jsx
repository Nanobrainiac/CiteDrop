import { useEffect, useRef } from 'react';
import { SignIn, SignUp } from '@clerk/clerk-react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../state/AuthContext.jsx';
import { trackEvent } from '../lib/analytics.js';

export default function LoginPage() {
  const { user, configured } = useAuth();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const mode = params.get('mode') === 'sign-up' ? 'sign-up' : 'sign-in';
  const redirectUrl = params.get('redirect_url') || '';
  const safeRedirectUrl = redirectUrl.startsWith('/') && !redirectUrl.startsWith('//') ? redirectUrl : '';
  const destination = location.state?.from?.pathname || safeRedirectUrl || '/dashboard';
  const signupFormStarted = useRef(false);
  const signupGoogleClicked = useRef(false);

  useEffect(() => {
    trackEvent(mode === 'sign-up' ? 'signup_started' : 'login_started', { destination });
    signupFormStarted.current = false;
    signupGoogleClicked.current = false;
  }, [destination, mode]);

  function showRegister() {
    trackEvent('register_tab_clicked', { destination });
    setParams(safeRedirectUrl ? { mode: 'sign-up', redirect_url: safeRedirectUrl } : { mode: 'sign-up' });
  }

  function handleSignupFormFocus(event) {
    if (mode !== 'sign-up' || signupFormStarted.current) return;
    if (!event.target.matches('input, textarea, select')) return;
    signupFormStarted.current = true;
    trackEvent('signup_form_started', {
      destination,
      field_name: event.target.name || event.target.id || event.target.type
    });
  }

  function handleSignupFormClick(event) {
    if (mode !== 'sign-up' || signupGoogleClicked.current) return;
    const clickedText = event.target.closest('button, a')?.textContent || '';
    if (!/google/i.test(clickedText)) return;
    signupGoogleClicked.current = true;
    trackEvent('signup_google_clicked', { destination });
  }

  if (user) return <Navigate to={destination} replace />;

  return (
    <section className="mx-auto grid max-w-6xl gap-8 overflow-x-hidden px-3 py-10 sm:px-6 sm:py-16 lg:grid-cols-[.9fr_1.1fr] lg:px-8">
      <div className="flex min-w-0 flex-col justify-center">
        <p className="text-sm font-bold uppercase text-acid">FREE ACCOUNT</p>
        <h1 className="mt-3 text-4xl font-black leading-none sm:text-5xl">Create and manage research pages.</h1>
        <p className="mt-5 text-lg leading-8 text-white/60">Create polished, source-backed research pages in seconds and share them anywhere instantly.</p>
      </div>

      <div className="glass-panel min-w-0 overflow-hidden rounded-lg p-3 sm:p-6">
        {!configured ? (
          <div>
            <h2 className="text-2xl font-black">Clerk is not configured</h2>
            <p className="mt-3 text-white/65">Add your Clerk keys to `.env`, then restart `npm run dev`.</p>
          </div>
        ) : (
          <>
            <div className="mb-6 grid grid-cols-2 gap-2 rounded-full bg-white/8 p-1">
              <button type="button" onClick={() => setParams(safeRedirectUrl ? { mode: 'sign-in', redirect_url: safeRedirectUrl } : { mode: 'sign-in' })} className={`rounded-full px-4 py-2 font-bold ${mode === 'sign-in' ? 'bg-acid text-ink' : 'text-white/60'}`}>Login</button>
              <button type="button" onClick={showRegister} className={`rounded-full px-4 py-2 font-bold ${mode === 'sign-up' ? 'bg-acid text-ink' : 'text-white/60'}`}>Register</button>
            </div>
            <div
              className="flex min-w-0 justify-center overflow-hidden [&_.cl-card]:max-w-full [&_.cl-rootBox]:w-full [&_.cl-rootBox]:max-w-full"
              onFocusCapture={handleSignupFormFocus}
              onClickCapture={handleSignupFormClick}
            >
              {mode === 'sign-up' ? (
                <SignUp routing="hash" signInUrl={`/login${safeRedirectUrl ? `?redirect_url=${encodeURIComponent(safeRedirectUrl)}` : ''}`} afterSignUpUrl={destination} />
              ) : (
                <SignIn routing="hash" signUpUrl={`/login?mode=sign-up${safeRedirectUrl ? `&redirect_url=${encodeURIComponent(safeRedirectUrl)}` : ''}`} afterSignInUrl={destination} />
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
