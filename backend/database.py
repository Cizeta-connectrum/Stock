"""
SQLite database for storing historical OHLCV price data.
"""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import pandas as pd

DB_PATH = Path(__file__).parent / "data" / "prices.db"


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ohlcv (
                symbol   TEXT    NOT NULL,
                interval TEXT    NOT NULL,
                ts       INTEGER NOT NULL,
                open     REAL,
                high     REAL,
                low      REAL,
                close    REAL    NOT NULL,
                volume   REAL,
                PRIMARY KEY (symbol, interval, ts)
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_ohlcv_lookup
            ON ohlcv (symbol, interval, ts)
        """)


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def upsert_bars(symbol: str, interval: str, df: pd.DataFrame) -> int:
    """Insert or replace bars. Returns number of rows written."""
    if df.empty:
        return 0
    rows = []
    for ts, row in df.iterrows():
        epoch = int(pd.Timestamp(ts).timestamp())
        rows.append((
            symbol, interval, epoch,
            _f(row.get("Open")), _f(row.get("High")),
            _f(row.get("Low")),  _f(row.get("Close")),
            _f(row.get("Volume")),
        ))
    with get_conn() as conn:
        conn.executemany("""
            INSERT OR REPLACE INTO ohlcv
            (symbol, interval, ts, open, high, low, close, volume)
            VALUES (?,?,?,?,?,?,?,?)
        """, rows)
    return len(rows)


def load_bars(symbol: str, interval: str,
              start: pd.Timestamp | None = None,
              end: pd.Timestamp | None = None) -> pd.DataFrame:
    """Load bars from DB as a DataFrame sorted by time."""
    conditions = ["symbol=?", "interval=?"]
    params: list[Any] = [symbol, interval]
    if start:
        conditions.append("ts>=?")
        params.append(int(start.timestamp()))
    if end:
        conditions.append("ts<=?")
        params.append(int(end.timestamp()))
    sql = f"""
        SELECT ts, open, high, low, close, volume
        FROM ohlcv WHERE {' AND '.join(conditions)}
        ORDER BY ts
    """
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows, columns=["ts", "Open", "High", "Low", "Close", "Volume"])
    df.index = pd.to_datetime(df["ts"], unit="s", utc=True)
    df.index = df.index.tz_convert("America/New_York")
    df = df.drop(columns=["ts"])
    return df


def get_data_status() -> list[dict]:
    """Return summary of stored data per symbol/interval."""
    sql = """
        SELECT symbol, interval,
               COUNT(*) as bars,
               MIN(ts)  as first_ts,
               MAX(ts)  as last_ts
        FROM ohlcv
        GROUP BY symbol, interval
        ORDER BY symbol, interval
    """
    with get_conn() as conn:
        rows = conn.execute(sql).fetchall()
    result = []
    for row in rows:
        symbol, interval, bars, first_ts, last_ts = row
        result.append({
            "symbol": symbol,
            "interval": interval,
            "bars": bars,
            "first_date": str(pd.Timestamp(first_ts, unit="s").date()),
            "last_date":  str(pd.Timestamp(last_ts,  unit="s").date()),
        })
    return result


def _f(val: Any) -> float | None:
    try:
        import math
        f = float(val)
        return None if (math.isnan(f) or math.isinf(f)) else f
    except (TypeError, ValueError):
        return None
