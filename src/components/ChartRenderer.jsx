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

export default function ChartRenderer({ charts = [], fallbackData = [] }) {
  const normalizedCharts = charts.length ? charts : [{
    title: 'Evidence Coverage',
    type: 'bar',
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

        return (
          <article key={`${chart.title}-${index}`} className="glass-panel min-w-0 overflow-hidden rounded-lg p-4 sm:p-5">
            <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-black">{chart.title}</h2>
                <p className="text-sm text-white/50">{chart.note}</p>
              </div>
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs uppercase text-white/50">{type}</span>
            </div>
            <div className="h-72 min-w-0 overflow-hidden rounded-md border border-white/10 bg-black/25 p-2 sm:p-3">
              <ResponsiveContainer width="100%" height="100%">
                {type === 'line' ? (
                  <LineChart data={data}>
                    <CartesianGrid stroke="rgba(255,255,255,0.08)" />
                    <XAxis dataKey="label" stroke="rgba(255,255,255,0.45)" />
                    <YAxis stroke="rgba(255,255,255,0.45)" />
                    <Tooltip contentStyle={{ background: '#151714', border: '1px solid rgba(255,255,255,.12)' }} />
                    <Line type="monotone" dataKey={valueKey} stroke="#e6ff3f" strokeWidth={3} dot={false} />
                  </LineChart>
                ) : type === 'area' ? (
                  <AreaChart data={data}>
                    <CartesianGrid stroke="rgba(255,255,255,0.08)" />
                    <XAxis dataKey="label" stroke="rgba(255,255,255,0.45)" />
                    <YAxis stroke="rgba(255,255,255,0.45)" />
                    <Tooltip contentStyle={{ background: '#151714', border: '1px solid rgba(255,255,255,.12)' }} />
                    <Area type="monotone" dataKey={valueKey} stroke="#e6ff3f" fill="#657400" fillOpacity={0.55} />
                  </AreaChart>
                ) : type === 'pie' ? (
                  <PieChart>
                    <Tooltip contentStyle={{ background: '#151714', border: '1px solid rgba(255,255,255,.12)' }} />
                    <Pie data={data} dataKey={valueKey} nameKey="label" innerRadius={55} outerRadius={90}>
                      {data.map((_entry, cellIndex) => <Cell key={cellIndex} fill={colors[cellIndex % colors.length]} />)}
                    </Pie>
                  </PieChart>
                ) : (
                  <BarChart data={data}>
                    <CartesianGrid stroke="rgba(255,255,255,0.08)" />
                    <XAxis dataKey="label" stroke="rgba(255,255,255,0.45)" />
                    <YAxis stroke="rgba(255,255,255,0.45)" />
                    <Tooltip contentStyle={{ background: '#151714', border: '1px solid rgba(255,255,255,.12)' }} />
                    <Bar dataKey={valueKey} fill="#e6ff3f" radius={[6, 6, 0, 0]} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </article>
        );
      })}
    </section>
  );
}
