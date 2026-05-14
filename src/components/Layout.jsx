import { Link, NavLink } from 'react-router-dom';
import { PenLine, ShieldCheck } from 'lucide-react';
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
            <img src="/citedrop-logo.png" alt="CiteDrop" className="h-10 w-14 shrink-0 object-contain sm:w-16" />
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
      <footer className="border-t border-white/10 px-4 py-10 text-sm text-white/50 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-[1.2fr_.8fr_.8fr]">
          <div>
            <Link to="/" className="inline-flex items-center gap-3 text-white">
              <img src="/citedrop-logo.png" alt="CiteDrop" className="h-12 w-20 object-contain" />
              <span>
                <span className="block text-lg font-black leading-none">CiteDrop</span>
                <span className="text-xs uppercase text-white/45">Turn Claims Into Evidence</span>
              </span>
            </Link>
            <p className="mt-4 max-w-md leading-6">Built for careful, sourced, shareable arguments with visible claims, charts, and references.</p>
            <DonateButton compact className="mt-5 px-4 py-2 text-sm" />
          </div>
          <div>
            <p className="font-black uppercase text-white/70">Site</p>
            <div className="mt-4 grid gap-2">
              <Link className="hover:text-acid" to="/#latest">Browse articles</Link>
              <Link className="hover:text-acid" to="/dashboard">Create article</Link>
              {user?.role === 'admin' ? <Link className="hover:text-acid" to="/admin">Admin</Link> : null}
            </div>
          </div>
          <div>
            <p className="font-black uppercase text-white/70">Notes</p>
            <p className="mt-4 leading-6">AI output should be reviewed before publishing. Sources and claims are shown separately for transparency.</p>
            <p className="mt-4">
              Powered by{' '}
              <a className="font-bold text-acid hover:text-white" href="https://twopixelshort.com" target="_blank" rel="noreferrer">
                Two Pixels short
              </a>
            </p>
          </div>
        </div>
        <div className="mx-auto mt-8 flex max-w-7xl flex-col gap-2 border-t border-white/10 pt-5 text-xs text-white/35 sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {new Date().getFullYear()} CiteDrop. All rights reserved.</p>
          <p>Public research pages for debate, review, and sharing.</p>
        </div>
      </footer>
    </div>
  );
}
