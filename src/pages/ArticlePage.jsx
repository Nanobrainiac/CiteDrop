import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Copy, Share2 } from 'lucide-react';
import ChartRenderer from '../components/ChartRenderer.jsx';
import ClaimList from '../components/ClaimList.jsx';
import EvidenceScorePanel from '../components/EvidenceScorePanel.jsx';
import LoadingState from '../components/LoadingState.jsx';
import SourceList from '../components/SourceList.jsx';
import { demoArticles } from '../data/demoArticles.js';
import { getArticle } from '../lib/api.js';
import { formatDate } from '../utils/format.js';

export default function ArticlePage() {
  const { slug } = useParams();
  const [article, setArticle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLoading(true);
    getArticle(slug, true)
      .then((result) => {
        setArticle(result.article);
        document.title = `${result.article.title} | CiteDrop`;
      })
      .catch((err) => {
        const demoArticle = demoArticles.find((item) => item.slug === slug);
        if (demoArticle) {
          setArticle(demoArticle);
          document.title = `${demoArticle.title} | CiteDrop`;
        } else {
          setError(err.message);
        }
      })
      .finally(() => setLoading(false));
  }, [slug]);

  const sections = useMemo(() => Array.isArray(article?.body) ? article.body : [], [article]);
  const claims = useMemo(() => Array.isArray(article?.claims_json) ? article.claims_json : [], [article]);
  const charts = useMemo(() => Array.isArray(article?.charts_json) ? article.charts_json : [], [article]);
  const sources = useMemo(() => Array.isArray(article?.sources_json) ? article.sources_json : [], [article]);
  const fallbackChartData = useMemo(() => [
    { label: 'Claims', value: claims.length },
    { label: 'Charts', value: charts.length },
    { label: 'Sources', value: sources.length }
  ], [claims.length, charts.length, sources.length]);

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  async function share() {
    if (navigator.share) {
      await navigator.share({ title: article.title, text: article.summary, url: window.location.href });
    } else {
      copyLink();
    }
  }

  if (loading) return <LoadingState label="Loading article" />;
  if (error || !article) return <div className="mx-auto max-w-3xl px-4 py-20 text-white/65">{error || 'Article not found.'}</div>;

  return (
    <article>
      <header className="border-b border-white/10">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_380px] lg:px-8">
          <div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-white/48">
              <span className="rounded-full bg-acid px-3 py-1 font-black uppercase text-ink">{article.category}</span>
              <span>{formatDate(article.created_at)}</span>
              <span>{article.status}</span>
            </div>
            <h1 className="mt-6 max-w-4xl text-4xl font-black leading-none sm:text-6xl">{article.title}</h1>
            {article.subtitle ? <p className="mt-5 max-w-3xl text-xl leading-8 text-white/62">{article.subtitle}</p> : null}
            <div className="mt-8 flex flex-wrap gap-3">
              <button onClick={share} className="inline-flex items-center gap-2 rounded-full bg-acid px-5 py-3 font-black text-ink hover:bg-white">
                <Share2 size={18} /> Share
              </button>
              <button onClick={copyLink} className="inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-3 font-bold text-white/75 hover:bg-white/10">
                <Copy size={18} /> {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          </div>
          <EvidenceScorePanel claims={claims} charts={charts} sources={sources} />
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:px-8">
        <div className="space-y-8">
          {sections.map((section, index) => (
            <section key={`${section.heading}-${index}`} className="prose prose-invert max-w-none">
              <h2 className="text-3xl font-black">{section.heading}</h2>
              {(section.paragraphs || []).map((paragraph, paragraphIndex) => (
                <p key={paragraphIndex} className="text-lg leading-8 text-white/70">{paragraph}</p>
              ))}
            </section>
          ))}
          <SourceList sources={sources} />
        </div>
        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <div className="glass-panel rounded-lg p-5">
            <p className="text-sm uppercase text-white/45">Brief summary</p>
            <p className="mt-4 text-base leading-7 text-white/72">{article.summary}</p>
          </div>
          <ClaimList claims={claims} />
          <ChartRenderer charts={charts} fallbackData={fallbackChartData} />
        </aside>
      </div>
    </article>
  );
}
