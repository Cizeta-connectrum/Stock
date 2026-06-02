"""
Parameter optimizer — grid search over indicator parameters, ranked by profit factor.
"""

from __future__ import annotations

import itertools
import math
from typing import Any

from backtester import fetch_gold_data, run_backtest

# ---------------------------------------------------------------------------
# Search spaces
# ---------------------------------------------------------------------------

SMA_FAST_PERIODS = [5, 10, 20, 50]
SMA_SLOW_PERIODS = [20, 50, 100, 200]

EMA_FAST_PERIODS = [5, 10, 20, 50]
EMA_SLOW_PERIODS = [20, 50, 100, 200]

RSI_PERIODS      = [7, 14, 21]
RSI_OVERSOLD     = [20, 25, 30, 35]
RSI_OVERBOUGHT   = [60, 65, 70, 75, 80]

MACD_FAST        = [8, 12]
MACD_SLOW        = [21, 26]
MACD_SIGNAL      = [5, 9]

BB_PERIODS       = [10, 20, 30, 50]
BB_STD_DEVS      = [1.5, 2.0, 2.5, 3.0]

STOCH_K_PERIODS  = [5, 9, 14]
STOCH_D_PERIODS  = [3, 5]
STOCH_OVERSOLD   = [20, 25]
STOCH_OVERBOUGHT = [70, 75, 80]

EMA_RSI_EMA_PERIODS = [20, 50, 200]
EMA_RSI_RSI_PERIODS = [7, 14]
EMA_RSI_OVERSOLD    = [25, 30]
EMA_RSI_OVERBOUGHT  = [65, 70]


def _build_sma_combos() -> list[dict[str, Any]]:
    combos = []
    for fast, slow in itertools.product(SMA_FAST_PERIODS, SMA_SLOW_PERIODS):
        if fast >= slow:
            continue
        combos.append({
            "label": f"SMA {fast}/{slow}",
            "params": {"fast": fast, "slow": slow},
            "entry_conditions": [
                {
                    "indicator": "SMA",
                    "params": {"period": fast},
                    "condition": "crosses_above",
                    "target": {"indicator": "SMA", "params": {"period": slow}},
                }
            ],
            "exit_conditions": [
                {
                    "indicator": "SMA",
                    "params": {"period": fast},
                    "condition": "crosses_below",
                    "target": {"indicator": "SMA", "params": {"period": slow}},
                }
            ],
        })
    return combos


def _build_rsi_combos() -> list[dict[str, Any]]:
    combos = []
    for period, oversold, overbought in itertools.product(RSI_PERIODS, RSI_OVERSOLD, RSI_OVERBOUGHT):
        combos.append({
            "label": f"RSI({period}) <{oversold} / >{overbought}",
            "params": {"period": period, "oversold": oversold, "overbought": overbought},
            "entry_conditions": [
                {
                    "indicator": "RSI",
                    "params": {"period": period},
                    "condition": "crosses_below",
                    "target": {"value": oversold},
                }
            ],
            "exit_conditions": [
                {
                    "indicator": "RSI",
                    "params": {"period": period},
                    "condition": "crosses_above",
                    "target": {"value": overbought},
                }
            ],
        })
    return combos


def _build_bb_combos() -> list[dict[str, Any]]:
    combos = []
    for period, std_dev in itertools.product(BB_PERIODS, BB_STD_DEVS):
        combos.append({
            "label": f"BB({period}, {std_dev}σ)",
            "params": {"period": period, "std_dev": std_dev},
            "entry_conditions": [
                {
                    "indicator": "PRICE",
                    "params": {},
                    "condition": "crosses_below",
                    "target": {"indicator": "BB", "params": {"period": period, "std_dev": std_dev}, "sub": "lower"},
                }
            ],
            "exit_conditions": [
                {
                    "indicator": "PRICE",
                    "params": {},
                    "condition": "crosses_above",
                    "target": {"indicator": "BB", "params": {"period": period, "std_dev": std_dev}, "sub": "upper"},
                }
            ],
        })
    return combos


def _build_ema_combos() -> list[dict[str, Any]]:
    combos = []
    for fast, slow in itertools.product(EMA_FAST_PERIODS, EMA_SLOW_PERIODS):
        if fast >= slow:
            continue
        combos.append({
            "label": f"EMA {fast}/{slow}",
            "params": {"fast": fast, "slow": slow},
            "entry_conditions": [
                {
                    "indicator": "EMA",
                    "params": {"period": fast},
                    "condition": "crosses_above",
                    "target": {"indicator": "EMA", "params": {"period": slow}},
                }
            ],
            "exit_conditions": [
                {
                    "indicator": "EMA",
                    "params": {"period": fast},
                    "condition": "crosses_below",
                    "target": {"indicator": "EMA", "params": {"period": slow}},
                }
            ],
        })
    return combos


def _build_macd_combos() -> list[dict[str, Any]]:
    combos = []
    for fast, slow, signal in itertools.product(MACD_FAST, MACD_SLOW, MACD_SIGNAL):
        if fast >= slow:
            continue
        p = {"fast": fast, "slow": slow, "signal": signal}
        combos.append({
            "label": f"MACD({fast},{slow},{signal})",
            "params": p,
            "entry_conditions": [
                {
                    "indicator": "MACD",
                    "params": p,
                    "condition": "crosses_above",
                    "target": {"indicator": "MACD", "params": p, "sub": "signal"},
                }
            ],
            "exit_conditions": [
                {
                    "indicator": "MACD",
                    "params": p,
                    "condition": "crosses_below",
                    "target": {"indicator": "MACD", "params": p, "sub": "signal"},
                }
            ],
        })
    return combos


def _build_stoch_combos() -> list[dict[str, Any]]:
    combos = []
    for k_period, d_period, oversold, overbought in itertools.product(
        STOCH_K_PERIODS, STOCH_D_PERIODS, STOCH_OVERSOLD, STOCH_OVERBOUGHT
    ):
        p = {"k_period": k_period, "d_period": d_period}
        combos.append({
            "label": f"STOCH({k_period},{d_period}) <{oversold} / >{overbought}",
            "params": {"k_period": k_period, "d_period": d_period, "oversold": oversold, "overbought": overbought},
            "entry_conditions": [
                {
                    "indicator": "STOCH",
                    "params": p,
                    "sub": "k",
                    "condition": "crosses_above",
                    "target": {"value": oversold},
                }
            ],
            "exit_conditions": [
                {
                    "indicator": "STOCH",
                    "params": p,
                    "sub": "k",
                    "condition": "crosses_above",
                    "target": {"value": overbought},
                }
            ],
        })
    return combos


def _build_ema_rsi_combos() -> list[dict[str, Any]]:
    combos = []
    for ema_period, rsi_period, oversold, overbought in itertools.product(
        EMA_RSI_EMA_PERIODS, EMA_RSI_RSI_PERIODS, EMA_RSI_OVERSOLD, EMA_RSI_OVERBOUGHT
    ):
        combos.append({
            "label": f"EMA{ema_period}+RSI({rsi_period}) <{oversold} / >{overbought}",
            "params": {"ema_period": ema_period, "rsi_period": rsi_period, "oversold": oversold, "overbought": overbought},
            "entry_conditions": [
                {
                    "indicator": "PRICE",
                    "params": {},
                    "condition": "above",
                    "target": {"indicator": "EMA", "params": {"period": ema_period}},
                },
                {
                    "indicator": "RSI",
                    "params": {"period": rsi_period},
                    "condition": "crosses_below",
                    "target": {"value": oversold},
                },
            ],
            "exit_conditions": [
                {
                    "indicator": "RSI",
                    "params": {"period": rsi_period},
                    "condition": "crosses_above",
                    "target": {"value": overbought},
                }
            ],
        })
    return combos


COMBO_BUILDERS = {
    "SMA":     _build_sma_combos,
    "EMA":     _build_ema_combos,
    "MACD":    _build_macd_combos,
    "RSI":     _build_rsi_combos,
    "BB":      _build_bb_combos,
    "STOCH":   _build_stoch_combos,
    "EMA_RSI": _build_ema_rsi_combos,
}


# ---------------------------------------------------------------------------
# Grid search
# ---------------------------------------------------------------------------

def run_optimization(
    indicator: str,
    period: str,
    interval: str,
    initial_capital: float,
    trading_mode: str,
    stop_loss_pct: float,
    take_profit_pct: float,
    commission_pct: float,
    min_trades: int,
    top_n: int,
    progress_callback=None,
) -> list[dict[str, Any]]:
    builder = COMBO_BUILDERS.get(indicator.upper())
    if builder is None:
        raise ValueError(f"Unsupported indicator: {indicator}. Choose from {list(COMBO_BUILDERS)}")

    combos = builder()
    results = []

    # Pre-fetch data once so every combo reuses it (avoids repeated I/O)
    df = fetch_gold_data(period, interval)

    total = len(combos)
    for idx, combo in enumerate(combos):
        if progress_callback:
            progress_callback(idx + 1, total, combo["label"])
        config = {
            "period": period,
            "interval": interval,
            "initial_capital": initial_capital,
            "entry_conditions": combo["entry_conditions"],
            "entry_logic": "AND",
            "exit_conditions": combo["exit_conditions"],
            "exit_logic": "AND",
            "stop_loss_pct": stop_loss_pct,
            "take_profit_pct": take_profit_pct,
            "commission_pct": commission_pct,
            "trading_mode": trading_mode,
        }
        try:
            result = run_backtest(config)
            s = result.summary
            n = s["num_trades"]
            if n < min_trades:
                continue
            pf = s["profit_factor"]
            pf_val = pf if pf is not None else float("inf")
            results.append({
                "label": combo["label"],
                "params": combo["params"],
                "profit_factor": round(pf_val, 3) if math.isfinite(pf_val) else None,
                "total_return_pct": s["total_return_pct"],
                "annualised_return_pct": s["annualised_return_pct"],
                "sharpe_ratio": s["sharpe_ratio"],
                "max_drawdown_pct": s["max_drawdown_pct"],
                "win_rate_pct": s["win_rate_pct"],
                "num_trades": n,
                "final_capital": s["final_capital"],
            })
        except Exception:
            continue

    # Sort by profit_factor descending (None = ∞ goes to top)
    def sort_key(r: dict) -> float:
        pf = r["profit_factor"]
        return pf if pf is not None else 1e9

    results.sort(key=sort_key, reverse=True)
    return results[:top_n]
