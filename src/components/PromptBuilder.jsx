import { useState } from 'react';
import { generateArticle } from '../lib/api.js';
import { WandSparkles } from 'lucide-react';

const chartOptions = ['bar', 'line', 'area', 'pie'];

export default function PromptBuilder({ onGenerated }) {
  const [form, setForm] = useState({
    topic: '',
    position: '',
    tone: 'Professional and persuasive',
    category: 'Policy',
    visualizations: ['bar'],
    sourceUrlsText: '',
    prompt: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function toggleChart(type) {
    setForm((current) => ({
      ...current,
      visualizations: current.visualizations.includes(type)
        ? current.visualizations.filter((item) => item !== type)
        : [...current.visualizations, type]
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const sourceUrls = form.sourceUrlsText
        .split(/\s+/)
        .map((url) => url.trim())
        .filter(Boolean);
      const result = await generateArticle({ ...form, sourceUrls, sourceUrlsText: undefined });
      onGenerated?.(result.article);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="glass-panel rounded-lg p-5">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2">
          <span className="text-sm font-bold text-white/70">Topic</span>
          <input required value={form.topic} onChange={(event) => updateField('topic', event.target.value)} className="w-full rounded-md border border-white/10 bg-black/25 px-4 py-3 outline-none focus:border-acid" placeholder="Example: urban housing supply" />
        </label>
        <label className="space-y-2">
          <span className="text-sm font-bold text-white/70">Category</span>
          <input required value={form.category} onChange={(event) => updateField('category', event.target.value)} className="w-full rounded-md border border-white/10 bg-black/25 px-4 py-3 outline-none focus:border-acid" />
        </label>
        <label className="space-y-2">
          <span className="text-sm font-bold text-white/70">Intended position</span>
          <input value={form.position} onChange={(event) => updateField('position', event.target.value)} className="w-full rounded-md border border-white/10 bg-black/25 px-4 py-3 outline-none focus:border-acid" placeholder="What should the argument support?" />
        </label>
        <label className="space-y-2">
          <span className="text-sm font-bold text-white/70">Tone</span>
          <select value={form.tone} onChange={(event) => updateField('tone', event.target.value)} className="w-full rounded-md border border-white/10 bg-panelSoft px-4 py-3 outline-none focus:border-acid">
            <option>Professional and persuasive</option>
            <option>Academic and cautious</option>
            <option>Plain-spoken and direct</option>
            <option>Executive brief</option>
          </select>
        </label>
      </div>
      <label className="mt-4 block space-y-2">
        <span className="text-sm font-bold text-white/70">Prompt</span>
        <textarea required minLength={20} rows={7} value={form.prompt} onChange={(event) => updateField('prompt', event.target.value)} className="w-full resize-y rounded-md border border-white/10 bg-black/25 px-4 py-3 outline-none focus:border-acid" placeholder="Describe the question, audience, constraints, and evidence you want considered." />
      </label>
      <label className="mt-4 block space-y-2">
        <span className="text-sm font-bold text-white/70">Source URLs</span>
        <textarea rows={3} value={form.sourceUrlsText} onChange={(event) => updateField('sourceUrlsText', event.target.value)} className="w-full resize-y rounded-md border border-white/10 bg-black/25 px-4 py-3 outline-none focus:border-acid" placeholder="Optional: paste specific source URLs, one per line or separated by spaces." />
      </label>
      <div className="mt-4">
        <span className="text-sm font-bold text-white/70">Charts</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {chartOptions.map((type) => (
            <button type="button" key={type} onClick={() => toggleChart(type)} className={`rounded-full px-4 py-2 text-sm font-bold uppercase ${form.visualizations.includes(type) ? 'bg-acid text-ink' : 'bg-white/10 text-white/65'}`}>
              {type}
            </button>
          ))}
        </div>
      </div>
      {error ? <p className="mt-4 rounded-md border border-ember/40 bg-ember/10 p-3 text-sm text-red-100">{error}</p> : null}
      <button disabled={loading} className="mt-6 inline-flex items-center gap-2 rounded-full bg-acid px-6 py-3 font-black text-ink hover:bg-white disabled:cursor-not-allowed disabled:opacity-60">
        <WandSparkles size={19} /> {loading ? 'Generating article...' : 'Generate article'}
      </button>
    </form>
  );
}
