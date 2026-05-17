import { Link } from 'react-router-dom';
import { Copy, Eye, Trash2 } from 'lucide-react';
import { deleteArticle, updateArticle } from '../lib/api.js';
import { trackEvent } from '../lib/analytics.js';
import { formatDate } from '../utils/format.js';
import { articleUrl } from '../utils/links.js';

export default function AdminArticleTable({ articles, onChange }) {
  async function handleUpdate(article, field, value) {
    await updateArticle(article.id, { [field]: value });
    if (field === 'status' && value === 'published') {
      trackEvent('article_published', {
        article_id: article.id,
        article_slug: article.slug,
        article_category: article.category,
        location: 'admin_table'
      });
    }
    onChange();
  }

  async function handleDelete(article) {
    if (!window.confirm(`Delete "${article.title}"?`)) return;
    await deleteArticle(article.id);
    onChange();
  }

  async function copyLink(article) {
    await navigator.clipboard.writeText(articleUrl(article.slug));
    trackEvent('article_shared', {
      article_id: article.id,
      article_slug: article.slug,
      article_category: article.category,
      method: 'copy_link_admin'
    });
  }

  return (
    <div className="overflow-hidden rounded-lg border border-white/10">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-white/10 bg-panel/80 text-sm">
          <thead className="bg-white/[0.04] text-left text-xs uppercase text-white/45">
            <tr>
              <th className="px-4 py-3">Article</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {articles.map((article) => (
              <tr key={article.id} className="align-top">
                <td className="px-4 py-4">
                  <input value={article.title} onChange={(event) => handleUpdate(article, 'title', event.target.value)} className="w-72 max-w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 font-semibold outline-none focus:border-acid" />
                  <p className="mt-1 text-xs text-white/40">{article.slug}</p>
                </td>
                <td className="px-4 py-4">
                  <input value={article.category} onChange={(event) => handleUpdate(article, 'category', event.target.value)} className="w-40 rounded-md border border-white/10 bg-black/20 px-3 py-2 outline-none focus:border-acid" />
                </td>
                <td className="px-4 py-4">
                  <select value={article.status} onChange={(event) => handleUpdate(article, 'status', event.target.value)} className="rounded-md border border-white/10 bg-panelSoft px-3 py-2 outline-none focus:border-acid">
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                    <option value="archived">Archived</option>
                    <option value="deleted">Deleted</option>
                  </select>
                </td>
                <td className="px-4 py-4 text-white/50">{formatDate(article.created_at)}</td>
                <td className="px-4 py-4">
                  <div className="flex justify-end gap-2">
                    <Link aria-label="View article" className="rounded-full bg-white/10 p-2 hover:bg-white/15" to={`/articles/${article.slug}`}><Eye size={16} /></Link>
                    <button aria-label="Copy public link" className="rounded-full bg-white/10 p-2 hover:bg-white/15" onClick={() => copyLink(article)}><Copy size={16} /></button>
                    <button aria-label="Delete article" className="rounded-full bg-ember/80 p-2 hover:bg-ember" onClick={() => handleDelete(article)}><Trash2 size={16} /></button>
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
