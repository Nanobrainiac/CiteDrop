import { useState } from 'react';
import { generateArticle } from '../lib/api.js';
import { trackEvent } from '../lib/analytics.js';
import { CheckCircle2, Loader2, WandSparkles } from 'lucide-react';
import { useAuth } from '../state/AuthContext.jsx';

const pipelineStages = [
  { key: 'claim_extraction', label: 'Interpreting prompt' },
  { key: 'research', label: 'Gathering targeted evidence' },
  { key: 'source_ingestion', label: 'Verifying source text' },
  { key: 'evidence_synthesis', label: 'Ranking sources' },
  { key: 'counterevidence', label: 'Checking counterevidence' },
  { key: 'drafting', label: 'Writing the first draft' },
  { key: 'polish', label: 'Polishing the article' },
  { key: 'review', label: 'Running fact-check and bias review' },
  { key: 'revision', label: 'Revising the article' },
  { key: 'citation_audit', label: 'Auditing citations' },
  { key: 'citation_repair', label: 'Repairing citation issues' },
  { key: 'saving', label: 'Saving draft' }
];

const stageDescriptions = {
  claim_extraction: 'Breaking your prompt into claims, questions, comparisons, and coverage requirements so the research can target the right evidence.',
  research: 'Running separate searches for each claim or question, with a preference for primary records, datasets, reports, transcripts, and direct evidence.',
  source_ingestion: 'Opening candidate source pages, detecting linked PDFs, extracting readable text, and marking sources that could not be independently read.',
  evidence_synthesis: 'Scoring sources by relevance, authority, recency, specificity, primary-source value, and whether readable text was verified.',
  counterevidence: 'Looking for opposing evidence, limitations, stale data, missing context, and reasons a skeptical reader might reject the argument.',
  drafting: 'Writing only from the ranked evidence packet and attaching source buttons to evidence-bearing paragraphs.',
  polish: 'Improving section depth, source clarity, chart placement, and removing filler without adding unsupported facts.',
  review: 'Running a skeptical fact-check and neutrality review for unsupported claims, weak citations, missing counterpoints, and biased wording.',
  revision: 'Revising the draft to fix review issues, add caveats, improve source support, and remove overclaims.',
  citation_audit: 'Checking that factual claims and paragraphs are tied to real source records before the draft is saved.',
  citation_repair: 'Sending weakly supported sections back for repair, or marking claims as uncertain when public evidence is insufficient.',
  saving: 'Saving the completed draft to your article library.'
};

function stageBase(stage = '') {
  if (/^searching_/.test(stage)) return 'research';
  if (/^ingesting_source_/.test(stage)) return 'source_ingestion';
  if (/^ranking_/.test(stage)) return 'evidence_synthesis';
  if (/^checking_counterevidence/.test(stage)) return 'counterevidence';
  if (/^repair_attempt_/.test(stage)) return 'citation_repair';
  return stage;
}

export default function PromptBuilder({ onGenerated }) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    tone: 'Professional and persuasive',
    prompt: ''
  });
  const [loading, setLoading] = useState(false);
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setJob({ stage: 'claim_extraction', stageLabel: 'Interpreting prompt' });
    setError('');
    try {
      const result = await generateArticle(form, setJob);
      trackEvent('article_generated', {
        article_id: result.article?.id,
        article_slug: result.article?.slug,
        article_category: result.article?.category,
        tone: form.tone
      });
      onGenerated?.(result.article);
    } catch (err) {
      trackEvent('generate_failed', {
        tone: form.tone,
        error_message: err.message
      });
      setError(err.message);
      setJob(null);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="glass-panel rounded-lg p-5">
        <div className="flex items-start gap-4">
          <div className="rounded-full bg-acid p-3 text-ink">
            <Loader2 className="animate-spin" size={22} />
          </div>
          <div>
            <p className="text-sm font-bold uppercase text-acid">Generation in progress</p>
            <h2 className="mt-2 text-2xl font-black">{job?.stageLabel || 'Building your article'}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">{stageDescriptions[stageBase(job?.stage)] || 'CiteDrop is moving this article through the research, verification, writing, and citation workflow.'}</p>
            <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-white/70">
              {user ? 'You can leave this page if you need to. We will email you when the draft is ready to review and publish.' : 'Keep this page open while your free draft is generated.'}
            </p>
          </div>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {pipelineStages.map((stage) => {
            const activeStage = stageBase(job?.stage);
            const currentIndex = pipelineStages.findIndex((item) => item.key === activeStage);
            const stageIndex = pipelineStages.findIndex((item) => item.key === stage.key);
            const isDone = currentIndex > stageIndex;
            const isActive = currentIndex === stageIndex;
            return (
              <div key={stage.key} className={`rounded-md border p-3 ${isActive ? 'border-acid bg-acid/10' : isDone ? 'border-acid/30 bg-white/[0.04]' : 'border-white/10 bg-black/20'}`}>
                <div className="flex items-center gap-2">
                  {isDone ? <CheckCircle2 className="text-acid" size={17} /> : isActive ? <Loader2 className="animate-spin text-acid" size={17} /> : <span className="h-[17px] w-[17px] rounded-full border border-white/20" />}
                  <span className="text-sm font-bold">{stage.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="glass-panel rounded-lg p-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <label className="block space-y-2">
          <span className="text-sm font-bold text-white/70">Copy & paste, or type your point of view about something here.</span>
          <textarea required minLength={12} rows={7} value={form.prompt} onChange={(event) => updateField('prompt', event.target.value)} className="w-full resize-y rounded-md border border-white/10 bg-black/25 px-4 py-3 outline-none focus:border-acid" placeholder="Example: Is college still worth it?" />
        </label>
        <label className="space-y-2">
          <span className="text-sm font-bold text-white/70">Tone</span>
          <select value={form.tone} onChange={(event) => updateField('tone', event.target.value)} className="w-full rounded-md border border-white/10 bg-panelSoft px-4 py-3 outline-none focus:border-acid">
            <option>Professional and persuasive</option>
            <option>Academic and cautious</option>
            <option>Plain-spoken and direct</option>
            <option>Executive brief</option>
            <option>Silly but evidence-based</option>
          </select>
          <p className="text-sm leading-6 text-white/45">CiteDrop will infer the category, framing, sources, and chart types from your question.</p>
        </label>
      </div>
      {error ? <p className="mt-4 rounded-md border border-ember/40 bg-ember/10 p-3 text-sm text-red-100">{error}</p> : null}
      <button disabled={loading} className="mt-6 inline-flex items-center gap-2 rounded-full bg-acid px-6 py-3 font-black text-ink hover:bg-white disabled:cursor-not-allowed disabled:opacity-60">
        <WandSparkles size={19} /> {loading ? 'Generating article...' : 'Generate article'}
      </button>
    </form>
  );
}
