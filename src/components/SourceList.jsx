import { ExternalLink } from 'lucide-react';

export default function SourceList({ sources = [] }) {
  if (!sources.length) return null;
  return (
    <section className="glass-panel rounded-lg p-6">
      <h2 className="text-2xl font-black">Sources</h2>
      <div className="mt-5 space-y-3">
        {sources.map((source, index) => (
          <div key={`${source.title}-${index}`} className="rounded-md border border-white/10 bg-black/20 p-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="font-bold">{source.title || 'Source needed'}</h3>
              <span className="text-sm text-white/45">{source.publisher}</span>
            </div>
            <p className="mt-2 text-sm leading-6 text-white/58">{source.note}</p>
            {source.url ? (
              <a className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-acid hover:text-white" href={source.url} target="_blank" rel="noreferrer">
                Visit source <ExternalLink size={15} />
              </a>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
