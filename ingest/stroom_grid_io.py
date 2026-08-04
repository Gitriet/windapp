"""Grid <-> parquet + grof pijlenveld (kaartpad). Geen opslag/DB hier: puur (de)serialisatie.

Parquet-indeling: twee vlakke float32-kolommen ``u``/``v`` in (T, ny, nx) ravel-volgorde,
zstd + byte-stream-split (gemeten ~1,9 B/cel-stap). Alle georeferentie (assen, tijden,
box, model_unvalidated) staat in de parquet-schema-metadata, zodat één bestand
zelfbeschrijvend is. NaN blijft NaN in het grid (pas bij puntextractie -> NULL).
"""
from __future__ import annotations

import io
import json
from datetime import datetime, timezone

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

_META_KEY = b"stroom"


def _iso(t: datetime) -> str:
    return t.astimezone(timezone.utc).isoformat()


def grid_to_parquet(box_id: str, source: str, analysis_time: datetime,
                    issue_time: datetime | None, valid_times: list[datetime],
                    lat: np.ndarray, lon: np.ndarray,
                    u: np.ndarray, v: np.ndarray, model_unvalidated: bool = True) -> bytes:
    """u/v shape (T, ny, nx) -> parquet-bytes. Zelfbeschrijvend via schema-metadata."""
    ny, nx = int(lat.size), int(lon.size)
    T = len(valid_times)
    assert u.shape == (T, ny, nx) == v.shape, f"shape {u.shape} != {(T, ny, nx)}"
    meta = {
        "box_id": box_id, "source": source,
        "analysis_time": _iso(analysis_time),
        "issue_time": _iso(issue_time) if issue_time else None,
        "valid_times": [_iso(t) for t in valid_times],
        "nx": nx, "ny": ny,
        "lat": np.asarray(lat, dtype="<f4").tolist(),
        "lon": np.asarray(lon, dtype="<f4").tolist(),
        "model_unvalidated": bool(model_unvalidated),
        "layout": "t,ny,nx",
    }
    table = pa.table({
        "u": pa.array(np.ascontiguousarray(u, dtype="<f4").ravel()),
        "v": pa.array(np.ascontiguousarray(v, dtype="<f4").ravel()),
    }).replace_schema_metadata({_META_KEY: json.dumps(meta).encode()})
    buf = io.BytesIO()
    pq.write_table(table, buf, compression="zstd", compression_level=9,
                   use_byte_stream_split=["u", "v"], use_dictionary=False)
    return buf.getvalue()


def parquet_to_grid(data: bytes) -> dict:
    """Parquet-bytes -> {box_id, source, analysis_time, valid_times, lat, lon, nx, ny,
    u(T,ny,nx), v, model_unvalidated}. NaN intact."""
    reader = pq.ParquetFile(io.BytesIO(data))
    meta = json.loads(reader.schema_arrow.metadata[_META_KEY])
    nx, ny, T = meta["nx"], meta["ny"], len(meta["valid_times"])
    t = reader.read()
    u = t.column("u").to_numpy(zero_copy_only=False).reshape(T, ny, nx)
    v = t.column("v").to_numpy(zero_copy_only=False).reshape(T, ny, nx)
    return {
        "box_id": meta["box_id"], "source": meta["source"],
        "analysis_time": datetime.fromisoformat(meta["analysis_time"]),
        "issue_time": datetime.fromisoformat(meta["issue_time"]) if meta["issue_time"] else None,
        "valid_times": [datetime.fromisoformat(x) for x in meta["valid_times"]],
        "lat": np.asarray(meta["lat"], dtype=np.float32),
        "lon": np.asarray(meta["lon"], dtype=np.float32),
        "nx": nx, "ny": ny, "u": u, "v": v,
        "model_unvalidated": meta["model_unvalidated"],
    }


def punt_rows_to_parquet(rows) -> bytes:
    """Puntreeks-rijen (route_id, volgnr, box_id, valid_time, u, v) -> parquet.
    Voor de hindcast-punten-dagbestanden. u/v als float32; None -> NaN (= NULL)."""
    def f(x):
        return float("nan") if x is None else float(x)
    rows = list(rows)
    table = pa.table({
        "route_id": pa.array([r[0] for r in rows], pa.string()),
        "volgnr": pa.array([r[1] for r in rows], pa.int32()),
        "box_id": pa.array([r[2] for r in rows], pa.string()),
        "valid_time": pa.array([_iso(r[3]) for r in rows], pa.string()),
        "u": pa.array([f(r[4]) for r in rows], pa.float32()),
        "v": pa.array([f(r[5]) for r in rows], pa.float32()),
    })
    buf = io.BytesIO()
    pq.write_table(table, buf, compression="zstd", compression_level=9)
    return buf.getvalue()


def parquet_to_punt_rows(data: bytes) -> list[tuple]:
    """Parquet -> [(route_id, volgnr, box_id, valid_time(datetime), u|None, v|None)]."""
    t = pq.read_table(io.BytesIO(data))
    d = t.to_pydict()
    out = []
    for i in range(t.num_rows):
        u, v = d["u"][i], d["v"][i]
        out.append((d["route_id"][i], int(d["volgnr"][i]), d["box_id"][i],
                    datetime.fromisoformat(d["valid_time"][i]),
                    None if u is None or np.isnan(u) else float(u),
                    None if v is None or np.isnan(v) else float(v)))
    return out


def build_arrows(box_id: str, analysis_time: datetime, valid_times: list[datetime],
                 lat: np.ndarray, lon: np.ndarray, u: np.ndarray, v: np.ndarray,
                 max_arrows: int = 150, model_unvalidated: bool = True) -> dict:
    """Grof pijlenveld voor de kaart: elke N-de cel, alleen natte cellen. Klein JSON;
    draagt de eerlijkheidsvlag (model_unvalidated) en de versheid (analysis_time) mee."""
    ny, nx = int(lat.size), int(lon.size)
    step = max(1, round((ny * nx / max_arrows) ** 0.5))
    ii = range(step // 2, ny, step)
    jj = range(step // 2, nx, step)
    slices = []
    for t, vt in enumerate(valid_times):
        arr = []
        for i in ii:
            for j in jj:
                uu, vv = float(u[t, i, j]), float(v[t, i, j])
                if np.isnan(uu) or np.isnan(vv):
                    continue
                arr.append([round(float(lat[i]), 4), round(float(lon[j]), 4),
                            round(uu, 3), round(vv, 3)])
        slices.append({"valid_time": _iso(vt), "arrows": arr})
    return {
        "box_id": box_id, "analysis_time": _iso(analysis_time),
        "model_unvalidated": model_unvalidated, "units": "m/s",
        "step_cells": step, "times": slices,
    }
