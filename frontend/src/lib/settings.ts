export interface TradingSettings {
  usd_jpy: number
  initial_capital: number   // JPY
  leverage: number          // e.g. 500
  stop_loss_pct: number
  take_profit_pct: number
  commission_pct: number
}

export const DEFAULT_SETTINGS: TradingSettings = {
  usd_jpy: 150,
  initial_capital: 1_000_000,
  leverage: 500,
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

/**
 * Max tradeable lots given capital, leverage, and a reference gold price.
 * margin_per_lot = (100oz * ref_price_usd * usd_jpy) / leverage
 */
export function calcMaxLots(
  capitalJpy: number,
  leverage = 500,
  refPriceUsd = 2500,
  usdJpy = 150,
): number {
  const marginPerLot = (100 * refPriceUsd * usdJpy) / leverage
  return Math.floor(capitalJpy / marginPerLot / 0.01) * 0.01
}
