import { useState } from 'react'
import type { OptimizeRequest, OptimizeResultRow } from '../lib/api'
import { runOptimize } from '../lib/api'

const PERIOD_OPTIONS = [
  { value: '3mo', label: '3ヶ月' },
  { value: '6mo', label: '6ヶ月' },
  { value: '1y',  label: '1年' },
  { value: '2y',  label: '2年' },
  { value: '5y',  label: '5年' },
]

const INTERVAL_OPTIONS = [
  { value: '5m',  label: '5分足' },
  { value: '15m', label: '15分足' },
  { value: '1h',  label: '1時間足' },
  { value: '1d',  label: '日足' },
  { value: '1wk', label: '週足' },
]

const INDICATOR_OPTIONS: { value: 'SMA' | 'RSI' | 'BB'; label: string; desc: string }[] = [
  { value: 'SMA', label: 'SMA クロス', desc: 'ゴールデン/デッドクロス (fast × slow の全組み合わせ)' },
  { value: 'RSI', label: 'RSI 逆張り', desc: '売られすぎで買い・買われすぎで売り' },
  { value: 'BB',  label: 'ボリンジャーバンド', desc: '下限バンドで買い・上限バンドで売り' },
]

function fmt(n: number, d = 2) { return n.toFixed(d) }
function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

export default function Optimizer() {
  const [indicator, setIndicator] = useState<'SMA' | 'RSI' | 'BB'>('SMA')
  const [period, setPeriod] = useState('1y')
  const [interval, setInterval] = useState('1d')
  const [capital, setCapital] = useState(10000)
  const [tradingMode, setTradingMode] = useState<'long_only' | 'always_in'>('long_only')
  const [stopLoss, setStopLoss] = useState(0)
  const [takeProfit, setTakeProfit] = useState(0)
  const [commission, setCommission] = useState(0.1)
  const [minTrades, setMinTrades] = useState(5)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<OptimizeResultRow[] | null>(null)
  const [elapsed, setElapsed] = useState<number | null>(null)

  async function handleRun() {
    setLoading(true)
    setError(null)
    setResults(null)
    const t0 = Date.now()
    const req: OptimizeRequest = {
      indicator,
      period,
      interval,
      initial_capital: capital,
      trading_mode: tradingMode,
      stop_loss_pct: stopLoss,
      take_profit_pct: takeProfit,
      commission_pct: commission,
      min_trades: minTrades,
      top_n: 20,
    }
    try {
      const res = await runOptimize(req)
      setResults(res.results)
      setElapsed(Date.now() - t0)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } }; message?: string })
        ?.response?.data?.detail || (e as { message?: string })?.message || 'エラーが発生しました'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const indicatorInfo = INDICATOR_OPTIONS.find(o => o.value === indicator)!

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* Settings panel */}
      <aside className="lg:w-80 flex-shrink-0">
        <div className="bg-gray-800 rounded-xl p-5 sticky top-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 inline-block"></span>
            最適化設定
          </h2>

          {/* Indicator */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">探索する指標</label>
            <div className="space-y-1">
              {INDICATOR_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setIndicator(opt.value)}
                  className={`w-full text-left px-3 py-2 rounded border text-sm transition-colors ${
                    indicator === opt.value
                      ? 'bg-amber-500 border-amber-500 text-black font-semibold'
                      : 'border-gray-600 text-gray-300 hover:border-amber-500'
                  }`}
                >
                  <div className="font-medium">{opt.label}</div>
                  <div className={`text-xs mt-0.5 ${indicator === opt.value ? 'text-black/70' : 'text-gray-500'}`}>
                    {opt.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Period / Interval */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-400 block mb-1">期間</label>
              <select value={period} onChange={e => setPeriod(e.target.value)}
                className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-sm">
                {PERIOD_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">インターバル</label>
              <select value={interval} onChange={e => setInterval(e.target.value)}
                className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-sm">
                {INTERVAL_OPTIONS.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
              </select>
            </div>
          </div>

          {/* Capital */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">初期資金 ($)</label>
            <input type="number" value={capital} onChange={e => setCapital(Number(e.target.value))}
              className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-sm" />
          </div>

          {/* Trading mode */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">取引方向</label>
            <div className="flex gap-2">
              {(['long_only', 'always_in'] as const).map(m => (
                <button key={m} onClick={() => setTradingMode(m)}
                  className={`flex-1 text-xs py-1.5 rounded border transition-colors ${
                    tradingMode === m
                      ? 'bg-amber-500 border-amber-500 text-black font-semibold'
                      : 'border-gray-600 text-gray-300 hover:border-amber-500'
                  }`}>
                  {m === 'long_only' ? 'ロングのみ' : 'L&S'}
                </button>
              ))}
            </div>
          </div>

          {/* SL / TP / Commission / MinTrades */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-400 block mb-1">損切り (%)</label>
              <input type="number" min="0" step="0.1" value={stopLoss} onChange={e => setStopLoss(Number(e.target.value))}
                className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">利確 (%)</label>
              <input type="number" min="0" step="0.1" value={takeProfit} onChange={e => setTakeProfit(Number(e.target.value))}
                className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">手数料 (%)</label>
              <input type="number" min="0" step="0.01" value={commission} onChange={e => setCommission(Number(e.target.value))}
                className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">最低取引数</label>
              <input type="number" min="1" value={minTrades} onChange={e => setMinTrades(Number(e.target.value))}
                className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-sm" />
            </div>
          </div>

          <button
            onClick={handleRun}
            disabled={loading}
            className="w-full py-3 rounded-lg font-semibold bg-amber-500 hover:bg-amber-400 text-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? '最適化実行中...' : '最適化を実行'}
          </button>

          {loading && (
            <p className="text-xs text-gray-500 text-center">
              {indicatorInfo.label}の全パターンをテスト中...
            </p>
          )}
        </div>
      </aside>

      {/* Results */}
      <main className="flex-1 min-w-0">
        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded-xl p-4 text-red-300 text-sm">{error}</div>
        )}

        {loading && (
          <div className="flex items-center justify-center h-64">
            <div className="text-center space-y-3">
              <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="text-gray-400 text-sm">パラメータを探索中...</p>
            </div>
          </div>
        )}

        {!loading && !results && !error && (
          <div className="flex flex-col items-center justify-center h-64 text-center space-y-2">
            <div className="text-5xl text-amber-500/30">&#9651;</div>
            <p className="text-gray-400">左で指標と条件を設定して「最適化を実行」してください</p>
            <p className="text-xs text-gray-500">全パラメータの組み合わせをテストし、PF上位をランキング表示します</p>
          </div>
        )}

        {!loading && results && (
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-100">
                  最適化結果 — {indicatorInfo.label}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {results.length}件のパターンをランキング（プロフィットファクター順）
                  {elapsed != null && ` · ${(elapsed / 1000).toFixed(1)}秒`}
                </p>
              </div>
            </div>

            {results.length === 0 ? (
              <div className="bg-gray-800 rounded-xl p-8 text-center text-gray-400">
                有効な結果がありません。最低取引数を下げるか期間を変えてください。
              </div>
            ) : (
              <div className="bg-gray-800 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-400 bg-gray-700/50 border-b border-gray-700">
                        <th className="px-4 py-3">#</th>
                        <th className="px-4 py-3">パラメータ</th>
                        <th className="px-4 py-3 text-right">PF</th>
                        <th className="px-4 py-3 text-right">リターン</th>
                        <th className="px-4 py-3 text-right">年率</th>
                        <th className="px-4 py-3 text-right">シャープ</th>
                        <th className="px-4 py-3 text-right">DD</th>
                        <th className="px-4 py-3 text-right">勝率</th>
                        <th className="px-4 py-3 text-right">取引数</th>
                        <th className="px-4 py-3 text-right">最終資産</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((r, i) => {
                        const isTop3 = i < 3
                        return (
                          <tr key={i}
                            className={`border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors ${
                              isTop3 ? 'bg-amber-900/10' : ''
                            }`}
                          >
                            <td className="px-4 py-2.5">
                              <span className={`font-bold ${
                                i === 0 ? 'text-amber-400' :
                                i === 1 ? 'text-gray-300' :
                                i === 2 ? 'text-orange-400' :
                                'text-gray-500'
                              }`}>
                                {i + 1}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 font-medium text-gray-200 whitespace-nowrap">
                              {r.label}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <span className={`font-semibold ${
                                r.profit_factor == null || r.profit_factor >= 1.5
                                  ? 'text-green-400'
                                  : r.profit_factor >= 1.0
                                  ? 'text-yellow-400'
                                  : 'text-red-400'
                              }`}>
                                {r.profit_factor != null ? fmt(r.profit_factor) : '∞'}
                              </span>
                            </td>
                            <td className={`px-4 py-2.5 text-right ${r.total_return_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {r.total_return_pct >= 0 ? '+' : ''}{fmt(r.total_return_pct)}%
                            </td>
                            <td className={`px-4 py-2.5 text-right ${r.annualised_return_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {r.annualised_return_pct >= 0 ? '+' : ''}{fmt(r.annualised_return_pct)}%
                            </td>
                            <td className={`px-4 py-2.5 text-right ${r.sharpe_ratio >= 1 ? 'text-green-400' : r.sharpe_ratio >= 0 ? 'text-yellow-400' : 'text-red-400'}`}>
                              {fmt(r.sharpe_ratio, 3)}
                            </td>
                            <td className="px-4 py-2.5 text-right text-red-400">
                              {fmt(r.max_drawdown_pct)}%
                            </td>
                            <td className={`px-4 py-2.5 text-right ${r.win_rate_pct >= 50 ? 'text-green-400' : 'text-yellow-400'}`}>
                              {fmt(r.win_rate_pct)}%
                            </td>
                            <td className="px-4 py-2.5 text-right text-gray-300">
                              {r.num_trades}
                            </td>
                            <td className={`px-4 py-2.5 text-right ${r.final_capital >= 10000 ? 'text-green-400' : 'text-red-400'}`}>
                              {fmtCurrency(r.final_capital)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <p className="text-xs text-gray-500">
              ⚠ 過去データで最適化したパラメータは過学習（カーブフィッティング）のリスクがあります。必ず別期間で検証してください。
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
