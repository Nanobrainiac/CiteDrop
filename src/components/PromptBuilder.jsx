import { useState } from 'react';
import { generateArticle } from '../lib/api.js';
import { WandSparkles } from 'lucide-react';

export default function PromptBuilder({ onGenerated }) {
  const [form, setForm] = useState({
    tone: 'Professional and persuasive',
    prompt: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await generateArticle(form);
      onGenerated?.(result.article);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="glass-panel rounded-lg p-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <label className="block space-y-2">
          <span className="text-sm font-bold text-white/70">Research question</span>
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
