"""Fase 3+ — geplande verversing met grids naar S3/R2 en puntreeksen naar Neon.

Draait als GitHub Action (elk uur). Per box:
  * leest nieuwe analysetijden in (robuust tegen de ~4,5u publicatievertraging);
  * FORECAST (alleen de te bewaren runs): grid-parquet + grof pijlenveld -> R2,
    en de dichtstbijzijnde-cel-puntreeksen -> Neon (stroom_punt_forecast);
  * HINDCAST (uit elke nieuwe run, kortste leads 0/1/2u): grid-parquet per uur -> R2
    (append-only), en de puntwaarden opgeteld tot dag-parquet in R2;
  * bookkeeping in stroom_run_log (permanent geheugen: welke runs verwerkt zijn);
  * retentie: laatste 3 analysetijden per box, synchroon in R2 (forecast + arrows)
    en Neon (puntreeksen). Hindcast en het log groeien door.
  * signaleert zichtbaar (exit != 0 -> rode Action) als Matroos stil valt.

Grids landen NIET meer in Neon; de oude gridtabellen (stroom_veld/hindcast) worden
in een aparte stap geleegd zodra alle lezers op R2/Neon-punten draaien.

Box-eigenaarschap van een samplepunt is deterministisch (dichtstbijzijnde celcentrum,
tie op box_id alfabetisch, zie stroom_punten). Een gloednieuwe box krijgt zijn grid
pas deze cyclus geüpsert, dus zijn puntreeksen vullen de VOLGENDE uurcyclus —
zelfherstellend, geen bug.

CLI:  python -m ingest.stroom_cron [box ...]   (default: alle bekende boxen)
"""
from __future__ import annotations

import json
import logging
import math
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from . import stroom as S
from . import stroom_db as DB
from . import stroom_grid_io as GIO
from . import stroom_punten as PU
from . import tiles as T
from .storage import storage

log = logging.getLogger("ingest.stroom_cron")

KEEP_RUNS = 3
STALE_H = 9
LOOKBACK_H = 54
LEADS = (0, 1, 2)
_PARQUET = "application/vnd.apache.parquet"


# --- R2-sleutels ---------------------------------------------------------
def _forecast_key(box_id: str, at: datetime) -> str:
    return f"forecast/{box_id}/{at.astimezone(timezone.utc):%Y%m%dT%H%M}Z.parquet"


def _arrows_key(box_id: str, at: datetime) -> str:
    return f"arrows/{box_id}/{at.astimezone(timezone.utc):%Y%m%dT%H%M}Z.json"


def _hindcast_key(box_id: str, vt: datetime) -> str:
    return f"hindcast/{box_id}/{vt.astimezone(timezone.utc):%Y/%m/%d/%H}Z.parquet"


def _hpunt_key(day) -> str:
    return f"hindcast-punten/{day:%Y/%m/%d}.parquet"


def _prune_keep(st, prefix: str, keep: int) -> int:
    """Houd onder prefix alleen de `keep` nieuwste keys (naam sorteert chronologisch);
    verwijder de rest. Retour: aantal verwijderd."""
    keys = sorted(st.list_keys(prefix))
    old = keys[:-keep] if keep > 0 else keys
    for k in old:
        st.delete(k)
    return len(old)


# --- één box -------------------------------------------------------------
def run_box(box_id, samplepunten, st, keep, stale_h, lookback_h, leads, now):
    """Verwerk één box. Retour: (rc, hindcast_punt_rows). rc: 0 gezond, 1 fout/stilte,
    2 config.

    Eigenaarschap wordt ín deze functie berekend, ná het upserten van de box-grid,
    zodat een gloednieuwe box zijn punten in dezelfde cyclus krijgt (geen gat)."""
    if box_id not in S.BOXES:
        log.error("onbekende box %r; bekend: %s", box_id, list(S.BOXES))
        return 2, [], []

    with DB.connect() as c:
        have = DB.logged_analysis_times(c, box_id)

    avail = S.list_analysis_times(now - timedelta(hours=lookback_h), now)
    if not avail:
        log.error("STILTE: geen analysetijden van Matroos voor %s (endpoint down?)", box_id)
        return 1, [], []

    todo = [t for t in avail if t not in have]          # oplopend
    keep_set = set(avail[-keep:])
    log.info("%s: %d beschikbaar, %d verwerkt, %d nieuw", box_id, len(avail), len(have), len(todo))

    hc_punt: list[tuple] = []
    done: list = []            # analysetijden die vólledig verwerkt zijn; loggen doet run_cycle ná finalize
    owners: dict = {}          # (route_id,volgnr) -> (box_id,i,j); pas na eerste upsert
    owned: list = []
    failures = 0

    for at in todo:
        try:
            field = S.fetch_stroom(box_id, analysis_time=at)
            DB.upsert_box_grid(field)
            if not owners:      # eenmalig: eigenaarschap mét deze (net geüpserte) box erin
                with DB.connect() as c:
                    owners = PU.assign_owners(samplepunten, PU.load_box_grids(c))
                owned = [(rk, ij) for rk, ij in owners.items() if ij[0] == box_id]
            idx = {vt: i for i, vt in enumerate(field.valid_times)}

            # HINDCAST-grids (kortste leads) -> R2, + puntwaarden verzamelen
            for lead in leads:
                vt = at + timedelta(hours=lead)
                i = idx.get(vt)
                if i is None:
                    continue
                blob = GIO.grid_to_parquet(box_id, field.source, at, field.issue_time, [vt],
                                           field.lat, field.lon, field.u[i:i + 1], field.v[i:i + 1])
                st.put(_hindcast_key(box_id, vt), blob, _PARQUET)
                for (rid, vg), (_b, ci, cj) in owned:
                    uu, vv = float(field.u[i, ci, cj]), float(field.v[i, ci, cj])
                    hc_punt.append((rid, vg, box_id, vt,
                                    None if math.isnan(uu) else uu,
                                    None if math.isnan(vv) else vv))

            # FORECAST (alleen bewaarde runs): grid + arrows -> R2, puntreeks -> Neon
            if at in keep_set:
                blob = GIO.grid_to_parquet(box_id, field.source, at, field.issue_time,
                                           field.valid_times, field.lat, field.lon, field.u, field.v)
                st.put(_forecast_key(box_id, at), blob, _PARQUET)
                arrows = GIO.build_arrows(box_id, at, field.valid_times, field.lat, field.lon,
                                          field.u, field.v)
                st.put(_arrows_key(box_id, at), json.dumps(arrows).encode(), "application/json")
                series = PU.extract_series(owners, box_id, field.valid_times, field.u, field.v)
                with DB.connect() as c:
                    DB.write_punt_forecast(c, at, series)

            # NIET hier loggen: de hindcast-punt-dagparquets worden pas na de hele
            # cyclus weggeschreven (finalize_hindcast_punten). run_cycle logt deze
            # analysetijd pas ná die finalize, zodat run_log nooit "klaar" zegt
            # terwijl de dag-parquet-puntrijen nog ontbreken.
            done.append(at)
        except Exception:
            failures += 1
            log.exception("ingestie van run %s (%s) faalde", box_id,
                          at.strftime("%Y-%m-%d %H:%MZ"))

    # retentie: laatste `keep` analysetijden per box, synchroon R2 + Neon
    _prune_keep(st, f"forecast/{box_id}/", keep)
    _prune_keep(st, f"arrows/{box_id}/", keep)
    with DB.connect() as c:
        DB.prune_punt_forecast(c, box_id, keep)

    # monitoring: leeftijd nieuwste GEPUBLICEERDE run
    newest = avail[-1]
    age_h = (now - newest).total_seconds() / 3600
    if age_h > stale_h:
        log.error("STILTE: nieuwste run %s is %.1fu oud (> %du)",
                  newest.strftime("%Y-%m-%d %H:%MZ"), age_h, stale_h)
        failures += 1
    else:
        log.info("%s gezond: nieuwste run %s (%.1fu oud), %d nieuwe run(s) verwerkt",
                 box_id, newest.strftime("%Y-%m-%d %H:%MZ"), age_h, len(todo))
    return (1 if failures else 0), hc_punt, done


# --- hindcast-punten: dag-parquet in R2 (alle routepunten samen) ----------
def finalize_hindcast_punten(st, rows) -> None:
    """Voeg de verzamelde hindcast-puntwaarden samen in dag-parquet
    hindcast-punten/{YYYY}/{MM}/{DD}.parquet — merge met bestaand (nieuw wint op
    (route_id, volgnr, valid_time)), append-only over dagen heen."""
    by_day: dict = defaultdict(list)
    for r in rows:
        by_day[r[3].astimezone(timezone.utc).date()].append(r)
    for day, drows in sorted(by_day.items()):
        key = _hpunt_key(day)
        merged: dict = {}
        if st.exists(key):
            for er in GIO.parquet_to_punt_rows(st.get(key)):
                merged[(er[0], er[1], er[3])] = er
        for r in drows:
            merged[(r[0], r[1], r[3])] = r
        ordered = sorted(merged.values(), key=lambda r: (r[3], r[0], r[1]))
        st.put(key, GIO.punt_rows_to_parquet(ordered), _PARQUET)
        log.info("hindcast-punten %s: %d rijen (%d nieuw)", key, len(ordered), len(drows))


# --- cyclus over alle boxen ----------------------------------------------
def run_cycle(boxes, keep=KEEP_RUNS, stale_h=STALE_H, lookback_h=LOOKBACK_H, leads=LEADS) -> int:
    now = datetime.now(timezone.utc)
    st = storage()
    with DB.connect() as c:
        DB.ensure_schema(c)          # stroom_box_grid (nog nodig voor georef/owners)
        DB.ensure_punt_schema(c)
        DB.ensure_run_log(c)
        samplepunten = PU.load_samplepunten(c)
    log.info("cyclus: %d boxen, %d samplepunten", len(boxes), len(samplepunten))

    rc = 0
    for box in boxes:
        r, hc, done = run_box(box, samplepunten, st, keep, stale_h, lookback_h, leads, now)
        rc = max(rc, r)
        # Finalize + log direct na elke box, in dezelfde lus. Zo is elke box
        # volledig opgeslagen zodra run_box terugkeert — een timeout of crash
        # halverwege de lijst laat de al-verwerkte boxen intact in R2 + run_log.
        if done:
            if hc:
                finalize_hindcast_punten(st, hc)
            with DB.connect() as c:
                for at in done:
                    DB.log_run(c, box, at)
    return rc


def _cli() -> None:
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    # --inshore/--offshore draaien de twee tegelgroepen apart (elk een eigen job +
    # timeout in stroom-ingest.yml), zodat de offshore-strook niet achteraan één
    # cyclus verhongert. Zonder argument: alle bekende tegels. Anders: expliciete ids.
    args = sys.argv[1:]
    if args and args[0] in ("--inshore", "--offshore"):
        want = args[0][2:]
        boxes = [b for b in S.BOXES if T.box_group(b) == want]
    else:
        boxes = args or list(S.BOXES)
    keep = int(os.environ.get("STROOM_KEEP_RUNS", KEEP_RUNS))
    stale = int(os.environ.get("STROOM_STALE_H", STALE_H))
    raise SystemExit(run_cycle(boxes, keep=keep, stale_h=stale))


if __name__ == "__main__":
    _cli()
