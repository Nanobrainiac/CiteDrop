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
          {entry.name || entry.dataKey}: {entry.value}{unit && unit !== 'none' ? ` ${unit}` : ''}
        </p>
      ))}
      {item.group ? <p className="mt-1 text-white/55">Group: {item.group}</p> : null}
      {item.source ? <p className="mt-1 text-white/55">Source: {item.source}</p> : null}
      {item.note ? <p className="mt-2 leading-5 text-white/65">{item.note}</p> : null}
    </div>
  );
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
        const type = chart.type || 'bar';
        const unit = chart.units || '';
        const xKey = data.some((item) => item.date) ? 'date' : 'label';

        return (
          <article key={`${chart.title}-${index}`} className="glass-panel min-w-0 overflow-hidden rounded-lg p-4 sm:p-5">
            <div className="mb-4 flex flex-col gap-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  {chart.question ? <p className="text-xs font-bold uppercase text-acid">{chart.question}</p> : null}
                  <h2 className="mt-1 break-words text-xl font-black">{chart.title}</h2>
                </div>
                <span className="w-fit rounded-full bg-white/10 px-3 py-1 text-xs uppercase text-white/50">{type}</span>
              </div>
              {chart.takeaway ? (
                <p className="rounded-md border border-acid/20 bg-acid/10 p-3 text-sm font-semibold leading-6 text-white">{chart.takeaway}</p>
              ) : null}
              <div className="grid gap-2 text-xs text-white/48 sm:grid-cols-2">
                {unit ? <p><span className="font-bold uppercase text-white/65">Units:</span> {unit}</p> : null}
                {chart.sourceNote ? <p><span className="font-bold uppercase text-white/65">Source:</span> {chart.sourceNote}</p> : null}
                {chart.limitation ? <p className="sm:col-span-2"><span className="font-bold uppercase text-white/65">Limit:</span> {chart.limitation}</p> : null}
              </div>
              {chart.note ? (
                <p className="text-sm leading-6 text-white/50">{chart.note}</p>
              ) : null}
            </div>
            <div className="h-72 min-w-0 overflow-hidden rounded-md border border-white/10 bg-black/25 p-2 sm:p-3">
              <ResponsiveContainer width="100%" height="100%">
                {type === 'line' ? (
                  <LineChart data={data}>
                    <CartesianGrid stroke="rgba(255,255,255,0.08)" />
                    <XAxis dataKey={xKey} stroke="rgba(255,255,255,0.45)" />
                    <YAxis stroke="rgba(255,255,255,0.45)" />
                    <Tooltip content={<ChartTooltip unit={unit} />} />
                    <Line type="monotone" dataKey={valueKey} stroke="#e6ff3f" strokeWidth={3} dot={false} />
                  </LineChart>
                ) : type === 'area' ? (
                  <AreaChart data={data}>
                    <CartesianGrid stroke="rgba(255,255,255,0.08)" />
                    <XAxis dataKey={xKey} stroke="rgba(255,255,255,0.45)" />
                    <YAxis stroke="rgba(255,255,255,0.45)" />
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
                    <YAxis stroke="rgba(255,255,255,0.45)" />
                    <Tooltip content={<ChartTooltip unit={unit} />} />
                    <Bar dataKey={valueKey} fill="#e6ff3f" radius={[6, 6, 0, 0]} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
            {data.length ? (
              <div className="mt-4 grid gap-2">
                {data.slice(0, 4).map((item, itemIndex) => (
                  <div key={`${item.label}-${itemIndex}`} className="rounded-md bg-white/[0.04] p-3 text-xs leading-5 text-white/55">
                    <span className="font-bold text-white/80">{item.label}</span>
                    <span> / {item[valueKey]}{unit && unit !== 'none' ? ` ${unit}` : ''}</span>
                    {item.note ? <span> - {item.note}</span> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
