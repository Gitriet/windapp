"""Routenetwerk afleiden uit de handgetekende GeoJSON -> Neon (Fase 0-opdracht).

De 21 routes (LineStrings) zijn de *edges* van een graaf, de 19 havens de
knooppunten. Dit script leidt uit ``data/routes/routes-R01-R21.geojson`` +
``data/routes/havens.json`` drie dingen af en schrijft ze idempotent weg:

  * ``netwerk_havens``      -- knooppunt = gemiddelde van alle route-eindpunten
                               binnen 500 m (canoniek punt); naam + sluis uit
                               havens.json.
  * ``netwerk_routes``      -- de edges zelf, met de originele feature als geojson.
  * ``netwerk_samplepunten``-- punten om de 1 NM langs elke route (incl. begin/eind).

Daarna bouwt het de graaf en controleert dat alle 19 havens onderling bereikbaar
zijn. Hard falen bij: een eindpunt > 500 m van z'n knooppunt, of een onbereikbare
haven. Bronbestanden blijven onaangeroerd (heilig).

Prefix ``netwerk_*`` volgt de ``stroom_*``-conventie en vermijdt de bestaande
(andere) ``routes``-tabel in windapp/sql/schema.sql.

CLI:  python -m ingest.netwerk        (vanuit windapp/; heeft DATABASE_URL nodig)
"""
from __future__ import annotations

import json
import logging
import math
import re
import unicodedata
from pathlib import Path

from .stroom_db import connect

log = logging.getLogger("wm.netwerk")

# Bronbestanden leven in de repo-root data/routes/ (dit pakket woont in windapp/ingest/).
ROOT = Path(__file__).resolve().parent.parent.parent
ROUTES_GEOJSON = ROOT / "data" / "routes" / "routes-R01-R21.geojson"
HAVENS_JSON = ROOT / "data" / "routes" / "havens.json"

NM_M = 1852.0                  # 1 zeemijl in meter
CLUSTER_MAX_M = 500.0          # eindpunt-tolerantie rond het knooppunt
EARTH_R = 6_371_000.0

SCHEMA = """
CREATE TABLE IF NOT EXISTS netwerk_havens (
  id     TEXT PRIMARY KEY,                     -- slug, bv. 'scheveningen'
  naam   TEXT NOT NULL,
  lat    DOUBLE PRECISION NOT NULL,            -- canoniek punt (gem. eindpunten <500 m)
  lon    DOUBLE PRECISION NOT NULL,
  sluis  BOOLEAN NOT NULL DEFAULT false        -- "hier ligt een sluis"; alleen opslaan
);

CREATE TABLE IF NOT EXISTS netwerk_routes (
  id         TEXT PRIMARY KEY,                 -- 'R01'..'R21'
  van_haven  TEXT NOT NULL REFERENCES netwerk_havens(id),
  naar_haven TEXT NOT NULL REFERENCES netwerk_havens(id),
  via        TEXT,                             -- optioneel, vrije tekst uit properties
  lengte_nm  DOUBLE PRECISION NOT NULL,
  geojson    JSONB NOT NULL                    -- originele LineString-feature
);

CREATE TABLE IF NOT EXISTS netwerk_samplepunten (
  route_id   TEXT NOT NULL REFERENCES netwerk_routes(id) ON DELETE CASCADE,
  volgnr     INT  NOT NULL,
  afstand_nm DOUBLE PRECISION NOT NULL,        -- vanaf het van-punt
  lat        DOUBLE PRECISION NOT NULL,
  lon        DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (route_id, volgnr)
);
"""


def slug(naam: str) -> str:
    """Naam -> slug: accenten weg, lowercase, niet-alfanumeriek -> '-'."""
    s = unicodedata.normalize("NFKD", naam).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.asin(math.sqrt(a))


# --- laden ---------------------------------------------------------------
def load_sources() -> tuple[list[dict], dict[str, dict]]:
    """Features + {slug: haven-meta}. Valideert dat elke van/naar in havens.json zit."""
    features = json.loads(ROUTES_GEOJSON.read_text())["features"]
    havens = {h["id"]: h for h in json.loads(HAVENS_JSON.read_text())}
    for f in features:
        for k in ("van", "naar"):
            s = slug(f["properties"][k])
            if s not in havens:
                raise SystemExit(f"{f['properties']['id']}: haven {f['properties'][k]!r} "
                                 f"(slug {s!r}) ontbreekt in havens.json")
    return features, havens


# --- Stap 2.1: knooppunten ----------------------------------------------
def derive_nodes(features: list[dict]) -> dict[str, tuple[float, float]]:
    """Per haven-slug het canonieke punt = gemiddelde van alle route-eindpunten.
    Hard falen als een eindpunt > 500 m van dat gemiddelde ligt."""
    endpoints: dict[str, list[tuple[float, float]]] = {}
    for f in features:
        coords = f["geometry"]["coordinates"]
        endpoints.setdefault(slug(f["properties"]["van"]), []).append(tuple(coords[0]))
        endpoints.setdefault(slug(f["properties"]["naar"]), []).append(tuple(coords[-1]))

    nodes: dict[str, tuple[float, float]] = {}
    fouten: list[str] = []
    for s, pts in endpoints.items():
        clon = sum(p[0] for p in pts) / len(pts)
        clat = sum(p[1] for p in pts) / len(pts)
        nodes[s] = (clat, clon)
        for lon, lat in pts:
            d = haversine_m(lon, lat, clon, clat)
            if d > CLUSTER_MAX_M:
                fouten.append(f"  {s}: eindpunt ({lat:.5f},{lon:.5f}) ligt {d:.0f} m "
                              f"van knooppunt ({clat:.5f},{clon:.5f})")
    if fouten:
        raise SystemExit("Route-eindpunt(en) verder dan 500 m van hun haven-knooppunt:\n"
                         + "\n".join(fouten))
    return nodes


# --- Stap 2.2: samplepunten ---------------------------------------------
def resample_route(coords: list[list[float]], step_m: float = NM_M):
    """Punten om de step_m langs de polyline (lineaire interpolatie in lon/lat),
    inclusief begin- en eindpunt. Retourneert [(afstand_m, lat, lon), ...] + totale
    lengte (m)."""
    cum = [0.0]
    for i in range(1, len(coords)):
        cum.append(cum[-1] + haversine_m(coords[i - 1][0], coords[i - 1][1],
                                          coords[i][0], coords[i][1]))
    total = cum[-1]

    out = [(0.0, coords[0][1], coords[0][0])]     # beginpunt
    target, seg = step_m, 1
    while target < total - 1e-6:
        while cum[seg] < target:
            seg += 1
        frac = (target - cum[seg - 1]) / (cum[seg] - cum[seg - 1])
        lon = coords[seg - 1][0] + frac * (coords[seg][0] - coords[seg - 1][0])
        lat = coords[seg - 1][1] + frac * (coords[seg][1] - coords[seg - 1][1])
        out.append((target, lat, lon))
        target += step_m
    if total - out[-1][0] > 1e-6:                 # eindpunt (exact)
        out.append((total, coords[-1][1], coords[-1][0]))
    return out, total


# --- Stap 3: graafcontrole ----------------------------------------------
def check_connected(features: list[dict], nodes: dict[str, tuple[float, float]]) -> None:
    """Alle knooppunten onderling bereikbaar via de routes? Zo niet: hard falen."""
    adj: dict[str, set[str]] = {s: set() for s in nodes}
    for f in features:
        a, b = slug(f["properties"]["van"]), slug(f["properties"]["naar"])
        adj[a].add(b)
        adj[b].add(a)

    start = next(iter(nodes))
    seen, stack = {start}, [start]
    while stack:
        for nb in adj[stack.pop()]:
            if nb not in seen:
                seen.add(nb)
                stack.append(nb)
    onbereikbaar = set(nodes) - seen
    if onbereikbaar:
        raise SystemExit(f"Graaf niet samenhangend: {len(onbereikbaar)} haven(s) "
                         f"onbereikbaar vanaf {start!r}: {sorted(onbereikbaar)}")
    log.info("graaf samenhangend: alle %d havens bereikbaar", len(nodes))


# --- wegschrijven (idempotent) ------------------------------------------
def write_db(features, havens, nodes) -> dict:
    conn = connect()
    n_samples = 0
    try:
        with conn.cursor() as cur:
            cur.execute(SCHEMA)
            cur.execute("TRUNCATE netwerk_samplepunten, netwerk_routes, netwerk_havens "
                        "RESTART IDENTITY CASCADE")

            for s, (lat, lon) in sorted(nodes.items()):
                h = havens[s]
                cur.execute(
                    "INSERT INTO netwerk_havens (id, naam, lat, lon, sluis) VALUES (%s,%s,%s,%s,%s)",
                    (s, h["naam"], lat, lon, bool(h["sluis"])))

            for f in features:
                p = f["properties"]
                cur.execute(
                    """INSERT INTO netwerk_routes (id, van_haven, naar_haven, via, lengte_nm, geojson)
                       VALUES (%s,%s,%s,%s,%s,%s)""",
                    (p["id"], slug(p["van"]), slug(p["naar"]), p.get("via"),
                     p["lengte_nm"], json.dumps(f)))

                pts, _ = resample_route(f["geometry"]["coordinates"])
                rows = [(p["id"], i, d / NM_M, lat, lon) for i, (d, lat, lon) in enumerate(pts)]
                cur.executemany(
                    """INSERT INTO netwerk_samplepunten (route_id, volgnr, afstand_nm, lat, lon)
                       VALUES (%s,%s,%s,%s,%s)""", rows)
                n_samples += len(rows)
        conn.commit()
    finally:
        conn.close()
    return {"havens": len(nodes), "routes": len(features), "samplepunten": n_samples}


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    features, havens = load_sources()
    nodes = derive_nodes(features)
    check_connected(features, nodes)
    stats = write_db(features, havens, nodes)
    log.info("weggeschreven: %d havens, %d routes, %d samplepunten",
             stats["havens"], stats["routes"], stats["samplepunten"])


if __name__ == "__main__":
    main()
