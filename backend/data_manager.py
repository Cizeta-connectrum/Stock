"""
Data download manager.
Supports:
  1. yfinance  – chunked download to work around period limits
  2. Alpha Vantage – free API key, extended intraday history (premium has years)
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import Generator

import pandas as pd
import yfinance as yf

from database import upsert_bars

# yfinance per-request limits (days)
YF_CHUNK_DAYS: dict[str, int] = {
    "1m":  6,    # 7-day limit, use 6 to be safe
    "2m":  6,
    "5m":  55,   # 60-day limit
    "15m": 55,
    "30m": 55,
    "60m": 55,
    "1h":  55,
    "90m": 55,
    "1d":  3650,
    "5d":  3650,
    "1wk": 3650,
    "1mo": 3650,
}

# yfinance max lookback (days from today)
YF_MAX_LOOKBACK: dict[str, int] = {
    "1m":  29,
    "2m":  59,
    "5m":  59,
    "15m": 59,
    "30m": 59,
    "60m": 729,
    "1h":  729,
    "90m": 59,
    "1d":  36500,
    "5d":  36500,
    "1wk": 36500,
    "1mo": 36500,
}

GOLD_SYMBOLS = ["GC=F", "GLD", "XAUUSD=X"]


def _date_chunks(
    start: datetime, end: datetime, chunk_days: int
) -> Generator[tuple[datetime, datetime], None, None]:
    cur = start
    while cur < end:
        chunk_end = min(cur + timedelta(days=chunk_days), end)
        yield cur, chunk_end
        cur = chunk_end


def download_yfinance(
    interval: str,
    days_back: int | None = None,
) -> dict:
    """
    Download gold data from yfinance using chunked requests.
    Returns a status dict.
    """
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
            n = upsert_bars("GOLD", interval, df[cols])
            total_bars += n

        time.sleep(0.3)  # be polite to Yahoo Finance

    return {
        "source": "yfinance",
        "interval": interval,
        "days_requested": days_back,
        "bars_stored": total_bars,
        "errors": errors[:5],
    }


def download_alpha_vantage(
    api_key: str,
    interval: str,
    months_back: int = 24,
) -> dict:
    """
    Download gold intraday data from Alpha Vantage using GLD ETF.
    Free tier: 25 req/day. Each request covers 1 month with month= param.
    interval: '1m','5m','15m','30m','1h'
    """
    import urllib.request
    import ssl
    import json

    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE

    av_interval_map = {
        "1m": "1min", "5m": "5min", "15m": "15min",
        "30m": "30min", "1h": "60min", "60m": "60min",
    }
    av_interval = av_interval_map.get(interval)
    if not av_interval:
        return {"error": f"Alpha Vantage does not support interval: {interval}"}

    total_bars = 0
    errors = []

    for month_offset in range(months_back):
        dt = datetime.now() - timedelta(days=30 * month_offset)
        # Alpha Vantage slice parameter: year1month1 ... year2month1 etc
        year_num = (month_offset // 12) + 1
        month_num = (month_offset % 12) + 1
        slice_param = f"year{year_num}month{month_num}"

        # Use TIME_SERIES_INTRADAY with GLD (Gold ETF) — most reliable on free tier
        url = (
            f"https://www.alphavantage.co/query"
            f"?function=TIME_SERIES_INTRADAY"
            f"&symbol=GLD"
            f"&interval={av_interval}"
            f"&outputsize=full"
            f"&extended_hours=false"
            f"&slice={slice_param}"
            f"&apikey={api_key}"
        )

        try:
            with urllib.request.urlopen(url, timeout=30, context=ssl_ctx) as resp:
                data = json.loads(resp.read())

            # Surface any API-level errors immediately
            if "Error Message" in data:
                errors.append(data["Error Message"])
                break
            if "Information" in data:
                # Rate limit hit
                errors.append(data["Information"])
                break
            if "Note" in data:
                errors.append(data["Note"])
                time.sleep(60)
                continue

            key = f"Time Series ({av_interval})"
            if key not in data:
                # Log actual keys for debugging
                actual_keys = list(data.keys())
                errors.append(f"slice={slice_param}: expected '{key}', got keys={actual_keys}")
                continue

            ts_data = data[key]
            if not ts_data:
                continue

            timestamps = []
            records = []
            for ts_str, vals in ts_data.items():
                timestamps.append(pd.Timestamp(ts_str, tz="America/New_York"))
                records.append({
                    "Open":   float(vals["1. open"]),
                    "High":   float(vals["2. high"]),
                    "Low":    float(vals["3. low"]),
                    "Close":  float(vals["4. close"]),
                    "Volume": float(vals.get("5. volume", 0)),
                })

            if records:
                df = pd.DataFrame(records, index=pd.DatetimeIndex(timestamps))
                n = upsert_bars("GOLD", interval, df)
                total_bars += n

            time.sleep(12)  # free tier: 5 req/min

        except Exception as e:
            errors.append(str(e))
            continue

    return {
        "source": "alpha_vantage",
        "interval": interval,
        "months_requested": months_back,
        "bars_stored": total_bars,
        "errors": errors[:5],
    }
