export default function LoadingState({ label = 'Loading' }) {
  return (
    <div className="mx-auto grid min-h-80 max-w-7xl place-items-center px-4 py-16">
      <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-5 py-3 text-white/70">
        <span className="h-3 w-3 animate-pulse rounded-full bg-acid shadow-glow" />
        {label}
      </div>
    </div>
  );
}
