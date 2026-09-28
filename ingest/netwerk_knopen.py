"""Routenetwerk opknippen bij knooppunten (zeegaten/kruispunten) -> nieuwe GeoJSON.

De Navionics-routes lopen van haven naar haven; doorgaand verkeer (bv. Den Helder ->
Lauwersoog) moest daardoor een tussenhaven in en weer uit. Dit script knipt elke route
op bij de knooppunten uit ``data/routes/knooppunten.json`` die er binnen TOL_M langs
liggen, zodat de graaf ook via die punten kan lopen.

  * Elke originele route blijft bestaan, ongewijzigd (zelfde id -> stroomhistorie
    blijft, en geen havenpaar wordt langer).
  * Daarnaast levert een route met knooppunten stukken ``R17a``, ``R17b``, ...: de
    lijn buigt via het knooppunt (eindpunt == knooppunt, exact). Die stukken dienen
    het doorgaande verkeer; wat ze door het buigen langer zijn, meldt het rapport.
  * Meerdere stukken tussen hetzelfde paar (de lange routes buitenom overlappen):
    het kortste blijft actief, de rest krijgt ``actief: false`` + ``dubbel_van``.

Controles (hard falen): stuklengte, extra lengte door buigen, graaf samenhangend,
geen havenpaar langer dan voorheen, en de ijkgevallen hieronder.

Schrijft alleen ``data/routes/routes-knopen.geojson``; de database blijft onaangeroerd
(dat is de volgende stap, via netwerk.py). Bronbestanden blijven heilig.

CLI:  python -m ingest.netwerk_knopen      (vanuit windapp/)
"""
from __future__ import annotations

import heapq
import itertools
import json
import math
import string

from .netwerk import NM_M, ROOT, haversine_m, load_sources, slug

KNOOPPUNTEN_JSON = ROOT / "data" / "routes" / "knooppunten.json"
UIT_GEOJSON = ROOT / "data" / "routes" / "routes-knopen.geojson"

TOL_M = 1500.0          # knooppunt telt voor een route als die er zo dicht langs loopt
RAND_NM = 0.3           # niet knippen vlak bij een route-eind (dat is de haven zelf)
MIN_STUK_NM = 0.1
LENGTE_TOL_NM = 0.5     # extra lengte door buigen via knooppunten, absoluut ...
LENGTE_TOL_REL = 0.01   # ... of relatief, wat groter is
IJK = [                 # (van, naar, max_nm, verboden tussenhaven)
    ("den-helder", "lauwersoog", 80.0, "vlieland"),
    ("breskens", "vlissingen", 4.0, "cadzand-bad"),
    ("harlingen", "vlieland", 19.0, "west-terschelling"),
]


def lengte_nm(coords) -> float:
    return sum(haversine_m(*coords[i - 1], *coords[i]) for i in range(1, len(coords))) / NM_M


def projecteer(pt, a, b):
    """(afstand_m, t, punt) van pt tot segment a-b (lokaal vlak, lon geschaald)."""
    k = math.cos(math.radians(pt[1]))
    ax, ay = (a[0] - pt[0]) * k, a[1] - pt[1]
    bx, by = (b[0] - pt[0]) * k, b[1] - pt[1]
    dx, dy = bx - ax, by - ay
    t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / (dx * dx + dy * dy)))
    q = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
    return haversine_m(*pt, *q), t, q


def knip(feature, knopen) -> list[dict]:
    """Stukken van één route. Zonder knip: [de originele feature]."""
    c = feature["geometry"]["coordinates"]
    p = feature["properties"]
    totaal = lengte_nm(c)
    cuts = []
    for k in knopen:
        pt = [k["lon"], k["lat"]]
        (d, t, q), i = min(((projecteer(pt, c[i], c[i + 1]), i) for i in range(len(c) - 1)),
                           key=lambda x: x[0][0])
        langs = lengte_nm(c[: i + 1] + [q])
        if d <= TOL_M and RAND_NM < langs < totaal - RAND_NM:
            cuts.append((langs, i, q, k, d))
    if not cuts:
        return [feature]
    cuts.sort(key=lambda x: x[0])

    van = (slug(p["van"]), p["van"])
    eindes = [van] + [(k["id"], k["naam"]) for _, _, _, k, _ in cuts] + [(slug(p["naar"]), p["naar"])]
    # de lijn buigt via het knooppunt (vorig hoekpunt -> knooppunt -> volgend hoekpunt);
    # geen heen-en-terug-stukje, dus de extra lengte blijft klein
    stukken, begin, vorig = [], [c[0]], 0
    for _, i, q, k, d in cuts:
        knoop = [k["lon"], k["lat"]]
        stukken.append(begin + c[vorig + 1: i + 1] + [knoop])
        begin, vorig = [knoop], i
    stukken.append(begin + c[vorig + 1:])

    out = []
    for n, (a, b, coords) in enumerate(zip(eindes, eindes[1:], stukken)):
        out.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {
                "id": f"{p['id']}{string.ascii_lowercase[n]}",
                "van": a[1], "naar": b[1], "van_id": a[0], "naar_id": b[0],
                "via": p.get("via"), "lengte_nm": round(lengte_nm(coords), 1),
                "bron": f"geknipt uit {p['id']} ({p.get('bron', '')})", "origineel": p["id"],
            },
        })
    return out


def dijkstra(edges, a, b):
    g: dict = {}
    for x, y, w in edges:
        g.setdefault(x, []).append((y, w))
        g.setdefault(y, []).append((x, w))
    dist, prev, q = {a: 0.0}, {}, [(0.0, a)]
    while q:
        d, u = heapq.heappop(q)
        if u == b:
            break
        if d > dist[u]:
            continue
        for v, w in g.get(u, []):
            if d + w < dist.get(v, math.inf):
                dist[v], prev[v] = d + w, u
                heapq.heappush(q, (d + w, v))
    if b not in dist:
        return math.inf, []
    pad = [b]
    while pad[-1] != a:
        pad.append(prev[pad[-1]])
    return dist[b], pad[::-1]


def main() -> None:
    features, havens = load_sources()
    knopen = json.loads(KNOOPPUNTEN_JSON.read_text())
    botsing = {k["id"] for k in knopen} & set(havens)
    if botsing:
        raise SystemExit(f"knooppunt-id botst met haven-id: {sorted(botsing)}")

    fouten: list[str] = []
    nieuw: list[dict] = []
    for f in features:
        stukken = knip(f, knopen)
        p = f["properties"]
        if len(stukken) > 1:
            som = sum(s["properties"]["lengte_nm"] for s in stukken)
            orig = lengte_nm(f["geometry"]["coordinates"])
            if abs(som - orig) > max(LENGTE_TOL_NM, LENGTE_TOL_REL * orig):
                fouten.append(f"{p['id']}: stukken {som:.1f} NM vs origineel {orig:.1f} NM (te veel buigen)")
            print(f"{p['id']:4} {p['van']} -> {p['naar']}: {len(stukken)} stukken "
                  f"({' | '.join(s['properties']['naar'] for s in stukken[:-1])}), "
                  f"{orig:.1f} -> {som:.1f} NM")
        if len(stukken) > 1:
            stukken = [f] + stukken          # origineel blijft naast de stukken
        for s in stukken:
            s["properties"].setdefault("van_id", slug(s["properties"]["van"]))
            s["properties"].setdefault("naar_id", slug(s["properties"]["naar"]))
            if s["properties"]["lengte_nm"] < MIN_STUK_NM:
                fouten.append(f"{s['properties']['id']}: stuk korter dan {MIN_STUK_NM} NM")
            nieuw.append(s)

    # per ongeordend paar: kortste actief, rest dubbel
    per_paar: dict = {}
    for s in nieuw:
        per_paar.setdefault(tuple(sorted((s["properties"]["van_id"], s["properties"]["naar_id"]))), []).append(s)
    for groep in per_paar.values():
        groep.sort(key=lambda s: s["properties"]["lengte_nm"])
        for i, s in enumerate(groep):
            s["properties"]["actief"] = i == 0
            if i:
                s["properties"]["dubbel_van"] = groep[0]["properties"]["id"]
    actief = [s for s in nieuw if s["properties"]["actief"]]
    print(f"\n{len(features)} routes -> {len(nieuw)} stukken, {len(actief)} actief, "
          f"{len(nieuw) - len(actief)} dubbel")

    # controles op de graaf
    oud = [(slug(f["properties"]["van"]), slug(f["properties"]["naar"]), f["properties"]["lengte_nm"]) for f in features]
    nw = [(s["properties"]["van_id"], s["properties"]["naar_id"], s["properties"]["lengte_nm"]) for s in actief]
    korter = 0
    for a, b in itertools.combinations(sorted(havens), 2):
        d0, _ = dijkstra(oud, a, b)
        d1, _ = dijkstra(nw, a, b)
        if math.isinf(d1):
            fouten.append(f"{a} -> {b}: onbereikbaar")
        elif d1 > d0 + LENGTE_TOL_NM:
            fouten.append(f"{a} -> {b}: langer dan voorheen ({d0:.1f} -> {d1:.1f} NM)")
        elif d1 < d0 - 0.5:
            korter += 1
    print(f"havenparen korter dan voorheen: {korter} van {len(havens) * (len(havens) - 1) // 2}")
    for a, b, maxi, verboden in IJK:
        d, pad = dijkstra(nw, a, b)
        print(f"ijk {a} -> {b}: {d:.1f} NM via {[x for x in pad[1:-1]]}")
        if d > maxi or verboden in pad:
            fouten.append(f"ijk {a} -> {b}: {d:.1f} NM (max {maxi}), pad {pad}")

    if fouten:
        raise SystemExit("Opknippen afgekeurd:\n  " + "\n  ".join(fouten))
    UIT_GEOJSON.write_text(json.dumps({"type": "FeatureCollection", "features": nieuw}, ensure_ascii=False))
    print(f"\ngeschreven: {UIT_GEOJSON}")


if __name__ == "__main__":
    main()
