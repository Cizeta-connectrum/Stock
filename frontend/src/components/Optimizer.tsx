import { useState, useEffect, useCallback } from 'react'
import type { OptimizeRequest, OptimizeResultRow, OptimizeRun, StrategyConfig, ConditionSpec } from '../lib/api'
import { runOptimizeStream, fetchOptimizeHistory, deleteOptimizeRun } from '../lib/api'
import type { TradingSettings } from '../lib/settings'

const PERIOD_OPTIONS = [
  { value: '3mo', label: '3ヶ月' },
  { value: '6mo', label: '6ヶ月' },
  { value: '1y',  label: '1年' },
  { value: '2y',  label: '2年' },
  { value: '5y',  label: '5年' },
]
const INTERVAL_OPTIONS = [
  { value: '5m',  label: '5分足 ⚡' },
  { value: '15m', label: '15分足 ⚡' },
  { value: '1h',  label: '1時間足' },
  { value: '1d',  label: '日足' },
  { value: '1wk', label: '週足' },
]

const SCALPING_INDICATORS = new Set(['SCALP_EMA', 'VWMA', 'RSI_BB'])
type IndicatorId = 'SMA' | 'EMA' | 'MACD' | 'RSI' | 'BB' | 'STOCH' | 'EMA_RSI' | 'SCALP_EMA' | 'VWMA' | 'RSI_BB'

const INDICATOR_OPTIONS: { value: IndicatorId; label: string; desc: string; scalping?: boolean }[] = [
  { value: 'SMA',      label: 'SMA クロス',         desc: 'fast × slow 全ペア (~10)' },
  { value: 'EMA',      label: 'EMA クロス',         desc: 'fast × slow 全ペア (~10)' },
  { value: 'MACD',     label: 'MACD クロス',        desc: 'MACD線 × シグナル線 (8組)' },
  { value: 'RSI',      label: 'RSI 逆張り',         desc: '閾値の全組み合わせ (60)' },
  { value: 'BB',       label: 'ボリンジャーバンド',  desc: 'period × σ (16)' },
  { value: 'STOCH',    label: 'ストキャスティクス',  desc: '%K クロス 閾値 (36)' },
  { value: 'EMA_RSI',  label: 'EMA + RSI 複合',     desc: 'トレンドフィルター + 逆張り (24)' },
  { value: 'SCALP_EMA', label: '⚡ 超高速 EMA',      desc: '3/5/8 × 13/21/34 (9組)', scalping: true },
  { value: 'VWMA',     label: '⚡ VWMA クロス',      desc: '出来高加重MA (3組)', scalping: true },
  { value: 'RSI_BB',   label: '⚡ RSI+BB 二重確認',  desc: 'RSI売られすぎ + BB下限 (48組)', scalping: true },
]

interface RunConfig {
  indicator: string
  period: string
  interval: string
  trading_mode: 'long_only' | 'always_in'
  commission: number
  stop_loss: number
  take_profit: number
  usd_jpy?: number
  leverage?: number
}

const INDICATOR_LABEL: Record<string, string> = {
  SMA: 'SMA クロス', EMA: 'EMA クロス', MACD: 'MACD クロス',
  RSI: 'RSI 逆張り', BB: 'ボリンジャーバンド', STOCH: 'ストキャスティクス', EMA_RSI: 'EMA+RSI 複合',
  SCALP_EMA: '⚡ 超高速 EMA', VWMA: '⚡ VWMA クロス', RSI_BB: '⚡ RSI+BB 二重確認',
}

function buildStrategyConfig(row: OptimizeResultRow, run: RunConfig, capital: number): StrategyConfig {
  const p = row.params
  let entry_conditions: ConditionSpec[]
  let exit_conditions: ConditionSpec[]

  if (run.indicator === 'SMA') {
    entry_conditions = [{ indicator: 'SMA', params: { period: p.fast }, condition: 'crosses_above', target: { indicator: 'SMA', params: { period: p.slow } } }]
    exit_conditions  = [{ indicator: 'SMA', params: { period: p.fast }, condition: 'crosses_below', target: { indicator: 'SMA', params: { period: p.slow } } }]
  } else if (run.indicator === 'EMA') {
    entry_conditions = [{ indicator: 'EMA', params: { period: p.fast }, condition: 'crosses_above', target: { indicator: 'EMA', params: { period: p.slow } } }]
    exit_conditions  = [{ indicator: 'EMA', params: { period: p.fast }, condition: 'crosses_below', target: { indicator: 'EMA', params: { period: p.slow } } }]
  } else if (run.indicator === 'MACD') {
    const mp = { fast: p.fast, slow: p.slow, signal: p.signal }
    entry_conditions = [{ indicator: 'MACD', params: mp, condition: 'crosses_above', target: { indicator: 'MACD', params: mp, sub: 'signal' } }]
    exit_conditions  = [{ indicator: 'MACD', params: mp, condition: 'crosses_below', target: { indicator: 'MACD', params: mp, sub: 'signal' } }]
  } else if (run.indicator === 'RSI') {
    entry_conditions = [{ indicator: 'RSI', params: { period: p.period }, condition: 'crosses_below', target: { value: p.oversold } }]
    exit_conditions  = [{ indicator: 'RSI', params: { period: p.period }, condition: 'crosses_above', target: { value: p.overbought } }]
  } else if (run.indicator === 'STOCH') {
    const sp = { k_period: p.k_period, d_period: p.d_period }
    entry_conditions = [{ indicator: 'STOCH', params: sp, sub: 'k', condition: 'crosses_above', target: { value: p.oversold } }]
    exit_conditions  = [{ indicator: 'STOCH', params: sp, sub: 'k', condition: 'crosses_above', target: { value: p.overbought } }]
  } else if (run.indicator === 'EMA_RSI') {
    entry_conditions = [
      { indicator: 'PRICE', params: {}, condition: 'above', target: { indicator: 'EMA', params: { period: p.ema_period } } },
      { indicator: 'RSI',   params: { period: p.rsi_period }, condition: 'crosses_below', target: { value: p.oversold } },
    ]
    exit_conditions = [{ indicator: 'RSI', params: { period: p.rsi_period }, condition: 'crosses_above', target: { value: p.overbought } }]
  } else if (run.indicator === 'SCALP_EMA') {
    entry_conditions = [{ indicator: 'EMA', params: { period: p.fast }, condition: 'crosses_above', target: { indicator: 'EMA', params: { period: p.slow } } }]
    exit_conditions  = [{ indicator: 'EMA', params: { period: p.fast }, condition: 'crosses_below', target: { indicator: 'EMA', params: { period: p.slow } } }]
  } else if (run.indicator === 'VWMA') {
    entry_conditions = [{ indicator: 'PRICE', params: {}, condition: 'crosses_above', target: { indicator: 'VWMA', params: { period: p.period } } }]
    exit_conditions  = [{ indicator: 'PRICE', params: {}, condition: 'crosses_below', target: { indicator: 'VWMA', params: { period: p.period } } }]
  } else if (run.indicator === 'RSI_BB') {
    entry_conditions = [
      { indicator: 'RSI',   params: { period: p.rsi_period }, condition: 'below', target: { value: p.oversold } },
      { indicator: 'PRICE', params: {}, condition: 'below', target: { indicator: 'BB', params: { period: p.bb_period, std_dev: p.bb_std }, sub: 'lower' } },
    ]
    exit_conditions = [{ indicator: 'RSI', params: { period: p.rsi_period }, condition: 'above', target: { value: p.overbought } }]
  } else {
    // BB
    entry_conditions = [{ indicator: 'PRICE', params: {}, condition: 'crosses_below', target: { indicator: 'BB', params: { period: p.period, std_dev: p.std_dev }, sub: 'lower' } }]
    exit_conditions  = [{ indicator: 'PRICE', params: {}, condition: 'crosses_above', target: { indicator: 'BB', params: { period: p.period, std_dev: p.std_dev }, sub: 'upper' } }]
  }

  return {
    period: run.period,
    interval: run.interval,
    initial_capital: capital,
    usd_jpy: run.usd_jpy ?? 150,
    leverage: run.leverage ?? 500,
    entry_conditions,
    entry_logic: 'AND',
    exit_conditions,
    exit_logic: 'AND',
    stop_loss_pct: run.stop_loss,
    take_profit_pct: run.take_profit,
    commission_pct: run.commission,
    trading_mode: run.trading_mode,
  }
}

function fmt(n: number, d = 2) { return n.toFixed(d) }
function fmtCurrency(n: number) {
  return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }).format(n)
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

export default function Optimizer({ onApply, settings }: { onApply?: (config: StrategyConfig) => void; settings: TradingSettings }) {
  const [indicator, setIndicator] = useState<IndicatorId>('SMA')
  const [period, setPeriod] = useState('1y')
  const [interval, setInterval] = useState('1d')
  const [tradingMode, setTradingMode] = useState<'long_only' | 'always_in'>('long_only')
  const [minTrades, setMinTrades] = useState(5)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<OptimizeResultRow[] | null>(null)
  const [elapsed, setElapsed] = useState<number | null>(null)
  const [progress, setProgress] = useState<{ current: number; total: number; label: string } | null>(null)

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
    setProgress(null)
    const t0 = Date.now()
    const req: OptimizeRequest = {
      indicator, period, interval,
      initial_capital: settings.initial_capital,
      usd_jpy: settings.usd_jpy,
      leverage: settings.leverage,
      trading_mode: tradingMode,
      stop_loss_pct: settings.stop_loss_pct,
      take_profit_pct: settings.take_profit_pct,
      commission_pct: settings.commission_pct,
      min_trades: minTrades,
      top_n: 20,
    }
    try {
      const res = await runOptimizeStream(req, (current, total, label) => {
        setProgress({ current, total, label })
      })
      setResults(res.results)
      setElapsed(Date.now() - t0)
      setProgress(null)
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

          {/* Settings summary */}
          <div className="bg-gray-700/40 rounded-lg px-3 py-2 text-xs text-gray-400 space-y-1">
            <p className="text-gray-300 font-medium">取引設定（設定タブから変更）</p>
            <p>証拠金: <span className="text-amber-400">¥{settings.initial_capital.toLocaleString('ja-JP')}</span></p>
            <p>損切/利確: <span className="text-red-400">{settings.stop_loss_pct || '—'}%</span> / <span className="text-green-400">{settings.take_profit_pct || '—'}%</span></p>
            <p>手数料: {settings.commission_pct}% · USD/JPY: {settings.usd_jpy}</p>
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

          <div>
            <label className="text-xs text-gray-400 block mb-1">最低取引数</label>
            <input type="number" min="1" value={minTrades} onChange={e => setMinTrades(Number(e.target.value))}
              className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-sm" />
          </div>

          {SCALPING_INDICATORS.has(indicator) && !['5m', '15m'].includes(interval) && (
            <div className="text-xs bg-amber-900/30 border border-amber-700/50 rounded px-3 py-2 text-amber-300">
              ⚡ スキャルピング戦略は 5分足・15分足 推奨です
            </div>
          )}

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
              <div className="bg-gray-800 rounded-xl p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-5 h-5 border-3 border-amber-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  <p className="text-sm text-gray-300 font-medium">{indicatorInfo.label}を探索中...</p>
                </div>
                {progress && progress.total > 0 && (
                  <div className="space-y-2">
                    {/* Progress bar */}
                    <div className="w-full bg-gray-700 rounded-full h-2.5">
                      <div
                        className="bg-amber-500 h-2.5 rounded-full transition-all duration-300"
                        style={{ width: `${(progress.current / progress.total) * 100}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-gray-400">
                      <span className="truncate max-w-xs">{progress.label}</span>
                      <span className="flex-shrink-0 ml-2 font-mono text-amber-400">
                        {progress.current} / {progress.total}
                      </span>
                    </div>
                  </div>
                )}
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
                      runConfig={{ indicator, period, interval, trading_mode: tradingMode, commission: settings.commission_pct, stop_loss: settings.stop_loss_pct, take_profit: settings.take_profit_pct, usd_jpy: settings.usd_jpy, leverage: settings.leverage }}
                      capital={settings.initial_capital}
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
                      <span className="font-medium text-gray-200">{INDICATOR_LABEL[run.indicator] ?? run.indicator}</span>
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
                      capital={settings.initial_capital}
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
                <ResultsTable rows={combinedTop} globalRank capital={settings.initial_capital} onApply={onApply} />
              </div>
            )}
            <p className="text-xs text-gray-500">⚠ 異なる期間・インターバルで最適化した結果は直接比較できません。参考値としてご利用ください。</p>
          </div>
        )}
      </main>
    </div>
  )
}
