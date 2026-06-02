"""
FastAPI backend for the Gold Backtesting Platform.
"""

from __future__ import annotations

import asyncio
import json
import math
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import yfinance as yf
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

_executor = ThreadPoolExecutor(max_workers=2)

from backtester import fetch_gold_data, run_backtest
from strategies import PRESET_STRATEGIES
from database import init_db, get_data_status, save_optimization_run, list_optimization_runs, delete_optimization_run
from data_manager import download_yfinance, download_twelve_data
from optimizer import run_optimization

from drive_sync import download_db, upload_db

init_db()
try:
    result = download_db()  # Restore DB from Google Drive on startup
    print(f"[Startup] Drive download result: {result}")
except Exception as e:
    print(f"[Startup] Drive download exception: {e}")
init_db()      # Ensure tables exist after DB restore
print("[Startup] DB initialized successfully")


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
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
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
    commission_pct: float = 0.0
    trading_mode: str = "long_only"  # "long_only" | "always_in"


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
            "id": "STOCH",
            "name": "Stochastic",
            "params": [
                {"name": "k_period", "type": "int", "default": 14, "min": 3, "max": 50},
                {"name": "d_period", "type": "int", "default": 3,  "min": 1, "max": 10},
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


class OptimizeRequest(BaseModel):
    indicator: str = "SMA"          # "SMA" | "RSI" | "BB"
    period: str = "1y"
    interval: str = "1d"
    initial_capital: float = 10000.0
    trading_mode: str = "long_only"
    stop_loss_pct: float = 0.0
    take_profit_pct: float = 0.0
    commission_pct: float = 0.1
    min_trades: int = 5
    top_n: int = 20


@app.post("/api/optimize")
async def optimize(req: OptimizeRequest):
    """
    Grid-search with SSE progress streaming.
    """
    progress: dict[str, Any] = {"current": 0, "total": 0, "label": ""}

    def progress_callback(current: int, total: int, label: str) -> None:
        progress["current"] = current
        progress["total"] = total
        progress["label"] = label

    def run() -> list:
        try:
            return run_optimization(
                indicator=req.indicator,
                period=req.period,
                interval=req.interval,
                initial_capital=req.initial_capital,
                trading_mode=req.trading_mode,
                stop_loss_pct=req.stop_loss_pct,
                take_profit_pct=req.take_profit_pct,
                commission_pct=req.commission_pct,
                min_trades=req.min_trades,
                top_n=req.top_n,
                progress_callback=progress_callback,
            )
        except Exception as exc:
            raise exc

    async def stream():
        loop = asyncio.get_event_loop()
        future = loop.run_in_executor(_executor, run)
        while not future.done():
            data = json.dumps({"current": progress["current"], "total": progress["total"], "label": progress["label"]})
            yield f"data: {data}\n\n"
            await asyncio.sleep(0.5)
        try:
            results = await future
        except Exception as exc:
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"
            return
        run_id = save_optimization_run(
            indicator=req.indicator,
            period=req.period,
            interval=req.interval,
            trading_mode=req.trading_mode,
            commission=req.commission_pct,
            stop_loss=req.stop_loss_pct,
            take_profit=req.take_profit_pct,
            results=results,
        )
        yield f"data: {json.dumps({'done': True, 'results': results, 'count': len(results), 'run_id': run_id})}\n\n"
        # Upload DB in background after sending done event
        loop = asyncio.get_event_loop()
        loop.run_in_executor(_executor, upload_db)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
    })


@app.get("/api/optimize/history")
async def optimize_history():
    return {"runs": list_optimization_runs()}


@app.delete("/api/optimize/history/{run_id}")
async def delete_optimize_run(run_id: int):
    ok = delete_optimization_run(run_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Run not found")
    return {"deleted": run_id}


@app.api_route("/health", methods=["GET", "HEAD"])
async def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Data management endpoints
# ---------------------------------------------------------------------------

class YFinanceDownloadRequest(BaseModel):
    interval: str = "5m"
    days_back: int | None = None


class TwelveDataDownloadRequest(BaseModel):
    api_key: str
    interval: str = "5m"
    start_date: str = "2020-01-01"
    end_date: str | None = None


@app.get("/api/data/status")
async def data_status():
    """Return what data is stored locally."""
    return {"datasets": get_data_status()}


@app.post("/api/data/download/yfinance")
async def download_yf(req: YFinanceDownloadRequest):
    """
    Download gold data from yfinance and store in local DB.
    Limit: 1m=29days, 5m=59days, 1h=729days.
    """
    valid = {"1m", "5m", "15m", "30m", "1h", "60m", "1d"}
    if req.interval not in valid:
        raise HTTPException(status_code=400, detail=f"interval must be one of {sorted(valid)}")
    try:
        result = download_yfinance(req.interval, req.days_back)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    upload_db()
    return result


@app.post("/api/data/download/twelvedata")
async def download_td(req: TwelveDataDownloadRequest):
    """
    Download GLD intraday data from Twelve Data (free tier).
    API key: https://twelvedata.com (free signup, 800 req/day)
    Each request fetches 5000 bars. Pages backwards from end_date to start_date.
    """
    valid = {"1m", "5m", "15m", "30m", "1h", "1d"}
    if req.interval not in valid:
        raise HTTPException(status_code=400, detail=f"interval must be one of {sorted(valid)}")
    if not req.api_key:
        raise HTTPException(status_code=400, detail="api_key is required")
    import traceback
    try:
        result = download_twelve_data(req.api_key, req.interval, req.start_date, req.end_date)
    except Exception as e:
        detail = f"{type(e).__name__}: {e}\n{traceback.format_exc()}"
        print(detail)
        raise HTTPException(status_code=500, detail=str(e))
    upload_db()
    return result


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def _sf(val: Any) -> float | None:
    try:
        f = float(val)
        return None if (math.isnan(f) or math.isinf(f)) else f
    except (TypeError, ValueError):
        return None
