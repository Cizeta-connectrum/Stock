import { useState, useEffect } from 'react'
import type { ConditionSpec, StrategyConfig, IndicatorMeta, PresetStrategy, StrategiesResponse } from '../lib/api'
import { fetchStrategies } from '../lib/api'
import type { TradingSettings } from '../lib/settings'
import { calcMaxLots } from '../lib/settings'

interface Props {
  onRun: (config: StrategyConfig) => void
  loading: boolean
  preloadConfig?: StrategyConfig | null
  settings: TradingSettings
}

const PERIOD_OPTIONS: { value: string; label: string; note?: string }[] = [
  { value: '5d',  label: '5日',   note: '1m用' },
  { value: '1mo', label: '1ヶ月', note: '5m/15m用' },
  { value: '2mo', label: '2ヶ月', note: '5m/15m用' },
  { value: '3mo', label: '3ヶ月' },
  { value: '6mo', label: '6ヶ月' },
  { value: '1y',  label: '1年' },
  { value: '2y',  label: '2年' },
  { value: '5y',  label: '5年' },
]

const INTERVAL_OPTIONS: { value: string; label: string; maxPeriod: string }[] = [
  { value: '1m',  label: '1分足',   maxPeriod: '最大7日' },
  { value: '5m',  label: '5分足',   maxPeriod: '最大60日' },
  { value: '15m', label: '15分足',  maxPeriod: '最大60日' },
  { value: '30m', label: '30分足',  maxPeriod: '最大60日' },
  { value: '1h',  label: '1時間足', maxPeriod: '最大2年' },
  { value: '1d',  label: '日足',    maxPeriod: '無制限' },
  { value: '1wk', label: '週足',    maxPeriod: '無制限' },
]

const CONDITION_TYPES = [
  { id: 'crosses_above', name: 'Crosses Above' },
  { id: 'crosses_below', name: 'Crosses Below' },
  { id: 'above', name: 'Is Above' },
  { id: 'below', name: 'Is Below' },
]

function makeDefaultCondition(): ConditionSpec {
  return {
    indicator: 'SMA',
    params: { period: 20 },
    condition: 'crosses_above',
    target: { indicator: 'SMA', params: { period: 50 } },
  }
}

function ConditionRow({ cond, indicators, onChange, onRemove }: {
  cond: ConditionSpec; indicators: IndicatorMeta[]
  onChange: (c: ConditionSpec) => void; onRemove: () => void
}) {
  const leftMeta = indicators.find(i => i.id === cond.indicator)
  const isTargetValue = cond.target && 'value' in cond.target && cond.target.value !== undefined

  function setLeft(id: string) {
    const meta = indicators.find(i => i.id === id)
    const params: Record<string, number> = {}
    meta?.params.forEach(p => { params[p.name] = p.default })
    onChange({ ...cond, indicator: id, params })
  }

  function setTargetType(toValue: boolean) {
    if (toValue) {
      onChange({ ...cond, target: { value: 30 } })
    } else {
      const meta = indicators.find(i => i.id !== cond.indicator) || indicators[0]
      const params: Record<string, number> = {}
      meta?.params.forEach(p => { params[p.name] = p.default })
      onChange({ ...cond, target: { indicator: meta?.id || 'SMA', params } })
    }
  }

  function setTargetIndicator(id: string) {
    const meta = indicators.find(i => i.id === id)
    const params: Record<string, number> = {}
    meta?.params.forEach(p => { params[p.name] = p.default })
    onChange({ ...cond, target: { indicator: id, params } })
  }

  const targetMeta = !isTargetValue
    ? indicators.find(i => i.id === (cond.target as { indicator: string }).indicator)
    : null

  return (
    <div className="bg-gray-800 rounded-lg p-3 space-y-2">
      <div className="flex gap-2 items-center flex-wrap">
        <select value={cond.indicator} onChange={e => setLeft(e.target.value)}
          className="bg-gray-700 text-white rounded px-2 py-1 text-sm">
          {indicators.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        {leftMeta?.params.map(p => (
          <input key={p.name} type="number"
            value={cond.params[p.name] ?? p.default} min={p.min} max={p.max}
            onChange={e => onChange({ ...cond, params: { ...cond.params, [p.name]: Number(e.target.value) } })}
            className="bg-gray-700 text-white rounded px-2 py-1 text-sm w-20" placeholder={p.name} />
        ))}
        <select value={cond.condition} onChange={e => onChange({ ...cond, condition: e.target.value })}
          className="bg-amber-700 text-white rounded px-2 py-1 text-sm">
          {CONDITION_TYPES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button onClick={() => setTargetType(!isTargetValue)}
          className="text-xs text-gray-400 border border-gray-600 rounded px-2 py-1 hover:border-amber-500">
          {isTargetValue ? 'Fixed Value' : 'Indicator'}
        </button>
        {isTargetValue ? (
          <input type="number" value={(cond.target as { value: number }).value}
            onChange={e => onChange({ ...cond, target: { value: Number(e.target.value) } })}
            className="bg-gray-700 text-white rounded px-2 py-1 text-sm w-24" />
        ) : (
          <>
            <select value={(cond.target as { indicator: string }).indicator || 'SMA'}
              onChange={e => setTargetIndicator(e.target.value)}
              className="bg-gray-700 text-white rounded px-2 py-1 text-sm">
              {indicators.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
            {targetMeta?.params.map(p => {
              const tParams = (cond.target as { params?: Record<string, number> }).params || {}
              return (
                <input key={p.name} type="number"
                  value={tParams[p.name] ?? p.default} min={p.min} max={p.max}
                  onChange={e => onChange({
                    ...cond,
                    target: { ...(cond.target as object), params: { ...tParams, [p.name]: Number(e.target.value) } },
                  })}
                  className="bg-gray-700 text-white rounded px-2 py-1 text-sm w-20" placeholder={p.name} />
              )
            })}
          </>
        )}
        <button onClick={onRemove} className="ml-auto text-red-400 hover:text-red-300 text-sm">✕</button>
      </div>
    </div>
  )
}

export default function StrategyBuilder({ onRun, loading, preloadConfig, settings }: Props) {
  const [meta, setMeta] = useState<StrategiesResponse | null>(null)
  const [period, setPeriod] = useState('1y')
  const [interval, setInterval] = useState('1d')
  const [entryConditions, setEntryConditions] = useState<ConditionSpec[]>([makeDefaultCondition()])
  const [exitConditions, setExitConditions] = useState<ConditionSpec[]>([{
    indicator: 'SMA', params: { period: 20 }, condition: 'crosses_below',
    target: { indicator: 'SMA', params: { period: 50 } },
  }])
  const [entryLogic, setEntryLogic] = useState<'AND' | 'OR'>('AND')
  const [exitLogic, setExitLogic] = useState<'AND' | 'OR'>('AND')
  const [tradingMode, setTradingMode] = useState<'long_only' | 'always_in'>('long_only')
  const [selectedPreset, setSelectedPreset] = useState('')

  useEffect(() => { fetchStrategies().then(setMeta).catch(console.error) }, [])

  useEffect(() => {
    if (!preloadConfig) return
    setPeriod(preloadConfig.period)
    setInterval(preloadConfig.interval)
    setEntryConditions(preloadConfig.entry_conditions)
    setExitConditions(preloadConfig.exit_conditions)
    setEntryLogic(preloadConfig.entry_logic)
    setExitLogic(preloadConfig.exit_logic)
    setTradingMode(preloadConfig.trading_mode)
    setSelectedPreset('')
  }, [preloadConfig])

  function applyPreset(id: string) {
    if (!meta) return
    const p = meta.preset_strategies.find(s => s.id === id)
    if (!p) return
    setSelectedPreset(id)
    setPeriod(p.period)
    setInterval(p.interval)
    setEntryConditions(p.entry_conditions as ConditionSpec[])
    setExitConditions(p.exit_conditions as ConditionSpec[])
    setEntryLogic(p.entry_logic as 'AND' | 'OR')
    setExitLogic(p.exit_logic as 'AND' | 'OR')
  }

  function handleRun() {
    onRun({
      period, interval,
      initial_capital: settings.initial_capital,
      usd_jpy: settings.usd_jpy,
      entry_conditions: entryConditions,
      entry_logic: entryLogic,
      exit_conditions: exitConditions,
      exit_logic: exitLogic,
      stop_loss_pct: settings.stop_loss_pct,
      take_profit_pct: settings.take_profit_pct,
      commission_pct: settings.commission_pct,
      trading_mode: tradingMode,
    })
  }

  const indicators = meta?.indicators || []
  const maxLots = calcMaxLots(settings.initial_capital)

  return (
    <div className="space-y-4">
      {/* Active settings summary */}
      <div className="bg-gray-700/40 rounded-lg px-3 py-2 text-xs text-gray-400 flex flex-wrap gap-x-4 gap-y-1">
        <span>証拠金: <span className="text-amber-400">¥{settings.initial_capital.toLocaleString('ja-JP')}</span></span>
        <span>最大: <span className="text-amber-400">{maxLots.toFixed(2)}lot</span></span>
        <span>損切: <span className="text-red-400">{settings.stop_loss_pct || '—'}%</span></span>
        <span>利確: <span className="text-green-400">{settings.take_profit_pct || '—'}%</span></span>
        <span>手数料: <span className="text-gray-300">{settings.commission_pct}%</span></span>
        <span>USD/JPY: <span className="text-gray-300">{settings.usd_jpy}</span></span>
      </div>

      {/* Presets */}
      {meta && (
        <div>
          <label className="text-xs text-gray-400 block mb-1">プリセット戦略</label>
          <div className="flex flex-wrap gap-2">
            {meta.preset_strategies.map(p => (
              <button key={p.id} onClick={() => applyPreset(p.id)}
                className={`text-xs px-3 py-1.5 rounded border transition-colors ${
                  selectedPreset === p.id
                    ? 'bg-amber-500 border-amber-500 text-black'
                    : 'border-gray-600 text-gray-300 hover:border-amber-500'
                }`} title={p.description}>
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Period / Interval */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-400 block mb-1">期間</label>
          <select value={period} onChange={e => setPeriod(e.target.value)}
            className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-sm">
            {PERIOD_OPTIONS.map(p => (
              <option key={p.value} value={p.value}>{p.label}{p.note ? ` (${p.note})` : ''}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">インターバル</label>
          <select value={interval} onChange={e => setInterval(e.target.value)}
            className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-sm">
            {INTERVAL_OPTIONS.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
          </select>
          <div className="text-xs text-gray-500 mt-0.5">
            {INTERVAL_OPTIONS.find(i => i.value === interval)?.maxPeriod}
          </div>
        </div>
      </div>

      {/* Trading mode */}
      <div>
        <label className="text-xs text-gray-400 block mb-1">取引方向</label>
        <div className="flex gap-2">
          {([
            { value: 'long_only', label: 'ロングのみ' },
            { value: 'always_in', label: 'ロング＆ショート' },
          ] as const).map(opt => (
            <button key={opt.value} onClick={() => setTradingMode(opt.value)}
              className={`flex-1 text-xs px-3 py-2 rounded border transition-colors ${
                tradingMode === opt.value
                  ? 'bg-amber-500 border-amber-500 text-black font-semibold'
                  : 'border-gray-600 text-gray-300 hover:border-amber-500'
              }`}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Entry conditions */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-green-400 font-medium">エントリー条件</span>
          <div className="flex items-center gap-2">
            <select value={entryLogic} onChange={e => setEntryLogic(e.target.value as 'AND' | 'OR')}
              className="bg-gray-700 text-white rounded px-2 py-0.5 text-xs">
              <option>AND</option><option>OR</option>
            </select>
            <button onClick={() => setEntryConditions([...entryConditions, makeDefaultCondition()])}
              className="text-xs text-green-400 border border-green-600 rounded px-2 py-0.5 hover:bg-green-900">
              + 追加
            </button>
          </div>
        </div>
        <div className="space-y-2">
          {entryConditions.map((c, i) => (
            <ConditionRow key={i} cond={c} indicators={indicators}
              onChange={nc => setEntryConditions(entryConditions.map((x, j) => j === i ? nc : x))}
              onRemove={() => setEntryConditions(entryConditions.filter((_, j) => j !== i))} />
          ))}
        </div>
      </div>

      {/* Exit conditions */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-red-400 font-medium">エグジット条件</span>
          <div className="flex items-center gap-2">
            <select value={exitLogic} onChange={e => setExitLogic(e.target.value as 'AND' | 'OR')}
              className="bg-gray-700 text-white rounded px-2 py-0.5 text-xs">
              <option>AND</option><option>OR</option>
            </select>
            <button onClick={() => setExitConditions([...exitConditions, makeDefaultCondition()])}
              className="text-xs text-red-400 border border-red-600 rounded px-2 py-0.5 hover:bg-red-900">
              + 追加
            </button>
          </div>
        </div>
        <div className="space-y-2">
          {exitConditions.map((c, i) => (
            <ConditionRow key={i} cond={c} indicators={indicators}
              onChange={nc => setExitConditions(exitConditions.map((x, j) => j === i ? nc : x))}
              onRemove={() => setExitConditions(exitConditions.filter((_, j) => j !== i))} />
          ))}
        </div>
      </div>

      <button onClick={handleRun}
        disabled={loading || entryConditions.length === 0 || exitConditions.length === 0}
        className="w-full py-3 rounded-lg font-semibold bg-amber-500 hover:bg-amber-400 text-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
        {loading ? 'バックテスト実行中...' : 'バックテスト実行'}
      </button>
    </div>
  )
}
