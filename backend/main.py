"""
FastAPI backend for the Gold Backtesting Platform.
"""

from __future__ import annotations

import math
from typing import Any

import yfinance as yf
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backtester import fetch_gold_data, run_backtest
from strategies import PRESET_STRATEGIES


# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Gold Backtesting API",
    description="Backtest trading strategies on gold futures (GC=F)",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class ConditionSpec(BaseModel):
    indicator: str
    params: dict[str, Any] = {}
    condition: str
    target: dict[str, Any] = {}
    sub: str | None = None


class StrategyConfig(BaseModel):
    period: str = "1y"
    interval: str = "1d"
    initial_capital: float = 10000.0
    entry_conditions: list[ConditionSpec] = []
    entry_logic: str = "AND"
    exit_conditions: list[ConditionSpec] = []
    exit_logic: str = "AND"
    stop_loss_pct: float = 0.0
    take_profit_pct: float = 0.0


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/gold/data")
async def get_gold_data(
    period: str = Query(default="1y", description="Data period (e.g. 1mo, 3mo, 6mo, 1y, 2y, 5y)"),
    interval: str = Query(default="1d", description="Bar interval (e.g. 1d, 1h, 30m)"),
):
    """
    Fetch gold OHLCV data for the given period and interval.
    Returns a list of bars suitable for charting.
    """
    valid_periods = {"1d", "5d", "1mo", "2mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"}
    valid_intervals = {"1m", "2m", "5m", "15m", "30m", "60m", "1h", "1d", "5d", "1wk", "1mo"}

    if period not in valid_periods:
        raise HTTPException(status_code=400, detail=f"Invalid period. Choose from: {sorted(valid_periods)}")
    if interval not in valid_intervals:
        raise HTTPException(status_code=400, detail=f"Invalid interval. Choose from: {sorted(valid_intervals)}")

    try:
        df = fetch_gold_data(period=period, interval=interval)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch data: {exc}")

    bars = []
    for ts, row in df.iterrows():
        bars.append(
            {
                "date": str(ts.date()),
                "open": _sf(row["Open"]),
                "high": _sf(row["High"]),
                "low": _sf(row["Low"]),
                "close": _sf(row["Close"]),
                "volume": _sf(row["Volume"]),
            }
        )
    return {"ticker": "GC=F", "period": period, "interval": interval, "bars": bars}


@app.post("/api/backtest")
async def backtest(config: StrategyConfig):
    """
    Run a backtest with the given strategy configuration.
    Returns equity curve, trade list, price data with signals, and summary stats.
    """
    if not config.entry_conditions:
        raise HTTPException(status_code=400, detail="At least one entry condition is required.")
    if not config.exit_conditions:
        raise HTTPException(status_code=400, detail="At least one exit condition is required.")

    try:
        result = run_backtest(config.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Backtest error: {exc}")

    return {
        "summary": result.summary,
        "equity_curve": result.equity_curve,
        "trades": result.trades,
        "price_data": result.price_data,
        "indicators": result.indicators,
    }


@app.get("/api/strategies")
async def list_strategies():
    """
    Return the list of available indicator types and preset strategies.
    """
    indicators = [
        {
            "id": "SMA",
            "name": "Simple Moving Average",
            "params": [{"name": "period", "type": "int", "default": 20, "min": 2, "max": 500}],
        },
        {
            "id": "EMA",
            "name": "Exponential Moving Average",
            "params": [{"name": "period", "type": "int", "default": 20, "min": 2, "max": 500}],
        },
        {
            "id": "RSI",
            "name": "Relative Strength Index",
            "params": [{"name": "period", "type": "int", "default": 14, "min": 2, "max": 100}],
        },
        {
            "id": "MACD",
            "name": "MACD",
            "params": [
                {"name": "fast", "type": "int", "default": 12, "min": 2, "max": 100},
                {"name": "slow", "type": "int", "default": 26, "min": 2, "max": 200},
                {"name": "signal", "type": "int", "default": 9, "min": 2, "max": 50},
            ],
        },
        {
            "id": "BB",
            "name": "Bollinger Bands",
            "params": [
                {"name": "period", "type": "int", "default": 20, "min": 2, "max": 200},
                {"name": "std_dev", "type": "float", "default": 2.0, "min": 0.5, "max": 5.0},
            ],
        },
        {
            "id": "PRICE",
            "name": "Price (Close)",
            "params": [],
        },
    ]

    condition_types = [
        {"id": "crosses_above", "name": "Crosses Above"},
        {"id": "crosses_below", "name": "Crosses Below"},
        {"id": "above", "name": "Is Above"},
        {"id": "below", "name": "Is Below"},
        {"id": "above_equal", "name": "Is Above or Equal"},
        {"id": "below_equal", "name": "Is Below or Equal"},
    ]

    return {
        "indicators": indicators,
        "condition_types": condition_types,
        "preset_strategies": [
            {"id": k, **{kk: vv for kk, vv in v.items()}}
            for k, v in PRESET_STRATEGIES.items()
        ],
    }


@app.get("/health")
async def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def _sf(val: Any) -> float | None:
    try:
        f = float(val)
        return None if (math.isnan(f) or math.isinf(f)) else f
    except (TypeError, ValueError):
        return None
