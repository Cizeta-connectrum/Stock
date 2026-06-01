import { useState, useEffect, useCallback } from 'react'
import type { OptimizeRequest, OptimizeResultRow, OptimizeRun, StrategyConfig, ConditionSpec } from '../lib/api'
import { runOptimize, fetchOptimizeHistory, deleteOptimizeRun } from '../lib/api'

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
  { value: 'SMA', label: 'SMA クロス',        desc: 'fast × slow 全ペア' },
  { value: 'RSI', label: 'RSI 逆張り',        desc: '閾値の全組み合わせ' },
  { value: 'BB',  label: 'ボリンジャーバンド', desc: 'period × σ 全組み合わせ' },
]

interface RunConfig {
  indicator: string
  period: string
  interval: string
  trading_mode: 'long_only' | 'always_in'
  commission: number
  stop_loss: number
  take_profit: number
}

function buildStrategyConfig(row: OptimizeResultRow, run: RunConfig, capital: number): StrategyConfig {
  const p = row.params
  let entry: ConditionSpec, exit_: ConditionSpec

  if (run.indicator === 'SMA') {
    entry = { indicator: 'SMA', params: { period: p.fast }, condition: 'crosses_above', target: { indicator: 'SMA', params: { period: p.slow } } }
    exit_ = { indicator: 'SMA', params: { period: p.fast }, condition: 'crosses_below', target: { indicator: 'SMA', params: { period: p.slow } } }
  } else if (run.indicator === 'RSI') {
    entry = { indicator: 'RSI', params: { period: p.period }, condition: 'crosses_below', target: { value: p.oversold } }
    exit_ = { indicator: 'RSI', params: { period: p.period }, condition: 'crosses_above', target: { value: p.overbought } }
  } else {
    // BB
    entry = { indicator: 'PRICE', params: {}, condition: 'crosses_below', target: { indicator: 'BB', params: { period: p.period, std_dev: p.std_dev }, sub: 'lower' } }
    exit_ = { indicator: 'PRICE', params: {}, condition: 'crosses_above', target: { indicator: 'BB', params: { period: p.period, std_dev: p.std_dev }, sub: 'upper' } }
  }

  return {
    period: run.period,
    interval: run.interval,
    initial_capital: capital,
    entry_conditions: [entry],
    entry_logic: 'AND',
    exit_conditions: [exit_],
    exit_logic: 'AND',
    stop_loss_pct: run.stop_loss,
    take_profit_pct: run.take_profit,
    commission_pct: run.commission,
    trading_mode: run.trading_mode,
  }
}

function fmt(n: number, d = 2) { return n.toFixed(d) }
function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

function RankBadge({ rank }: { rank: number }) {
  const cls = rank === 1 ? 'text-amber-400' : rank === 2 ? 'text-gray-300' : rank === 3 ? 'text-orange-400' : 'text-gray-500'
  return <span className={`font-bold ${cls}`}>{rank}</span>
}

function ResultsTable({ rows, globalRank = false, runConfig, capital, onApply }: {
  rows: (OptimizeResultRow & { _run?: string; _runConfig?: RunConfig })[]
  globalRank?: boolean
  runConfig?: RunConfig
  capital?: number
  onApply?: (config: StrategyConfig) => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-400 bg-gray-700/50 border-b border-gray-700">
            <th className="px-3 py-2">#</th>
            {globalRank && <th className="px-3 py-2">実行</th>}
            <th className="px-3 py-2">パラメータ</th>
            <th className="px-3 py-2 text-right">PF</th>
            <th className="px-3 py-2 text-right">リターン</th>
            <th className="px-3 py-2 text-right">年率</th>
            <th className="px-3 py-2 text-right">シャープ</th>
            <th className="px-3 py-2 text-right">DD</th>
            <th className="px-3 py-2 text-right">勝率</th>
            <th className="px-3 py-2 text-right">取引数</th>
            <th className="px-3 py-2 text-right">最終資産</th>
            {onApply && <th className="px-3 py-2"></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const rc = r._runConfig ?? runConfig
            return (
            <tr key={i} className={`border-b border-gray-700/50 hover:bg-gray-700/30 ${i < 3 ? 'bg-amber-900/10' : ''}`}>
              <td className="px-3 py-2"><RankBadge rank={i + 1} /></td>
              {globalRank && <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{r._run}</td>}
              <td className="px-3 py-2 font-medium text-gray-200 whitespace-nowrap">{r.label}</td>
              <td className="px-3 py-2 text-right">
                <span className={`font-semibold ${r.profit_factor == null || r.profit_factor >= 1.5 ? 'text-green-400' : r.profit_factor >= 1.0 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {r.profit_factor != null ? fmt(r.profit_factor) : '∞'}
                </span>
              </td>
              <td className={`px-3 py-2 text-right ${r.total_return_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {r.total_return_pct >= 0 ? '+' : ''}{fmt(r.total_return_pct)}%
              </td>
              <td className={`px-3 py-2 text-right ${r.annualised_return_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {r.annualised_return_pct >= 0 ? '+' : ''}{fmt(r.annualised_return_pct)}%
              </td>
              <td className={`px-3 py-2 text-right ${r.sharpe_ratio >= 1 ? 'text-green-400' : r.sharpe_ratio >= 0 ? 'text-yellow-400' : 'text-red-400'}`}>
                {fmt(r.sharpe_ratio, 3)}
              </td>
              <td className="px-3 py-2 text-right text-red-400">{fmt(r.max_drawdown_pct)}%</td>
              <td className={`px-3 py-2 text-right ${r.win_rate_pct >= 50 ? 'text-green-400' : 'text-yellow-400'}`}>
                {fmt(r.win_rate_pct)}%
              </td>
              <td className="px-3 py-2 text-right text-gray-300">{r.num_trades}</td>
              <td className={`px-3 py-2 text-right ${r.final_capital >= 10000 ? 'text-green-400' : 'text-red-400'}`}>
                {fmtCurrency(r.final_capital)}
              </td>
              {onApply && (
                <td className="px-3 py-2 text-right">
                  <button
                    disabled={!rc}
                    onClick={() => rc && onApply(buildStrategyConfig(r, rc, capital ?? 10000))}
                    className="text-xs px-2 py-1 rounded bg-amber-500 hover:bg-amber-400 text-black font-semibold disabled:opacity-30 whitespace-nowrap"
                  >
                    ▶ BT
                  </button>
                </td>
              )}
            </tr>
          )})}
        </tbody>
      </table>
    </div>
  )
}

type MainView = 'current' | 'archive' | 'top'

export default function Optimizer({ onApply }: { onApply?: (config: StrategyConfig) => void }) {
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

  const [view, setView] = useState<MainView>('current')
  const [history, setHistory] = useState<OptimizeRun[]>([])
  const [expandedRun, setExpandedRun] = useState<number | null>(null)

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetchOptimizeHistory()
      setHistory(res.runs)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  async function handleRun() {
    setLoading(true)
    setError(null)
    setResults(null)
    const t0 = Date.now()
    const req: OptimizeRequest = {
      indicator, period, interval,
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
      setView('current')
      await loadHistory()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } }; message?: string })
        ?.response?.data?.detail || (e as { message?: string })?.message || 'エラーが発生しました'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id: number) {
    await deleteOptimizeRun(id)
    await loadHistory()
    if (expandedRun === id) setExpandedRun(null)
  }

  // Build combined top: take all results from all runs, sort by PF
  const combinedTop: (OptimizeResultRow & { _run: string; _runConfig: RunConfig })[] = history
    .flatMap(run =>
      run.results.map(r => ({
        ...r,
        _run: `${run.indicator} ${run.period}/${run.interval}`,
        _runConfig: { indicator: run.indicator, period: run.period, interval: run.interval, trading_mode: run.trading_mode as 'long_only' | 'always_in', commission: run.commission, stop_loss: run.stop_loss, take_profit: run.take_profit },
      }))
    )
    .sort((a, b) => {
      const pf = (r: OptimizeResultRow) => r.profit_factor ?? 1e9
      return pf(b) - pf(a)
    })
    .slice(0, 20)

  const indicatorInfo = INDICATOR_OPTIONS.find(o => o.value === indicator)!

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* Settings panel */}
      <aside className="lg:w-72 flex-shrink-0">
        <div className="bg-gray-800 rounded-xl p-5 sticky top-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 inline-block"></span>
            最適化設定
          </h2>

          <div>
            <label className="text-xs text-gray-400 block mb-1">探索する指標</label>
            <div className="space-y-1">
              {INDICATOR_OPTIONS.map(opt => (
                <button key={opt.value} onClick={() => setIndicator(opt.value)}
                  className={`w-full text-left px-3 py-2 rounded border text-sm transition-colors ${
                    indicator === opt.value
                      ? 'bg-amber-500 border-amber-500 text-black font-semibold'
                      : 'border-gray-600 text-gray-300 hover:border-amber-500'
                  }`}>
                  <div className="font-medium">{opt.label}</div>
                  <div className={`text-xs mt-0.5 ${indicator === opt.value ? 'text-black/70' : 'text-gray-500'}`}>{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

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

          <div>
            <label className="text-xs text-gray-400 block mb-1">初期資金 ($)</label>
            <input type="number" value={capital} onChange={e => setCapital(Number(e.target.value))}
              className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-sm" />
          </div>

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

          <button onClick={handleRun} disabled={loading}
            className="w-full py-3 rounded-lg font-semibold bg-amber-500 hover:bg-amber-400 text-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? '探索中...' : '最適化を実行'}
          </button>
        </div>
      </aside>

      {/* Main area */}
      <main className="flex-1 min-w-0 space-y-4">
        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded-xl p-4 text-red-300 text-sm">{error}</div>
        )}

        {/* View tabs */}
        <div className="flex gap-2">
          {([
            { id: 'current', label: '今回の結果' },
            { id: 'archive', label: `アーカイブ (${history.length})` },
            { id: 'top',     label: `総合TOP (${combinedTop.length})` },
          ] as const).map(t => (
            <button key={t.id} onClick={() => setView(t.id)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                view === t.id
                  ? 'bg-amber-500 text-black'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Current results */}
        {view === 'current' && (
          <>
            {loading && (
              <div className="flex items-center justify-center h-48">
                <div className="text-center space-y-3">
                  <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                  <p className="text-gray-400 text-sm">{indicatorInfo.label}のパラメータを探索中...</p>
                </div>
              </div>
            )}
            {!loading && !results && (
              <div className="flex flex-col items-center justify-center h-48 text-center space-y-2">
                <div className="text-4xl text-amber-500/30">&#9651;</div>
                <p className="text-gray-400">左で条件を設定して「最適化を実行」してください</p>
                <p className="text-xs text-gray-500">全パターンをテストし、PF上位20をランキング表示します</p>
              </div>
            )}
            {!loading && results && (
              <div className="space-y-3">
                <div>
                  <h3 className="text-base font-semibold text-gray-100">
                    最適化結果 — {indicatorInfo.label}
                  </h3>
                  <p className="text-xs text-gray-500">
                    {results.length}件 · PF順 {elapsed != null && `· ${(elapsed / 1000).toFixed(1)}秒`}
                  </p>
                </div>
                {results.length === 0 ? (
                  <div className="bg-gray-800 rounded-xl p-6 text-center text-gray-400">
                    有効な結果がありません。最低取引数を下げるか期間を変えてください。
                  </div>
                ) : (
                  <div className="bg-gray-800 rounded-xl overflow-hidden">
                    <ResultsTable
                      rows={results}
                      runConfig={{ indicator, period, interval, trading_mode: tradingMode, commission, stop_loss: stopLoss, take_profit: takeProfit }}
                      capital={capital}
                      onApply={onApply}
                    />
                  </div>
                )}
                <p className="text-xs text-gray-500">⚠ 同データでの最適化は過学習リスクがあります。別期間で必ず検証してください。</p>
              </div>
            )}
          </>
        )}

        {/* Archive view */}
        {view === 'archive' && (
          <div className="space-y-3">
            <h3 className="text-base font-semibold text-gray-100">アーカイブ</h3>
            {history.length === 0 ? (
              <div className="bg-gray-800 rounded-xl p-6 text-center text-gray-400">
                まだ最適化を実行していません
              </div>
            ) : (
              history.map(run => (
                <div key={run.id} className="bg-gray-800 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/50">
                    <div>
                      <span className="font-medium text-gray-200">{run.indicator} クロス</span>
                      <span className="text-xs text-gray-500 ml-3">
                        {run.period} / {run.interval} · 手数料 {run.commission}% · {run.count}パターン
                      </span>
                      <span className="text-xs text-gray-600 ml-3">{run.created_at}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {run.top_result && (
                        <span className="text-xs text-amber-400">
                          TOP: {run.top_result.label} PF {run.top_result.profit_factor != null ? fmt(run.top_result.profit_factor) : '∞'}
                        </span>
                      )}
                      <button
                        onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
                        className="text-xs text-gray-400 hover:text-white border border-gray-600 rounded px-2 py-1"
                      >
                        {expandedRun === run.id ? '折りたたむ' : '展開'}
                      </button>
                      <button
                        onClick={() => handleDelete(run.id)}
                        className="text-xs text-red-400 hover:text-red-300 border border-red-800 rounded px-2 py-1"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                  {expandedRun === run.id && (
                    <ResultsTable
                      rows={run.results}
                      runConfig={{ indicator: run.indicator, period: run.period, interval: run.interval, trading_mode: run.trading_mode as 'long_only' | 'always_in', commission: run.commission, stop_loss: run.stop_loss, take_profit: run.take_profit }}
                      capital={capital}
                      onApply={onApply}
                    />
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Combined TOP view */}
        {view === 'top' && (
          <div className="space-y-3">
            <div>
              <h3 className="text-base font-semibold text-gray-100">総合TOP 20</h3>
              <p className="text-xs text-gray-500">全アーカイブから上位20パターン · PF順</p>
            </div>
            {combinedTop.length === 0 ? (
              <div className="bg-gray-800 rounded-xl p-6 text-center text-gray-400">
                先に複数の最適化を実行してください
              </div>
            ) : (
              <div className="bg-gray-800 rounded-xl overflow-hidden">
                <ResultsTable rows={combinedTop} globalRank capital={capital} onApply={onApply} />
              </div>
            )}
            <p className="text-xs text-gray-500">⚠ 異なる期間・インターバルで最適化した結果は直接比較できません。参考値としてご利用ください。</p>
          </div>
        )}
      </main>
    </div>
  )
}
