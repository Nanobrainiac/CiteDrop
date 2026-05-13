export default function ClaimList({ claims = [] }) {
  if (!claims.length) return null;
  return (
    <section className="glass-panel rounded-lg p-6">
      <h2 className="text-2xl font-black">Key Claims</h2>
      <div className="mt-5 space-y-3">
        {claims.map((claim, index) => (
          <article key={`${claim.claim}-${index}`} className="rounded-md border border-white/10 bg-white/[0.04] p-4">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-acid px-2.5 py-1 text-xs font-bold uppercase text-ink">{claim.type || 'claim'}</span>
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs uppercase text-white/55">{claim.confidence || 'qualified'}</span>
            </div>
            <p className="mt-3 font-semibold text-white">{claim.claim}</p>
            <p className="mt-2 text-sm leading-6 text-white/58">{claim.support}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
