import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { formatDate } from '../utils/format.js';

export default function ArticleCard({ article }) {
  const statusTone = article.status === 'published' ? 'bg-acid text-ink' : 'bg-white/10 text-white/65';

  return (
    <Link to={`/articles/${article.slug}`} className="group glass-panel flex min-h-72 flex-col rounded-lg p-5 transition hover:-translate-y-1 hover:border-acid/50">
      <div className="flex items-center justify-between gap-3">
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs uppercase text-white/60">{article.category}</span>
        <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${statusTone}`}>{article.status || 'published'}</span>
      </div>
      <div className="chart-grid mt-5 rounded-md border border-white/10 bg-black/25 p-4">
        <p className="text-xs uppercase text-acid/80">{formatDate(article.created_at)}</p>
        <h3 className="mt-3 line-clamp-3 text-2xl font-black leading-tight">{article.title}</h3>
      </div>
      <p className="mt-5 line-clamp-3 flex-1 text-sm leading-6 text-white/62">{article.summary || article.subtitle}</p>
      <span className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-acid">
        Open brief <ArrowUpRight className="h-4 w-4 transition group-hover:translate-x-1" />
      </span>
    </Link>
  );
}
