import axios from 'axios'

const BASE = 'http://localhost:8000'

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
  initial_capital: number
  entry_conditions: ConditionSpec[]
  entry_logic: 'AND' | 'OR'
  exit_conditions: ConditionSpec[]
  exit_logic: 'AND' | 'OR'
  stop_loss_pct: number
  take_profit_pct: number
  commission_pct: number
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
  shares: number
  pnl: number
  pnl_pct: number
  exit_reason: string
  duration_days: number
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
  initial_capital: number
  final_capital: number
  commission_pct: number
  total_commission: number
  period: string
  interval: string
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

export async function fetchStrategies(): Promise<StrategiesResponse> {
  const res = await axios.get(`${BASE}/api/strategies`)
  return res.data
}

export async function runBacktest(config: StrategyConfig): Promise<BacktestResult> {
  const res = await axios.post(`${BASE}/api/backtest`, config)
  return res.data
}
