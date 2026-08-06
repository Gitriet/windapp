"""Herstel stroom_punt_forecast uit de INTACTE R2-forecastgrids.

Nodig omdat `ingest.netwerk` de netwerk_routes TRUNCATE't met CASCADE, wat via de
FK stroom_punt_forecast.route_id -> netwerk_routes de puntreeksen meesleurt. De
grids in R2 (forecast/<box>/<run>.parquet) en de grid-assen (stroom_box_grid) blijven
staan, dus we hersamplen de puntreeksen zonder Matroos, zonder R2-writes en zonder de
run_log/retentie aan te raken. write_punt_forecast is een idempotente upsert.

CLI:  python -m ingest.restore_punt_forecast   (vanuit windapp/, DATABASE_URL + STORAGE_* nodig)
"""
from __future__ import annotations

import logging

from . import stroom_punten as PU
from . import stroom_db as DB
from . import stroom_grid_io as GIO
from .storage import storage

log = logging.getLogger("ingest.restore")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    st = storage()
    with DB.connect() as c:
        samplepunten = PU.load_samplepunten(c)
        box_grids = PU.load_box_grids(c)
    owners = PU.assign_owners(samplepunten, box_grids)
    log.info("samplepunten=%d, boxen=%d, punten-met-eigenaar=%d",
             len(samplepunten), len(box_grids), len(owners))

    keys = st.list_keys("forecast/")
    log.info("R2 forecast-grids gevonden: %d", len(keys))
    total = 0
    per_route: dict[str, int] = {}
    for k in sorted(keys):
        grid = GIO.parquet_to_grid(st.get(k))
        box_id, at = grid["box_id"], grid["analysis_time"]
        series = PU.extract_series(owners, box_id, grid["valid_times"], grid["u"], grid["v"])
        with DB.connect() as c:
            n = DB.write_punt_forecast(c, at, series)
        total += n
        for r in series:
            per_route[r[0]] = per_route.get(r[0], 0) + 1
        log.info("%s @ %s: %d rijen", box_id, at.isoformat(), n)

    log.info("KLAAR: %d rijen hersteld over %d routes", total, len(per_route))
    for rid in sorted(per_route):
        log.info("  %s: %d rijen", rid, per_route[rid])


if __name__ == "__main__":
    main()
