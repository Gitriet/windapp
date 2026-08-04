"""Natwater-validatie (Stap 4.2): dekking per route uit de R2 hindcast-punten.

Leest de compacte ``hindcast-punten/{YYYY}/{MM}/{DD}.parquet`` uit R2 — NIET de
honderdduizenden grid-bestanden. Per samplepunt: het aandeel hindcast-uren met een
geldige (niet-null) u/v-vector. 100% = altijd nat; lager = valt (deels) droog. Dat
percentage IS de droogval-informatie (geen laagwater-definitie, geen correctie).
NaN/null is nooit nul: een punt zonder data is een bevinding.

Punten die in geen enkel hindcast-punt voorkomen = buiten dekking (niet door een
geingeste tegel bezeten). Voor die punten meldt het rapport of ze wel in een
geplande tegel-regio (tiles.py) liggen.

De getoetste uren staan bij elk percentage: 100% op 12 uur is zwakker bewijs dan
100% op 465 uur.

CLI:  python -m ingest.netwerk_validate   (vanuit windapp/; leest R2 + Neon)
"""
from __future__ import annotations

import logging
from collections import defaultdict

from .storage import storage
from .stroom_db import connect
from .stroom_grid_io import parquet_to_punt_rows
from .tiles import REGIONS

log = logging.getLogger("wm.netwerk_validate")


def load_coverage(st) -> tuple[dict, int]:
    """{(route_id, volgnr): [n_uren, n_nietnull]} over alle hindcast-punten-dagbestanden,
    plus het aantal dagbestanden."""
    agg: dict = defaultdict(lambda: [0, 0])
    keys = st.list_keys("hindcast-punten/")
    for k in keys:
        for rid, vg, _box, _vt, u, v in parquet_to_punt_rows(st.get(k)):
            a = agg[(rid, vg)]
            a[0] += 1
            if u is not None and v is not None:
                a[1] += 1
    return agg, len(keys)


def _in_region(lat: float, lon: float) -> bool:
    return any(r.xmin <= lon <= r.xmax and r.ymin <= lat <= r.ymax for r in REGIONS)


def validate() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    st = storage()
    cov, ndays = load_coverage(st)
    with connect() as c:
        with c.cursor() as cur:
            cur.execute("SELECT route_id, volgnr, lat, lon FROM netwerk_samplepunten "
                        "ORDER BY route_id, volgnr")
            samples = cur.fetchall()

    n_pts_cov = len(cov)
    print(f"Bron: R2 hindcast-punten ({ndays} dagbestand(en), {n_pts_cov} punten met historie).")
    if not cov:
        print("GEEN hindcast-punten in R2 -> elk punt is 'buiten dekking'.")
    print()

    per_route: dict = defaultdict(list)
    for rid, volgnr, lat, lon in samples:
        per_route[rid].append((volgnr, float(lat), float(lon)))

    header = f"{'route':6} {'punten':>6} {'buiten':>7} {'gedekt':>6}   dekking < 100% (volgnr: %@uren)"
    print(header)
    print("-" * len(header))
    tot_pts = tot_buiten = tot_planned = 0
    for rid in sorted(per_route):
        pts = per_route[rid]
        buiten, buiten_planned, onder100, gedekt = [], 0, [], 0
        uren_gedekt = set()
        for volgnr, lat, lon in pts:
            a = cov.get((rid, volgnr))
            if a is None or a[0] == 0:
                buiten.append(volgnr)
                if _in_region(lat, lon):
                    buiten_planned += 1
            else:
                n_uren, n_nn = a
                gedekt += 1
                uren_gedekt.add(n_uren)
                frac = n_nn / n_uren
                if frac < 1.0:
                    onder100.append((volgnr, frac, n_uren))
        onder100.sort(key=lambda t: t[1])
        uren_txt = ("/".join(str(u) for u in sorted(uren_gedekt)) + "u") if uren_gedekt else ""
        detail = (f"alle 100% (op {uren_txt})" if gedekt and not onder100 else
                  ("-" if not gedekt else
                   ", ".join(f"{v}:{c*100:.0f}%@{u}u" for v, c, u in onder100)))
        planned_note = f" (waarvan {buiten_planned} in geplande regio)" if buiten_planned else ""
        print(f"{rid:6} {len(pts):>6} {len(buiten):>7} {gedekt:>6}   {detail}{planned_note}")
        tot_pts += len(pts); tot_buiten += len(buiten); tot_planned += buiten_planned

    print("-" * len(header))
    print(f"{'TOTAAL':6} {tot_pts:>6} {tot_buiten:>7} {tot_pts - tot_buiten:>6}   "
          f"buiten dekking waarvan {tot_planned} in geplande (nog niet geingeste) regio")


if __name__ == "__main__":
    validate()
