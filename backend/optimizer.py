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

RSI_PERIODS      = [7, 14, 21]
RSI_OVERSOLD     = [20, 25, 30, 35]
RSI_OVERBOUGHT   = [60, 65, 70, 75, 80]

BB_PERIODS       = [10, 20, 30, 50]
BB_STD_DEVS      = [1.5, 2.0, 2.5, 3.0]


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


COMBO_BUILDERS = {
    "SMA": _build_sma_combos,
    "RSI": _build_rsi_combos,
    "BB":  _build_bb_combos,
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
) -> list[dict[str, Any]]:
    builder = COMBO_BUILDERS.get(indicator.upper())
    if builder is None:
        raise ValueError(f"Unsupported indicator: {indicator}. Choose from {list(COMBO_BUILDERS)}")

    combos = builder()
    results = []

    # Pre-fetch data once so every combo reuses it (avoids repeated I/O)
    df = fetch_gold_data(period, interval)

    for combo in combos:
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
