"""Tegelgenerator + regio-config voor de stroom-ingestie (Nederlandse kust).

Elke Matroos-fetch moet onder ~150k cellen blijven (preflight #4: nx*ny*stappen
< ~10M cel-stappen, ~52 stappen bij 48u+hindcast). Een regio groter dan dat wordt
hier opgedeeld in aaneensluitende tegels met een kleine overlap-marge, zodat de
serveerlaag de naden naadloos kan stikken.

Resolutie per regio: geulen/estuaria op 100 m (detail in de vaargeulen), de open
Noordzee-kuststrook op 300 m (x9 minder cellen; offshore is glad genoeg). De
bronmodel-resolutie is ~100 m; nx/ny bepalen hoe fijn we die bemonsteren.

Draai `python -m ingest.tiles` voor de tegeltabel + cel- en opslagbegroting.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from .stroom import Box

M_PER_DEG_LAT = 111_320.0

# Max cellen per ophaal-request. Preflight: ~10M cel-stappen / ~52 tijdstappen
# (48u horizon + een paar hindcast-uren) -> ~190k; ruime marge -> 150k.
MAX_CELLS = 150_000
# Overlap naar binnen tussen buurtegels van dezelfde regio, in cellen: garandeert
# dat elk punt ruim binnen minstens een tegel valt (naadloos stikken downstream).
OVERLAP_CELLS = 6


@dataclass(frozen=True)
class Region:
    """Een aaneengesloten kustgebied + doelresolutie; wordt tot Box-tegels gehakt."""
    id: str
    xmin: float
    xmax: float
    ymin: float
    ymax: float
    res_m: int          # doelresolutie in meters (100 = geul, 300 = offshore)


# NL-kust. Geulen/estuaria op 100 m, open Noordzee-kuststrook op 300 m.
# Rechthoeken zijn een eerste snit, makkelijk bij te stellen; droge/land-cellen
# worden verderop NaN (geen stroom), dus een royale rechthoek kost alleen opslag.
REGIONS: list[Region] = [
    # --- geulen / estuaria: 100 m ---
    Region("wad-west", 4.70, 5.55, 52.90, 53.45, 100),   # Marsdiep + Vlie
    Region("wad-oost", 5.35, 7.25, 53.20, 53.80, 100),   # Borndiep..Eems/Dollard
    Region("zeeland",  3.35, 4.35, 51.30, 51.95, 100),   # Wester-/Oosterschelde + Voordelta
    Region("rijnmond", 3.95, 4.40, 51.85, 52.10, 100),   # Maasmond / Nieuwe Waterweg / Haringvliet
    # --- open Noordzee-kuststrook: 300 m ---
    Region("nz-zuid",  2.95, 4.60, 51.30, 52.55, 300),   # Zeeland..Holland-kust zeewaarts
    Region("nz-noord", 4.20, 6.95, 52.45, 53.95, 300),   # Holland..Wad-eilanden zeewaarts
]

# De 300 m open-Noordzee-regio's; de rest zijn de 100 m geul/estuarium-tegels.
# Gebruikt om de ingest-cron in twee jobs te splitsen (offshore krijgt zo een eigen
# timeout-budget i.p.v. achteraan in één cyclus te verhongeren). Zie stroom-ingest.yml.
OFFSHORE_REGION_IDS = frozenset({"nz-zuid", "nz-noord"})

# Tegels die uit de gegenereerde box-set worden gehouden. nz-noord-01 (ZO-hoek van
# nz-noord: lon 5,55–6,95 x lat 52,45–53,22) bestaat vrijwel geheel uit IJsselmeer
# + land en valt buiten het DCSM-Noordzeedomein: Matroos geeft er een interpolate-
# fout (geen NetCDF) i.p.v. NaN's, dus de cron faalde er elke cyclus op (rode Action).
# De tegel bezit 0 routepunten. Uitgesloten zodat de overige nz-noord-tegels
# (00/10/11) hun bestaande box-id's houden (geen her-ingest).
EXCLUDE_TILES = frozenset({"nz-noord-01"})


def _m_per_deg_lon(lat_deg: float) -> float:
    return M_PER_DEG_LAT * math.cos(math.radians(lat_deg))


def _grid_dims(r: Region) -> tuple[float, int, int]:
    """(m/graad-lon op middenbreedte, nx_totaal, ny_totaal) op doelresolutie."""
    mlon = _m_per_deg_lon(0.5 * (r.ymin + r.ymax))
    nx = max(1, math.ceil((r.xmax - r.xmin) * mlon / r.res_m))
    ny = max(1, math.ceil((r.ymax - r.ymin) * M_PER_DEG_LAT / r.res_m))
    return mlon, nx, ny


def _split(nx_tot: int, ny_tot: int, max_cells: int) -> tuple[int, int]:
    """Kleinste kolom/rij-verdeling zodat elke tegel <= max_cells; zo vierkant
    mogelijk (verklein telkens de langste tegel-dimensie)."""
    ncols = nrows = 1
    while math.ceil(nx_tot / ncols) * math.ceil(ny_tot / nrows) > max_cells:
        if math.ceil(nx_tot / ncols) >= math.ceil(ny_tot / nrows):
            ncols += 1
        else:
            nrows += 1
    return ncols, nrows


def make_tiles(r: Region, max_cells: int = MAX_CELLS) -> list[Box]:
    """Hak een regio in aaneensluitende Box-tegels (<= max_cells), met overlap
    tussen buurtegels. Eén tegel als de hele regio al past."""
    mlon, nx_tot, ny_tot = _grid_dims(r)
    ncols, nrows = _split(nx_tot, ny_tot, max_cells)
    dx = (r.xmax - r.xmin) / ncols
    dy = (r.ymax - r.ymin) / nrows
    mx = OVERLAP_CELLS * r.res_m / mlon              # overlap in graden lon
    my = OVERLAP_CELLS * r.res_m / M_PER_DEG_LAT     # overlap in graden lat

    tiles: list[Box] = []
    for j in range(nrows):
        for i in range(ncols):
            # basiscel + overlap naar binnen (niet buiten de regiogrens)
            xa = r.xmin + dx * i - (mx if i > 0 else 0.0)
            xb = r.xmin + dx * (i + 1) + (mx if i < ncols - 1 else 0.0)
            ya = r.ymin + dy * j - (my if j > 0 else 0.0)
            yb = r.ymin + dy * (j + 1) + (my if j < nrows - 1 else 0.0)
            nx = max(2, round((xb - xa) * mlon / r.res_m))
            ny = max(2, round((yb - ya) * M_PER_DEG_LAT / r.res_m))
            box_id = r.id if (ncols == 1 and nrows == 1) else f"{r.id}-{j}{i}"
            tiles.append(Box(box_id, round(xa, 4), round(xb, 4),
                             round(ya, 4), round(yb, 4), nx, ny))
    return tiles


def build_boxes(regions: list[Region] = REGIONS) -> dict[str, Box]:
    """Alle regio's -> {box_id: Box}. Dit voedt stroom.BOXES en dus de cron."""
    out: dict[str, Box] = {}
    for r in regions:
        for t in make_tiles(r):
            if t.id in EXCLUDE_TILES:
                continue
            if t.id in out:
                raise ValueError(f"dubbele box-id {t.id!r}")
            out[t.id] = t
    return out


def box_group(box_id: str) -> str:
    """'offshore' voor de 300 m open-Noordzee-tegels (nz-zuid/nz-noord), anders
    'inshore'. Voedt de --inshore/--offshore selectie in de cron."""
    for rid in OFFSHORE_REGION_IDS:
        if box_id == rid or box_id.startswith(rid + "-"):
            return "offshore"
    return "inshore"


def _report() -> None:
    """Tegeltabel + cel- en opslagbegroting (dense float16 u/v)."""
    BYTES_PER_CELL_STEP = 4          # u+v als float16 = 2+2 bytes
    STEPS_PER_RUN = 52               # ~48u horizon + paar hindcast-uren
    KEEP_RUNS = 3

    grand_cells = 0
    print(f"{'regio':10} {'res':>4}  {'tegels':>6}  {'cellen':>10}  bbox")
    for r in REGIONS:
        tiles = make_tiles(r)
        cells = sum(t.nx * t.ny for t in tiles)
        grand_cells += cells
        maxc = max(t.nx * t.ny for t in tiles)
        print(f"{r.id:10} {r.res_m:>3}m  {len(tiles):>6}  {cells:>10,}  "
              f"[{r.xmin},{r.xmax}]x[{r.ymin},{r.ymax}]  max_tegel={maxc:,}")
    n_tiles = sum(len(make_tiles(r)) for r in REGIONS)

    run_mb = grand_cells * BYTES_PER_CELL_STEP * STEPS_PER_RUN / 1e6
    live_gb = run_mb * KEEP_RUNS / 1000
    hind_day_mb = grand_cells * BYTES_PER_CELL_STEP * 24 / 1e6
    print(f"\ntegels totaal : {n_tiles}")
    print(f"cellen totaal : {grand_cells:,} (dense, incl. droge cellen)")
    print(f"per run       : ~{run_mb:.0f} MB dense  ({STEPS_PER_RUN} stappen)")
    print(f"live (keep={KEEP_RUNS}) : ~{live_gb:.2f} GB")
    print(f"hindcast      : ~{hind_day_mb:.0f} MB/dag (1 slice/uur, groeit door)")
    print("sparse (alleen natte cellen) ~ helft hiervan; vereist schemawijziging.")


if __name__ == "__main__":
    _report()
