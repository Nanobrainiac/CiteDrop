import { BarChart3, FileCheck2, ShieldCheck } from 'lucide-react';

function confidenceScore(claims) {
  if (!claims.length) return 0;
  const weights = { high: 100, medium: 72, low: 42 };
  const total = claims.reduce((sum, claim) => sum + (weights[String(claim.confidence || '').toLowerCase()] || 60), 0);
  return Math.round((total / claims.length) * 10) / 10;
}

export default function EvidenceScorePanel({ claims = [], charts = [], sources = [] }) {
  const score = confidenceScore(claims);
  const scoreLabel = claims.length ? `${score}` : '0.0';
  const blocks = [
    'bg-ember h-12',
    'bg-moss h-20',
    'bg-acid h-16',
    'bg-ember h-24',
    'bg-acid h-14'
  ];

  return (
    <section className="glass-panel chart-grid rounded-lg p-6">
      <div className="rounded-lg border border-white/10 bg-black/30 p-5">
        <p className="text-sm uppercase text-white/45">Claim Strength Index</p>
        <div className="mt-4 flex items-end gap-3">
          <span className="text-6xl font-black leading-none text-acid">{scoreLabel}</span>
          <span className="pb-2 text-white/50">verified / qualified</span>
        </div>
        <div className="mt-8 grid grid-cols-5 gap-3">
          {blocks.map((className, index) => (
            <div key={index} className={`rounded-md ${className}`} />
          ))}
        </div>
        <div className="mt-8 grid grid-cols-3 gap-3">
          <Metric icon={FileCheck2} value={claims.length} label="Claims" />
          <Metric icon={BarChart3} value={charts.length} label="Charts" />
          <Metric icon={ShieldCheck} value={sources.length} label="Sources" />
        </div>
      </div>
    </section>
  );
}

function Metric({ icon: Icon, value, label }) {
  return (
    <div className="rounded-md bg-white/[0.04] p-3">
      <Icon className="h-5 w-5 text-acid" />
      <p className="mt-3 text-2xl font-black">{value}</p>
      <p className="text-sm text-white/45">{label}</p>
    </div>
  );
}
