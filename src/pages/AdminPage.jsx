import { useCallback, useEffect, useState } from 'react';
import AdminArticleTable from '../components/AdminArticleTable.jsx';
import EmptyState from '../components/EmptyState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import Pagination from '../components/Pagination.jsx';
import { getArticles } from '../lib/api.js';

const pageSize = 10;

export default function AdminPage() {
  const [articles, setArticles] = useState([]);
  const [page, setPage] = useState(1);
  const [totalArticles, setTotalArticles] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadArticles = useCallback(() => {
    setLoading(true);
    getArticles({ includeDrafts: true, scope: 'all', page, pageSize })
      .then((result) => {
        setArticles(result.articles);
        setTotalArticles(result.count || 0);
        setError('');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [page]);

  useEffect(() => {
    loadArticles();
  }, [loadArticles]);

  return (
    <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-6">
        <p className="text-sm font-bold uppercase text-acid">Admin</p>
        <h1 className="mt-2 text-4xl font-black">Manage generated articles</h1>
      </div>
      {error ? <div className="glass-panel rounded-lg p-6 text-white/65">{error}</div> : loading ? <LoadingState label="Loading admin list" /> : articles.length ? (
        <>
          <AdminArticleTable articles={articles} onChange={loadArticles} />
          <Pagination page={page} pageSize={pageSize} total={totalArticles} onPageChange={setPage} label="articles" />
        </>
      ) : <EmptyState title="No articles yet" message="Generate a draft from the dashboard first." />}
    </section>
  );
}
