import { Link } from 'react-router-dom';
import { LockKeyhole, X } from 'lucide-react';

export default function RegisterToPublishModal({ open, onClose }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/70 px-3 py-4 backdrop-blur-sm sm:items-center sm:justify-center" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-lg border border-white/10 bg-panel p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3">
            <div className="mt-1 rounded-full bg-acid p-2 text-ink">
              <LockKeyhole size={18} />
            </div>
            <div>
              <p className="text-xs font-black uppercase text-acid">Account required</p>
              <h2 className="mt-2 text-2xl font-black">Register to publish</h2>
            </div>
          </div>
          <button type="button" aria-label="Close registration prompt" onClick={onClose} className="rounded-full bg-white/10 p-2 hover:bg-white/15">
            <X size={18} />
          </button>
        </div>
        <p className="mt-4 text-sm leading-6 text-white/65">
          You can generate a free draft without an account. To publish it publicly and share the link, create a free CiteDrop account.
        </p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <Link to="/login?mode=sign-up" className="inline-flex min-h-12 items-center justify-center rounded-full bg-acid px-5 py-3 font-black text-ink hover:bg-white">
            Register free
          </Link>
          <button type="button" onClick={onClose} className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/15 px-5 py-3 font-bold text-white/70 hover:bg-white/10">
            Keep editing
          </button>
        </div>
      </div>
    </div>
  );
}
