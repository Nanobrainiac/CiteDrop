import { Search } from 'lucide-react';
import { trackEvent } from '../lib/analytics.js';

export default function SearchAndFilters({ search, setSearch, category, setCategory, categories }) {
  function trackSearch(value) {
    const term = value.trim();
    if (term.length < 3) return;
    trackEvent('search_used', {
      search_term: term,
      search_length: term.length
    });
  }

  return (
    <div className="glass-panel rounded-lg p-3">
      <div className="flex flex-col gap-3 md:flex-row">
        <label className="relative flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-white/35" />
          <span className="sr-only">Search articles</span>
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            onBlur={(event) => trackSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') trackSearch(event.currentTarget.value);
            }}
            placeholder="Search research, claims, topics..."
            className="h-12 w-full rounded-full border border-white/10 bg-white/8 pl-12 pr-4 text-white outline-none placeholder:text-white/35 focus:border-acid"
          />
        </label>
        <label>
          <span className="sr-only">Category</span>
          <select
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              trackEvent('category_filter_used', { category: event.target.value || 'all' });
            }}
            className="h-12 w-full rounded-full border border-white/10 bg-panelSoft px-4 text-white outline-none focus:border-acid md:w-56"
          >
            <option value="">All categories</option>
            {categories.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}
