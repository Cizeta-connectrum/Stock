"""
Data download manager.
Supports:
  1. yfinance     – chunked download (free, no key, limited to ~60 days intraday)
  2. Twelve Data  – free API key, years of intraday history, 800 req/day
"""

from __future__ import annotations

import json
import ssl
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Generator

import pandas as pd
import yfinance as yf

from database import upsert_bars

# yfinance per-request limits (days)
YF_CHUNK_DAYS: dict[str, int] = {
    "1m":  6,
    "2m":  6,
    "5m":  55,
    "15m": 55,
    "30m": 55,
    "60m": 55,
    "1h":  55,
    "1d":  3650,
    "1wk": 3650,
}

YF_MAX_LOOKBACK: dict[str, int] = {
    "1m":  29,
    "2m":  59,
    "5m":  59,
    "15m": 59,
    "30m": 59,
    "60m": 729,
    "1h":  729,
    "1d":  36500,
    "1wk": 36500,
}

GOLD_SYMBOLS = ["GC=F", "GLD", "XAUUSD=X"]

# Twelve Data interval mapping
TD_INTERVAL_MAP = {
    "1m": "1min", "5m": "5min", "15m": "15min",
    "30m": "30min", "1h": "1h", "1d": "1day",
}


def _ssl_ctx() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _date_chunks(
    start: datetime, end: datetime, chunk_days: int
) -> Generator[tuple[datetime, datetime], None, None]:
    cur = start
    while cur < end:
        chunk_end = min(cur + timedelta(days=chunk_days), end)
        yield cur, chunk_end
        cur = chunk_end


# ---------------------------------------------------------------------------
# yfinance
# ---------------------------------------------------------------------------

def download_yfinance(interval: str, days_back: int | None = None) -> dict:
    """Download gold data from yfinance using chunked requests."""
    max_back = YF_MAX_LOOKBACK.get(interval, 59)
    if days_back is None or days_back > max_back:
        days_back = max_back

    chunk_days = YF_CHUNK_DAYS.get(interval, 55)
    end_dt = datetime.now(tz=timezone.utc)
    start_dt = end_dt - timedelta(days=days_back)

    total_bars = 0
    errors = []

    for chunk_start, chunk_end in _date_chunks(start_dt, end_dt, chunk_days):
        df = pd.DataFrame()
        for symbol in GOLD_SYMBOLS:
            try:
                raw = yf.download(
                    symbol,
                    start=chunk_start.strftime("%Y-%m-%d"),
                    end=chunk_end.strftime("%Y-%m-%d"),
                    interval=interval,
                    progress=False,
                    auto_adjust=True,
                )
                if not raw.empty:
                    if isinstance(raw.columns, pd.MultiIndex):
                        raw.columns = raw.columns.get_level_values(0)
                    df = raw
                    break
            except Exception as e:
                errors.append(str(e))
                continue

        if not df.empty:
            cols = [c for c in ["Open", "High", "Low", "Close", "Volume"] if c in df.columns]
            total_bars += upsert_bars("GOLD", interval, df[cols])

        time.sleep(0.3)

    return {
        "source": "yfinance",
        "interval": interval,
        "days_requested": days_back,
        "bars_stored": total_bars,
        "errors": errors[:5],
    }


# ---------------------------------------------------------------------------
# Twelve Data
# ---------------------------------------------------------------------------

def download_twelve_data(
    api_key: str,
    interval: str,
    start_date: str,          # "YYYY-MM-DD"
    end_date: str | None = None,
) -> dict:
    """
    Download gold (GLD) intraday data from Twelve Data.
    Free tier: 800 req/day, 8 req/min, 5000 bars/request.
    API key: https://twelvedata.com (free signup)
    """
    td_interval = TD_INTERVAL_MAP.get(interval)
    if not td_interval:
        return {"error": f"Unsupported interval: {interval}"}

    if end_date is None:
        end_date = datetime.now().strftime("%Y-%m-%d")

    ctx = _ssl_ctx()
    total_bars = 0
    errors = []
    request_count = 0

    # We page backwards using end_date, fetching 5000 bars at a time
    current_end = end_date
    start_dt = pd.Timestamp(start_date, tz="America/New_York")

    while True:
        url = (
            f"https://api.twelvedata.com/time_series"
            f"?symbol=GLD"
            f"&interval={td_interval}"
            f"&outputsize=5000"
            f"&end_date={str(current_end).replace(' ', '%20')}"
            f"&timezone=America/New_York"
            f"&apikey={api_key}"
        )

        try:
            with urllib.request.urlopen(url, timeout=30, context=ctx) as resp:
                data = json.loads(resp.read())
        except Exception as e:
            errors.append(f"Request error: {e}")
            break

        request_count += 1
        # Log first response for debugging
        if request_count == 1:
            print(f"[TwelveData] First response keys: {list(data.keys())}")
            if "status" in data:
                print(f"[TwelveData] status={data['status']}, message={data.get('message')}")

        if data.get("status") == "error":
            errors.append(data.get("message", "Unknown API error"))
            break

        values = data.get("values")
        if not values:
            break

        records = []
        timestamps = []
        for bar in values:
            ts = pd.Timestamp(bar["datetime"], tz="America/New_York")
            timestamps.append(ts)
            records.append({
                "Open":   float(bar["open"]),
                "High":   float(bar["high"]),
                "Low":    float(bar["low"]),
                "Close":  float(bar["close"]),
                "Volume": float(bar.get("volume") or 0),
            })

        if records:
            df = pd.DataFrame(records, index=pd.DatetimeIndex(timestamps))
            total_bars += upsert_bars("GOLD", interval, df)

        # The oldest bar in this batch
        oldest_ts = min(timestamps)
        if oldest_ts <= start_dt:
            break

        # Next batch ends just before the oldest bar we got
        current_end = (oldest_ts - timedelta(minutes=1)).strftime("%Y-%m-%d %H:%M:%S")

        # Rate limit: 8 req/min on free tier → wait ~8s between requests
        time.sleep(8)

    return {
        "source": "twelve_data",
        "interval": interval,
        "start_date": start_date,
        "end_date": end_date,
        "requests_made": request_count,
        "bars_stored": total_bars,
        "errors": errors[:5],
    }
