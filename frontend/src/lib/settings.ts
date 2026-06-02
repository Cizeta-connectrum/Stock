export interface TradingSettings {
  usd_jpy: number
  initial_capital: number   // JPY
  stop_loss_pct: number
  take_profit_pct: number
  commission_pct: number
}

export const DEFAULT_SETTINGS: TradingSettings = {
  usd_jpy: 150,
  initial_capital: 1_000_000,
  stop_loss_pct: 2.0,
  take_profit_pct: 4.0,
  commission_pct: 0.03,
}

const KEY = 'fx_trading_settings'

export function loadSettings(): TradingSettings {
  try {
    const s = localStorage.getItem(KEY)
    return s ? { ...DEFAULT_SETTINGS, ...JSON.parse(s) } : { ...DEFAULT_SETTINGS }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: TradingSettings): void {
  localStorage.setItem(KEY, JSON.stringify(s))
}

/** Lot info helpers */
export function calcMaxLots(capitalJpy: number): number {
  return Math.floor(capitalJpy / 10_000) * 0.01
}

export function calcLeverage(capitalJpy: number, goldPriceUsd: number, usdJpy: number): number {
  const lots = calcMaxLots(capitalJpy)
  if (lots <= 0 || capitalJpy <= 0) return 0
  const notionalJpy = lots * 100 * goldPriceUsd * usdJpy
  return notionalJpy / capitalJpy
}
