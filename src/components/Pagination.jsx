import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function Pagination({ page, pageSize, total, onPageChange, label = 'items' }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  return (
    <div className="mt-8 flex flex-col gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-3 text-sm text-white/60 sm:flex-row sm:items-center sm:justify-between">
      <p>
        Showing <span className="font-bold text-white">{start}-{end}</span> of <span className="font-bold text-white">{total}</span> {label}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="inline-flex items-center gap-1 rounded-full border border-white/10 px-3 py-2 font-bold text-white/70 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft size={16} /> Prev
        </button>
        <span className="rounded-full bg-acid px-3 py-2 font-black text-ink">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="inline-flex items-center gap-1 rounded-full border border-white/10 px-3 py-2 font-bold text-white/70 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
