"""
Backtesting engine for gold trading strategies.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd
import yfinance as yf

from strategies import (
    combine_conditions,
    get_indicator_series,
    calc_sma,
    calc_ema,
    calc_rsi,
    calc_macd,
    calc_bollinger_bands,
)


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

@dataclass
class Trade:
    entry_date: str
    exit_date: str | None
    entry_price: float
    exit_price: float | None
    shares: float
    pnl: float
    pnl_pct: float
    exit_reason: str  # "signal" | "stop_loss" | "take_profit" | "end_of_data"
    duration_days: int


@dataclass
class BacktestResult:
    summary: dict[str, Any]
    equity_curve: list[dict[str, Any]]
    trades: list[dict[str, Any]]
    price_data: list[dict[str, Any]]
    indicators: dict[str, list[float | None]]


# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------

def _period_to_days(period: str) -> int:
    mapping = {
        "1d": 1, "5d": 5, "1mo": 30, "2mo": 60, "3mo": 90,
        "6mo": 180, "1y": 365, "2y": 730, "5y": 1825,
        "10y": 3650, "ytd": 365, "max": 36500,
    }
    return mapping.get(period, 365)


def _safe_float(val: Any) -> float | None:
    """Convert numpy/pandas scalar to Python float, return None if NaN."""
    if val is None:
        return None
    try:
        f = float(val)
        return None if math.isnan(f) or math.isinf(f) else f
    except (TypeError, ValueError):
        return None


def _annualised_return(total_return_pct: float, days: int) -> float:
    if days <= 0:
        return 0.0
    years = days / 365.25
    if years == 0:
        return 0.0
    factor = 1 + total_return_pct / 100
    if factor <= 0:
        return -100.0
    return (factor ** (1 / years) - 1) * 100


def _max_drawdown(equity: pd.Series) -> float:
    roll_max = equity.cummax()
    drawdown = (equity - roll_max) / roll_max
    return float(drawdown.min() * 100)


def _bars_per_year(interval: str) -> float:
    """Approximate number of bars per year for annualising Sharpe ratio."""
    mapping = {
        "1m": 252 * 390, "2m": 252 * 195, "5m": 252 * 78,
        "15m": 252 * 26, "30m": 252 * 13, "60m": 252 * 7,
        "1h": 252 * 7,   "1d": 252,       "5d": 52,
        "1wk": 52,       "1mo": 12,
    }
    return float(mapping.get(interval, 252))


def _sharpe_ratio(returns: pd.Series, interval: str = "1d", risk_free_rate: float = 0.05) -> float:
    if len(returns) < 2:
        return 0.0
    bpy = _bars_per_year(interval)
    bar_rf = risk_free_rate / bpy
    excess = returns - bar_rf
    std = excess.std()
    if std == 0:
        return 0.0
    return float((excess.mean() / std) * math.sqrt(bpy))


# ---------------------------------------------------------------------------
# Data fetching
# ---------------------------------------------------------------------------

def fetch_gold_data(period: str = "1y", interval: str = "1d") -> pd.DataFrame:
    """
    Fetch gold OHLCV data.
    Priority: local SQLite DB → yfinance live download.
    """
    from database import init_db, load_bars
    init_db()

    # Try local DB first
    db_df = load_bars("GOLD", interval)
    if not db_df.empty:
        end_dt = pd.Timestamp.now(tz="UTC")
        period_days = _period_to_days(period)
        start_dt = end_dt - pd.Timedelta(days=period_days)
        # Normalize index to UTC-aware
        db_df.index = pd.to_datetime(db_df.index)
        if db_df.index.tz is None:
            db_df.index = db_df.index.tz_localize("UTC")
        else:
            db_df.index = db_df.index.tz_convert("UTC")
        filtered = db_df[db_df.index >= start_dt]
        if len(filtered) >= 20:
            # Strip timezone for downstream compatibility
            filtered = filtered.copy()
            filtered.index = filtered.index.tz_localize(None)
            return filtered.dropna(subset=["Close"])

    # Fall back to live yfinance download
    tickers = ["GC=F", "GLD", "XAUUSD=X"]
    df = pd.DataFrame()
    last_error = None
    for symbol in tickers:
        try:
            data = yf.download(symbol, period=period, interval=interval, progress=False, auto_adjust=True)
            if not data.empty:
                df = data
                break
        except Exception as e:
            last_error = e
            continue
    if df.empty:
        raise ValueError(
            f"ローカルDBにデータがなく、yfinanceからも取得できませんでした。"
            f"先にデータをダウンロードしてください。(エラー: {last_error})"
        )
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df = df[["Open", "High", "Low", "Close", "Volume"]].copy()
    df.index = pd.to_datetime(df.index)
    df = df.sort_index()
    df = df.dropna(subset=["Close"])
    return df


# ---------------------------------------------------------------------------
# Indicator overlay builder (for chart display)
# ---------------------------------------------------------------------------

def build_indicator_overlays(
    df: pd.DataFrame,
    entry_conditions: list[dict],
    exit_conditions: list[dict],
) -> dict[str, list[float | None]]:
    """
    Build indicator series for all conditions so the frontend can render
    overlays on the price chart.
    """
    overlays: dict[str, list[float | None]] = {}

    all_conditions = entry_conditions + exit_conditions
    for cond in all_conditions:
        ind = cond.get("indicator", "").upper()
        params = cond.get("params", {})

        if ind in ("PRICE", ""):
            continue

        # Build a display key
        if ind == "SMA":
            key = f"SMA_{params.get('period', 20)}"
        elif ind == "EMA":
            key = f"EMA_{params.get('period', 20)}"
        elif ind == "RSI":
            key = f"RSI_{params.get('period', 14)}"
        elif ind == "MACD":
            key = "MACD"
        elif ind in ("BB", "BOLLINGER", "BOLLINGER_BANDS"):
            period = params.get("period", 20)
            key = f"BB_{period}"
        else:
            key = ind

        if key in overlays:
            continue

        try:
            series = get_indicator_series(df, ind, params)
            overlays[key] = [_safe_float(v) for v in series]

            # For BB, also add upper/lower
            if ind in ("BB", "BOLLINGER", "BOLLINGER_BANDS"):
                period = int(params.get("period", 20))
                std_dev = float(params.get("std_dev", 2.0))
                bb = calc_bollinger_bands(df["Close"], period, std_dev)
                overlays[f"BB_{period}_upper"] = [_safe_float(v) for v in bb["upper"]]
                overlays[f"BB_{period}_lower"] = [_safe_float(v) for v in bb["lower"]]

            # For MACD, add signal line
            if ind == "MACD":
                fast = int(params.get("fast", 12))
                slow = int(params.get("slow", 26))
                signal = int(params.get("signal", 9))
                macd_data = calc_macd(df["Close"], fast, slow, signal)
                overlays["MACD_signal"] = [_safe_float(v) for v in macd_data["signal"]]
                overlays["MACD_histogram"] = [_safe_float(v) for v in macd_data["histogram"]]

        except Exception:
            pass

        # Also process the target if it's an indicator
        target = cond.get("target", {})
        if "indicator" in target and target["indicator"].upper() not in ("PRICE",):
            t_ind = target["indicator"].upper()
            t_params = target.get("params", {})
            t_sub = target.get("sub")

            if t_ind == "SMA":
                t_key = f"SMA_{t_params.get('period', 20)}"
            elif t_ind == "EMA":
                t_key = f"EMA_{t_params.get('period', 20)}"
            elif t_ind == "RSI":
                t_key = f"RSI_{t_params.get('period', 14)}"
            elif t_ind in ("BB", "BOLLINGER", "BOLLINGER_BANDS"):
                t_period = t_params.get("period", 20)
                t_key = f"BB_{t_period}"
            else:
                t_key = t_ind

            if t_key not in overlays:
                try:
                    t_series = get_indicator_series(df, t_ind, t_params)
                    overlays[t_key] = [_safe_float(v) for v in t_series]

                    if t_ind in ("BB", "BOLLINGER", "BOLLINGER_BANDS"):
                        t_period = int(t_params.get("period", 20))
                        t_std = float(t_params.get("std_dev", 2.0))
                        bb = calc_bollinger_bands(df["Close"], t_period, t_std)
                        overlays[f"BB_{t_period}_upper"] = [_safe_float(v) for v in bb["upper"]]
                        overlays[f"BB_{t_period}_lower"] = [_safe_float(v) for v in bb["lower"]]
                except Exception:
                    pass

    return overlays


# ---------------------------------------------------------------------------
# Core backtesting loop
# ---------------------------------------------------------------------------

def run_backtest(config: dict[str, Any]) -> BacktestResult:
    """
    Execute a backtest given a strategy configuration dict.
    """
    period = config.get("period", "1y")
    interval = config.get("interval", "1d")
    initial_capital = float(config.get("initial_capital", 10000))
    entry_conditions = config.get("entry_conditions", [])
    exit_conditions = config.get("exit_conditions", [])
    entry_logic = config.get("entry_logic", "AND")
    exit_logic = config.get("exit_logic", "AND")
    stop_loss_pct = float(config.get("stop_loss_pct", 0) or 0)
    take_profit_pct = float(config.get("take_profit_pct", 0) or 0)
    commission_pct = float(config.get("commission_pct", 0) or 0)  # e.g. 0.1 = 0.1%

    # --- Fetch data ---
    df = fetch_gold_data(period, interval)

    # --- Build signal arrays ---
    entry_signals = combine_conditions(df, entry_conditions, entry_logic)
    exit_signals = combine_conditions(df, exit_conditions, exit_logic)

    # --- Simulation ---
    capital = initial_capital
    position: float = 0.0          # shares held
    entry_price: float = 0.0
    entry_date: str = ""
    entry_index: int = -1

    trades: list[Trade] = []
    equity_values: list[float] = []

    prices = df["Close"].values
    dates = df.index
    n = len(df)

    for i in range(n):
        price = prices[i]
        date_str = str(dates[i].date())

        if position == 0:
            # Check for entry signal
            if entry_signals.iloc[i]:
                entry_commission = capital * commission_pct / 100
                capital -= entry_commission
                shares = capital / price
                position = shares
                entry_price = price
                entry_date = date_str
                entry_index = i
                capital = 0.0
        else:
            # Check stop loss / take profit first
            pnl_pct = (price - entry_price) / entry_price * 100
            exit_reason = None

            if stop_loss_pct > 0 and pnl_pct <= -stop_loss_pct:
                exit_reason = "stop_loss"
            elif take_profit_pct > 0 and pnl_pct >= take_profit_pct:
                exit_reason = "take_profit"
            elif exit_signals.iloc[i]:
                exit_reason = "signal"

            if exit_reason:
                exit_value = position * price
                exit_commission = exit_value * commission_pct / 100
                exit_value -= exit_commission
                pnl = exit_value - (position * entry_price)
                pnl_pct = pnl / (position * entry_price) * 100
                duration = (dates[i] - dates[entry_index]).days

                trades.append(
                    Trade(
                        entry_date=entry_date,
                        exit_date=date_str,
                        entry_price=entry_price,
                        exit_price=price,
                        shares=position,
                        pnl=pnl,
                        pnl_pct=pnl_pct,
                        exit_reason=exit_reason,
                        duration_days=duration,
                    )
                )
                capital = exit_value
                position = 0.0

        # Current equity
        equity_values.append(capital + position * price)

    # Close any open position at end
    if position > 0:
        last_price = prices[-1]
        exit_value = position * last_price
        exit_value -= exit_value * commission_pct / 100
        pnl = exit_value - (position * entry_price)
        pnl_pct = pnl / (position * entry_price) * 100
        duration = (dates[-1] - dates[entry_index]).days
        trades.append(
            Trade(
                entry_date=entry_date,
                exit_date=str(dates[-1].date()),
                entry_price=entry_price,
                exit_price=last_price,
                shares=position,
                pnl=pnl,
                pnl_pct=pnl_pct,
                exit_reason="end_of_data",
                duration_days=duration,
            )
        )
        capital = exit_value
        position = 0.0
        equity_values[-1] = capital

    # --- Metrics ---
    equity_series = pd.Series(equity_values, index=df.index)
    daily_returns = equity_series.pct_change().dropna()

    total_return_pct = (equity_values[-1] - initial_capital) / initial_capital * 100
    total_days = (dates[-1] - dates[0]).days
    annualised_return = _annualised_return(total_return_pct, total_days)
    max_dd = _max_drawdown(equity_series)
    sharpe = _sharpe_ratio(daily_returns, interval)

    winning_trades = [t for t in trades if t.pnl > 0]
    losing_trades = [t for t in trades if t.pnl <= 0]
    win_rate = (len(winning_trades) / len(trades) * 100) if trades else 0.0

    gross_profit = sum(t.pnl for t in winning_trades)
    gross_loss = abs(sum(t.pnl for t in losing_trades))
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else float("inf")

    avg_duration = (
        sum(t.duration_days for t in trades) / len(trades) if trades else 0
    )

    summary = {
        "total_return_pct": round(total_return_pct, 2),
        "annualised_return_pct": round(annualised_return, 2),
        "max_drawdown_pct": round(max_dd, 2),
        "sharpe_ratio": round(sharpe, 3),
        "win_rate_pct": round(win_rate, 2),
        "profit_factor": round(profit_factor, 3) if math.isfinite(profit_factor) else None,
        "num_trades": len(trades),
        "num_winning": len(winning_trades),
        "num_losing": len(losing_trades),
        "avg_trade_duration_days": round(avg_duration, 1),
        "initial_capital": initial_capital,
        "final_capital": round(equity_values[-1], 2),
        "commission_pct": commission_pct,
        "total_commission": round(len(trades) * 2 * initial_capital * commission_pct / 100, 2),
        "period": period,
        "interval": interval,
    }

    equity_curve = [
        {"date": str(dates[i].date()), "equity": round(equity_values[i], 2)}
        for i in range(n)
    ]

    trades_list = [
        {
            "entry_date": t.entry_date,
            "exit_date": t.exit_date,
            "entry_price": round(t.entry_price, 2),
            "exit_price": round(t.exit_price, 2) if t.exit_price else None,
            "shares": round(t.shares, 6),
            "pnl": round(t.pnl, 2),
            "pnl_pct": round(t.pnl_pct, 2),
            "exit_reason": t.exit_reason,
            "duration_days": t.duration_days,
        }
        for t in trades
    ]

    # --- Price data for chart ---
    # Build signal markers
    entry_set = set()
    exit_set = set()
    for t in trades:
        entry_set.add(t.entry_date)
        if t.exit_date:
            exit_set.add(t.exit_date)

    price_data = []
    for i in range(n):
        row = df.iloc[i]
        d = str(dates[i].date())
        price_data.append(
            {
                "date": d,
                "open": _safe_float(row["Open"]),
                "high": _safe_float(row["High"]),
                "low": _safe_float(row["Low"]),
                "close": _safe_float(row["Close"]),
                "volume": _safe_float(row["Volume"]),
                "signal": "buy" if d in entry_set else ("sell" if d in exit_set else None),
            }
        )

    indicators = build_indicator_overlays(df, entry_conditions, exit_conditions)

    return BacktestResult(
        summary=summary,
        equity_curve=equity_curve,
        trades=trades_list,
        price_data=price_data,
        indicators=indicators,
    )
