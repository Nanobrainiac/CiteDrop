import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { trackEvent } from '../lib/analytics.js';

const colors = ['#e6ff3f', '#657400', '#c92605', '#f7f7f2', '#35372f'];

function getValueKeys(data) {
  const sample = data?.[0] || {};
  return Object.keys(sample).filter((key) => key !== 'label' && typeof sample[key] === 'number');
}

function ChartTooltip({ active, payload, label, unit }) {
  if (!active || !payload?.length) return null;
  const item = payload[0]?.payload || {};
  return (
    <div className="max-w-72 rounded-md border border-white/10 bg-panel p-3 text-sm shadow-glow">
      <p className="font-black text-white">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="mt-1 text-acid">
          {entry.name || entry.dataKey}: {formatValueWithUnit(entry.value, unit)}
        </p>
      ))}
      {item.group ? <p className="mt-1 text-white/55">Group: {item.group}</p> : null}
      {item.source ? <p className="mt-1 text-white/55">Source: {item.source}</p> : null}
      {item.note ? <p className="mt-2 leading-5 text-white/65">{item.note}</p> : null}
    </div>
  );
}

function formatTimelineDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = raw.replace(/,/g, '');

  if (/^-?\d+(\.\d+)?$/.test(normalized)) {
    const numeric = Math.abs(Number(normalized));
    if (numeric >= 1000000000) return `${trimNumber(numeric / 1000000000)}B years ago`;
    if (numeric >= 1000000) return `${trimNumber(numeric / 1000000)}M years ago`;
    if (numeric >= 10000) return `${trimNumber(numeric / 1000)}K years ago`;
    if (numeric > 3000) return `${numeric} years ago`;
    return raw;
  }

  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly && dateOnly[2] === '01' && dateOnly[3] === '01') return dateOnly[1];
  if (/^\d{4}-\d{2}$/.test(raw) || /^\d{4}$/.test(raw)) return raw;

  return raw;
}

function trimNumber(value) {
  return Number(value.toFixed(1)).toString();
}

function TimelineView({ data }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/25 p-4">
      <div className="relative space-y-4 before:absolute before:left-3 before:top-2 before:h-[calc(100%-1rem)] before:w-px before:bg-acid/30">
        {data.map((item, index) => (
          <div key={`${item.label}-${index}`} className="relative min-w-0 pl-9">
            <span className="absolute left-0 top-1 grid h-6 w-6 place-items-center rounded-full border border-acid/50 bg-ink text-[10px] font-black text-acid">{index + 1}</span>
            <div className="rounded-md bg-white/[0.04] p-3">
              <div className="flex flex-wrap items-center gap-2">
                {item.date ? <span className="rounded-full bg-acid px-2.5 py-1 text-xs font-black text-ink">{formatTimelineDate(item.date)}</span> : null}
                {item.group ? <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs uppercase text-white/50">{item.group}</span> : null}
              </div>
              <p className="mt-3 break-words font-black text-white">{item.label}</p>
              {item.note ? <p className="mt-2 break-words text-sm leading-6 text-white/62">{item.note}</p> : null}
              {item.source ? <p className="mt-2 text-xs text-white/42">Source: {item.source}</p> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScorecardView({ data, unit }) {
  const values = data.map((item) => Number(item.value)).filter(Number.isFinite);
  const maxValue = Math.max(100, ...values);

  return (
    <div className="grid gap-3">
      {data.map((item, index) => {
        const value = Number(item.value) || 0;
        const width = `${Math.max(4, Math.min(100, (value / maxValue) * 100))}%`;
        return (
          <div key={`${item.label}-${index}`} className="rounded-md border border-white/10 bg-black/25 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words font-black text-white">{item.label}</p>
                {item.note ? <p className="mt-1 break-words text-sm leading-6 text-white/58">{item.note}</p> : null}
              </div>
              <span className="shrink-0 rounded-full bg-acid px-3 py-1 text-sm font-black text-ink">
                {formatValueWithUnit(value, unit)}
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-acid" style={{ width }} />
            </div>
            {item.source ? <p className="mt-2 text-xs text-white/42">Source: {item.source}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

function MetricsView({ data, unit }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {data.map((item, index) => (
        <div key={`${item.label}-${index}`} className="rounded-md border border-white/10 bg-black/25 p-4">
          <p className="text-xs font-bold uppercase text-white/45">{item.group || item.source || 'Metric'}</p>
          <p className="mt-3 break-words text-sm font-semibold leading-6 text-white">{item.label}</p>
          <p className="mt-3 break-words text-4xl font-black leading-none text-acid">
            {formatValueWithUnit(item.value, unit, { compact: true })}
          </p>
          {item.note ? <p className="mt-3 break-words text-sm leading-6 text-white/58">{item.note}</p> : null}
          {item.date || item.source ? <p className="mt-3 text-xs text-white/40">{[item.date, item.source].filter(Boolean).join(' / ')}</p> : null}
        </div>
      ))}
    </div>
  );
}

function ComparisonView({ data, unit }) {
  return (
    <div className="grid gap-3">
      {data.map((item, index) => (
        <div key={`${item.label}-${index}`} className="rounded-md border border-white/10 bg-black/25 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="break-words font-black text-white">{item.label}</p>
              {item.group ? <p className="mt-1 text-xs uppercase text-white/45">{item.group}</p> : null}
              {item.note ? <p className="mt-2 break-words text-sm leading-6 text-white/60">{item.note}</p> : null}
            </div>
            <span className="shrink-0 rounded-full bg-acid px-3 py-1 text-sm font-black text-ink">
              {formatValueWithUnit(item.value, unit, { compact: true })}
            </span>
          </div>
          {item.source ? <p className="mt-3 text-xs text-white/42">Source: {item.source}</p> : null}
        </div>
      ))}
    </div>
  );
}

function RankedBarView({ data, unit }) {
  const sorted = [...data].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));
  const maxValue = Math.max(...sorted.map((item) => Number(item.value)).filter(Number.isFinite), 1);

  return (
    <div className="grid gap-3">
      {sorted.map((item, index) => {
        const value = Number(item.value) || 0;
        const width = `${Math.max(6, Math.min(100, (value / maxValue) * 100))}%`;
        return (
          <div key={`${item.label}-${index}`} className="rounded-md border border-white/10 bg-black/25 p-4">
            <div className="flex items-start gap-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-acid/40 text-xs font-black text-acid">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <p className="break-words font-black text-white">{item.label}</p>
                  <span className="shrink-0 font-black text-acid">{formatValueWithUnit(value, unit, { compact: true })}</span>
                </div>
                <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-acid" style={{ width }} />
                </div>
                {item.note ? <p className="mt-3 break-words text-sm leading-6 text-white/58">{item.note}</p> : null}
                {item.source ? <p className="mt-2 text-xs text-white/42">Source: {item.source}</p> : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DeltaView({ data, unit }) {
  const usable = data.filter((item) => Number.isFinite(Number(item.value)));
  const first = usable[0] || data[0] || {};
  const last = usable[usable.length - 1] || data[data.length - 1] || first;
  const firstValue = Number(first.value) || 0;
  const lastValue = Number(last.value) || 0;
  const delta = lastValue - firstValue;
  const percent = firstValue ? (delta / Math.abs(firstValue)) * 100 : null;

  return (
    <div className="rounded-md border border-white/10 bg-black/25 p-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <DeltaPoint item={first} label="From" value={firstValue} unit={unit} />
        <div className="rounded-md border border-acid/25 bg-acid/10 p-4 text-center">
          <p className="text-xs font-bold uppercase text-white/45">Change</p>
          <p className={`mt-2 text-3xl font-black ${delta >= 0 ? 'text-acid' : 'text-red-500'}`}>
            {delta >= 0 ? '+' : ''}{formatValueWithUnit(delta, unit, { compact: true })}
          </p>
          {percent !== null ? <p className="mt-1 text-sm text-white/55">{percent >= 0 ? '+' : ''}{trimNumber(percent)}%</p> : null}
        </div>
        <DeltaPoint item={last} label="To" value={lastValue} unit={unit} />
      </div>
      {data.length > 2 ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {data.slice(1, -1).map((item, index) => (
            <p key={`${item.label}-${index}`} className="rounded-md bg-white/[0.04] p-3 text-xs text-white/55">
              <span className="font-bold text-white/75">{item.label}</span> / {formatValueWithUnit(item.value, unit, { compact: true })}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DeltaPoint({ item, label, value, unit }) {
  return (
    <div className="rounded-md bg-white/[0.04] p-4">
      <p className="text-xs font-bold uppercase text-white/45">{label}</p>
      <p className="mt-2 break-words font-black text-white">{item.label}</p>
      <p className="mt-3 text-3xl font-black text-acid">{formatValueWithUnit(value, unit, { compact: true })}</p>
      {item.note ? <p className="mt-3 break-words text-sm leading-6 text-white/58">{item.note}</p> : null}
      {item.source ? <p className="mt-2 text-xs text-white/42">Source: {item.source}</p> : null}
    </div>
  );
}

function FactTableView({ data, unit }) {
  return (
    <div className="overflow-hidden rounded-md border border-white/10 bg-black/25">
      <div className="hidden grid-cols-[1.2fr_0.6fr_1.4fr_0.8fr] gap-3 border-b border-white/10 bg-white/[0.04] px-4 py-3 text-xs font-black uppercase text-white/45 sm:grid">
        <span>Item</span>
        <span>Value</span>
        <span>Context</span>
        <span>Source</span>
      </div>
      <div className="divide-y divide-white/10">
        {data.map((item, index) => (
          <div key={`${item.label}-${index}`} className="grid gap-2 p-4 text-sm sm:grid-cols-[1.2fr_0.6fr_1.4fr_0.8fr] sm:gap-3">
            <p className="break-words font-black text-white">{item.label}</p>
            <p className="font-bold text-acid">{Number.isFinite(Number(item.value)) ? formatValueWithUnit(item.value, unit, { compact: true }) : 'Context'}</p>
            <p className="break-words leading-6 text-white/60">{item.note || item.group || 'Included for context.'}</p>
            <p className="break-words text-xs text-white/42">{[item.date, item.source].filter(Boolean).join(' / ') || 'Listed source'}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function EvidenceMatrixView({ data, unit }) {
  return (
    <div className="grid gap-3">
      {data.map((item, index) => {
        const position = item.group || 'Evidence';
        const value = Number(item.value);
        const tone = /contradict|against|weak|false/i.test(position) ? 'bg-red-600' : /uncertain|mixed|limit/i.test(position) ? 'bg-white/20' : 'bg-acid text-ink';
        return (
          <div key={`${item.label}-${index}`} className="rounded-md border border-white/10 bg-black/25 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${tone}`}>{position}</span>
                  {Number.isFinite(value) ? <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black text-white/70">{formatValueWithUnit(value, unit || 'score')}</span> : null}
                </div>
                <p className="mt-3 break-words font-black text-white">{item.label}</p>
                {item.note ? <p className="mt-2 break-words text-sm leading-6 text-white/60">{item.note}</p> : null}
              </div>
              {item.source ? <p className="shrink-0 text-xs text-white/42 sm:max-w-44">Source: {item.source}</p> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatValueWithUnit(value, unit = '', options = {}) {
  const unitLabel = String(unit || '').trim();
  const normalizedUnit = unitLabel.toLowerCase();
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  if (isDollarUnit(normalizedUnit)) return formatCurrency(numeric, unitLabel, options);
  if (isPercentUnit(normalizedUnit)) return `${formatMetricValue(numeric, options)}%`;
  if (!unitLabel || normalizedUnit === 'none') return formatMetricValue(numeric, options);
  return `${formatMetricValue(numeric, options)} ${unitLabel}`;
}

function formatMetricValue(value, options = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  if (options.compact) {
    if (Math.abs(numeric) >= 1000000000) return `${trimNumber(numeric / 1000000000)}B`;
    if (Math.abs(numeric) >= 1000000) return `${trimNumber(numeric / 1000000)}M`;
    if (Math.abs(numeric) >= 1000) return `${trimNumber(numeric / 1000)}K`;
  }
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: Number.isInteger(numeric) ? 0 : 2
  }).format(numeric);
}

function formatCurrency(value, unit, options = {}) {
  const normalizedUnit = unit.toLowerCase();
  const multiplier = normalizedUnit.includes('billion') ? 1000000000 : normalizedUnit.includes('million') ? 1000000 : 1;
  const amount = value * multiplier;
  if (options.compact || Math.abs(amount) >= 1000000) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: 1
    }).format(amount);
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2
  }).format(amount);
}

function isDollarUnit(unit) {
  return /\b(dollars?|usd|u\.s\. dollars?)\b/.test(unit);
}

function isPercentUnit(unit) {
  return /\b(percent|percentage|%)\b/.test(unit);
}

function normalizeChartType(type, data = []) {
  const normalized = String(type || 'bar').toLowerCase().replace(/[\s-]+/g, '_');
  if ((normalized === 'line' || normalized === 'area') && data.length <= 2) return 'delta';
  if (normalized === 'bar' && data.length === 1) return 'metrics';
  if (normalized === 'timeline' && data.length <= 1) return 'fact_table';
  return normalized;
}

function chartTypeLabel(type) {
  return type.replaceAll('_', ' ');
}

export default function ChartRenderer({ charts = [], fallbackData = [] }) {
  const normalizedCharts = charts.length ? charts : [{
    title: 'Evidence Coverage',
    type: 'bar',
    question: 'How much evidence is available in this article?',
    takeaway: 'This fallback chart summarizes article evidence counts.',
    units: 'count',
    sourceNote: 'Generated from available article claims, charts, and sources.',
    limitation: 'This is a structural count, not an independent evidence assessment.',
    note: 'Fallback visualization based on available article evidence counts.',
    data: fallbackData
  }];

  return (
    <section className="space-y-4">
      {normalizedCharts.map((chart, index) => {
        const data = Array.isArray(chart.data) ? chart.data : [];
        const valueKeys = getValueKeys(data);
        const valueKey = valueKeys[0] || 'value';
        const type = normalizeChartType(chart.type, data);
        const unit = chart.units || '';
        const xKey = data.some((item) => item.date) ? 'date' : 'label';
        const isTimeline = type === 'timeline';
        const isScorecard = type === 'scorecard';
        const isMetrics = type === 'metrics';
        const isComparison = type === 'comparison';
        const isRankedBar = type === 'ranked_bar';
        const isDelta = type === 'delta';
        const isFactTable = type === 'fact_table';
        const isEvidenceMatrix = type === 'evidence_matrix';
        const isCustomLayout = isTimeline || isScorecard || isMetrics || isComparison || isRankedBar || isDelta || isFactTable || isEvidenceMatrix;

        return (
          <article
            key={`${chart.title}-${index}`}
            className="glass-panel min-w-0 overflow-hidden rounded-lg p-4 sm:p-5"
            onClick={() => trackEvent('chart_interaction', {
              chart_title: chart.title,
              chart_type: type,
              chart_index: index + 1
            })}
          >
            <div className="mb-4 flex flex-col gap-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  {chart.question ? <p className="text-xs font-bold uppercase text-acid">{chart.question}</p> : null}
                  <h2 className="mt-1 break-words text-xl font-black">{chart.title}</h2>
                </div>
                <span className="w-fit rounded-full bg-white/10 px-3 py-1 text-xs uppercase text-white/50">{chartTypeLabel(type)}</span>
              </div>
              {chart.takeaway ? (
                <p className="rounded-md border border-acid/20 bg-acid/10 p-3 text-sm font-semibold leading-6 text-white">{chart.takeaway}</p>
              ) : null}
            </div>
            {isTimeline ? (
              <TimelineView data={data} />
            ) : isScorecard ? (
              <ScorecardView data={data} unit={unit} />
            ) : isMetrics ? (
              <MetricsView data={data} unit={unit} />
            ) : isComparison ? (
              <ComparisonView data={data} unit={unit} />
            ) : isRankedBar ? (
              <RankedBarView data={data} unit={unit} />
            ) : isDelta ? (
              <DeltaView data={data} unit={unit} />
            ) : isFactTable ? (
              <FactTableView data={data} unit={unit} />
            ) : isEvidenceMatrix ? (
              <EvidenceMatrixView data={data} unit={unit} />
            ) : (
              <div className="h-72 min-w-0 overflow-hidden rounded-md border border-white/10 bg-black/25 p-2 sm:p-3">
                <ResponsiveContainer width="100%" height="100%">
                  {type === 'line' ? (
                    <LineChart data={data}>
                      <CartesianGrid stroke="rgba(255,255,255,0.08)" />
                      <XAxis dataKey={xKey} stroke="rgba(255,255,255,0.45)" />
                      <YAxis tickFormatter={(value) => formatValueWithUnit(value, unit, { compact: true })} stroke="rgba(255,255,255,0.45)" />
                      <Tooltip content={<ChartTooltip unit={unit} />} />
                      <Line type="monotone" dataKey={valueKey} stroke="#e6ff3f" strokeWidth={3} dot={false} />
                    </LineChart>
                  ) : type === 'area' ? (
                    <AreaChart data={data}>
                      <CartesianGrid stroke="rgba(255,255,255,0.08)" />
                      <XAxis dataKey={xKey} stroke="rgba(255,255,255,0.45)" />
                      <YAxis tickFormatter={(value) => formatValueWithUnit(value, unit, { compact: true })} stroke="rgba(255,255,255,0.45)" />
                      <Tooltip content={<ChartTooltip unit={unit} />} />
                      <Area type="monotone" dataKey={valueKey} stroke="#e6ff3f" fill="#657400" fillOpacity={0.55} />
                    </AreaChart>
                  ) : type === 'pie' ? (
                    <PieChart>
                      <Tooltip content={<ChartTooltip unit={unit} />} />
                      <Pie data={data} dataKey={valueKey} nameKey="label" innerRadius={55} outerRadius={90}>
                        {data.map((_entry, cellIndex) => <Cell key={cellIndex} fill={colors[cellIndex % colors.length]} />)}
                      </Pie>
                    </PieChart>
                  ) : (
                    <BarChart data={data}>
                      <CartesianGrid stroke="rgba(255,255,255,0.08)" />
                      <XAxis dataKey={xKey} stroke="rgba(255,255,255,0.45)" />
                      <YAxis tickFormatter={(value) => formatValueWithUnit(value, unit, { compact: true })} stroke="rgba(255,255,255,0.45)" />
                      <Tooltip content={<ChartTooltip unit={unit} />} />
                      <Bar dataKey={valueKey} fill="#e6ff3f" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>
            )}
            {data.length && !isCustomLayout ? (
              <div className="mt-4 grid gap-2">
                {data.slice(0, 4).map((item, itemIndex) => (
                  <div key={`${item.label}-${itemIndex}`} className="rounded-md bg-white/[0.04] p-3 text-xs leading-5 text-white/55">
                    <span className="font-bold text-white/80">{item.label}</span>
                    <span> / {formatValueWithUnit(item[valueKey], unit)}</span>
                    {item.note ? <span> - {item.note}</span> : null}
                  </div>
                ))}
              </div>
            ) : null}
            {(unit || chart.sourceNote || chart.limitation || chart.note) ? (
              <div className="mt-4 border-t border-white/10 pt-3 text-xs leading-5 text-white/38">
                <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                  {unit ? <p><span className="font-bold uppercase text-white/50">Units:</span> {unit}</p> : null}
                  {chart.sourceNote ? <p><span className="font-bold uppercase text-white/50">Source:</span> {chart.sourceNote}</p> : null}
                  {chart.limitation ? <p className="sm:col-span-2"><span className="font-bold uppercase text-white/50">Limit:</span> {chart.limitation}</p> : null}
                </div>
                {chart.note ? <p className="mt-2 text-white/34">{chart.note}</p> : null}
              </div>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
