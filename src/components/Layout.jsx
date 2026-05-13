import { Link, NavLink } from 'react-router-dom';
import { PenLine, ShieldCheck, Sparkles } from 'lucide-react';
import { UserButton } from '@clerk/clerk-react';
import { useAuth } from '../state/AuthContext.jsx';
import DonateButton from './DonateButton.jsx';

export default function Layout({ children }) {
  const { user, configured } = useAuth();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-ink/85 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-3 py-3 sm:flex-nowrap sm:px-6 sm:py-4 lg:px-8">
          <Link to="/" className="flex min-w-0 items-center gap-2 sm:gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-acid text-ink shadow-glow">
              <Sparkles size={21} strokeWidth={2.6} />
            </span>
            <span className="min-w-0">
              <span className="block text-base font-black leading-none tracking-normal sm:text-lg">CiteDrop</span>
              <span className="hidden text-xs uppercase text-white/45 sm:block">Turn Claims Into Evidence</span>
            </span>
          </Link>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-1 overflow-x-auto sm:flex-none sm:gap-2 sm:overflow-visible">
            <NavLink className="shrink-0 rounded-full px-2.5 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white sm:px-3" to="/#latest">Browse</NavLink>
            {user ? (
              <>
                <NavLink className="inline-flex shrink-0 rounded-full px-2.5 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white sm:px-3" to="/dashboard">
                  <PenLine className="mr-1 h-4 w-4 sm:mr-2" /> Create
                </NavLink>
                {user.role === 'admin' ? (
                  <NavLink className="inline-flex shrink-0 rounded-full px-2.5 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white sm:px-3" to="/admin">
                    <ShieldCheck className="mr-1 h-4 w-4 sm:mr-2" /> Admin
                  </NavLink>
                ) : null}
                {configured ? <UserButton afterSignOutUrl="/" /> : null}
              </>
            ) : (
              <NavLink className="rounded-full bg-acid px-4 py-2 text-sm font-bold text-ink hover:bg-white" to="/login">Log in</NavLink>
            )}
          </div>
        </nav>
      </header>
      <main>{children}</main>
      <footer className="border-t border-white/10 px-4 py-8 text-center text-sm text-white/45">
        <p>Built for careful, sourced, shareable arguments.</p>
        <DonateButton compact className="mt-4 px-4 py-2 text-sm" />
      </footer>
    </div>
  );
}
