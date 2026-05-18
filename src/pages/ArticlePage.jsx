import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, Copy, ExternalLink, Send, Share2, X } from 'lucide-react';
import ClaimList from '../components/ClaimList.jsx';
import EvidenceScorePanel from '../components/EvidenceScorePanel.jsx';
import LoadingState from '../components/LoadingState.jsx';
import RegisterToPublishModal from '../components/RegisterToPublishModal.jsx';
import SectionTabs from '../components/SectionTabs.jsx';
import { demoArticles } from '../data/demoArticles.js';
import { getArticle, updateArticle } from '../lib/api.js';
import { trackEvent } from '../lib/analytics.js';
import { useAuth } from '../state/AuthContext.jsx';
import { formatDate } from '../utils/format.js';
import { articleUrl } from '../utils/links.js';

const ChartRenderer = lazy(() => import('../components/ChartRenderer.jsx'));

export default function ArticlePage() {
  const { slug } = useParams();
  const { user } = useAuth();
  const [article, setArticle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [publishError, setPublishError] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedSource, setSelectedSource] = useState(null);
  const [showRegisterPrompt, setShowRegisterPrompt] = useState(false);

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
  const sourcesById = useMemo(() => new Map(sources.map((source, index) => [String(source.id || `source-${index + 1}`), { ...source, id: String(source.id || `source-${index + 1}`) }])), [sources]);
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
    ...(remainingCharts.length ? [{ label: 'Charts', href: '#charts' }] : [])
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
    if (!user) {
      setShowRegisterPrompt(true);
      return;
    }
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
      <header className="border-b border-white/10 bg-black/20">
        <div className="mx-auto grid max-w-7xl gap-6 overflow-x-hidden px-3 py-8 sm:px-6 sm:py-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:px-8">
          <div className="min-w-0">
            <div className="border-l-4 border-acid pl-4">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-acid">CiteDrop Research Article</p>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-white/48">
                <span className="rounded-full bg-acid px-3 py-1 font-black uppercase text-ink">{article.category}</span>
                <span>{formatDate(article.created_at)}</span>
                <span className="uppercase">{article.status}</span>
                <span>{sources.length} sources</span>
              </div>
            </div>
            <h1 className="mt-6 max-w-4xl break-words border-b border-white/10 pb-5 text-4xl font-black leading-[1.03] sm:text-6xl">{article.title}</h1>
            {article.subtitle ? <p className="mt-5 max-w-3xl break-words text-xl font-semibold leading-8 text-white/75">{article.subtitle}</p> : null}
            <div id="summary" className="mt-6 max-w-3xl scroll-mt-20">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-white/42">Brief Summary</p>
              <p className="mt-3 border-l border-white/15 pl-4 text-base leading-7 text-white/68">{article.summary}</p>
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
                const paragraphSources = normalized.sourceIds.map((id) => sourcesById.get(String(id))).filter(Boolean);
                return (
                  <div key={paragraphIndex}>
                    <p className="mt-4 break-words text-base leading-8 text-white/70 sm:text-lg">{normalized.text}</p>
                    {paragraphSources.length ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {paragraphSources.map((source, sourceIndex) => (
                          <button
                            key={`${source.id}-${sourceIndex}`}
                            type="button"
                            onClick={() => setSelectedSource(source)}
                            className="inline-flex min-h-11 items-center rounded-full border border-acid/30 bg-acid/10 px-4 py-2 text-sm font-black text-acid hover:bg-acid hover:text-ink"
                          >
                            Source {sourceIndex + 1}: {source.publisher || sourceDomain(source.url) || 'Reference'}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {paragraphCharts.length ? (
                      <div className="mt-5">
                        <Suspense fallback={<LoadingState label="Loading chart" />}>
                          <ChartRenderer charts={paragraphCharts} fallbackData={fallbackChartData} />
                        </Suspense>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </section>
          ))}
          {remainingCharts.length ? (
            <div id="charts" className="scroll-mt-20">
              <Suspense fallback={<LoadingState label="Loading charts" />}>
                <ChartRenderer charts={remainingCharts} fallbackData={fallbackChartData} />
              </Suspense>
            </div>
          ) : null}
        </div>
      </div>
      <SourceModal source={selectedSource} onClose={() => setSelectedSource(null)} />
      <RegisterToPublishModal open={showRegisterPrompt} onClose={() => setShowRegisterPrompt(false)} />
    </article>
  );
}

function normalizeParagraph(paragraph) {
  if (typeof paragraph === 'string') return { text: paragraph, chartIds: [], sourceIds: [] };
  return {
    text: paragraph?.text || '',
    chartIds: Array.isArray(paragraph?.chartIds) ? paragraph.chartIds : [],
    sourceIds: Array.isArray(paragraph?.sourceIds) ? paragraph.sourceIds : []
  };
}

function SourceModal({ source, onClose }) {
  if (!source) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/70 px-3 py-4 backdrop-blur-sm sm:items-center sm:justify-center" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-lg border border-white/10 bg-panel p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase text-acid">Source</p>
            <h2 className="mt-2 break-words text-2xl font-black">{displaySourceTitle(source)}</h2>
            <p className="mt-1 break-words text-sm text-white/45">{source.publisher || sourceDomain(source.url)}{source.date ? ` / ${source.date}` : ''}</p>
          </div>
          <button type="button" aria-label="Close source details" onClick={onClose} className="rounded-full bg-white/10 p-2 hover:bg-white/15">
            <X size={18} />
          </button>
        </div>
        {source.note ? <p className="mt-4 break-words text-sm leading-6 text-white/65">{source.note}</p> : null}
        {source.url ? (
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            onClick={() => trackEvent('source_click', {
              source_title: source.title,
              source_publisher: source.publisher,
              source_url: source.url
            })}
            className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-acid px-5 py-3 font-black text-ink hover:bg-white sm:w-auto"
          >
            Open source page <ExternalLink size={17} />
          </a>
        ) : null}
      </div>
    </div>
  );
}

function displaySourceTitle(source) {
  const title = String(source?.title || '').trim();
  if (!title || /^https?:\/\//i.test(title)) return source?.publisher || sourceDomain(source?.url) || 'Source';
  return title;
}

function sourceDomain(url = '') {
  try {
    return new globalThis.URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
