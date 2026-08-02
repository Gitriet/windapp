"""Natwater-validatie: toets elk route-samplepunt tegen de stroom-hindcast.

Per samplepunt:
  1. Valt het binnen een geconfigureerde tegel (een box met hindcast-data)?
     Zo nee -> rapporteren als "buiten dekking" (met de notitie of het punt wel
     in een *geplande* regio uit tiles.py ligt, maar die box nog niet geingest is).
  2. Dekkingspercentage van de dichtstbijzijnde cel = aandeel hindcast-uren met
     data (niet-NaN). Dat percentage IS de droogval-informatie: 100% = altijd nat,
     lager = valt (deels) droog. Geen laagwater-definitie nodig, geen correctie.

NaN is nooit nul: een punt zonder data is een bevinding, geen nul-stroom.

Rapport per route: aantal punten, aantal buiten dekking, en de gedekte punten
met dekking < 100% (volgnr: percentage), gesorteerd van laag naar hoog.

CLI:  python -m ingest.netwerk_validate   (vanuit windapp/; heeft DATABASE_URL nodig)
"""
from __future__ import annotations

import logging

import numpy as np

from .stroom_db import connect, unpack_axis, unpack_field
from .tiles import REGIONS

log = logging.getLogger("wm.netwerk_validate")


def load_ingested_boxes(conn) -> dict:
    """Boxen met hindcast-data -> {box_id: {lat, lon, wet(ny,nx), n}}. `wet` is per
    cel het aandeel hindcast-uren met een geldige (u,v)-vector (niet-NaN)."""
    boxes: dict[str, dict] = {}
    with conn.cursor() as cur:
        cur.execute("SELECT box_id, nx, ny, lat, lon FROM stroom_box_grid ORDER BY box_id")
        grids = [(bid, nx, ny, unpack_axis(la, ny), unpack_axis(lo, nx))
                 for bid, nx, ny, la, lo in cur.fetchall()]
        for bid, nx, ny, lat, lon in grids:
            cur.execute("SELECT u, v FROM stroom_hindcast WHERE box_id=%s ORDER BY valid_time", (bid,))
            rows = cur.fetchall()
            if not rows:
                continue
            valid = np.zeros((ny, nx), dtype=np.float64)
            for u, v in rows:
                uu, vv = unpack_field(u, ny, nx), unpack_field(v, ny, nx)
                valid += np.isfinite(uu) & np.isfinite(vv)
            boxes[bid] = {"lat": lat, "lon": lon, "wet": valid / len(rows), "n": len(rows)}
    return boxes


def _in_region(lat: float, lon: float) -> bool:
    """Ligt het punt in een geplande tegel-regio (tiles.py), los van of die box
    al geingest is?"""
    return any(r.xmin <= lon <= r.xmax and r.ymin <= lat <= r.ymax for r in REGIONS)


def coverage(boxes: dict, lat: float, lon: float):
    """Hoogste dekkingsfractie over alle geingeste boxen die dit punt bevatten,
    met het aantal getoetste uren van die box; None als geen box het punt dekt.
    De uren horen bij het percentage: 100% op 12 uur is zwakker bewijs dan op 462."""
    best = None
    for b in boxes.values():
        la, lo = b["lat"], b["lon"]
        if not (la.min() <= lat <= la.max() and lo.min() <= lon <= lo.max()):
            continue
        i = int(np.argmin(np.abs(la - lat)))
        j = int(np.argmin(np.abs(lo - lon)))
        frac = float(b["wet"][i, j])
        if best is None or frac > best[0]:
            best = (frac, b["n"])
    return best


def validate() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    conn = connect()
    try:
        boxes = load_ingested_boxes(conn)
        with conn.cursor() as cur:
            cur.execute("""SELECT route_id, volgnr, lat, lon FROM netwerk_samplepunten
                           ORDER BY route_id, volgnr""")
            samples = cur.fetchall()
    finally:
        conn.close()

    if boxes:
        print("Geingeste stroom-boxen (geconfigureerde tegels met data):")
        for bid, b in boxes.items():
            print(f"  {bid}: lon[{b['lon'].min():.3f},{b['lon'].max():.3f}] "
                  f"lat[{b['lat'].min():.3f},{b['lat'].max():.3f}]  {b['n']} uurslices")
    else:
        print("GEEN geingeste stroom-boxen gevonden -> elk punt is 'buiten dekking'.")
    print()

    # groepeer per route
    per_route: dict[str, list[tuple[int, float, float]]] = {}
    for rid, volgnr, lat, lon in samples:
        per_route.setdefault(rid, []).append((volgnr, lat, lon))

    tot_pts = tot_buiten = tot_planned = 0
    header = f"{'route':6} {'punten':>6} {'buiten':>7} {'gedekt':>6}   dekking < 100% (volgnr: %)"
    print(header)
    print("-" * len(header))
    for rid in sorted(per_route):
        pts = per_route[rid]
        buiten = []          # volgnrs zonder geingeste dekking
        buiten_planned = 0   # daarvan: wel in geplande regio
        onder100 = []        # (volgnr, pct, uren) voor gedekte punten < 100%
        gedekt = 0
        uren_gedekt = set()  # aantal getoetste uren over de gedekte punten
        for volgnr, lat, lon in pts:
            cov = coverage(boxes, lat, lon)
            if cov is None:
                buiten.append(volgnr)
                if _in_region(lat, lon):
                    buiten_planned += 1
            else:
                frac, uren = cov
                gedekt += 1
                uren_gedekt.add(uren)
                if frac < 1.0:
                    onder100.append((volgnr, frac, uren))
        onder100.sort(key=lambda t: t[1])   # laag -> hoog
        # de getoetste uren horen bij het percentage (weinig uren = zwak bewijs)
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
