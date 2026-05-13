import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BarChart3, FileSearch, ShieldCheck } from 'lucide-react';
import ArticleGrid from '../components/ArticleGrid.jsx';
import LoadingState from '../components/LoadingState.jsx';
import SearchAndFilters from '../components/SearchAndFilters.jsx';
import { demoArticles } from '../data/demoArticles.js';
import { getArticles } from '../lib/api.js';

export default function HomePage() {
  const [articles, setArticles] = useState([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const timeout = setTimeout(() => {
      setLoading(true);
      getArticles({ search, category })
        .then((result) => {
          setArticles(result.articles);
          setError('');
        })
        .catch(() => {
          setArticles(demoArticles);
          setError('');
        })
        .finally(() => setLoading(false));
    }, 250);

    return () => clearTimeout(timeout);
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
            Proofer turns focused prompts into polished research articles with chart visualizations, visible sources, and a clear separation between claims and opinion.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to="/dashboard" className="inline-flex items-center justify-center gap-2 rounded-full bg-acid px-6 py-3 font-black text-ink hover:bg-white">
              Generate article <ArrowRight size={19} />
            </Link>
            <a href="#latest" className="inline-flex items-center justify-center rounded-full border border-white/15 px-6 py-3 font-bold text-white/75 hover:bg-white/10">Browse latest</a>
          </div>
        </div>
        <div className="glass-panel chart-grid rounded-lg p-5 shadow-glow">
          <div className="rounded-lg border border-white/10 bg-black/35 p-5">
            <p className="text-sm uppercase text-white/45">Claim strength index</p>
            <div className="mt-2 flex items-end gap-3">
              <span className="text-6xl font-black text-acid sm:text-7xl">87.4</span>
              <span className="pb-3 text-white/45">verified / qualified</span>
            </div>
            <div className="mt-8 grid grid-cols-5 gap-2">
              {[42, 70, 54, 88, 63, 35, 50, 78, 47, 92].map((height, index) => (
                <div key={index} className={`rounded-md ${index % 3 === 0 ? 'bg-ember' : index % 2 ? 'bg-moss' : 'bg-acid'}`} style={{ height }} />
              ))}
            </div>
            <div className="mt-7 grid gap-3 sm:grid-cols-3">
              <Metric icon={FileSearch} label="Claims" value="12" />
              <Metric icon={BarChart3} label="Charts" value="4" />
              <Metric icon={ShieldCheck} label="Sources" value="9" />
            </div>
          </div>
        </div>
      </section>

      <section id="latest" className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-bold uppercase text-acid">Latest generated articles</p>
            <h2 className="mt-2 text-3xl font-black">Browse the public library</h2>
          </div>
          <SearchAndFilters search={search} setSearch={setSearch} category={category} setCategory={setCategory} categories={categories} />
        </div>
        {error ? <div className="glass-panel rounded-lg p-6 text-white/65">{error}</div> : loading ? <LoadingState label="Loading articles" /> : <ArticleGrid articles={articles} />}
      </section>
    </>
  );
}

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="rounded-md bg-white/8 p-4">
      <Icon className="h-5 w-5 text-acid" />
      <p className="mt-3 text-2xl font-black">{value}</p>
      <p className="text-sm text-white/45">{label}</p>
    </div>
  );
}
