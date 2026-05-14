import { ExternalLink } from 'lucide-react';
import { trackEvent } from '../lib/analytics.js';

export default function SourceList({ sources = [] }) {
  if (!sources.length) return null;
  return (
    <section className="glass-panel min-w-0 overflow-hidden rounded-lg p-4 sm:p-6">
      <h2 className="text-2xl font-black">Sources</h2>
      <div className="mt-5 space-y-3">
        {sources.map((source, index) => (
          <div key={`${source.title}-${index}`} className="min-w-0 rounded-md border border-white/10 bg-black/20 p-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="break-words font-bold">{source.title || 'Source needed'}</h3>
              <span className="break-words text-sm text-white/45">{source.publisher}</span>
            </div>
            <p className="mt-2 break-words text-sm leading-6 text-white/58">{source.note}</p>
            {source.url ? (
              <a
                className="mt-3 inline-flex max-w-full items-center gap-2 break-all text-sm font-bold text-acid hover:text-white"
                href={source.url}
                target="_blank"
                rel="noreferrer"
                onClick={() => trackEvent('source_click', {
                  source_title: source.title,
                  source_publisher: source.publisher,
                  source_url: source.url
                })}
              >
                Visit source <ExternalLink size={15} />
              </a>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
