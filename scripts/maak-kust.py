# Maakt lib/kust.json: land en droogvallende platen voor het routekaartje (VAARPLAN).
# Bronnen:
#  - PDOK / Kadaster, BRT Top10NL (CC BY 4.0): zee, meren en droogvallend gebied; gemeentegebied als
#    Nederlands gebied. Dit levert de Nederlandse kust in detail (havens, dijken, eilanden, wadplaten).
#  - Natural Earth 1:10m land (publiek domein): alles buiten Nederland (Duitsland, België).
# Gebruik (vanuit windapp/, met `pip install shapely`):  python3 scripts/maak-kust.py
# Downloadt eenmalig naar ./kust-bron/ (bestaande bestanden worden hergebruikt) en schrijft lib/kust.json.
# Ringen zijn bijgesneden tot het kader hieronder en vereenvoudigd (Douglas-Peucker, TOL graden), als
# gehele getallen ×1e4 (lon, lat, lon, lat, ...). Land en platen zijn elk een lijst ringen (even-odd).
import json, os, time, urllib.request
from shapely.geometry import shape, box, mapping
from shapely.ops import unary_union

LON0, LON1, LAT0, LAT1 = 1.8, 8.2, 50.3, 54.6
TOL = 0.0008        # graden (~90 m): basic, maar de vorm van eilanden en geulen blijft herkenbaar
GAT = 0.004         # deel van het land dat kleiner is dan dit (graden², ~50 km²) als meer: gevuld, geen gat
DIR = "kust-bron"
PDOK = "https://api.pdok.nl"
NL_BOX = "3.1,51.2,7.3,53.65"   # Zeeland t/m Groningen


def haal(naam, url):
    pad = f"{DIR}/{naam}"
    if not os.path.exists(pad):
        os.makedirs(DIR, exist_ok=True)
        print("download", naam)
        urllib.request.urlretrieve(url, pad)
    return pad


def pdok_paged(url, filt):
    out = []
    while url:
        for _ in range(5):
            try:
                d = json.load(urllib.request.urlopen(url, timeout=300)); break
            except Exception as e:
                print("opnieuw", e); time.sleep(3)
        out += [x for x in (filt(f) for f in d["features"]) if x]
        url = next((l["href"] for l in d["links"] if l["rel"] == "next"), None)
    return out


def nl_gebied():
    pad = f"{DIR}/gemeentegebied.json"
    if not os.path.exists(pad):
        os.makedirs(DIR, exist_ok=True)
        fs = pdok_paged(f"{PDOK}/kadaster/brk-bestuurlijke-gebieden/ogc/v1/collections/gemeentegebied/items?f=json&limit=100", lambda f: f["geometry"])
        json.dump(fs, open(pad, "w"))
    return unary_union([shape(g).buffer(0) for g in json.load(open(pad))])


def nl_water():
    pad = f"{DIR}/top10nl-water.json"
    if not os.path.exists(pad):
        os.makedirs(DIR, exist_ok=True)

        def filt(f):   # ruim vlak water; kleine meren en sloten laten we weg
            tw = f["properties"].get("typewater")
            g = f["geometry"]
            if tw in ("zee", "droogvallend", "droogvallend (LAT)") or (tw == "meer, plas" and len(json.dumps(g)) > 6000):
                return {"t": "plat" if tw.startswith("droogvallend") else "water", "g": g}
        fs = pdok_paged(f"{PDOK}/brt/top10nl/ogc/v1/collections/waterdeel_vlak/items?f=json&limit=1000&bbox={NL_BOX}", filt)
        json.dump(fs, open(pad, "w"))
    w = json.load(open(pad))
    water = unary_union([shape(x["g"]).buffer(0) for x in w if x["t"] == "water"])
    plat = unary_union([shape(x["g"]).buffer(0) for x in w if x["t"] == "plat"])
    return water, plat


def ringen(geom, kader, drop_holes, min_area):
    out = []
    g = geom.intersection(kader).simplify(TOL, preserve_topology=True)
    for p in getattr(g, "geoms", [g]):
        if p.geom_type != "Polygon" or p.is_empty or p.area < min_area:
            continue
        for r in [p.exterior] + ([] if drop_holes else list(p.interiors)):
            c = list(r.coords)[:-1]
            if len(c) >= 3:
                out.append([round(v * 1e4) for pt in c for v in pt])
    return out


def main():
    kader = box(LON0, LAT0, LON1, LAT1)
    gebied = nl_gebied()
    water, plat = nl_water()
    ne = unary_union([shape(f["geometry"]).buffer(0) for f in json.load(open(haal(
        "ne_10m_land.geojson", "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson")))["features"]])
    nl_land = gebied.difference(water).difference(plat)   # droogvallend is geen land: aparte laag
    buiten = ne.difference(gebied.buffer(0.002))
    land = unary_union([nl_land, buiten]).buffer(0.0008).buffer(-0.0008)   # naden tussen de bronnen sluiten
    platen = plat.intersection(gebied)
    # land zonder kleine binnenmeren (alleen de grote, zoals het IJsselmeer, blijven een gat)
    from shapely.geometry import Polygon
    schoon = []
    for p in getattr(land, "geoms", [land]):
        schoon.append(Polygon(p.exterior, [h for h in p.interiors if Polygon(h).area >= GAT]))
    land = unary_union(schoon)
    l, pl = ringen(land, kader, False, 2e-5), ringen(platen, kader, True, 1e-4)
    json.dump({"land": l, "platen": pl}, open("lib/kust.json", "w"), separators=(",", ":"))
    print("land", len(l), sum(len(r) // 2 for r in l), "platen", len(pl), sum(len(r) // 2 for r in pl))


main()
