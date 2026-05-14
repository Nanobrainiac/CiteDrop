import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import ArticleGrid from '../components/ArticleGrid.jsx';
import EvidenceScorePanel from '../components/EvidenceScorePanel.jsx';
import LoadingState from '../components/LoadingState.jsx';
import Pagination from '../components/Pagination.jsx';
import SearchAndFilters from '../components/SearchAndFilters.jsx';
import { demoArticles } from '../data/demoArticles.js';
import { getArticles } from '../lib/api.js';

const featuredEvidence = {
  claims: [
    { text: 'Public filings show measurable changes after policy shifts.', confidence: 'high' },
    { text: 'The strongest evidence comes from multi-year trend comparisons.', confidence: 'high' },
    { text: 'Some regional effects remain difficult to isolate from broader market conditions.', confidence: 'medium' },
    { text: 'Expert commentary supports the directional conclusion but not every numeric estimate.', confidence: 'medium' },
    { text: 'Older survey data should be treated as context rather than proof.', confidence: 'low' },
    { text: 'The available evidence is persuasive when claims are scoped narrowly.', confidence: 'high' },
    { text: 'Alternative explanations are credible for part of the observed change.', confidence: 'medium' },
    { text: 'Recent source material confirms the core timeline.', confidence: 'high' },
    { text: 'The conclusion depends on qualified rather than absolute language.', confidence: 'medium' },
    { text: 'A comparison chart helps clarify the size of the effect.', confidence: 'high' },
    { text: 'No single source resolves the full causal question.', confidence: 'medium' },
    { text: 'The public record supports a cautious, evidence-backed argument.', confidence: 'high' }
  ],
  charts: [{}, {}, {}, {}],
  sources: [{}, {}, {}, {}, {}, {}, {}, {}, {}]
};

const pageSize = 9;

export default function HomePage() {
  const [articles, setArticles] = useState([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [totalArticles, setTotalArticles] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const timeout = setTimeout(() => {
      setLoading(true);
      getArticles({ search, category, page, pageSize })
        .then((result) => {
          setArticles(result.articles);
          setTotalArticles(result.count || 0);
          setError('');
        })
        .catch(() => {
          setArticles(demoArticles);
          setTotalArticles(demoArticles.length);
          setError('');
        })
        .finally(() => setLoading(false));
    }, 250);

    return () => clearTimeout(timeout);
  }, [search, category, page]);

  useEffect(() => {
    setPage(1);
  }, [search, category]);

  const categories = useMemo(() => [...new Set(articles.map((article) => article.category).filter(Boolean))], [articles]);

  return (
    <>
      <section className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[1.1fr_.9fr] lg:px-8 lg:py-18">
        <div className="flex flex-col justify-center">
          <div className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-acid/30 bg-acid/10 px-4 py-2 text-sm font-bold text-acid">
            <ShieldCheck size={17} /> Sourced AI research pages
          </div>
          <h1 className="max-w-4xl text-5xl font-black leading-[0.95] sm:text-6xl lg:text-7xl">
            Build shareable data-driven articles in seconds.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-white/62">
            CiteDrop turns focused prompts into polished research articles with chart visualizations, visible sources, and a clear separation between claims and opinion.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to="/dashboard" className="inline-flex items-center justify-center gap-2 rounded-full bg-acid px-6 py-3 font-black text-ink hover:bg-white">
              Generate article <ArrowRight size={19} />
            </Link>
            <a href="#latest" className="inline-flex items-center justify-center rounded-full border border-white/15 px-6 py-3 font-bold text-white/75 hover:bg-white/10">Browse latest</a>
          </div>
        </div>
        <EvidenceScorePanel claims={featuredEvidence.claims} charts={featuredEvidence.charts} sources={featuredEvidence.sources} />
      </section>

      <section id="latest" className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-bold uppercase text-acid">Latest generated articles</p>
            <h2 className="mt-2 text-3xl font-black">Browse the public library</h2>
          </div>
          <SearchAndFilters search={search} setSearch={setSearch} category={category} setCategory={setCategory} categories={categories} />
        </div>
        {error ? <div className="glass-panel rounded-lg p-6 text-white/65">{error}</div> : loading ? <LoadingState label="Loading articles" /> : (
          <>
            <ArticleGrid articles={articles} />
            <Pagination page={page} pageSize={pageSize} total={totalArticles} onPageChange={setPage} label="articles" />
          </>
        )}
      </section>
    </>
  );
}
