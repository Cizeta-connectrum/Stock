import axios from 'axios'

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export interface ConditionSpec {
  indicator: string
  params: Record<string, number>
  condition: string
  target: { indicator?: string; params?: Record<string, number>; sub?: string; value?: number }
  sub?: string
}

export interface StrategyConfig {
  period: string
  interval: string
  initial_capital: number   // JPY
  usd_jpy: number
  entry_conditions: ConditionSpec[]
  entry_logic: 'AND' | 'OR'
  exit_conditions: ConditionSpec[]
  exit_logic: 'AND' | 'OR'
  stop_loss_pct: number
  take_profit_pct: number
  commission_pct: number
  trading_mode: 'long_only' | 'always_in'
}

export interface Bar {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  signal?: 'buy' | 'sell' | null
}

export interface Trade {
  entry_date: string
  exit_date: string
  entry_price: number
  exit_price: number
  lots: number
  pnl: number       // JPY
  pnl_pct: number
  exit_reason: string
  duration_days: number
  side: 'long' | 'short'
}

export interface BacktestSummary {
  total_return_pct: number
  annualised_return_pct: number
  max_drawdown_pct: number
  sharpe_ratio: number
  win_rate_pct: number
  profit_factor: number | null
  num_trades: number
  num_winning: number
  num_losing: number
  avg_trade_duration_days: number
  initial_capital: number   // JPY
  final_capital: number     // JPY
  commission_pct: number
  total_commission: number  // JPY
  period: string
  interval: string
  usd_jpy: number
}

export interface BacktestResult {
  summary: BacktestSummary
  equity_curve: { date: string; equity: number }[]
  trades: Trade[]
  price_data: Bar[]
  indicators: Record<string, (number | null)[]>
}

export interface IndicatorMeta {
  id: string
  name: string
  params: { name: string; type: string; default: number; min: number; max: number }[]
}

export interface PresetStrategy extends StrategyConfig {
  id: string
  name: string
  description: string
}

export interface StrategiesResponse {
  indicators: IndicatorMeta[]
  condition_types: { id: string; name: string }[]
  preset_strategies: PresetStrategy[]
}

export interface OptimizeRequest {
  indicator: string
  period: string
  interval: string
  initial_capital: number   // JPY
  usd_jpy: number
  trading_mode: 'long_only' | 'always_in'
  stop_loss_pct: number
  take_profit_pct: number
  commission_pct: number
  min_trades: number
  top_n: number
}

export interface OptimizeResultRow {
  label: string
  params: Record<string, number>
  profit_factor: number | null
  total_return_pct: number
  annualised_return_pct: number
  sharpe_ratio: number
  max_drawdown_pct: number
  win_rate_pct: number
  num_trades: number
  final_capital: number
}

export async function fetchStrategies(): Promise<StrategiesResponse> {
  const res = await axios.get(`${BASE}/api/strategies`)
  return res.data
}

export interface OptimizeRun {
  id: number
  created_at: string
  indicator: string
  period: string
  interval: string
  trading_mode: string
  commission: number
  stop_loss: number
  take_profit: number
  count: number
  top_result: OptimizeResultRow | null
  results: OptimizeResultRow[]
}

export async function runOptimizeStream(
  req: OptimizeRequest,
  onProgress: (current: number, total: number, label: string) => void,
): Promise<{ results: OptimizeResultRow[]; count: number; run_id: number }> {
  const response = await fetch(`${BASE}/api/optimize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const raw = line.slice(6).trim()
      if (!raw) continue
      let data: Record<string, unknown>
      try { data = JSON.parse(raw) } catch { continue }
      if (data.error) throw new Error(data.error as string)
      if (data.done) return { results: data.results as OptimizeResultRow[], count: data.count as number, run_id: data.run_id as number }
      onProgress(data.current as number, data.total as number, data.label as string)
    }
  }
  // flush remaining buffer
  if (buffer.startsWith('data: ')) {
    try {
      const data = JSON.parse(buffer.slice(6).trim())
      if (data.done) return { results: data.results as OptimizeResultRow[], count: data.count as number, run_id: data.run_id as number }
    } catch { /* ignore */ }
  }
  throw new Error('Stream ended unexpectedly')
}

export async function fetchOptimizeHistory(): Promise<{ runs: OptimizeRun[] }> {
  const res = await axios.get(`${BASE}/api/optimize/history`)
  return res.data
}

export async function deleteOptimizeRun(id: number): Promise<void> {
  await axios.delete(`${BASE}/api/optimize/history/${id}`)
}

export async function runBacktest(config: StrategyConfig): Promise<BacktestResult> {
  const res = await axios.post(`${BASE}/api/backtest`, config)
  return res.data
}
