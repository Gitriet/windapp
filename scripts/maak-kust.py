# Maakt lib/kust.json: de kust van Nederland en omgeving voor het routekaartje (VAARPLAN).
# Bron: Natural Earth 1:10m land (publiek domein):
#   curl -O https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson
# Gebruik: python3 scripts/maak-kust.py   (leest ne_10m_land.geojson uit de huidige map, schrijft kust.json)
# Ringen zijn bijgesneden tot het kader hieronder en vereenvoudigd (Douglas-Peucker, TOL graden).
import json, math
LON0, LON1, LAT0, LAT1 = 1.8, 8.2, 50.3, 54.6
TOL = 0.0015     # graden (~150 m): basic, geen details

def clip_edge(pts, inside, inter):
    out = []
    for i in range(len(pts)):
        a, b = pts[i - 1], pts[i]
        ia, ib = inside(a), inside(b)
        if ib:
            if not ia: out.append(inter(a, b))
            out.append(b)
        elif ia:
            out.append(inter(a, b))
    return out

def clip(ring):
    pts = ring[:-1] if ring[0] == ring[-1] else ring[:]
    def ix(x):  # snijpunt met verticale lijn
        return lambda a, b: (x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]))
    def iy(y):
        return lambda a, b: (a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]), y)
    for inside, inter in [
        (lambda p: p[0] >= LON0, ix(LON0)), (lambda p: p[0] <= LON1, ix(LON1)),
        (lambda p: p[1] >= LAT0, iy(LAT0)), (lambda p: p[1] <= LAT1, iy(LAT1))]:
        if not pts: return []
        pts = clip_edge(pts, inside, inter)
    return pts

def dp(pts, tol):
    if len(pts) < 3: return pts
    def d(p, a, b):
        dx, dy = b[0] - a[0], b[1] - a[1]
        if dx == dy == 0: return math.hypot(p[0] - a[0], p[1] - a[1])
        t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
        return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    st = [(0, len(pts) - 1)]
    while st:
        i, j = st.pop()
        m, k = 0, -1
        for q in range(i + 1, j):
            dd = d(pts[q], pts[i], pts[j])
            if dd > m: m, k = dd, q
        if m > tol: keep[k] = True; st += [(i, k), (k, j)]
    return [p for p, kk in zip(pts, keep) if kk]

def area(p):
    return abs(sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p)))) / 2

d = json.load(open("ne_10m_land.geojson"))
ringen = []
for f in d["features"]:
    g = f["geometry"]
    polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
    for poly in polys:
        for ring in poly:
            xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
            if max(xs) < LON0 or min(xs) > LON1 or max(ys) < LAT0 or min(ys) > LAT1: continue
            c = clip([tuple(p) for p in ring])
            if len(c) < 3: continue
            c = dp(c + [c[0]], TOL)[:-1]
            if len(c) < 3 or area(c) < 1e-5: continue
            ringen.append([round(v * 1e4) for p in c for v in p])
json.dump({"ringen": ringen}, open("kust.json", "w"), separators=(",", ":"))
print(len(ringen), sum(len(r) // 2 for r in ringen))
