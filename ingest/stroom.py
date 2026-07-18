"""Getijstroom-ingestie (gedeelde laag) — Fase 1: ophalen + parsen.

Model current from RWS Matroos source ``dcsm7_harmonie_bf_f2w`` — the native
DFlowFM Noordzee-100m model, HARMONIE-forced, bias-filtered. This layer stays
*dumb*: it fetches one box, marks dry/missing cells NaN, and returns the raw
u/v field in m/s as delivered. Knots-conversion, magnitude and display are
downstream.

Hard principles (see stroom-preflight.md):
  * MODEL, niet gekalibreerd. RWS validates only water levels, not these
    currents -> every consumer carries ``model_unvalidated: true``.
  * NaN, geen nul. Dry/falling-dry/missing cells are NOT slack water; keep them
    NaN and never let a 0 m/s slip in.
  * Alleen deze RWS-eigen bron. No other Matroos source without a licence check.
  * Tijd in UTC. Matroos levert GMT; we parse to tz-aware UTC.

CLI:
  python -m wm.stroom fetch  marsdiep        # Fase 1 sanity fetch
  python -m wm.stroom ingest marsdiep        # Fase 2 write to Neon (needs DATABASE_URL)
"""
from __future__ import annotations

import logging
import re
import tempfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import numpy as np
import requests
import xarray as xr

log = logging.getLogger("wm.stroom")

# --- Bron (vast; niet uitbreiden zonder licentiecheck) -------------------
SOURCE = "dcsm7_harmonie_bf_f2w"
# kustwacht.php dient altijd de laatste run (negeert anal=); get_matroos.php
# honoreert anal= om een oudere run gericht op te halen (Fase-3 inhaal).
KUSTWACHT = "https://noos.matroos.rws.nl/direct/kustwacht.php"
GET_MATROOS = "https://noos.matroos.rws.nl/direct/get_matroos.php"
ANAL_TIMES = "https://noos.matroos.rws.nl/direct/get_anal_times.php"
HORIZON_H = 48                        # bewezen voorspelhorizon (preflight #2)
_TIMEOUT = 300


@dataclass(frozen=True)
class Box:
    """Eén ophaalbox: id + WGS84-bbox + gridresolutie. Elke nieuwe box vereist
    een eigen validatierun (preflight #4: houd nx*ny*stappen < ~10M cel-stappen)."""
    id: str
    xmin: float
    xmax: float
    ymin: float
    ymax: float
    nx: int
    ny: int


# Start met alleen de bewezen Marsdiep-box (preflight). Niet blind uitbreiden.
BOXES: dict[str, Box] = {
    "marsdiep": Box("marsdiep", 4.75, 4.92, 52.93, 53.05, 115, 135),
}


@dataclass
class StroomField:
    """Schoon in-memory stroomveld voor één run/box. u/v in m/s, NaN behouden."""
    box_id: str
    source: str
    analysis_time: datetime          # UTC, tz-aware
    issue_time: datetime | None      # UTC, tz-aware (publicatiemoment)
    lat: np.ndarray                  # float32[ny], degrees_north
    lon: np.ndarray                  # float32[nx], degrees_east
    valid_times: list[datetime]      # UTC, tz-aware, lengte T
    u: np.ndarray                    # float32 (T, ny, nx) eastward, NaN behouden
    v: np.ndarray                    # float32 (T, ny, nx) northward, NaN behouden

    @property
    def nx(self) -> int:
        return int(self.lon.size)

    @property
    def ny(self) -> int:
        return int(self.lat.size)


def _find_uv(ds: xr.Dataset) -> tuple[str, str]:
    """u/v herkennen op CF standard_name, met naam-fallback — niet aannemen."""
    u = v = None
    for name, da in ds.data_vars.items():
        sn = str(da.attrs.get("standard_name", "")).lower()
        if sn == "eastward_sea_water_velocity":
            u = name
        elif sn == "northward_sea_water_velocity":
            v = name
    if u and v:
        return u, v
    lower = {n.lower(): n for n in ds.data_vars}
    for cand in ("un", "velu", "u", "eastward_sea_water_velocity"):
        if not u and cand in lower:
            u = lower[cand]
    for cand in ("vn", "velv", "v", "northward_sea_water_velocity"):
        if not v and cand in lower:
            v = lower[cand]
    if not (u and v):
        raise RuntimeError(f"Kon u/v niet vinden in dataset; data_vars={list(ds.data_vars)}")
    return u, v


def _parse_gmt(s: str) -> datetime:
    """RWS-attribuut '2026-07-18 03:00:00 GMT' -> tz-aware UTC datetime."""
    return datetime.strptime(s.replace(" GMT", "").strip(), "%Y-%m-%d %H:%M:%S").replace(
        tzinfo=timezone.utc)


def _decode_times(tvar: xr.DataArray) -> list[datetime]:
    """time-as -> lijst tz-aware UTC datetimes, robuust of xarray de as al als
    datetime64 decodeerde of als ruwe 'minutes since 1970' liet staan (Matroos
    laat de units-attr soms leeg, waardoor decode uitblijft)."""
    vals = np.asarray(tvar.values)
    if np.issubdtype(vals.dtype, np.datetime64):
        secs = vals.astype("datetime64[s]").astype("int64")
        return [datetime.fromtimestamp(int(s), tz=timezone.utc) for s in secs]
    # numeriek: leid de eenheid + origin af uit units of long_name.
    meta = f"{tvar.attrs.get('units', '')} {tvar.attrs.get('long_name', '')}".lower()
    unit = next((u for u in ("seconds", "minutes", "hours", "days") if u in meta), "minutes")
    per = {"seconds": 1, "minutes": 60, "hours": 3600, "days": 86400}[unit]
    m = re.search(r"since\s+(\d{4}-\d{2}-\d{2}[ t]\d{2}:\d{2}:\d{2})", meta)
    origin = (datetime.strptime(m.group(1), "%Y-%m-%d %H:%M:%S") if m
              else datetime(1970, 1, 1)).replace(tzinfo=timezone.utc)
    return [origin + timedelta(seconds=per * float(v)) for v in vals]


def _check_netcdf(content: bytes, ctype: str) -> None:
    """Geen HTML-foutpagina onopgemerkt: eis NetCDF-magic, verwerp de rest.

    Waargenomen foutmodi (preflight): ontbrekende params -> 200 + HTML <pre>;
    te grote box -> 500 (al door raise_for_status gevangen)."""
    if content[:3] == b"CDF" or content[:4] == b"\x89HDF":
        return
    snippet = content[:200].decode("utf-8", "replace").replace("\n", " ")
    raise RuntimeError(
        f"Antwoord is geen NetCDF (content-type={ctype!r}, {len(content)} bytes): {snippet!r}")


def _gmt(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y%m%d%H%M")


def _floor_hour(dt: datetime) -> datetime:
    return dt.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)


def _window(analysis_time: datetime | None, tstart, tstop) -> tuple[datetime, datetime]:
    """Standaardvenster: een paar uur hindcast + de volle 48u horizon. De
    server capt zelf op de run z'n +48u, dus ruim vragen kan geen kwaad.

    Tijden MOETEN op hele klokuren liggen: een niet-uitgelijnde tstart (bv. :34)
    laat Matroos een degenererend 1-staps/leeg bestand teruggeven."""
    base = analysis_time or datetime.now(timezone.utc)
    start = tstart if tstart else base - timedelta(hours=3)
    stop = tstop if tstop else base + timedelta(hours=HORIZON_H + 1)
    return _floor_hour(start), _floor_hour(stop)


def list_analysis_times(tstart: datetime, tstop: datetime) -> list[datetime]:
    """Gepubliceerde analysetijden (UTC) voor deze source in [tstart, tstop].

    Source-niveau (niet per box). De lijst bevat alleen al-gepubliceerde runs, dus
    de ~4,5u publicatievertraging zit er vanzelf in verwerkt (preflight #1)."""
    r = requests.get(ANAL_TIMES, params={
        "database": "maps2d", "source": SOURCE,
        "tstart": _gmt(tstart), "tstop": _gmt(tstop)}, timeout=60)
    r.raise_for_status()
    out = [datetime.strptime(ln.strip(), "%Y%m%d%H%M").replace(tzinfo=timezone.utc)
           for ln in r.text.splitlines() if re.fullmatch(r"\d{12}", ln.strip())]
    return sorted(out)


def fetch_stroom(box: str | Box, analysis_time: datetime | None = None,
                 tstart: datetime | None = None, tstop: datetime | None = None,
                 tinc: int = 60) -> StroomField:
    """Haal één box op en verwerk tot een schoon StroomField.

    analysis_time=None -> laatste gepubliceerde run (kustwacht.php).
    analysis_time gezet -> die specifieke run (get_matroos.php met anal=).
    """
    b = BOXES[box] if isinstance(box, str) else box
    start, stop = _window(analysis_time, tstart, tstop)

    if analysis_time is None:
        url = KUSTWACHT
        params = {
            "source": SOURCE, "type": "water",
            "xmin": b.xmin, "xmax": b.xmax, "ymin": b.ymin, "ymax": b.ymax,
            "nx": b.nx, "ny": b.ny,
            "tstart": _gmt(start), "tstop": _gmt(stop), "tinc": tinc, "force": 1,
        }
    else:
        url = GET_MATROOS
        params = {
            "source": SOURCE, "field": "VELU,VELV", "fieldoutput": "un,vn",
            "xmin": b.xmin, "xmax": b.xmax, "ymin": b.ymin, "ymax": b.ymax,
            "coords": "WGS84", "coordsoutput": "lon,lat", "xn": b.nx, "yn": b.ny,
            "from": _gmt(start), "to": _gmt(stop), "dtmin": tinc,
            "ncout": "water.nc", "format": "nc", "anal": _gmt(analysis_time), "nolayer": 1,
        }

    log.info("fetch %s van %s  venster %s..%s GMT  anal=%s",
             b.id, url.rsplit("/", 1)[-1], _gmt(start), _gmt(stop),
             _gmt(analysis_time) if analysis_time else "laatste")
    r = requests.get(url, params=params, timeout=_TIMEOUT)   # volgt redirects (302) vanzelf
    r.raise_for_status()
    _check_netcdf(r.content, r.headers.get("content-type", ""))

    # netCDF4-backend leest uit een echt bestand; schrijf de bytes naar een tempfile.
    with tempfile.NamedTemporaryFile(suffix=".nc") as tmp:
        tmp.write(r.content)
        tmp.flush()
        ds = xr.open_dataset(tmp.name)
        field = _to_field(ds, b)
        ds.close()
    _log_sanity(field)
    return field


# Fysiek onmogelijke snelheid -> fill-sentinel. Matroos levert soms een NetCDF
# zonder _FillValue-attribuut waarin droge cellen een grote sentinel (~1e30 of
# -999) dragen i.p.v. NaN; die moeten alsnog NaN worden, nooit 0 of 1e30.
_SENTINEL_MS = 100.0                   # 100 m/s = 194 kn, ruim boven elke echte stroom


def _to_field(ds: xr.Dataset, b: Box) -> StroomField:
    u_name, v_name = _find_uv(ds)
    at_attr = ds.attrs.get("analysis_time")
    it_attr = ds.attrs.get("issue_time")

    # Assen: 1D lat(ny)/lon(nx). Verwacht dims (time, lat, lon) = (time, ny, nx).
    lat = np.asarray(ds["lat"].values, dtype=np.float32)
    lon = np.asarray(ds["lon"].values, dtype=np.float32)
    U = ds[u_name].transpose("time", "lat", "lon").values.astype(np.float32)
    V = ds[v_name].transpose("time", "lat", "lon").values.astype(np.float32)
    # Droge/ontbrekende cellen expliciet NaN: al-NaN, niet-eindig, of sentinel.
    # u/v zijn een vectorpaar: als één component ongeldig is, is de cel het.
    bad = ~np.isfinite(U) | ~np.isfinite(V) | (np.abs(U) >= _SENTINEL_MS) | (np.abs(V) >= _SENTINEL_MS)
    U = np.where(bad, np.nan, U).astype(np.float32)
    V = np.where(bad, np.nan, V).astype(np.float32)

    times = _decode_times(ds["time"])
    analysis_time = _parse_gmt(at_attr) if at_attr else times[0]
    issue_time = _parse_gmt(it_attr) if it_attr else None

    if (lat.size, lon.size) != (b.ny, b.nx):
        log.warning("gridmaat %dx%d wijkt af van boxconfig %dx%d",
                    lat.size, lon.size, b.ny, b.nx)
    return StroomField(b.id, SOURCE, analysis_time, issue_time, lat, lon, times, U, V)


def _log_sanity(f: StroomField) -> None:
    mag = np.sqrt(f.u.astype(np.float64) ** 2 + f.v.astype(np.float64) ** 2)
    finite = np.isfinite(f.u)
    log.info(
        "%s  anal=%s issue=%s  valid %s..%s (%d stappen)  grid %dx%d  "
        "NaN=%.1f%%  max|stroom|=%.2f m/s",
        f.box_id, f.analysis_time.strftime("%Y-%m-%d %H:%MZ"),
        f.issue_time.strftime("%Y-%m-%d %H:%MZ") if f.issue_time else "?",
        f.valid_times[0].strftime("%Y-%m-%d %H:%MZ"),
        f.valid_times[-1].strftime("%Y-%m-%d %H:%MZ"), len(f.valid_times),
        f.ny, f.nx, 100 * (1 - finite.mean()),
        float(np.nanmax(mag)) if finite.any() else float("nan"),
    )


def _cli() -> None:
    import sys
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    args = sys.argv[1:]
    if len(args) != 2 or args[0] not in ("fetch", "ingest"):
        raise SystemExit("gebruik: python -m wm.stroom {fetch|ingest} <box>")
    cmd, box = args
    if box not in BOXES:
        raise SystemExit(f"onbekende box {box!r}; bekend: {list(BOXES)}")
    field = fetch_stroom(box)
    if cmd == "fetch":
        return
    from . import stroom_db
    stroom_db.ingest(field)


if __name__ == "__main__":
    _cli()
