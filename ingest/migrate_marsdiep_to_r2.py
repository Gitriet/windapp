"""Eenmalige migratie: legacy-historie uit de oude Neon-gridtabellen naar de nieuwe
opslag — grids als parquet naar R2, puntreeksen naar Neon.

Alleen ``marsdiep`` heeft nog historie in de oude tabellen (stroom_run/stroom_veld =
forecast, stroom_hindcast = continue uurreeks, stroom_box_grid = assen). Dit script
reproduceert exact wat de nieuwe cron zou hebben weggeschreven:

  * per forecast-run : grid-parquet + grof pijlenveld -> R2, puntreeks -> Neon
                       (stroom_punt_forecast);
  * per hindcast-uur : grid-parquet -> R2, puntwaarden -> hindcast-punten dag-parquet;
  * elke verwerkte analysis_time -> stroom_run_log (zodat de cron ze na de omslag
    niet opnieuw ophaalt).

Idempotent + hervatbaar. Alle R2-sleutels zijn deterministisch en alle Neon-writes
zijn upserts; halverwege sneuvelen en opnieuw starten overschrijft identiek —
geen dubbele en geen ontbrekende objecten. Grids worden overgeslagen als het object
er al bit-voor-bit staat (snelle hervatting); de hindcast-punten-dagbestanden worden
altijd volledig herberekend uit Neon en gemerged, dus ook een half weggeschreven dag
wordt compleet.

Zelfverificatie achteraf (``--verify``, default aan): een steekproef vergelijkt de
oorspronkelijke Neon-bytea met wat er in R2 staat — zelfde vorm als de round-trip-test
(waarde-voor-waarde, NaN==NaN) — plus een telling van gemigreerde runs/uren.

CLI (vanuit windapp/):
  python -m ingest.migrate_marsdiep_to_r2               # echte migratie (box marsdiep)
  python -m ingest.migrate_marsdiep_to_r2 --test        # tijdelijke R2-prefix, GEEN Neon, verifieer, ruim R2-temp op
  python -m ingest.migrate_marsdiep_to_r2 --box wad-west-00
"""
from __future__ import annotations

import argparse
import json
import logging
import math
from collections import defaultdict
from datetime import timezone

import numpy as np

from . import stroom_db as DB
from . import stroom_grid_io as GIO
from . import stroom_punten as PU
from .stroom import SOURCE
from .stroom_cron import (
    _PARQUET, _arrows_key, _forecast_key, _hindcast_key,
    finalize_hindcast_punten,
)
from .stroom_db import unpack_axis, unpack_field
from .storage import storage

log = logging.getLogger("ingest.migrate")

TEST_PREFIX = "_migtest/"


# --- prefix-storage: dezelfde interface, elke sleutel onder een prefix ----
class PrefixedStorage:
    """Dunne wrapper rond Storage die elke sleutel onder ``prefix`` legt. Zo kan
    dezelfde migratiecode tegen een tijdelijke R2-ruimte draaien (test) en tegen de
    echte (leeg = geen prefix)."""

    def __init__(self, st, prefix: str = "") -> None:
        self._st = st
        self.prefix = prefix

    def put(self, key, data, content_type="application/octet-stream"):
        self._st.put(self.prefix + key, data, content_type)

    def get(self, key):
        return self._st.get(self.prefix + key)

    def exists(self, key):
        return self._st.exists(self.prefix + key)

    def delete(self, key):
        self._st.delete(self.prefix + key)

    def list_keys(self, prefix):
        n = len(self.prefix)
        return [k[n:] for k in self._st.list_keys(self.prefix + prefix)]


# --- Neon-lezers (oude gridtabellen) -------------------------------------
def _load_axes(conn, box_id):
    with conn.cursor() as cur:
        cur.execute("SELECT nx, ny, lat, lon FROM stroom_box_grid WHERE box_id=%s", (box_id,))
        row = cur.fetchone()
    if row is None:
        raise RuntimeError(f"geen stroom_box_grid voor box {box_id!r}")
    nx, ny, la, lo = row
    return nx, ny, unpack_axis(la, ny), unpack_axis(lo, nx)


def _forecast_runs(conn, box_id, ny, nx):
    """[(source, analysis_time, valid_times[], u(T,ny,nx), v)] uit stroom_run+stroom_veld."""
    with conn.cursor() as cur:
        cur.execute("SELECT id, source, analysis_time FROM stroom_run "
                    "WHERE box_id=%s ORDER BY analysis_time", (box_id,))
        runs = cur.fetchall()
        out = []
        for run_id, source, at in runs:
            cur.execute("SELECT valid_time, u, v FROM stroom_veld "
                        "WHERE run_id=%s ORDER BY valid_time", (run_id,))
            rows = cur.fetchall()
            vts = [r[0].astimezone(timezone.utc) for r in rows]
            u = np.stack([unpack_field(r[1], ny, nx) for r in rows])
            v = np.stack([unpack_field(r[2], ny, nx) for r in rows])
            out.append((source, at.astimezone(timezone.utc), vts, u, v))
    return out


def _hindcast_hours(conn, box_id):
    """[(valid_time, source_analysis)] uit stroom_hindcast (assen los, u/v per uur later)."""
    with conn.cursor() as cur:
        cur.execute("SELECT valid_time, source_analysis FROM stroom_hindcast "
                    "WHERE box_id=%s ORDER BY valid_time", (box_id,))
        return [(vt.astimezone(timezone.utc), sa.astimezone(timezone.utc))
                for vt, sa in cur.fetchall()]


def _hindcast_grid(conn, box_id, valid_time, ny, nx):
    with conn.cursor() as cur:
        cur.execute("SELECT u, v FROM stroom_hindcast WHERE box_id=%s AND valid_time=%s",
                    (box_id, valid_time))
        ub, vb = cur.fetchone()
    return unpack_field(ub, ny, nx), unpack_field(vb, ny, nx)


# --- migratie ------------------------------------------------------------
def migrate(box_id: str, st, write_neon: bool = True) -> dict:
    with DB.connect() as c:
        DB.ensure_punt_schema(c)
        DB.ensure_run_log(c)
        nx, ny, lat, lon = _load_axes(c, box_id)
        samplepunten = PU.load_samplepunten(c)
        owners = PU.assign_owners(samplepunten, PU.load_box_grids(c))
        fruns = _forecast_runs(c, box_id, ny, nx)
        hhours = _hindcast_hours(c, box_id)
    owned = [(rk, ij) for rk, ij in owners.items() if ij[0] == box_id]
    log.info("%s: %d forecast-run(s), %d hindcast-uur/uren, %d eigen punt(en)",
             box_id, len(fruns), len(hhours), len(owned))

    seen_anal = set()
    n_fc_slices = 0

    # --- FORECAST: grid + arrows -> R2, puntreeks -> Neon --------------------
    for source, at, vts, u, v in fruns:
        fkey = _forecast_key(box_id, at)
        if not st.exists(fkey):
            st.put(fkey, GIO.grid_to_parquet(box_id, source, at, None, vts, lat, lon, u, v), _PARQUET)
        akey = _arrows_key(box_id, at)
        if not st.exists(akey):
            st.put(akey, json.dumps(GIO.build_arrows(box_id, at, vts, lat, lon, u, v)).encode(),
                   "application/json")
        if write_neon:
            series = PU.extract_series(owners, box_id, vts, u, v)
            with DB.connect() as c:
                DB.write_punt_forecast(c, at, series)
        n_fc_slices += len(vts)
        seen_anal.add(at)
        log.info("forecast %s: %d slices", at.strftime("%Y-%m-%d %H:%MZ"), len(vts))

    # --- HINDCAST: grid per uur -> R2, puntwaarden -> dag-parquet -----------
    hc_punt: list[tuple] = []
    with DB.connect() as c:
        for vt, sa in hhours:
            uu, vv = _hindcast_grid(c, box_id, vt, ny, nx)
            hkey = _hindcast_key(box_id, vt)
            if not st.exists(hkey):
                blob = GIO.grid_to_parquet(box_id, SOURCE, sa, None, [vt], lat, lon,
                                           uu[None, :, :], vv[None, :, :])
                st.put(hkey, blob, _PARQUET)
            for (rid, vg), (_b, ci, cj) in owned:
                a, b = float(uu[ci, cj]), float(vv[ci, cj])
                hc_punt.append((rid, vg, box_id, vt,
                                None if math.isnan(a) else a,
                                None if math.isnan(b) else b))
            seen_anal.add(sa)
    finalize_hindcast_punten(st, hc_punt)          # herberekent+merget de dag-parquets

    # --- run_log: alle verwerkte analysetijden (forecast + hindcast-herkomst) -
    n_log = 0
    if write_neon:
        with DB.connect() as c:
            for at in sorted(seen_anal):
                DB.log_run(c, box_id, at)
                n_log += 1

    ndays = len({vt.date() for vt, _ in hhours})
    return {"forecast_runs": len(fruns), "forecast_slices": n_fc_slices,
            "hindcast_hours": len(hhours), "hindcast_days": ndays,
            "punt_rows": len(hc_punt), "logged_anal": n_log}


# --- zelfverificatie: Neon-bytea vs R2-parquet ---------------------------
def _cmp(name, a: np.ndarray, b: np.ndarray) -> bool:
    # De TEST is de volledige-array-vergelijking (alle cellen, NaN==NaN).
    ok = a.shape == b.shape and np.array_equal(a, b, equal_nan=True)
    # Ter ILLUSTRATIE een NATTE cel (de lege hoek [0,0] bewijst niets): eerste niet-NaN.
    af, bf = a.ravel(), b.ravel()
    wet = np.flatnonzero(~np.isnan(af))
    k = int(wet[0]) if wet.size else 0
    log.info("  %-20s %s  (%d cellen, %d nat; nat-cel[%d] neon=%s r2=%s)",
             name, "OK " if ok else "FOUT", af.size, int(wet.size),
             k, _fmt(af[k]), _fmt(bf[k]))
    return ok


def _fmt(x) -> str:
    return "NaN" if (isinstance(x, float) and math.isnan(x)) else f"{float(x):.4f}"


def verify(box_id: str, st, n_fc: int = 3, n_hc: int = 8) -> bool:
    """Steekproef: reconstrueer grids uit Neon (float16-bytea) en vergelijk ze
    waarde-voor-waarde met de parquet in R2. Bit-getrouw = zelfde vorm als de
    round-trip-test."""
    with DB.connect() as c:
        nx, ny, _lat, _lon = _load_axes(c, box_id)
        fruns = _forecast_runs(c, box_id, ny, nx)
        hhours = _hindcast_hours(c, box_id)
    ok = True
    log.info("verificatie forecast (%d run(s), steekproef %d slice(s)/run):", len(fruns), n_fc)
    for source, at, vts, u, v in fruns:
        grid = GIO.parquet_to_grid(st.get(_forecast_key(box_id, at)))
        idxs = np.linspace(0, len(vts) - 1, min(n_fc, len(vts))).round().astype(int)
        for k in idxs:
            tag = f"{at:%m-%d %HZ}/vt{k}"
            ok &= _cmp(f"fc {tag} u", u[k], grid["u"][k])
            ok &= _cmp(f"fc {tag} v", v[k], grid["v"][k])

    log.info("verificatie hindcast (%d uur, steekproef %d):", len(hhours), n_hc)
    if hhours:
        idxs = np.linspace(0, len(hhours) - 1, min(n_hc, len(hhours))).round().astype(int)
        with DB.connect() as c:
            for k in idxs:
                vt, _sa = hhours[k]
                nu, nv = _hindcast_grid(c, box_id, vt, ny, nx)
                grid = GIO.parquet_to_grid(st.get(_hindcast_key(box_id, vt)))
                ok &= _cmp(f"hc {vt:%m-%d %HZ} u", nu, grid["u"][0])
                ok &= _cmp(f"hc {vt:%m-%d %HZ} v", nv, grid["v"][0])
    return ok


# --- test-opruiming ------------------------------------------------------
def _cleanup(st, box_id: str) -> None:
    """Ruim de testrun op: alle objecten onder de tijdelijke R2-prefix. RAAKT NEON
    NIET — de test schrijft geen Neon-rijen (write_neon=False), zodat een --test-run
    nooit echte puntreeksen/run_log van deze box kan wissen."""
    n = 0
    for pre in ("forecast/", "arrows/", "hindcast/", "hindcast-punten/"):
        for k in st.list_keys(pre):
            st.delete(k)
            n += 1
    log.info("opgeruimd: %d R2-object(en) onder tijdelijke prefix (Neon onaangeraakt)", n)


def _report(counts: dict) -> None:
    print("\n=== migratie-telling ===")
    print(f"  forecast-runs      : {counts['forecast_runs']}")
    print(f"  forecast-slices    : {counts['forecast_slices']}  -> R2 grids + arrows, Neon punt_forecast")
    print(f"  hindcast-uren      : {counts['hindcast_hours']}  -> R2 grids")
    print(f"  hindcast-dagen     : {counts['hindcast_days']}  -> R2 hindcast-punten dag-parquet")
    print(f"  hindcast-puntrijen : {counts['punt_rows']}")
    print(f"  run_log-entries    : {counts['logged_anal']}")


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("--box", default="marsdiep")
    ap.add_argument("--test", action="store_true",
                    help="tijdelijke R2-prefix; verifieer; ruim daarna R2 + Neon-rijen op")
    ap.add_argument("--no-verify", action="store_true")
    args = ap.parse_args()

    st = PrefixedStorage(storage(), TEST_PREFIX if args.test else "")
    if args.test:
        log.info("TESTMODUS: R2-prefix %r; GEEN Neon-writes; R2-temp na afloop opgeruimd", TEST_PREFIX)

    try:
        counts = migrate(args.box, st, write_neon=not args.test)
        _report(counts)
        ok = True
        if not args.no_verify:
            print("\n=== zelfverificatie (Neon-bytea vs R2-parquet) ===")
            ok = verify(args.box, st)
            print(f"\nverificatie: {'GESLAAGD — bit-getrouw' if ok else 'GEFAALD'}")
    finally:
        if args.test:
            print("\n=== opruimen testrun ===")
            _cleanup(st, args.box)

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
