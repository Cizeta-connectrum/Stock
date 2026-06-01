import type { BacktestResult, Bar } from '../lib/api'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Legend,
} from 'recharts'

interface Props {
  result: BacktestResult
}

function StatCard({ label, value, sub, positive }: { label: string; value: string; sub?: string; positive?: boolean }) {
  const color = positive === undefined ? 'text-white' : positive ? 'text-green-400' : 'text-red-400'
  return (
    <div className="bg-gray-800 rounded-xl p-4">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  )
}

function fmt(n: number, decimals = 2) {
  return n.toFixed(decimals)
}

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

export default function ResultsDashboard({ result }: Props) {
  const { summary, equity_curve, trades, price_data, indicators } = result

  // Merge indicators into price data for chart
  const priceWithIndicators = price_data.map((bar: Bar, i: number) => {
    const row: Record<string, number | string | null> = {
      date: bar.date,
      close: bar.close,
      signal: bar.signal ?? null,
    }
    Object.entries(indicators).forEach(([key, vals]) => {
      row[key] = vals[i] ?? null
    })
    return row
  })

  const indicatorKeys = Object.keys(indicators).filter(k => !k.includes('histogram'))
  const maColors = ['#f59e0b', '#60a5fa', '#34d399', '#f472b6', '#a78bfa']

  const exitReasonLabel: Record<string, string> = {
    signal: 'シグナル',
    stop_loss: '損切り',
    take_profit: '利確',
    end_of_data: 'データ終端',
  }

  return (
    <div className="space-y-6">
      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="トータルリターン"
          value={`${summary.total_return_pct > 0 ? '+' : ''}${fmt(summary.total_return_pct)}%`}
          sub={`年率 ${fmt(summary.annualised_return_pct)}%`}
          positive={summary.total_return_pct >= 0}
        />
        <StatCard
          label="最大ドローダウン"
          value={`${fmt(summary.max_drawdown_pct)}%`}
          positive={false}
        />
        <StatCard
          label="シャープレシオ"
          value={fmt(summary.sharpe_ratio, 3)}
          positive={summary.sharpe_ratio >= 1}
        />
        <StatCard
          label="勝率"
          value={`${fmt(summary.win_rate_pct)}%`}
          sub={`${summary.num_winning}勝 / ${summary.num_losing}敗`}
          positive={summary.win_rate_pct >= 50}
        />
        <StatCard
          label="取引回数"
          value={`${summary.num_trades}回`}
          sub={`平均 ${fmt(summary.avg_trade_duration_days)}日`}
        />
        <StatCard
          label="プロフィットファクター"
          value={summary.profit_factor != null ? fmt(summary.profit_factor, 2) : '∞'}
          positive={summary.profit_factor == null || summary.profit_factor >= 1}
        />
        <StatCard
          label="最終資産"
          value={fmtCurrency(summary.final_capital)}
          sub={`初期 ${fmtCurrency(summary.initial_capital)}`}
          positive={summary.final_capital >= summary.initial_capital}
        />
        <StatCard
          label="純利益"
          value={fmtCurrency(summary.final_capital - summary.initial_capital)}
          positive={summary.final_capital >= summary.initial_capital}
        />
      </div>

      {/* Equity curve */}
      <div className="bg-gray-800 rounded-xl p-4">
        <h3 className="text-sm font-medium text-gray-300 mb-4">資産推移</h3>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={equity_curve}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false}
              interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false}
              tickFormatter={v => fmtCurrency(v)} width={80} />
            <Tooltip
              contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
              labelStyle={{ color: '#9ca3af', fontSize: 12 }}
              formatter={(v: number) => [fmtCurrency(v), '資産']}
            />
            <Line type="monotone" dataKey="equity" stroke="#f59e0b" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Price chart with indicators and signals */}
      <div className="bg-gray-800 rounded-xl p-4">
        <h3 className="text-sm font-medium text-gray-300 mb-4">ゴールド価格 + 指標</h3>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={priceWithIndicators}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false}
              interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false}
              tickFormatter={v => `$${v}`} width={70} domain={['auto', 'auto']} />
            <Tooltip
              contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
              labelStyle={{ color: '#9ca3af', fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="close" stroke="#e5e7eb" dot={false} strokeWidth={1.5} name="Price" />
            {indicatorKeys.map((key, idx) => (
              <Line key={key} type="monotone" dataKey={key}
                stroke={maColors[idx % maColors.length]} dot={false} strokeWidth={1.5}
                strokeDasharray={idx > 0 ? '4 2' : undefined} name={key} connectNulls />
            ))}
            {priceWithIndicators.filter(d => d.signal === 'buy').map(d => (
              <ReferenceLine key={`buy-${d.date}`} x={d.date as string} stroke="#10b981" strokeWidth={1} strokeDasharray="2 4" />
            ))}
            {priceWithIndicators.filter(d => d.signal === 'sell').map(d => (
              <ReferenceLine key={`sell-${d.date}`} x={d.date as string} stroke="#ef4444" strokeWidth={1} strokeDasharray="2 4" />
            ))}
            {priceWithIndicators.filter(d => d.signal === 'short').map(d => (
              <ReferenceLine key={`short-${d.date}`} x={d.date as string} stroke="#f97316" strokeWidth={1} strokeDasharray="2 4" />
            ))}
            {priceWithIndicators.filter(d => d.signal === 'cover').map(d => (
              <ReferenceLine key={`cover-${d.date}`} x={d.date as string} stroke="#818cf8" strokeWidth={1} strokeDasharray="2 4" />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Trade history */}
      {trades.length > 0 && (
        <div className="bg-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-medium text-gray-300 mb-3">取引履歴 ({trades.length}件)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-700">
                  <th className="pb-2 pr-4">方向</th>
                  <th className="pb-2 pr-4">エントリー日</th>
                  <th className="pb-2 pr-4">エグジット日</th>
                  <th className="pb-2 pr-4 text-right">エントリー価格</th>
                  <th className="pb-2 pr-4 text-right">エグジット価格</th>
                  <th className="pb-2 pr-4 text-right">損益</th>
                  <th className="pb-2 pr-4 text-right">損益%</th>
                  <th className="pb-2 text-right">理由</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => (
                  <tr key={i} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                    <td className="py-1.5 pr-4">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${
                        t.side === 'short' ? 'bg-orange-900/50 text-orange-300' : 'bg-green-900/50 text-green-300'
                      }`}>
                        {t.side === 'short' ? 'S' : 'L'}
                      </span>
                    </td>
                    <td className="py-1.5 pr-4 text-gray-300">{t.entry_date}</td>
                    <td className="py-1.5 pr-4 text-gray-300">{t.exit_date}</td>
                    <td className="py-1.5 pr-4 text-right">${fmt(t.entry_price)}</td>
                    <td className="py-1.5 pr-4 text-right">${fmt(t.exit_price)}</td>
                    <td className={`py-1.5 pr-4 text-right ${t.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {t.pnl >= 0 ? '+' : ''}{fmtCurrency(t.pnl)}
                    </td>
                    <td className={`py-1.5 pr-4 text-right ${t.pnl_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {t.pnl_pct >= 0 ? '+' : ''}{fmt(t.pnl_pct)}%
                    </td>
                    <td className="py-1.5 text-right">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        t.exit_reason === 'stop_loss' ? 'bg-red-900/50 text-red-300' :
                        t.exit_reason === 'take_profit' ? 'bg-green-900/50 text-green-300' :
                        'bg-gray-700 text-gray-300'
                      }`}>
                        {exitReasonLabel[t.exit_reason] || t.exit_reason}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
