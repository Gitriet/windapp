"""Fase 3 — geplande verversing, retentie, hindcast-historie.

Draait als GitHub Action (elk uur, zie .github/workflows/stroom-ingest.yml):
  * leest nieuwe analysetijden in (robuust tegen de ~4,5u publicatievertraging);
  * bouwt de continue hindcast-uurreeks (spoor 2) uit de kortste leads (0/1/2 u);
  * ingest de volledige 48u-forecast (spoor 1) alleen voor de te bewaren runs;
  * ruimt oudere forecast-runs op (retentie), zonder de hindcast te raken;
  * signaleert zichtbaar (exit != 0 -> rode Action) als Matroos stil valt.

CLI:  python -m ingest.stroom_cron [box ...]   (default: alle bekende boxen)
"""
from __future__ import annotations

import logging
import os
import sys
from datetime import datetime, timedelta, timezone

from . import stroom as S
from . import stroom_db as DB

log = logging.getLogger("ingest.stroom_cron")

# Defaults (overrulebaar via env). Zie 'Open parameters' in de opdracht.
KEEP_RUNS = 3        # retentie spoor 1: laatste N analysetijden per box
STALE_H = 9          # 'stilte is een fout'-drempel. Boven de normale max-leeftijd
                     # (~7,5u = 3u cadans + ~4,5u publicatievertraging) zodat een
                     # gezonde cyclus geen vals alarm geeft; 6u zou dat wel doen.
LOOKBACK_H = 54      # venster om (gemiste) nieuwe runs te vinden -> zelfherstellend
                     # na een uitval tot ~2 dagen, binnen de Matroos-retentie (~15d).
LEADS = (0, 1, 2)


def run(box_id: str, keep: int = KEEP_RUNS, stale_h: int = STALE_H,
        lookback_h: int = LOOKBACK_H, leads=LEADS) -> int:
    """Eén cronronde voor één box. Retour: 0 gezond, 1 bij fout/stilte, 2 config."""
    if box_id not in S.BOXES:
        log.error("onbekende box %r; bekend: %s", box_id, list(S.BOXES))
        return 2

    now = datetime.now(timezone.utc)
    failures = 0

    # Korte connecties: Neon (serverless) sluit een verbinding die tijdens de trage
    # (~5s) fetches idle staat. Elke DB-call opent daarom zijn eigen korte connectie
    # (conn=None) i.p.v. één lang-levende die de hele lus vasthoudt.
    with DB.connect() as c:
        DB.ensure_schema(c)
        have = DB.processed_analysis_times(c, box_id)

    avail = S.list_analysis_times(now - timedelta(hours=lookback_h), now)
    if not avail:
        log.error("STILTE: geen analysetijden van Matroos voor %s (endpoint down of source weg?)",
                  box_id)
        return 1

    todo = [t for t in avail if t not in have]
    keep_set = set(avail[-keep:])              # alleen de nieuwste `keep` krijgen de volle forecast
    log.info("%s: %d beschikbaar, %d ingelezen, %d nieuw op te halen",
             box_id, len(avail), len(have), len(todo))

    for at in todo:
        try:
            field = S.fetch_stroom(box_id, analysis_time=at)   # geen DB-connectie open tijdens fetch
            DB.upsert_box_grid(field)
            DB.write_hindcast(field, leads=leads)              # historie uit ELKE nieuwe run
            if at in keep_set:
                DB.ingest(field)                               # volle 48u alleen voor bewaarde runs
        except Exception:
            failures += 1
            log.exception("ingestie van run %s (%s) faalde",
                          box_id, at.strftime("%Y-%m-%d %H:%MZ"))

    DB.prune_runs(box_id, keep=keep)

    # monitoring: leeftijd van de nieuwste GEPUBLICEERDE run (Matroos-gezondheid)
    newest = avail[-1]
    age_h = (now - newest).total_seconds() / 3600
    if age_h > stale_h:
        log.error("STILTE: nieuwste run %s is %.1fu oud (> %du) — verwachting hapert",
                  newest.strftime("%Y-%m-%d %H:%MZ"), age_h, stale_h)
        failures += 1
    else:
        with DB.connect() as c:
            n_hind = _hindcast_count(c, box_id)
        log.info("%s gezond: nieuwste run %s (%.1fu oud), %d hindcast-uren totaal",
                 box_id, newest.strftime("%Y-%m-%d %H:%MZ"), age_h, n_hind)
    return 1 if failures else 0


def _hindcast_count(conn, box_id: str) -> int:
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM stroom_hindcast WHERE box_id = %s", (box_id,))
        return cur.fetchone()[0]


def _cli() -> None:
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    boxes = sys.argv[1:] or list(S.BOXES)
    keep = int(os.environ.get("STROOM_KEEP_RUNS", KEEP_RUNS))
    stale = int(os.environ.get("STROOM_STALE_H", STALE_H))
    rc = 0
    for box in boxes:
        rc = max(rc, run(box, keep=keep, stale_h=stale))
    raise SystemExit(rc)


if __name__ == "__main__":
    _cli()
