"""S3-compatibele objectopslag voor de stroom-grids (Stap 1).

De code kent alleen "S3-compatibele opslag", niet een specifieke leverancier. Vier
env-variabelen (GitHub-secrets in de Action, of windapp/.env.local lokaal):

  STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY, STORAGE_ENDPOINT, STORAGE_BUCKET

Fouten falen hard: een put/get/list/delete die mislukt gooit door, zodat de Action
rood wordt. Stilte is een storing, geen stille no-op.
"""
from __future__ import annotations

import os
import re
from functools import lru_cache
from pathlib import Path

import boto3
from botocore.config import Config

_ENV_FILE = Path(__file__).resolve().parent.parent / ".env.local"
_ENV_KEYS = ("STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY",
             "STORAGE_ENDPOINT", "STORAGE_BUCKET")


def _env(key: str) -> str:
    """os.environ, met lokale fallback naar windapp/.env.local (zoals stroom_db)."""
    val = os.environ.get(key)
    if val:
        return val
    if _ENV_FILE.exists():
        for line in _ENV_FILE.read_text().splitlines():
            m = re.match(rf"\s*{re.escape(key)}\s*=\s*(.+?)\s*$", line)
            if m:
                return m.group(1).strip().strip('"').strip("'")
    raise RuntimeError(f"{key} niet gezet (en niet in windapp/.env.local gevonden).")


class Storage:
    """Dunne S3-wrapper: put/get/list/delete op één bucket. Hard falen bij fouten."""

    def __init__(self) -> None:
        self.bucket = _env("STORAGE_BUCKET")
        # region_name 'auto' werkt voor R2 en is onschadelijk voor andere S3-backends.
        self._s3 = boto3.client(
            "s3",
            endpoint_url=_env("STORAGE_ENDPOINT"),
            aws_access_key_id=_env("STORAGE_ACCESS_KEY_ID"),
            aws_secret_access_key=_env("STORAGE_SECRET_ACCESS_KEY"),
            region_name="auto",
            config=Config(signature_version="s3v4", retries={"max_attempts": 3, "mode": "standard"}),
        )

    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        self._s3.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)

    def get(self, key: str) -> bytes:
        return self._s3.get_object(Bucket=self.bucket, Key=key)["Body"].read()

    def list_keys(self, prefix: str) -> list[str]:
        """Alle keys onder prefix (met paginatie)."""
        keys: list[str] = []
        token = None
        while True:
            kw = dict(Bucket=self.bucket, Prefix=prefix)
            if token:
                kw["ContinuationToken"] = token
            resp = self._s3.list_objects_v2(**kw)
            keys.extend(o["Key"] for o in resp.get("Contents", []))
            if not resp.get("IsTruncated"):
                return keys
            token = resp["NextContinuationToken"]

    def delete(self, key: str) -> None:
        self._s3.delete_object(Bucket=self.bucket, Key=key)

    def exists(self, key: str) -> bool:
        from botocore.exceptions import ClientError
        try:
            self._s3.head_object(Bucket=self.bucket, Key=key)
            return True
        except ClientError as e:
            if e.response["Error"]["Code"] in ("404", "NoSuchKey", "NotFound"):
                return False
            raise


@lru_cache(maxsize=1)
def storage() -> Storage:
    """Gedeelde client (lazy: pas een connectie/creds-check als hij echt nodig is)."""
    return Storage()
