"use client";
import { useEffect, useRef, useState } from "react";
import type { Location } from "@/lib/types";
import { roleOf, currentArrow } from "@/lib/route";

const ROLE_COLOR = { van: "#1DC87A", via: "#17B5EA", naar: "#8B79F5" } as const;

type Arrow = { lat: number; lon: number; u: number; v: number };

// Leaflet-kaart (donkere tiles) met route-polyline, waypoint-markers en stroompijlen.
// Leaflet wordt alleen client-side geladen (dynamische import in het effect).
// ETA per waypoint-key, in potlood-materialiteit onder de naam. `legs` markeert per
// beentje of het een kruisrak is, zodat de routelijn dat laat zien.
export type MapEta = { label: string; src: string };

export default function MapView({ waypoints, arrows, legs, etas, onWaypointClick }: {
  waypoints: Location[]; arrows: Arrow[];
  legs?: { tacking: boolean }[];
  etas?: Record<string, MapEta>;
  onWaypointClick?: (key: string) => void;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const arrowLayerRef = useRef<any>(null);
  const LRef = useRef<any>(null);
  const clickRef = useRef(onWaypointClick);
  clickRef.current = onWaypointClick;
  const legsRef = useRef(legs);
  legsRef.current = legs;
  const etasRef = useRef(etas);
  etasRef.current = etas;
  // telt op na elke (her)opbouw van de kaart, zodat de pijlenlaag opnieuw wordt gezet
  const [mapVersion, setMapVersion] = useState(0);

  // init map + route + markers (herbouwt bij wijziging van de route)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !elRef.current) return;
      LRef.current = L;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }

      const pts = waypoints.map((w) => [w.lat, w.lon] as [number, number]);
      const center: [number, number] = pts.length
        ? [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]
        : [53.0, 4.8];

      const map = L.map(elRef.current, {
        center, zoom: 10, zoomControl: false, attributionControl: false,
        dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, keyboard: false,
      });
      mapRef.current = map;
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { subdomains: "abcd", maxZoom: 19 }).addTo(map);

      // per been een eigen lijn, zodat een kruisrak zijn eigen markering krijgt
      for (let i = 0; i + 1 < pts.length; i++) {
        const tacking = legsRef.current?.[i]?.tacking ?? false;
        L.polyline([pts[i], pts[i + 1]], {
          color: tacking ? "#F3A430" : "#1DC87A",
          weight: 3, dashArray: tacking ? "2 5" : "9 5", opacity: 0.9,
        }).addTo(map);
      }
      waypoints.forEach((w, i) => {
        const role = roleOf(i, waypoints.length);
        const c = ROLE_COLOR[role], s = role === "via" ? 11 : 13;
        const marker = L.marker([w.lat, w.lon], { icon: L.divIcon({
          className: "", iconSize: [Math.max(s, 22), Math.max(s, 22)], iconAnchor: [Math.max(s, 22) / 2, Math.max(s, 22) / 2],
          html: `<div style="width:${Math.max(s, 22)}px;height:${Math.max(s, 22)}px;display:flex;align-items:center;justify-content:center;cursor:pointer"><div style="width:${s}px;height:${s}px;border-radius:50%;background:${c};box-shadow:0 0 10px ${c}55;border:2px solid rgba(255,255,255,.2)"></div></div>`,
        }) }).addTo(map);
        marker.on("click", () => clickRef.current?.(w.location_key));
        const el = marker.getElement();
        if (el) { el.style.cursor = "pointer"; el.addEventListener("click", () => clickRef.current?.(w.location_key)); }
        // naam + ETA in potlood (grafiet, gestippelde onderlijn, herkomst eronder)
        const eta = etasRef.current?.[w.location_key];
        const etaHtml = eta
          ? `<div style="font-family:'DM Mono',monospace;font-size:10px;color:#6590B3;border-bottom:1px dashed #263D58;display:inline-block;padding-bottom:1px;margin-top:2px">${eta.label}</div>` +
            `<div style="font-family:'DM Mono',monospace;font-size:8px;color:#3B5872;margin-top:1px">${eta.src}</div>`
          : "";
        L.marker([w.lat, w.lon], { interactive: false, icon: L.divIcon({
          className: "", iconSize: [190, 44], iconAnchor: [95, 50],
          html: `<div style="text-align:center;white-space:nowrap;text-shadow:0 1px 4px #000,0 0 8px #000">` +
            `<div style="font-family:'DM Mono',monospace;font-size:10px;font-weight:500;color:${role === "via" ? "#17B5EA" : "#DDE9F8"}">${w.name}</div>` +
            `${etaHtml}</div>`,
        }) }).addTo(map);
      });

      if (pts.length >= 2) {
        try { map.fitBounds(L.latLngBounds(pts).pad(0.35)); } catch { /* single point */ }
      }
      arrowLayerRef.current = null;      // oude laag ging mee met de vorige kaart
      setMapVersion((v) => v + 1);
    })();
    return () => { cancelled = true; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
    // herbouwt ook als de ETA's of kruisrakken veranderen (bv. andere performance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waypoints.map((w) => w.location_key).join(","),
      JSON.stringify(legs?.map((l) => l.tacking) ?? []), JSON.stringify(etas ?? {})]);

  // stroompijlen-laag (ververst bij nieuwe uur-slice)
  useEffect(() => {
    const L = LRef.current, map = mapRef.current;
    if (!L || !map) return;
    if (arrowLayerRef.current) { map.removeLayer(arrowLayerRef.current); arrowLayerRef.current = null; }
    if (!arrows.length) return;
    const layer = L.layerGroup();
    const maxMag = Math.max(0.1, ...arrows.map((a) => currentArrow(a.u, a.v).mag));
    for (const a of arrows) {
      const { mag, bearingDeg: bearing } = currentArrow(a.u, a.v);   // richting waarheen de stroom loopt
      const op = 0.4 + 0.4 * (mag / maxMag);
      layer.addLayer(L.marker([a.lat, a.lon], { interactive: false, icon: L.divIcon({
        className: "", iconSize: [22, 22], iconAnchor: [11, 11],
        html: `<svg width="22" height="22" viewBox="0 0 22 22" style="opacity:${op.toFixed(2)}"><path d="M11,2 L16,17 L11,13 L6,17 Z" fill="#17B5EA" transform="rotate(${bearing.toFixed(0)},11,11)"/></svg>`,
      }) }));
    }
    layer.addTo(map);
    arrowLayerRef.current = layer;
  }, [arrows, mapVersion]);

  return <div className="map" ref={elRef} />;
}
