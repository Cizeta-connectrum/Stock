"""
Strategy evaluation logic for the gold backtesting engine.
Supports crossover/crossunder, threshold conditions, and indicator calculations.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from typing import Any


# ---------------------------------------------------------------------------
# Indicator calculations
# ---------------------------------------------------------------------------

def calc_sma(series: pd.Series, period: int) -> pd.Series:
    return series.rolling(window=period).mean()


def calc_ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()


def calc_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(com=period - 1, min_periods=period).mean()
    avg_loss = loss.ewm(com=period - 1, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    return rsi.fillna(50)


def calc_macd(
    series: pd.Series,
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> dict[str, pd.Series]:
    ema_fast = calc_ema(series, fast)
    ema_slow = calc_ema(series, slow)
    macd_line = ema_fast - ema_slow
    signal_line = calc_ema(macd_line, signal)
    histogram = macd_line - signal_line
    return {"macd": macd_line, "signal": signal_line, "histogram": histogram}


def calc_stochastic(
    df: pd.DataFrame,
    k_period: int = 14,
    d_period: int = 3,
) -> dict[str, pd.Series]:
    low_min = df["Low"].rolling(window=k_period).min()
    high_max = df["High"].rolling(window=k_period).max()
    denom = (high_max - low_min).replace(0, np.nan)
    k = 100 * (df["Close"] - low_min) / denom
    d = k.rolling(window=d_period).mean()
    return {"k": k.fillna(50), "d": d.fillna(50)}



    series: pd.Series,
    period: int = 20,
    std_dev: float = 2.0,
) -> dict[str, pd.Series]:
    middle = calc_sma(series, period)
    std = series.rolling(window=period).std()
    upper = middle + std_dev * std
    lower = middle - std_dev * std
    return {"upper": upper, "middle": middle, "lower": lower}


# ---------------------------------------------------------------------------
# Indicator registry: build a named series from a condition spec
# ---------------------------------------------------------------------------

def get_indicator_series(
    df: pd.DataFrame,
    indicator: str,
    params: dict[str, Any],
    sub: str | None = None,
) -> pd.Series:
    """
    Return a Series for the requested indicator.
    `sub` selects sub-series for multi-output indicators (e.g. 'upper' for BB).
    """
    close = df["Close"]
    ind = indicator.upper()

    if ind == "SMA":
        period = int(params.get("period", 20))
        return calc_sma(close, period)

    if ind == "EMA":
        period = int(params.get("period", 20))
        return calc_ema(close, period)

    if ind == "RSI":
        period = int(params.get("period", 14))
        return calc_rsi(close, period)

    if ind == "MACD":
        fast = int(params.get("fast", 12))
        slow = int(params.get("slow", 26))
        signal = int(params.get("signal", 9))
        result = calc_macd(close, fast, slow, signal)
        key = sub if sub in result else "macd"
        return result[key]

    if ind in ("BB", "BOLLINGER", "BOLLINGER_BANDS"):
        period = int(params.get("period", 20))
        std_dev = float(params.get("std_dev", 2.0))
        result = calc_bollinger_bands(close, period, std_dev)
        key = sub if sub in result else "middle"
        return result[key]

    if ind in ("STOCH", "STOCHASTIC"):
        k_period = int(params.get("k_period", 14))
        d_period = int(params.get("d_period", 3))
        result = calc_stochastic(df, k_period, d_period)
        key = sub if sub in result else "k"
        return result[key]

    if ind == "PRICE":
        return close

    raise ValueError(f"Unknown indicator: {indicator}")


# ---------------------------------------------------------------------------
# Condition evaluation (vectorised)
# ---------------------------------------------------------------------------

def _resolve_target(
    df: pd.DataFrame,
    target: dict[str, Any],
) -> pd.Series:
    """
    A condition target can be:
      - {"indicator": "SMA", "params": {"period": 30}} -> indicator series
      - {"value": 30}                                  -> scalar constant
    """
    if "value" in target:
        return pd.Series(float(target["value"]), index=df.index)
    return get_indicator_series(
        df,
        target["indicator"],
        target.get("params", {}),
        target.get("sub"),
    )


def evaluate_condition(
    df: pd.DataFrame,
    cond: dict[str, Any],
) -> pd.Series:
    """
    Evaluate a single condition and return a boolean Series.

    Supported condition types:
      crosses_above  – indicator crossed above target (False->True transition)
      crosses_below  – indicator crossed below target
      above          – indicator > target
      below          – indicator < target
      above_equal    – indicator >= target
      below_equal    – indicator <= target
    """
    ind_series = get_indicator_series(
        df,
        cond["indicator"],
        cond.get("params", {}),
        cond.get("sub"),
    )
    target_series = _resolve_target(df, cond.get("target", {"value": 0}))

    ctype = cond["condition"].lower()

    if ctype == "crosses_above":
        prev_below = ind_series.shift(1) <= target_series.shift(1)
        now_above = ind_series > target_series
        return prev_below & now_above

    if ctype == "crosses_below":
        prev_above = ind_series.shift(1) >= target_series.shift(1)
        now_below = ind_series < target_series
        return prev_above & now_below

    if ctype == "above":
        return ind_series > target_series

    if ctype == "below":
        return ind_series < target_series

    if ctype == "above_equal":
        return ind_series >= target_series

    if ctype == "below_equal":
        return ind_series <= target_series

    raise ValueError(f"Unknown condition type: {ctype}")


def combine_conditions(
    df: pd.DataFrame,
    conditions: list[dict[str, Any]],
    logic: str = "AND",
) -> pd.Series:
    """
    Combine a list of conditions with AND or OR logic.
    """
    if not conditions:
        return pd.Series(False, index=df.index)

    result = evaluate_condition(df, conditions[0])
    for cond in conditions[1:]:
        next_cond = evaluate_condition(df, cond)
        if logic.upper() == "OR":
            result = result | next_cond
        else:
            result = result & next_cond

    return result


# ---------------------------------------------------------------------------
# Preset strategies
# ---------------------------------------------------------------------------

PRESET_STRATEGIES = {
    "golden_cross": {
        "name": "Golden Cross (SMA 50/200)",
        "description": "Buy when 50-day SMA crosses above 200-day SMA; sell on cross below.",
        "period": "2y",
        "interval": "1d",
        "initial_capital": 10000,
        "entry_conditions": [
            {
                "indicator": "SMA",
                "params": {"period": 50},
                "condition": "crosses_above",
                "target": {"indicator": "SMA", "params": {"period": 200}},
            }
        ],
        "entry_logic": "AND",
        "exit_conditions": [
            {
                "indicator": "SMA",
                "params": {"period": 50},
                "condition": "crosses_below",
                "target": {"indicator": "SMA", "params": {"period": 200}},
            }
        ],
        "exit_logic": "AND",
        "stop_loss_pct": 5.0,
        "take_profit_pct": 15.0,
    },
    "rsi_reversion": {
        "name": "RSI Oversold / Overbought",
        "description": "Buy when RSI drops below 30 (oversold); sell when RSI rises above 70.",
        "period": "1y",
        "interval": "1d",
        "initial_capital": 10000,
        "entry_conditions": [
            {
                "indicator": "RSI",
                "params": {"period": 14},
                "condition": "below",
                "target": {"value": 30},
            }
        ],
        "entry_logic": "AND",
        "exit_conditions": [
            {
                "indicator": "RSI",
                "params": {"period": 14},
                "condition": "above",
                "target": {"value": 70},
            }
        ],
        "exit_logic": "AND",
        "stop_loss_pct": 3.0,
        "take_profit_pct": 8.0,
    },
    "bollinger_reversion": {
        "name": "Bollinger Band Reversion",
        "description": "Buy when price touches/crosses below lower BB; sell at middle band.",
        "period": "1y",
        "interval": "1d",
        "initial_capital": 10000,
        "entry_conditions": [
            {
                "indicator": "PRICE",
                "params": {},
                "condition": "below",
                "target": {"indicator": "BB", "params": {"period": 20, "std_dev": 2.0}, "sub": "lower"},
            }
        ],
        "entry_logic": "AND",
        "exit_conditions": [
            {
                "indicator": "PRICE",
                "params": {},
                "condition": "above",
                "target": {"indicator": "BB", "params": {"period": 20, "std_dev": 2.0}, "sub": "middle"},
            }
        ],
        "exit_logic": "AND",
        "stop_loss_pct": 2.0,
        "take_profit_pct": 4.0,
    },
    "scalping_ema": {
        "name": "スキャルピング EMA (5m)",
        "description": "5分足でEMA3がEMA10をクロス。デイトレード向け。",
        "period": "1mo",
        "interval": "5m",
        "initial_capital": 10000,
        "entry_conditions": [
            {
                "indicator": "EMA",
                "params": {"period": 3},
                "condition": "crosses_above",
                "target": {"indicator": "EMA", "params": {"period": 10}},
            }
        ],
        "entry_logic": "AND",
        "exit_conditions": [
            {
                "indicator": "EMA",
                "params": {"period": 3},
                "condition": "crosses_below",
                "target": {"indicator": "EMA", "params": {"period": 10}},
            }
        ],
        "exit_logic": "AND",
        "stop_loss_pct": 0.3,
        "take_profit_pct": 0.6,
    },
    "scalping_rsi": {
        "name": "スキャルピング RSI (5m)",
        "description": "5分足でRSI30割れでエントリー、70超えでエグジット。",
        "period": "1mo",
        "interval": "5m",
        "initial_capital": 10000,
        "entry_conditions": [
            {
                "indicator": "RSI",
                "params": {"period": 7},
                "condition": "below",
                "target": {"value": 30},
            }
        ],
        "entry_logic": "AND",
        "exit_conditions": [
            {
                "indicator": "RSI",
                "params": {"period": 7},
                "condition": "above",
                "target": {"value": 70},
            }
        ],
        "exit_logic": "AND",
        "stop_loss_pct": 0.3,
        "take_profit_pct": 0.6,
    },
}
