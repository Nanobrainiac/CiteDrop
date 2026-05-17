import { useState } from 'react';
import { generateArticle } from '../lib/api.js';
import { trackEvent } from '../lib/analytics.js';
import { CheckCircle2, Loader2, WandSparkles } from 'lucide-react';

const pipelineStages = [
  { key: 'claim_extraction', label: 'Interpreting prompt' },
  { key: 'research', label: 'Gathering sources' },
  { key: 'drafting', label: 'Writing the first draft' },
  { key: 'review', label: 'Running fact-check and bias review' },
  { key: 'revision', label: 'Revising the article' },
  { key: 'citation_audit', label: 'Auditing citations' },
  { key: 'citation_repair', label: 'Repairing citation issues' },
  { key: 'saving', label: 'Saving draft' }
];

export default function PromptBuilder({ onGenerated }) {
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
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">CiteDrop is checking the claim, gathering sources, drafting, reviewing, revising, and auditing citations before saving your draft.</p>
          </div>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {pipelineStages.map((stage) => {
            const currentIndex = pipelineStages.findIndex((item) => item.key === job?.stage);
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
