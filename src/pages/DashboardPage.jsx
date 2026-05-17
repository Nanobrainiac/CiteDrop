import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import EmptyState from '../components/EmptyState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import MyArticleTable from '../components/MyArticleTable.jsx';
import Pagination from '../components/Pagination.jsx';
import PromptBuilder from '../components/PromptBuilder.jsx';
import DonateButton from '../components/DonateButton.jsx';
import SectionTabs from '../components/SectionTabs.jsx';
import { getArticles } from '../lib/api.js';

const dashboardTabs = [
  { label: 'Create', href: '#create' },
  { label: 'My articles', href: '#my-articles' }
];
const pageSize = 10;

export default function DashboardPage() {
  const navigate = useNavigate();
  const [generated, setGenerated] = useState(null);
  const [articles, setArticles] = useState([]);
  const [page, setPage] = useState(1);
  const [totalArticles, setTotalArticles] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadMyArticles = useCallback((targetPage = page) => {
    setLoading(true);
    getArticles({ includeDrafts: true, mine: true, page: targetPage, pageSize })
      .then((result) => {
        setArticles(result.articles);
        setTotalArticles(result.count || 0);
        setError('');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [page]);

  useEffect(() => {
    loadMyArticles();
  }, [loadMyArticles]);

  function handleGenerated(article) {
    setGenerated(article);
    setPage(1);
    loadMyArticles(1);
    if (article?.slug) navigate(`/articles/${article.slug}`);
  }

  return (
    <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div id="create" className="mb-6 scroll-mt-24">
        <p className="text-sm font-bold uppercase text-acid">Generator</p>
        <h1 className="mt-2 text-4xl font-black">Build a shareable research article</h1>
        <p className="mt-3 max-w-3xl text-white/60">Create a shareable AI-powered article with research, graphs, and visual explanations in seconds.</p>
        <div className="mt-5">
          <DonateButton />
        </div>
      </div>
      <SectionTabs items={dashboardTabs} className="mb-6 rounded-lg" />
      <PromptBuilder onGenerated={handleGenerated} />
      {generated ? (
        <div className="mt-6 glass-panel rounded-lg p-5">
          <p className="text-sm uppercase text-acid">Draft saved</p>
          <h2 className="mt-2 text-2xl font-black">{generated.title}</h2>
          <p className="mt-2 text-white/55">Your draft is saved. Preview it, then publish it when you are ready to share.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link to={`/articles/${generated.slug}`} className="rounded-full border border-white/15 px-5 py-3 font-bold hover:bg-white/10">Preview article</Link>
            <DonateButton compact />
          </div>
        </div>
      ) : null}
      <div id="my-articles" className="mt-10 scroll-mt-24">
        <div className="mb-5">
          <p className="text-sm font-bold uppercase text-acid">Your articles</p>
          <h2 className="mt-2 text-3xl font-black">Generated articles</h2>
        </div>
        {error ? <div className="glass-panel rounded-lg p-6 text-white/65">{error}</div> : loading ? <LoadingState label="Loading your articles" /> : articles.length ? (
          <>
            <MyArticleTable articles={articles} onChange={loadMyArticles} />
            <Pagination page={page} pageSize={pageSize} total={totalArticles} onPageChange={setPage} label="articles" />
          </>
        ) : <EmptyState title="No drafts yet" message="Generate your first article above." />}
      </div>
    </section>
  );
}
