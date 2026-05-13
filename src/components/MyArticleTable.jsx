import { Link } from 'react-router-dom';
import { Copy, Eye, Send, Trash2, Undo2 } from 'lucide-react';
import { deleteArticle, updateArticle } from '../lib/api.js';
import { formatDate } from '../utils/format.js';
import { articleUrl } from '../utils/links.js';

export default function MyArticleTable({ articles, onChange }) {
  async function togglePublished(article) {
    const nextStatus = article.status === 'published' ? 'draft' : 'published';
    await updateArticle(article.id, { status: nextStatus });
    onChange();
  }

  async function removeArticle(article) {
    if (!window.confirm(`Delete "${article.title}"?`)) return;
    await deleteArticle(article.id);
    onChange();
  }

  async function copyLink(article) {
    await navigator.clipboard.writeText(articleUrl(article.slug));
  }

  return (
    <div className="overflow-hidden rounded-lg border border-white/10">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-white/10 bg-panel/80 text-sm">
          <thead className="bg-white/[0.04] text-left text-xs uppercase text-white/45">
            <tr>
              <th className="px-4 py-3">Article</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {articles.map((article) => (
              <tr key={article.id} className="align-top">
                <td className="px-4 py-4">
                  <p className="max-w-xl font-semibold">{article.title}</p>
                  <p className="mt-1 text-xs text-white/40">{article.category} / {article.slug}</p>
                </td>
                <td className="px-4 py-4">
                  <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${article.status === 'published' ? 'bg-acid text-ink' : 'bg-white/10 text-white/60'}`}>
                    {article.status}
                  </span>
                </td>
                <td className="px-4 py-4 text-white/50">{formatDate(article.created_at)}</td>
                <td className="px-4 py-4">
                  <div className="flex justify-end gap-2">
                    <Link aria-label="Preview article" className="rounded-full bg-white/10 p-2 hover:bg-white/15" to={`/articles/${article.slug}`}><Eye size={16} /></Link>
                    <button aria-label="Copy public link" className="rounded-full bg-white/10 p-2 hover:bg-white/15" onClick={() => copyLink(article)}><Copy size={16} /></button>
                    <button aria-label={article.status === 'published' ? 'Unpublish article' : 'Publish article'} className="inline-flex items-center gap-2 rounded-full bg-acid px-3 py-2 font-bold text-ink hover:bg-white" onClick={() => togglePublished(article)}>
                      {article.status === 'published' ? <Undo2 size={16} /> : <Send size={16} />}
                      <span className="hidden sm:inline">{article.status === 'published' ? 'Unpublish' : 'Publish'}</span>
                    </button>
                    <button aria-label="Delete article" className="rounded-full bg-ember/80 p-2 hover:bg-ember" onClick={() => removeArticle(article)}><Trash2 size={16} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
