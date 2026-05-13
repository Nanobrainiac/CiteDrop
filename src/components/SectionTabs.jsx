export default function SectionTabs({ items = [], className = '' }) {
  if (!items.length) return null;

  return (
    <nav className={`border-y border-white/10 bg-ink/95 backdrop-blur ${className}`} aria-label="Page sections">
      <div className="mx-auto max-w-7xl overflow-x-auto px-3 sm:px-6 lg:px-8">
        <div className="flex min-w-max gap-2 py-3">
          {items.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-bold text-white/65 hover:border-acid/50 hover:bg-acid/10 hover:text-acid"
            >
              {item.label}
            </a>
          ))}
        </div>
      </div>
    </nav>
  );
}
