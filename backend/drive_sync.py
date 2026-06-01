"""
Google Drive sync for SQLite database persistence.
Downloads DB on startup, uploads after data changes.
"""
from __future__ import annotations

import io
import json
import os
from pathlib import Path

DB_PATH = Path(__file__).parent / "data" / "prices.db"
FOLDER_ID = os.environ.get("GDRIVE_FOLDER_ID", "")
CREDENTIALS_JSON = os.environ.get("GOOGLE_CREDENTIALS", "")


def _get_service():
    if not CREDENTIALS_JSON or not FOLDER_ID:
        return None
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
        creds = service_account.Credentials.from_service_account_info(
            json.loads(CREDENTIALS_JSON),
            scopes=["https://www.googleapis.com/auth/drive"],
        )
        return build("drive", "v3", credentials=creds, cache_discovery=False)
    except Exception as e:
        print(f"[DriveSync] Failed to initialize: {e}")
        return None


def _find_file(service) -> str | None:
    results = service.files().list(
        q=f"name='prices.db' and '{FOLDER_ID}' in parents and trashed=false",
        fields="files(id)",
    ).execute()
    files = results.get("files", [])
    return files[0]["id"] if files else None


def download_db() -> bool:
    """Download prices.db from Drive on startup. Returns True if successful."""
    service = _get_service()
    if not service:
        return False
    try:
        from googleapiclient.http import MediaIoBaseDownload
        file_id = _find_file(service)
        if not file_id:
            print("[DriveSync] No prices.db found in Drive, starting fresh.")
            return False
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        request = service.files().get_media(fileId=file_id)
        buf = io.BytesIO()
        downloader = MediaIoBaseDownload(buf, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        with open(DB_PATH, "wb") as f:
            f.write(buf.getvalue())
        print(f"[DriveSync] Downloaded prices.db ({DB_PATH.stat().st_size // 1024} KB)")
        return True
    except Exception as e:
        print(f"[DriveSync] Download failed: {e}")
        return False


def upload_db() -> bool:
    """Upload prices.db to Drive after data update. Returns True if successful."""
    service = _get_service()
    if not service or not DB_PATH.exists():
        return False
    try:
        from googleapiclient.http import MediaFileUpload
        media = MediaFileUpload(str(DB_PATH), mimetype="application/x-sqlite3", resumable=True)
        file_id = _find_file(service)
        if file_id:
            service.files().update(fileId=file_id, media_body=media).execute()
        else:
            service.files().create(
                body={"name": "prices.db", "parents": [FOLDER_ID]},
                media_body=media,
            ).execute()
        print(f"[DriveSync] Uploaded prices.db ({DB_PATH.stat().st_size // 1024} KB)")
        return True
    except Exception as e:
        print(f"[DriveSync] Upload failed: {e}")
        return False
