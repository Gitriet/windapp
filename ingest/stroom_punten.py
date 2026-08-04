"""Samplepunt-toewijzing + puntextractie (Stap 2.3 / Stap 3).

Tegels overlappen bewust, dus een samplepunt kan in meerdere boxen vallen. De
eigenaar-box is deterministisch: dichtstbijzijnde celcentrum wint, gelijkspel op
box_id alfabetisch. Zo is de herkomst stabiel over runs en zijn runs vergelijkbaar.

Uit een box-veld (u/v over alle valid_times) haalt dit de u/v van de naaste cel per
door die box bezeten samplepunt. NaN blijft NaN hier; pas bij het wegschrijven ->
NULL (nooit nul).
"""
from __future__ import annotations

import math

import numpy as np

from .stroom_db import unpack_axis

EARTH_R = 6_371_000.0


def _haversine_m(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.asin(math.sqrt(a))


def load_box_grids(conn) -> dict[str, dict]:
    """{box_id: {lat[ny], lon[nx]}} uit stroom_box_grid (de echte, geingeste assen)."""
    out: dict[str, dict] = {}
    with conn.cursor() as cur:
        cur.execute("SELECT box_id, nx, ny, lat, lon FROM stroom_box_grid ORDER BY box_id")
        for bid, nx, ny, la, lo in cur.fetchall():
            out[bid] = {"lat": unpack_axis(la, ny), "lon": unpack_axis(lo, nx)}
    return out


def load_samplepunten(conn) -> list[tuple[str, int, float, float]]:
    with conn.cursor() as cur:
        cur.execute("SELECT route_id, volgnr, lat, lon FROM netwerk_samplepunten ORDER BY route_id, volgnr")
        return [(r[0], r[1], float(r[2]), float(r[3])) for r in cur.fetchall()]


def _nearest_cell(grid: dict, lat: float, lon: float):
    """(i, j, afstand_m) van het dichtstbijzijnde celcentrum, of None als het punt
    buiten de box-bbox valt."""
    la, lo = grid["lat"], grid["lon"]
    if not (la.min() <= lat <= la.max() and lo.min() <= lon <= lo.max()):
        return None
    i = int(np.argmin(np.abs(la - lat)))
    j = int(np.argmin(np.abs(lo - lon)))
    return i, j, _haversine_m(lat, lon, float(la[i]), float(lo[j]))


def assign_owners(samplepunten, box_grids) -> dict[tuple[str, int], tuple[str, int, int]]:
    """{(route_id, volgnr): (box_id, i, j)} volgens de keuzeregel: dichtstbijzijnde
    celcentrum wint; gelijkspel -> box_id alfabetisch. Punten buiten elke box: geen
    eigenaar (geen puntreeks)."""
    owners: dict[tuple[str, int], tuple[str, int, int]] = {}
    for route_id, volgnr, lat, lon in samplepunten:
        best = None  # (dist, box_id, i, j) — sorteer op (dist, box_id) => alfabetische tiebreak
        for bid in sorted(box_grids):                       # alfabetisch voor deterministische tie
            nc = _nearest_cell(box_grids[bid], lat, lon)
            if nc is None:
                continue
            i, j, dist = nc
            cand = (dist, bid, i, j)
            if best is None or cand[:2] < best[:2]:
                best = cand
        if best is not None:
            owners[(route_id, volgnr)] = (best[1], best[2], best[3])
    return owners


def extract_series(owners, box_id, valid_times, u, v):
    """Rijen (route_id, volgnr, box_id, valid_time, u, v) voor de door box_id bezeten
    punten, over alle valid_times. u/v uit u/v(T,ny,nx); NaN -> None (nooit nul)."""
    mine = [(rk, ij) for rk, ij in owners.items() if ij[0] == box_id]
    rows = []
    for (route_id, volgnr), (_bid, i, j) in mine:
        for t, vt in enumerate(valid_times):
            uu, vv = float(u[t, i, j]), float(v[t, i, j])
            rows.append((route_id, volgnr, box_id, vt,
                         None if math.isnan(uu) else uu,
                         None if math.isnan(vv) else vv))
    return rows
