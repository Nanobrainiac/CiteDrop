export default function ClaimList({ claims = [] }) {
  if (!claims.length) return null;
  return (
    <section className="glass-panel min-w-0 overflow-hidden rounded-lg p-4 sm:p-6">
      <h2 className="text-2xl font-black">Claims Checked</h2>
      <div className="mt-5 space-y-3">
        {claims.map((claim, index) => (
          <article key={`${claim.claim}-${index}`} className="min-w-0 rounded-md border border-white/10 bg-white/[0.04] p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold uppercase ${verdictTone(claim.verdict)}`}>
                    {claim.verdict || claim.type || 'claim'}
                  </span>
                  <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs uppercase text-white/55">
                    {claim.confidenceLabel || claim.confidence || 'qualified'}
                  </span>
                </div>
                <p className="mt-3 break-words font-semibold text-white">{claim.claim}</p>
                <p className="mt-2 break-words text-sm font-bold leading-6 text-acid">{claim.verdictSummary}</p>
                <p className="mt-2 break-words text-sm leading-6 text-white/58">{claim.support}</p>
              </div>
              <ClaimScore claim={claim} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ClaimScore({ claim }) {
  const score = getClaimScore(claim);
  return (
    <div className="shrink-0 rounded-md border border-acid/20 bg-black/25 p-3 text-center sm:w-28">
      <p className="text-[10px] font-bold uppercase text-white/45">Index</p>
      <p className="mt-1 text-3xl font-black leading-none text-acid">{score}</p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-acid" style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

function getClaimScore(claim) {
  const score = Number(claim.confidenceScore);
  if (Number.isFinite(score)) return Math.max(0, Math.min(100, Math.round(score)));
  const weights = { high: 88, medium: 68, low: 42 };
  return weights[String(claim.confidence || claim.confidenceLabel || '').toLowerCase()] || 60;
}

function verdictTone(verdict) {
  const value = String(verdict || '').toLowerCase();
  if (value === 'true') return 'bg-acid text-ink';
  if (value === 'false') return 'bg-ember text-white';
  if (value === 'mixed') return 'bg-moss text-white';
  return 'bg-white/10 text-white/60';
}
