import type { BacktestResult, Bar } from '../lib/api'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Legend,
} from 'recharts'

interface Props { result: BacktestResult }

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

function fmt(n: number, d = 2) { return n.toFixed(d) }

function fmtJpy(n: number) {
  return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }).format(n)
}

const exitReasonLabel: Record<string, string> = {
  signal: 'シグナル', stop_loss: '損切り', take_profit: '利確', end_of_data: 'データ終端',
}

export default function ResultsDashboard({ result }: Props) {
  const { summary, equity_curve, trades, price_data, indicators } = result

  const priceWithIndicators = price_data.map((bar: Bar, i: number) => {
    const row: Record<string, number | string | null> = {
      date: bar.date, close: bar.close, signal: bar.signal ?? null,
    }
    Object.entries(indicators).forEach(([key, vals]) => { row[key] = vals[i] ?? null })
    return row
  })

  const indicatorKeys = Object.keys(indicators).filter(k => !k.includes('histogram'))
  const maColors = ['#f59e0b', '#60a5fa', '#34d399', '#f472b6', '#a78bfa']

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
          label="最終残高"
          value={fmtJpy(summary.final_capital)}
          sub={`初期 ${fmtJpy(summary.initial_capital)}`}
          positive={summary.final_capital >= summary.initial_capital}
        />
        <StatCard
          label="純損益"
          value={fmtJpy(summary.final_capital - summary.initial_capital)}
          positive={summary.final_capital >= summary.initial_capital}
        />
      </div>

      {/* Meta info */}
      <div className="flex flex-wrap gap-3 text-xs text-gray-500">
        <span>USD/JPY: <span className="text-gray-300">{summary.usd_jpy}</span></span>
        <span>手数料合計: <span className="text-gray-300">{fmtJpy(summary.total_commission)}</span></span>
        <span>手数料率: <span className="text-gray-300">{summary.commission_pct}%</span></span>
      </div>

      {/* Equity curve */}
      <div className="bg-gray-800 rounded-xl p-4">
        <h3 className="text-sm font-medium text-gray-300 mb-4">資産推移（円）</h3>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={equity_curve}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false}
              interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false}
              tickFormatter={v => fmtJpy(v)} width={90} />
            <Tooltip
              contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
              labelStyle={{ color: '#9ca3af', fontSize: 12 }}
              formatter={(v: number) => [fmtJpy(v), '残高']}
            />
            <Line type="monotone" dataKey="equity" stroke="#f59e0b" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Price chart */}
      <div className="bg-gray-800 rounded-xl p-4">
        <h3 className="text-sm font-medium text-gray-300 mb-4">ゴールド価格 + 指標（USD/oz）</h3>
        <ResponsiveContainer width="100%" height={220}>
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
            <Line type="monotone" dataKey="close" stroke="#e5e7eb" dot={false} strokeWidth={1.5} name="Price (USD)" />
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
                  <th className="pb-2 pr-3">方向</th>
                  <th className="pb-2 pr-3">エントリー日</th>
                  <th className="pb-2 pr-3 hidden sm:table-cell">エグジット日</th>
                  <th className="pb-2 pr-3 text-right hidden md:table-cell">エントリー($)</th>
                  <th className="pb-2 pr-3 text-right hidden md:table-cell">エグジット($)</th>
                  <th className="pb-2 pr-3 text-right hidden sm:table-cell">ロット</th>
                  <th className="pb-2 pr-3 text-right">損益(¥)</th>
                  <th className="pb-2 pr-3 text-right">損益%</th>
                  <th className="pb-2 text-right hidden sm:table-cell">理由</th>
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
                    <td className="py-1.5 pr-3 text-gray-300 text-xs">{t.entry_date}</td>
                    <td className="py-1.5 pr-3 text-gray-300 text-xs hidden sm:table-cell">{t.exit_date}</td>
                    <td className="py-1.5 pr-3 text-right hidden md:table-cell text-gray-400">${fmt(t.entry_price)}</td>
                    <td className="py-1.5 pr-3 text-right hidden md:table-cell text-gray-400">${fmt(t.exit_price)}</td>
                    <td className="py-1.5 pr-3 text-right hidden sm:table-cell text-gray-300">{t.lots.toFixed(2)}</td>
                    <td className={`py-1.5 pr-3 text-right font-medium ${t.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {t.pnl >= 0 ? '+' : ''}{fmtJpy(t.pnl)}
                    </td>
                    <td className={`py-1.5 pr-3 text-right ${t.pnl_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {t.pnl_pct >= 0 ? '+' : ''}{fmt(t.pnl_pct)}%
                    </td>
                    <td className="py-1.5 text-right hidden sm:table-cell">
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
