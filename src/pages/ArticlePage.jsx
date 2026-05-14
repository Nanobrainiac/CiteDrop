import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, Copy, Send, Share2 } from 'lucide-react';
import ChartRenderer from '../components/ChartRenderer.jsx';
import ClaimList from '../components/ClaimList.jsx';
import EvidenceScorePanel from '../components/EvidenceScorePanel.jsx';
import LoadingState from '../components/LoadingState.jsx';
import SectionTabs from '../components/SectionTabs.jsx';
import SourceList from '../components/SourceList.jsx';
import { demoArticles } from '../data/demoArticles.js';
import { getArticle, updateArticle } from '../lib/api.js';
import { trackEvent } from '../lib/analytics.js';
import { formatDate } from '../utils/format.js';
import { articleUrl } from '../utils/links.js';

export default function ArticlePage() {
  const { slug } = useParams();
  const [article, setArticle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [publishError, setPublishError] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLoading(true);
    getArticle(slug, true)
      .then((result) => {
        setArticle(result.article);
        document.title = `${result.article.title} | CiteDrop`;
        trackEvent('article_view', {
          article_id: result.article.id,
          article_slug: result.article.slug,
          article_category: result.article.category,
          article_status: result.article.status
        });
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
  const chartsById = useMemo(() => new Map(charts.map((chart, index) => [chart.id || chart.slug || `chart-${index + 1}`, chart])), [charts]);
  const usedChartIds = useMemo(() => {
    const ids = new Set();
    sections.forEach((section) => {
      (section.paragraphs || []).forEach((paragraph) => {
        if (typeof paragraph === 'object' && Array.isArray(paragraph.chartIds)) {
          paragraph.chartIds.forEach((id) => ids.add(id));
        }
      });
    });
    return ids;
  }, [sections]);
  const remainingCharts = useMemo(() => charts.filter((chart, index) => !usedChartIds.has(chart.id || chart.slug || `chart-${index + 1}`)), [charts, usedChartIds]);
  const sectionTabs = useMemo(() => [
    { label: 'Summary', href: '#summary' },
    { label: 'Claims', href: '#claims' },
    { label: 'Article', href: '#article-body' },
    ...(remainingCharts.length ? [{ label: 'Charts', href: '#charts' }] : []),
    { label: 'Sources', href: '#sources' }
  ], [remainingCharts.length]);

  async function copyLink() {
    await navigator.clipboard.writeText(articleUrl(article.slug));
    trackEvent('article_shared', {
      article_id: article.id,
      article_slug: article.slug,
      article_category: article.category,
      method: 'copy_link'
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  async function share() {
    const url = articleUrl(article.slug);
    if (navigator.share) {
      await navigator.share({ title: article.title, text: article.summary, url });
      trackEvent('article_shared', {
        article_id: article.id,
        article_slug: article.slug,
        article_category: article.category,
        method: 'native_share'
      });
    } else {
      copyLink();
    }
  }

  async function publishArticle() {
    setPublishing(true);
    setPublishError('');
    try {
      const result = await updateArticle(article.id, { status: 'published' });
      setArticle(result.article);
      trackEvent('article_published', {
        article_id: result.article.id,
        article_slug: result.article.slug,
        article_category: result.article.category,
        location: 'article_page'
      });
    } catch (err) {
      setPublishError(err.message);
    } finally {
      setPublishing(false);
    }
  }

  if (loading) return <LoadingState label="Loading article" />;
  if (error || !article) return <div className="mx-auto max-w-3xl px-4 py-20 text-white/65">{error || 'Article not found.'}</div>;

  return (
    <article>
      <header className="border-b border-white/10">
        <div className="mx-auto grid max-w-7xl gap-6 overflow-x-hidden px-3 py-10 sm:px-6 sm:py-12 lg:grid-cols-[minmax(0,1fr)_380px] lg:px-8">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3 text-sm text-white/48">
              <span className="rounded-full bg-acid px-3 py-1 font-black uppercase text-ink">{article.category}</span>
              <span>{formatDate(article.created_at)}</span>
              <span>{article.status}</span>
            </div>
            <h1 className="mt-6 max-w-4xl break-words text-4xl font-black leading-none sm:text-6xl">{article.title}</h1>
            {article.subtitle ? <p className="mt-5 max-w-3xl break-words text-lg leading-8 text-white/62 sm:text-xl">{article.subtitle}</p> : null}
            <div id="summary" className="mt-6 max-w-3xl scroll-mt-20 rounded-lg border border-white/10 bg-white/[0.04] p-5">
              <p className="text-sm uppercase text-white/45">Summary</p>
              <p className="mt-3 text-base leading-7 text-white/72">{article.summary}</p>
            </div>
            {article.status === 'published' ? (
              <div className="mt-8">
                <div className="flex flex-wrap gap-3">
                  <button onClick={share} className="inline-flex items-center gap-2 rounded-full bg-acid px-5 py-3 font-black text-ink hover:bg-white">
                    <Share2 size={18} /> Share
                  </button>
                  <button onClick={copyLink} className="inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-3 font-bold text-white/75 hover:bg-white/10">
                    <Copy size={18} /> {copied ? 'Copied' : 'Copy link'}
                  </button>
                </div>
                <Link to="/dashboard" className="mt-4 inline-flex items-center gap-2 rounded-full border border-acid/40 bg-acid/10 px-5 py-3 font-black text-acid hover:bg-acid hover:text-ink">
                  Generate your own research articles in seconds for free. <ArrowRight size={18} />
                </Link>
              </div>
            ) : (
              <div className="mt-8">
                <div className="glass-panel rounded-lg p-4">
                  <p className="text-sm font-semibold text-white/60">This article is still a draft. Publish it before sharing a public link.</p>
                  <button disabled={publishing} onClick={publishArticle} className="mt-4 inline-flex items-center gap-2 rounded-full bg-acid px-5 py-3 font-black text-ink hover:bg-white disabled:cursor-not-allowed disabled:opacity-60">
                    <Send size={18} /> {publishing ? 'Publishing...' : 'Publish article'}
                  </button>
                  {publishError ? <p className="mt-3 rounded-md border border-ember/40 bg-ember/10 p-3 text-sm text-red-100">{publishError}</p> : null}
                </div>
              </div>
            )}
            <SectionTabs items={sectionTabs} className="mt-6 rounded-lg lg:hidden" />
          </div>
          <EvidenceScorePanel claims={claims} charts={charts} sources={sources} />
        </div>
      </header>

      <section className="mx-auto max-w-7xl space-y-5 overflow-x-hidden px-3 py-8 sm:px-6 lg:px-8">
        <div id="claims" className="scroll-mt-20">
          <ClaimList claims={claims} />
        </div>
      </section>

      <div id="article-body" className="mx-auto max-w-5xl scroll-mt-20 overflow-x-hidden px-3 py-10 sm:px-6 lg:px-8">
        <div className="min-w-0 space-y-8">
          {sections.map((section, index) => (
            <section key={`${section.heading}-${index}`} className="max-w-none">
              <h2 className="break-words text-2xl font-black sm:text-3xl">{section.heading}</h2>
              {(section.paragraphs || []).map((paragraph, paragraphIndex) => {
                const normalized = normalizeParagraph(paragraph);
                const paragraphCharts = normalized.chartIds.map((id) => chartsById.get(id)).filter(Boolean);
                return (
                  <div key={paragraphIndex}>
                    <p className="mt-4 break-words text-base leading-8 text-white/70 sm:text-lg">{normalized.text}</p>
                    {paragraphCharts.length ? (
                      <div className="mt-5">
                        <ChartRenderer charts={paragraphCharts} fallbackData={fallbackChartData} />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </section>
          ))}
          {remainingCharts.length ? (
            <div id="charts" className="scroll-mt-20">
              <ChartRenderer charts={remainingCharts} fallbackData={fallbackChartData} />
            </div>
          ) : null}
          <div id="sources" className="scroll-mt-20">
            <SourceList sources={sources} />
          </div>
        </div>
      </div>
    </article>
  );
}

function normalizeParagraph(paragraph) {
  if (typeof paragraph === 'string') return { text: paragraph, chartIds: [] };
  return {
    text: paragraph?.text || '',
    chartIds: Array.isArray(paragraph?.chartIds) ? paragraph.chartIds : []
  };
}
