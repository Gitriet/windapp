"use client";
// Tidan — Nu-view + Tocht-planner, nagebouwd uit het design-handoff-prototype maar
// gevoed door de echte API's (/api/forecast, /api/tide, /api/week, /api/route-stroom,
// /api/routes) en de bestaande libs (polar.ts, route.ts, tripsim.ts). De Nu-view volgt
// de nav-picker; de Tocht-planner kiest uit de bekende havenroutes (netwerk_routes) en
// zet het antwoord (beste vertrek + alternatieven) vooraan, het bewijs (grafieken) erna.
import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_BOAT } from "@/lib/polar";
import { localHM, localMidnight, localDateISO } from "@/lib/tz";
import { compass, beaufort } from "@/lib/format";
import { COLORS, alpha } from "@/lib/colors";
import { simulateTrip, type SimResult, type SimWind } from "@/lib/tripsim";
import {
  DEFAULT_ROUTE_ID, fetchForecast, fetchWeek, fetchTide, fetchHavenTide, fetchRouteCurrent, fetchRoutes,
  toWindSamples, type ForecastResponse, type WeekResponse, type RouteCurrent, type RouteInfo, type RouteHaven,
} from "@/lib/planner-data";
import { bearing, routeDistanceNm } from "@/lib/route";
import { shortestPath } from "@/lib/netwerk-path";
import HavenSelector from "./components/HavenSelector";
import VaarplanView, { type ViaHaven, PassageStrip } from "./components/VaarplanView";
import type { Location, TideData, TideExtreme } from "@/lib/types";
import {
  CurrentTimeline, WindTimeline, TripChart, SummaryRow, DepartureCards, WindBarbs, Compass,
  dirLabel16, sailPhrase, windAgainstCurrent, fmtDur, type DepOption, type WindTLSample,
} from "./components/charts";
import { WindCanvas } from "./components/WindCanvas";
import { useIsMobile } from "@/lib/use-is-mobile";

const H = 3_600_000;
const tms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));
const isTide = (t: TideData | { tide: null } | null): t is TideData => !!t && "extremes" in t;

// windrichting-waaruit → stroomrichting van de deeltjes op het canvas
function canvasDir(dirFrom: number): number {
  const t = ((dirFrom + 180) * Math.PI) / 180;
  return (Math.atan2(-Math.cos(t), Math.sin(t)) * 180) / Math.PI;
}

// Eén dynamische contextzin uit de forecast: trend (bouwt op / neemt af / vrij
// constant, met de doelwaarde ~6u vooruit), draaiing (draait naar … / blijft …) en de
// bron (meting = gekalibreerd, anders model). Onder de tags in de hero.
function windContext(pts: ForecastResponse["points"]): string {
  const p0 = pts[0];
  const t = pts[Math.min(6, pts.length - 1)];
  const d = t.speed_kn - p0.speed_kn;
  const trend = d > 2 ? `bouwt op naar ${Math.round(t.speed_kn)} kn`
    : d < -2 ? `neemt af naar ${Math.round(t.speed_kn)} kn`
    : "vrij constant";
  const turn = Math.abs(((t.dir_deg - p0.dir_deg + 540) % 360) - 180);
  const draai = turn >= 25 ? `draait naar ${dirLabel16(t.dir_deg)}` : `blijft ${dirLabel16(p0.dir_deg)}`;
  const bron = p0.corrected ? "meting" : "model";
  const s = `${trend}, ${draai} · ${bron}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Combineert de wind-per-station (SimWind) tot één route-reeks voor de windtijdlijn:
// per tijdstip de scalaire gemiddelde snelheid + vector-gemiddelde richting over de
// stations die op dat moment data hebben. De stations delen hetzelfde forecast-grid.
function combineWindStations(wind: SimWind | null): WindTLSample[] {
  if (!wind) return [];
  const series = Object.values(wind).filter((s) => s.length);
  if (!series.length) return [];
  const times = Array.from(new Set(series.flatMap((s) => s.map((x) => x.time)))).sort();
  const maps = series.map((s) => new Map(s.map((x) => [x.time, x])));
  return times.map((t) => {
    let e = 0, n = 0, spd = 0, k = 0;
    for (const m of maps) {
      const x = m.get(t);
      if (!x) continue;
      const r = (x.dir_deg * Math.PI) / 180;
      e += Math.sin(r); n += Math.cos(r); spd += x.speed_kn; k++;
    }
    if (!k) return { t, speedKn: 0, dirDeg: 0 };
    return { t, speedKn: spd / k, dirDeg: ((Math.atan2(e / k, n / k) * 180) / Math.PI + 360) % 360 };
  });
}

export default function Page() {
  const [page, setPage] = useState<"now" | "departure" | "vaarplan">("now");
  const [locations, setLocations] = useState<Location[]>([]);
  const [locIdx, setLocIdx] = useState(0);
  const [showLocPicker, setShowLocPicker] = useState(false);
  // locatiepicker (Nu-view): knop en menu zijn losse siblings, dus check beide refs.
  const locBtnRef = useRef<HTMLDivElement>(null);
  const locMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showLocPicker) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!locBtnRef.current?.contains(t) && !locMenuRef.current?.contains(t)) setShowLocPicker(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showLocPicker]);
  const [depDay, setDepDay] = useState<0 | 1 | 2>(0);
  const [depRange, setDepRange] = useState<12 | 24>(12);
  const [depMs, setDepMs] = useState<number | null>(null);
  // Tocht-planner route: gekozen uit de bekende havenroutes (/api/routes),
  // onafhankelijk van de nav-picker (die stuurt de Nu-view).
  const [routes, setRoutes] = useState<RouteInfo[]>([]);
  const [fromHaven, setFromHaven] = useState<string>("");
  const [toHaven, setToHaven] = useState<string>("");

  // Nu-view data (volgt de picker)
  const [nowFc, setNowFc] = useState<ForecastResponse | null>(null);
  const [nowWeek, setNowWeek] = useState<WeekResponse | null>(null);
  const [nowTide, setNowTide] = useState<TideData | { tide: null } | null>(null);

  // Tocht-planner data (volgt de gekozen van→naar-tocht; per been een stroomreeks)
  const [routeWind, setRouteWind] = useState<SimWind | null>(null);
  const [legCurrents, setLegCurrents] = useState<(RouteCurrent | null)[]>([]);
  const [routeTide, setRouteTide] = useState<TideData | null>(null);      // vertrekhaven
  const [routeTideTo, setRouteTideTo] = useState<TideData | null>(null);  // aankomsthaven
  const [nowMs, setNowMs] = useState<number>(0);
  const [err, setErr] = useState<string | null>(null);
  // De 12-kaart-selectielogica (clamp + auto-best) is desktop-specifiek; de mobiele
  // Tocht-tak draait op een eigen 48u-sweep met eigen beste-vertrek. Op mobiel zetten
  // we die effecten uit zodat ze de sweep-selectie niet overschrijven.
  const isMobile = useIsMobile();

  // ── mount: klok + locatielijst + havenroutes ──
  useEffect(() => {
    setNowMs(Date.now());
    let ignore = false;
    (async () => {
      try {
        const [locs, rts] = await Promise.all([
          fetch("/api/locations", { cache: "no-store" }).then((r) => r.json()) as Promise<Location[]>,
          fetchRoutes(),
        ]);
        if (ignore) return;
        setLocations(locs);
        const ti = locs.findIndex((l) => l.location_key === "texel");
        if (ti >= 0) setLocIdx(ti);
        setRoutes(rts);
        const def = rts.find((r) => r.id === DEFAULT_ROUTE_ID) ?? rts[0];
        if (def) { setFromHaven(def.van.haven); setToHaven(def.naar.haven); }
      } catch (e) {
        if (!ignore) setErr(String(e));
      }
    })();
    return () => { ignore = true; };
  }, []);

  // Alle bekende havens (met coördinaten + dichtstbijzijnd station) uit de route-uiteinden.
  // Elke haven is nu vrij kiesbaar, ook zonder voorgedefinieerde route ertussen.
  const havenMap = useMemo(() => {
    const m = new Map<string, RouteHaven>();
    for (const r of routes) { m.set(r.van.haven, r.van); m.set(r.naar.haven, r.naar); }
    return m;
  }, [routes]);
  const allHavens = useMemo(
    () => [...havenMap.values()].sort((a, b) => a.naam.localeCompare(b.naam, "nl")).map((h) => h.haven),
    [havenMap],
  );

  // Kortste pad door het netwerk (Dijkstra op lengte_nm): een keten van 1..N buur-
  // segmenten. Een directe route is gewoon een keten van lengte 1. null = geen pad
  // (haven onbekend of — theoretisch — onverbonden).
  const chain = useMemo(() => shortestPath(routes, fromHaven, toHaven), [routes, fromHaven, toHaven]);
  // uiteinden in vaarrichting (voor de wind-station-labels). Met pad: eerste/laatste
  // haven van de keten; zonder pad: de losse havens uit havenMap (rechte-lijn-fallback).
  const endpoints = useMemo(() => {
    if (chain) return { van: chain.havens[0], naar: chain.havens[chain.havens.length - 1] };
    const a = havenMap.get(fromHaven), b = havenMap.get(toHaven);
    return a && b ? { van: a, naar: b } : null;
  }, [chain, fromHaven, toHaven, havenMap]);
  // waypoints voor de sim = de hele havenketen (N+1 punten); zonder pad de twee losse havens.
  const waypoints = useMemo(() => {
    const hs = chain ? chain.havens : endpoints ? [endpoints.van, endpoints.naar] : [];
    return hs.map((h) => ({ location_key: h.key, lat: h.lat, lon: h.lon }));
  }, [chain, endpoints]);
  // koers = grove peiling begin→eind (bij 1 leg identiek aan de leg-peiling)
  const routeBearing = waypoints.length >= 2 ? bearing(waypoints[0], waypoints[waypoints.length - 1]) : null;
  // afstand: som van lengte_nm over de segmenten; zonder pad de rechte lijn
  const routeDistNm = chain ? chain.totalNm
    : endpoints ? routeDistanceNm([endpoints.van, endpoints.naar]) : null;
  // stroom-dekking over de keten: compleet (elk been), deels, of geen
  const stroomFlags = chain?.legs.map((l) => l.route.stroom) ?? [];
  const stroomComplete = stroomFlags.length > 0 && stroomFlags.every(Boolean);
  const stroomPartial = stroomFlags.some(Boolean) && !stroomComplete;
  const legsZonderStroom = chain?.legs.filter((l) => !l.route.stroom).map((l) => l.label) ?? [];
  const hasRoute = !!chain;

  // Van en Naar zijn vrij kiesbaar; de enige regel is dat ze verschillen. Bij een
  // botsing draait de keuze de tocht om (de andere haven schuift mee).
  const chooseFrom = (h: string) => {
    if (h === toHaven) setToHaven(fromHaven);
    setFromHaven(h);
    setDepMs(null);
  };
  const chooseTo = (h: string) => {
    if (h === fromHaven) setFromHaven(toHaven);
    setToHaven(h);
    setDepMs(null);
  };

  // ── Tocht-planner data bij tochtwissel ──
  // Wind per DISTINCT station in de keten; stroom per been (elk op de eigen leg-peiling,
  // teken-omgekeerd als het been tegen de opslagrichting in gevaren wordt — dat zit al in
  // fetchRouteCurrent). Getij bij de VERTREKHAVEN (het getijstation van waaruit je
  // vertrekt is relevanter voor de tocht dan dat van de eindhaven; bv. Den Helder →
  // denhelder.marsdiep i.p.v. Texel). Bij een rechte-lijn-fallback (geen keten): geen
  // stroom, wind aan de twee uiteinden.
  useEffect(() => {
    if (waypoints.length < 2) { setRouteWind(null); setLegCurrents([]); setRouteTideTo(null); return; }
    const keys = [...new Set(waypoints.map((w) => w.location_key))];
    // getij bij BEIDE havens via het EIGEN station (haven slug), niet de gedeelde wind-key
    const vanSlug = (chain ? chain.havens[0] : endpoints?.van)?.haven ?? null;
    const naarSlug = (chain ? chain.havens[chain.havens.length - 1] : endpoints?.naar)?.haven ?? null;
    const legs = chain?.legs ?? [];
    let ignore = false;
    (async () => {
      try {
        const [winds, curs, tide, tideTo] = await Promise.all([
          Promise.all(keys.map((k) => fetchForecast(k))),
          Promise.all(legs.map((l) => (l.route.stroom ? fetchRouteCurrent(l.route.id, l.bearingDeg) : Promise.resolve(null)))),
          vanSlug ? fetchHavenTide(vanSlug) : Promise.resolve(null),
          naarSlug ? fetchHavenTide(naarSlug) : Promise.resolve(null),
        ]);
        if (ignore) return;
        const wind: SimWind = {};
        keys.forEach((k, i) => { wind[k] = toWindSamples(winds[i].points); });
        setRouteWind(wind);
        setLegCurrents(curs);
        setRouteTide(isTide(tide) ? tide : null);
        setRouteTideTo(isTide(tideTo) ? tideTo : null);
      } catch (e) {
        if (!ignore) setErr(String(e));
      }
    })();
    return () => { ignore = true; };
  }, [chain, waypoints]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Nu-view data bij locatiewissel ──
  const locKey = locations[locIdx]?.location_key;
  useEffect(() => {
    if (!locKey) return;
    let ignore = false;
    (async () => {
      try {
        const [fc, wk, td] = await Promise.all([fetchForecast(locKey), fetchWeek(locKey), fetchTide(locKey)]);
        if (ignore) return;
        setNowFc(fc); setNowWeek(wk); setNowTide(td);
      } catch (e) { if (!ignore) setErr(String(e)); }
    })();
    return () => { ignore = true; };
  }, [locKey]);

  // Altijd 12 kaarten in één rij. 12u → interval 1u, 24u → interval 2u (dekt 24u af).
  // Vandaag start op het eerstvolgende hele uur na nu (verstreken uren weglaten);
  // morgen/overmorgen op 06:00 lokaal.
  const candidates = useMemo(() => {
    if (!nowMs) return [];
    const stepH = depRange === 24 ? 2 : 1;
    const start = depDay === 0
      ? Math.ceil(nowMs / H) * H
      : localMidnight(nowMs + depDay * 24 * H) + 6 * H;
    return Array.from({ length: 12 }, (_, i) => start + i * stepH * H);
  }, [nowMs, depDay, depRange]);

  // stroom per been in sim-vorm (index = leg); lege reeks = been zonder stroomdata
  const alongPerLeg = useMemo(
    () => (chain ? chain.legs.map((_, i) => legCurrents[i]?.series ?? []) : []),
    [chain, legCurrents],
  );
  // echte beenlengte per leg (langs de geul, = route.lengte_nm) zodat de gevaren afstand
  // klopt met de getoonde afstand; zonder pad (rechte lijn) terugvallen op haversine
  const legDistNm = useMemo(() => (chain ? chain.legs.map((l) => l.route.lengte_nm) : undefined), [chain]);
  const runSim = useMemo(() => {
    return (dep: number): SimResult | null => {
      if (!routeWind || waypoints.length < 2) return null;
      return simulateTrip({
        waypoints, departMs: dep, boat: DEFAULT_BOAT,
        wind: routeWind, along: alongPerLeg, legDistNm,
      });
    };
  }, [routeWind, waypoints, alongPerLeg, legDistNm]);

  const depOptions: DepOption[] = useMemo(
    () => candidates.map((dep) => ({ depMs: dep, result: runSim(dep)! })).filter((o) => o.result),
    [candidates, runSim],
  );
  // beste vertrek (kortste vaartijd) — voedt de antwoordregel + BEST-badge
  const bestOption = useMemo(() => {
    const reach = depOptions.filter((o) => o.result?.arrMs != null);
    return reach.length ? reach.reduce((b, o) => (o.result.tripMin < b.result.tripMin ? o : b)) : null;
  }, [depOptions]);

  // clamp een gekozen vertrek in de zichtbare dag (alleen als er iets gekozen is)
  useEffect(() => {
    if (isMobile) return;   // mobiel: sweep-selectie mag buiten de 12-kaart-dag vallen
    if (!candidates.length || depMs == null) return;
    if (depMs < candidates[0] || depMs > candidates[candidates.length - 1]) setDepMs(null);
  }, [candidates]); // eslint-disable-line react-hooks/exhaustive-deps

  // Toon het detail meteen voor het BESTE vertrek: selecteer de BEST-kaart automatisch
  // zolang de gebruiker zelf niets koos (depMs == null). Bij het laden staat het detail
  // dus direct open; een route-/dag-/range-wissel zet depMs op null, waarna de selectie
  // meeschuift naar het nieuwe beste uur. Een eigen kaartkeuze (depMs != null) blijft staan.
  useEffect(() => {
    if (isMobile) return;   // mobiel: DepartureMobile kiest zelf het sweep-beste vertrek
    if (depMs == null && bestOption) setDepMs(bestOption.depMs);
  }, [depMs, bestOption, isMobile]);

  // Bij het omschakelen naar mobiel de (desktop-)selectie één keer wissen, zodat de
  // mobiele tak vanaf null naar zijn eigen 48u-sweep-beste vertrek kan defaulten.
  useEffect(() => {
    if (isMobile) setDepMs(null);
  }, [isMobile]);

  const selTrip = useMemo(() => (depMs != null ? runSim(depMs) : null), [depMs, runSim]);

  const hwMs = useMemo(
    () => (routeTide?.extremes ?? []).filter((e) => e.kind === "HW").map((e) => tms(e.t)),
    [routeTide],
  );

  // tussenliggende havens (uitwijk) + cumulatieve nm-vanaf-vertrek, voor het vaarplan.
  // Alleen de binnen-havens van de keten (begin/eind zijn vertrek/aankomst).
  const viaHavens = useMemo<ViaHaven[]>(() => {
    if (!chain) return [];
    const out: ViaHaven[] = [];
    let acc = 0;
    for (let i = 0; i < chain.legs.length; i++) {
      acc += chain.legs[i].route.lengte_nm;
      if (i < chain.legs.length - 1) out.push({ haven: chain.havens[i + 1], nmFromStart: acc });
    }
    return out;
  }, [chain]);

  // wind langs de route (gecombineerd over de stations) + de station-namen voor het label
  const windSeries = useMemo(() => combineWindStations(routeWind), [routeWind]);
  const windStations = useMemo(() => {
    const hs = chain ? chain.havens : endpoints ? [endpoints.van, endpoints.naar] : [];
    return Array.from(new Set(hs.map((h) => h.stationNaam)));
  }, [chain, endpoints]);

  // route-descriptor voor de planner-UI: het pad, per-segment stroomtijdlijnen en de
  // stroom-dekkingsvlaggen. Bij 1 leg gedraagt dit zich als de oude directe route.
  const routeMeta: RouteMeta = {
    hasRoute,
    legCount: chain?.legs.length ?? 0,
    pathNamen: chain?.namen ?? [],
    viaHavens: chain?.viaNamen ?? [],
    viaPassage: chain && chain.legs.length === 1 ? (chain.legs[0].route.via ?? null) : null,
    stroomComplete, stroomPartial, legsZonderStroom,
    legTimelines: (chain?.legs ?? []).map((l, i) => ({ label: l.label, cur: legCurrents[i] ?? null, distNm: l.route.lengte_nm })),
    windSeries, windStations,
  };

  const dayNames = ["Vandaag", "Morgen", "Overmorgen"];
  const loc = locations[locIdx];

  return (
    <div style={{ padding: "calc(16px + env(safe-area-inset-top)) calc(24px + env(safe-area-inset-right)) calc(16px + env(safe-area-inset-bottom)) calc(24px + env(safe-area-inset-left))" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", position: "relative" }}>
        {/* nav */}
        <div className="nav" style={{ borderBottom: "1px solid rgba(233,233,237,.08)" }}>
          <span className="nav-brand" style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke={COLORS.weer} strokeWidth={2} strokeLinecap="round"><path d="M3 8h11a3 3 0 1 0-3-3" /><path d="M3 12h15a3 3 0 1 1-3 3" /><path d="M3 16h9" /></svg>
            Tidan
          </span>
          <a href="#" aria-current={page === "now" ? "page" : undefined} onClick={(e) => { e.preventDefault(); setPage("now"); }}>Nu</a>
          <a href="#" aria-current={page === "departure" ? "page" : undefined} onClick={(e) => { e.preventDefault(); setPage("departure"); }}>Tocht planner</a>
          <a href="#" aria-current={page === "vaarplan" ? "page" : undefined} onClick={(e) => { e.preventDefault(); setPage("vaarplan"); }}>Vaarplan</a>
          <div style={{ flex: 1 }} />
          {/* polaire-badge: subtiel één-regel label, in de header (alle views) */}
          <span className="nav-polaire" style={{ fontSize: 11, whiteSpace: "nowrap", color: "rgba(233,233,237,.4)", fontVariantNumeric: "tabular-nums" }}>
            Winner 11.20 <span style={{ color: "rgba(233,233,237,.3)" }}>· {Math.round(DEFAULT_BOAT.performance * 100)}%</span>
          </span>
          {/* Locatiepicker is alleen relevant voor de Nu-view. Desktop: altijd renderen
              (visibility toggelt) zodat de header niet verspringt bij tab-wissel. Mobiel:
              de picker staat op een eigen volle-breedte-rij, dus 'm buiten Nu wél renderen
              zou een lege rij reserveren → op mobiel alleen op Nu renderen. */}
          {(!isMobile || page === "now") && (
          <div ref={locBtnRef} className="loc-picker" onClick={() => setShowLocPicker((s) => !s)} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", padding: "5px 12px", borderRadius: 8, background: alpha(COLORS.weer, 0.08), border: `1px solid ${alpha(COLORS.weer, 0.18)}`, fontSize: 13, visibility: page === "now" ? "visible" : "hidden", pointerEvents: page === "now" ? "auto" : "none" }}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={COLORS.weer} strokeWidth={2} strokeLinecap="round"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" /><circle cx={12} cy={9} r={2.5} /></svg>
            <span>{loc?.name ?? "…"}</span>
            <svg width={10} height={10} viewBox="0 0 10 10" fill="none" stroke="rgba(233,233,237,.4)" strokeWidth={1.5}><path d="M2.5 4 L5 6.5 L7.5 4" /></svg>
          </div>
          )}
        </div>

        {page === "now" && showLocPicker && (
          <div ref={locMenuRef} style={{ position: "absolute", right: 26, top: 50, zIndex: 10, background: "#1e2035", borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,.5), 0 0 0 1px rgba(233,233,237,.1)", padding: 8, minWidth: 240, maxHeight: 360, overflowY: "auto" }}>
            {locations.map((l, i) => (
              <div key={l.location_key} onClick={() => { setLocIdx(i); setShowLocPicker(false); }} style={{ padding: "9px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 10 }}>
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={i === locIdx ? COLORS.weer : "rgba(233,233,237,.3)"} strokeWidth={2}><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" /><circle cx={12} cy={9} r={2.5} /></svg>
                <span style={{ flex: 1 }}>{l.name}</span>
                <span style={{ fontSize: 11, color: "rgba(233,233,237,.35)" }}>{l.area}</span>
                {i === locIdx && <svg width={14} height={14} viewBox="0 0 20 20" fill={COLORS.weer}><path d="M8.5 14.2 L4 9.7 l1.4-1.4 3.1 3.1 6.1-6.1 1.4 1.4z" /></svg>}
              </div>
            ))}
          </div>
        )}

        {err && <div style={{ padding: 24, color: "#c07a7a", fontSize: 13 }}>Fout bij laden: {err}</div>}

        {page === "now" ? <NowView fc={nowFc} week={nowWeek} tide={nowTide} loc={loc} nowMs={nowMs} />
          : page === "vaarplan" ? (
            selTrip && depMs != null && endpoints ? (
              <VaarplanView
                depMs={depMs} trip={selTrip} from={endpoints.van} to={endpoints.naar}
                distanceNm={routeDistNm} bearingDeg={routeBearing}
                routeLabel={{ pathNamen: routeMeta.pathNamen, viaPassage: routeMeta.viaPassage, legCount: routeMeta.legCount }}
                fromTide={routeTide} toTide={routeTideTo} via={viaHavens} boat={DEFAULT_BOAT}
                stroomSpan={stroomSpanOf(routeMeta.legTimelines)} />
            ) : (
              // geen geldig vertrekmoment (bv. herladen op deze view)
              <VaarplanEmpty />
            )
          )
          : <DepartureView
              routeBearing={routeBearing} routeDistNm={routeDistNm} route={routeMeta}
              selTrip={selTrip} depMs={depMs} setDepMs={setDepMs} hwMs={hwMs}
              depOptions={depOptions} bestOption={bestOption} depDay={depDay} setDepDay={setDepDay}
              depRange={depRange} setDepRange={setDepRange} dayNames={dayNames} ready={!!routeWind}
              routes={routes} fromHaven={fromHaven} toHaven={toHaven}
              chooseFrom={chooseFrom} chooseTo={chooseTo} allHavens={allHavens}
              fromStation={endpoints?.van ?? null} toStation={endpoints?.naar ?? null}
              runSim={runSim} nowMs={nowMs} viaHavens={viaHavens} />}
      </div>
    </div>
  );
}

// ════════════════════ NU-VIEW ════════════════════
function NowView({ fc, week, tide, loc, nowMs }: {
  fc: ForecastResponse | null; week: WeekResponse | null;
  tide: TideData | { tide: null } | null; loc?: Location; nowMs: number;
}) {
  const isMobile = useIsMobile();
  if (!fc || !loc) return <Loading label="wind laden…" />;
  const pts = fc.points;
  if (!pts.length) return <div style={{ padding: 40, color: "rgba(233,233,237,.5)" }}>Geen voorspelling beschikbaar voor {loc.name}.</div>;
  const p0 = pts[0];
  const bft = beaufort(p0.speed_kn);
  const nextHW = isTide(tide) ? (tide.extremes.find((e) => e.kind === "HW" && tms(e.t) >= nowMs) ?? tide.extremes.find((e) => e.kind === "HW")) : null;

  const chartPts = pts.slice(0, 13);
  const barbItems = Array.from({ length: 6 }, (_, i) => {
    const idx = Math.min(pts.length - 1, i * 2);
    const p = pts[idx];
    return { kt: Math.round(p.speed_kn), dir: p.dir_deg, label: i === 0 ? "Nu" : localHM(tms(p.time)) };
  });

  return (
    <div className="nowview">
      {isMobile ? <HeroMobile p0={p0} bft={bft} /> : (
      <div style={{ display: "flex", alignItems: "center", gap: 24, position: "relative", overflow: "hidden", borderRadius: 12, padding: "10px 20px", background: "linear-gradient(120deg,#191c2b,#12131f)" }}>
        <WindCanvas dir={canvasDir(p0.dir_deg)} />
        <div style={{ position: "relative", flex: 1 }}>
          <div style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: COLORS.weer }}>
            {loc.name} · {new Intl.DateTimeFormat("nl-NL", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" }).format(nowMs)}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4 }}>
            <span className="kpi" style={{ fontSize: 52, lineHeight: 0.9, fontWeight: 600, letterSpacing: "-.03em", color: COLORS.wind }}>{Math.round(p0.speed_kn)}</span>
            <span style={{ fontSize: 18, color: "rgba(233,233,237,.6)" }}>kn</span>
            <span style={{ fontSize: 22, fontWeight: 600, color: "rgba(233,233,237,.85)", marginLeft: 4 }}>{dirLabel16(p0.dir_deg)}</span>
            <span style={{ fontSize: 16, color: "rgba(233,233,237,.5)", fontVariantNumeric: "tabular-nums" }}>{Math.round(p0.dir_deg)}°</span>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <span className="tag tag-wind">bft {bft}</span>
            <span className="tag tag-wind">vlaag {Math.round(p0.gust_kn)}</span>
            {nextHW && <span className="tag tag-water">HW {localHM(tms(nextHW.t))}</span>}
            <span className="tag tag-weer">{p0.model_label}</span>
          </div>
          <div style={{ fontSize: 13, color: "rgba(233,233,237,.6)", marginTop: 8, fontVariantNumeric: "tabular-nums" }}>{windContext(pts)}</div>
        </div>
        <div style={{ position: "relative", flex: "none", width: 96, height: 96 }}>
          <div style={{ transform: "scale(0.558)", transformOrigin: "top left" }}><Compass dir={p0.dir_deg} /></div>
        </div>
      </div>
      )}

      <div className="now-grid" style={{ display: "grid", gap: 22, marginTop: 16 }}>
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(233,233,237,.85)" }}>Komende 12 uur</span>
            <span style={{ fontSize: 11, color: "rgba(233,233,237,.4)" }}>{loc.name} · wind in knopen</span>
          </div>
          <Chart12h points={chartPts} />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(233,233,237,.85)", marginBottom: 10 }}>Windveren</div>
          <WindBarbs items={barbItems} />
        </div>
      </div>

      <div style={{ marginTop: 26 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(233,233,237,.85)", marginBottom: 8 }}>7-daagse vooruitzichten</div>
        <WeekTable week={week} tide={tide} />
      </div>
    </div>
  );
}

// Windkracht-beschrijving afgeleid van het Beaufort-getal (0–12). Puur een
// presentatielabel — geen databron; het getal komt uit beaufort(speed_kn).
const BFT_LABEL = [
  "stil", "zwak", "zwak", "matig", "matig", "vrij krachtig", "krachtig",
  "hard", "stormachtig", "storm", "zware storm", "zeer zware storm", "orkaan",
];

// Mobiele hero (≤640px): compas + snelheid als anker, drie compacte metrics
// eronder. Vereenvoudigd t.o.v. desktop — geen datumregel, HW-tag, model-tag of
// trend-zin. Golf/water hebben geen forecast-bron → tonen `—`. WindCanvas blijft
// de achtergrond-particles (amber, kleur uit COLORS.wind). Conform de mock
// tidan-hero-mobile.html.
function HeroMobile({ p0, bft }: { p0: ForecastResponse["points"][number]; bft: number }) {
  const spd = Math.round(p0.speed_kn);
  const dir = p0.dir_deg;
  // amber stip op de kompasrand = windrichting t.o.v. noord (Nu-view, geen koers)
  const rad = (dir * Math.PI) / 180, cx = 50 + 40 * Math.sin(rad), cy = 50 - 40 * Math.cos(rad);
  // golf/water: geen veld in de forecast → bron is null → `—`
  const golf: number | null = null, water: number | null = null;
  const dimVal = "rgba(233,233,237,.35)";
  return (
    <div style={{ position: "relative", overflow: "hidden", borderRadius: 16, padding: "22px 18px 20px", background: alpha(COLORS.wind, 0.05), border: `1px solid ${alpha(COLORS.wind, 0.22)}` }}>
      <WindCanvas dir={canvasDir(dir)} color={COLORS.wind} />
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 18 }}>
        <svg viewBox="0 0 100 100" width={104} height={104} style={{ flex: "0 0 auto" }}>
          <circle cx={50} cy={50} r={40} fill="none" stroke={alpha(COLORS.wind, 0.3)} strokeWidth={1.5} />
          <g stroke={alpha(COLORS.wind, 0.55)} strokeWidth={2}>
            <line x1={50} y1={10} x2={50} y2={17} /><line x1={50} y1={83} x2={50} y2={90} />
            <line x1={10} y1={50} x2={17} y2={50} /><line x1={83} y1={50} x2={90} y2={50} />
          </g>
          <g stroke={alpha(COLORS.wind, 0.3)} strokeWidth={1.5}>
            <line x1={21.7} y1={21.7} x2={26} y2={26} /><line x1={78.3} y1={21.7} x2={74} y2={26} />
            <line x1={21.7} y1={78.3} x2={26} y2={74} /><line x1={78.3} y1={78.3} x2={74} y2={74} />
          </g>
          <circle cx={cx} cy={cy} r={5.5} fill={COLORS.wind} />
          <text x={50} y={49} textAnchor="middle" dominantBaseline="central" fontSize={30} fontWeight={700} fill="#e9e9ed" className="kpi">{spd}</text>
          <text x={50} y={66} textAnchor="middle" fontSize={9} fill="rgba(233,233,237,.5)">kn</text>
        </svg>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 44, fontWeight: 700, lineHeight: 1, color: COLORS.wind }} className="kpi">
            {spd}<span style={{ fontSize: 20, fontWeight: 500, color: alpha(COLORS.wind, 0.7), marginLeft: 4 }}>kn</span>
          </div>
          <div style={{ fontSize: 15, color: "rgba(233,233,237,.8)", marginTop: 6, fontVariantNumeric: "tabular-nums" }}>{dirLabel16(dir)} · {Math.round(dir)}°</div>
          <div style={{ fontSize: 13, color: "rgba(233,233,237,.45)", marginTop: 2 }}>{bft} Bft · {BFT_LABEL[bft]}</div>
        </div>
      </div>
      <div style={{ position: "relative", display: "flex", gap: 8, marginTop: 18 }}>
        <Metric label="Vlaag" value={`${Math.round(p0.gust_kn)} kn`} color={COLORS.wind} />
        <Metric label="Golf" value={golf == null ? "—" : `${golf} m`} color={dimVal} />
        <Metric label="Water" value={water == null ? "—" : `${water}°`} color={dimVal} />
      </div>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ flex: 1, textAlign: "center", padding: "10px 6px", borderRadius: 10, background: "rgba(255,255,255,.04)" }}>
      <div style={{ fontSize: 10, color: "rgba(233,233,237,.4)", textTransform: "uppercase", letterSpacing: ".4px" }}>{label}</div>
      <div className="kpi" style={{ fontSize: 17, fontWeight: 600, marginTop: 3, color }}>{value}</div>
    </div>
  );
}

function Chart12h({ points }: { points: ForecastResponse["points"] }) {
  const W = 620, Hgt = 220, n = points.length;
  if (n < 2) return <svg width="100%" viewBox={`0 0 ${W} ${Hgt}`} />;
  const PL = 34, PR = 14, PT = 34, PB = 22;
  const x0 = PL, x1 = W - PR, yTop = PT, yBot = Hgt - PB, plotW = x1 - x0, plotH = yBot - yTop;
  const maxGust = Math.max(...points.map((p) => p.gust_kn));
  const maxKn = Math.max(30, Math.ceil(maxGust / 10) * 10);         // vaste schaal 0/10/20/30(+)
  const ticks: number[] = []; for (let v = 0; v <= maxKn; v += 10) ticks.push(v);
  const xi = (i: number) => x0 + (i / (n - 1)) * plotW;
  const yv = (v: number) => yBot - (v / maxKn) * plotH;
  const speedD = points.map((p, i) => `${xi(i)} ${yv(p.speed_kn)}`).join(" L");
  const gustD = points.map((p, i) => `${xi(i)} ${yv(p.gust_kn)}`).join(" L");
  const now = Math.round(points[0].speed_kn);
  const labelIdx = [0, 3, 6, 9, 12].filter((i) => i < n);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${Hgt}`} preserveAspectRatio="xMidYMid meet" style={{ display: "block" }}>
      <defs><linearGradient id="wg2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={COLORS.wind} stopOpacity=".28" /><stop offset="1" stopColor={COLORS.wind} stopOpacity="0" /></linearGradient></defs>
      {/* legend */}
      <line x1={x0} y1={12} x2={x0 + 18} y2={12} stroke={COLORS.wind} strokeWidth={2.5} />
      <text x={x0 + 23} y={15.5} fontSize={11} fill="rgba(233,233,237,.6)">wind</text>
      <line x1={x0 + 74} y1={12} x2={x0 + 92} y2={12} stroke={COLORS.wind} strokeWidth={2} strokeDasharray="5 4" />
      <text x={x0 + 97} y={15.5} fontSize={11} fill="rgba(233,233,237,.6)">vlagen</text>
      {/* y-as: gridlijnen + knopenlabels */}
      {ticks.map((v) => (
        <g key={`y${v}`}>
          <line x1={x0} y1={yv(v)} x2={x1} y2={yv(v)} stroke="rgba(233,233,237,.08)" />
          <text x={x0 - 6} y={yv(v) + 3.5} textAnchor="end" fontSize={10} fill="rgba(233,233,237,.3)" style={{ fontVariantNumeric: "tabular-nums" }}>{v}</text>
        </g>
      ))}
      <text x={x0 - 6} y={yTop - 6} textAnchor="end" fontSize={9} fill="rgba(233,233,237,.35)">kn</text>
      {/* vulling + lijnen */}
      <path d={`M${speedD} L${x1} ${yBot} L${x0} ${yBot} Z`} fill="url(#wg2)" />
      <path d={`M${speedD}`} fill="none" stroke={COLORS.wind} strokeWidth={2.5} strokeLinejoin="round" />
      <path d={`M${gustD}`} fill="none" stroke={COLORS.wind} strokeWidth={2} strokeDasharray="5 4" />
      {/* nu-dot met huidig getal */}
      <circle cx={xi(0)} cy={yv(points[0].speed_kn)} r={4.5} fill={COLORS.wind} stroke="#161826" strokeWidth={2} />
      <text x={xi(0) + 9} y={yv(points[0].speed_kn) - 7} fontSize={13} fontWeight={600} fill={COLORS.wind} style={{ fontVariantNumeric: "tabular-nums" }}>{now}</text>
      {/* x-as tijdlabels */}
      {labelIdx.map((i) => (
        <text key={`x${i}`} x={xi(i)} y={Hgt - 6} textAnchor="middle" fontSize={10} fill="rgba(233,233,237,.4)" style={{ fontVariantNumeric: "tabular-nums" }}>{i === 0 ? "Nu" : localHM(tms(points[i].time))}</text>
      ))}
    </svg>
  );
}

// Zeilrating uit de dag-winddata (max wind uit het bereik + vlaag), volgorde bepaalt
// de grens: eerst zwaar (Let op), dan fris, dan licht, anders goed.
function rateDay(speedMax: number | null, gust: number | null): { ratingLabel: string; tagClass: string } {
  if (speedMax == null) return { ratingLabel: "—", tagClass: "tag tag-neutral" };
  const w = speedMax, g = gust ?? 0;
  if (w > 25 || g > 35) return { ratingLabel: "Let op", tagClass: "tag tag-danger" };
  if (w >= 16 || g >= 25) return { ratingLabel: "Fris", tagClass: "tag tag-outline" };
  if (w < 6) return { ratingLabel: "Licht", tagClass: "tag tag-neutral" };
  return { ratingLabel: "Goed", tagClass: "tag tag-good" };
}

function WeekTable({ week, tide }: { week: WeekResponse | null; tide: TideData | { tide: null } | null }) {
  const isMobile = useIsMobile();
  if (!week) return <Loading label="7-daagse laden…" />;
  const hwByDay = new Map<string, TideExtreme>();
  const lwByDay = new Map<string, TideExtreme>();
  if (isTide(tide)) {
    for (const e of tide.extremes) {
      const d = localDateISO(tms(e.t));
      if (e.kind === "HW" && !hwByDay.has(d)) hwByDay.set(d, e);
      if (e.kind === "LW" && !lwByDay.has(d)) lwByDay.set(d, e);
    }
  }
  const wd = (date: string) => new Intl.DateTimeFormat("nl-NL", { weekday: "short", day: "numeric", timeZone: "Europe/Amsterdam" }).format(new Date(date + "T12:00:00Z"));

  // Mobiel (≤640px): de 7-koloms tabel past niet op 375px, dus per dag een kaart.
  // Zelfde data als de desktop-tabel; Golf valt weg (heeft geen databron). Elke
  // metric is zelf-gelabeld (vlaag/pijl/H·L), dus geen scheidingstekens nodig.
  if (isMobile) return (
    <div>
      {week.days.map((d) => {
        const { ratingLabel, tagClass } = rateDay(d.speedMax, d.gust);
        const hw = hwByDay.get(d.date), lw = lwByDay.get(d.date);
        const windRange = d.windMin != null && d.speedMax != null
          ? `${Math.round(d.windMin)}–${Math.round(d.speedMax)}`
          : d.speedMax != null ? `${Math.round(d.speedMax)}` : "—";
        return (
          <div key={d.date} style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 12, padding: "10px 14px", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: "#e9e9ed" }}>{wd(d.date)}</span>
              <span className={tagClass}>{ratingLabel}</span>
            </div>
            {/* metrics in vaste kolommen zodat wind/vlaag/richting over alle
                kaarten uitlijnen; getij vast op een eigen regel eronder → elke
                kaart identiek van opmaak (geen inconsistente wrap). */}
            <div style={{ display: "grid", gridTemplateColumns: "76px 76px 1fr", alignItems: "center", gap: 8, marginTop: 7, fontSize: 12.5, color: "rgba(233,233,237,.6)", fontVariantNumeric: "tabular-nums" }}>
              <span><span style={{ color: COLORS.wind, fontWeight: 600 }}>{windRange}</span> kn</span>
              <span>vlaag <span style={{ color: COLORS.wind }}>{d.gust != null ? Math.round(d.gust) : "—"}</span></span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                {d.dir != null && <svg width={13} height={13} viewBox="0 0 20 20" style={{ transform: `rotate(${d.dir}deg)` }}><path d="M10 3 L14 16 L10 13 L6 16 Z" fill={COLORS.wind} /></svg>}
                {d.dir != null ? compass(d.dir) : "—"}
              </span>
            </div>
            <div style={{ marginTop: 4, fontSize: 12.5, color: "rgba(233,233,237,.5)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
              {hw ? <><span style={{ color: COLORS.water }}>H</span>{localHM(tms(hw.t))}</> : "—"}
              {lw && <> <span style={{ color: "rgba(233,233,237,.35)" }}>L</span>{localHM(tms(lw.t))}</>}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <table className="table" style={{ fontSize: 13 }}>
      <thead><tr><th>Dag</th><th>Wind</th><th>Vlaag</th><th>Richt.</th><th>Golf</th><th>Getij</th><th /></tr></thead>
      <tbody>
        {week.days.map((d) => {
          // rating uit de winddata van deze rij: max wind uit het bereik + de vlaag
          const { ratingLabel, tagClass } = rateDay(d.speedMax, d.gust);
          const hw = hwByDay.get(d.date), lw = lwByDay.get(d.date);
          return (
            <tr key={d.date}>
              <td style={{ fontWeight: 600, color: "#e9e9ed" }}>{wd(d.date)}</td>
              <td className="kpi">{d.windMin != null && d.speedMax != null ? `${Math.round(d.windMin)}–${Math.round(d.speedMax)}` : d.speedMax != null ? Math.round(d.speedMax) : "—"}</td>
              <td className="kpi" style={{ color: COLORS.wind }}>{d.gust != null ? Math.round(d.gust) : "—"}</td>
              <td>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {d.dir != null && <svg width={14} height={14} viewBox="0 0 20 20" style={{ transform: `rotate(${d.dir}deg)` }}><path d="M10 3 L14 16 L10 13 L6 16 Z" fill={COLORS.wind} /></svg>}
                  <span className="kpi">{d.dir != null ? compass(d.dir) : "—"}</span>
                </span>
              </td>
              <td className="kpi" style={{ color: "rgba(233,233,237,.35)" }}>—</td>
              <td className="kpi" style={{ fontSize: 12, color: "rgba(233,233,237,.6)" }}>
                {hw ? <><span style={{ color: COLORS.water }}>H</span>{localHM(tms(hw.t))} </> : "—"}
                {lw && <><span style={{ color: "rgba(233,233,237,.35)" }}>L</span>{localHM(tms(lw.t))}</>}
              </td>
              <td><span className={tagClass}>{ratingLabel}</span></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}


// ════════════════════ TOCHT-PLANNER ════════════════════
// Volgorde (antwoord eerst): routekiezer → antwoordregel → vertrekalternatieven →
// scheidingslabel → detail voor het gekozen vertrek.
type RouteMeta = {
  hasRoute: boolean; legCount: number; pathNamen: string[]; viaHavens: string[];
  viaPassage: string | null; stroomComplete: boolean; stroomPartial: boolean;
  legsZonderStroom: string[]; legTimelines: { label: string; cur: RouteCurrent | null; distNm: number }[];
  windSeries: WindTLSample[]; windStations: string[];
};

// Combineert de per-leg stroomreeksen tot ÉÉN gewogen-gemiddelde tijdlijn langs de
// hele tocht. Weging = beenlengte (nm): een langer been telt zwaarder mee. Per tijdstip
// middelen we alleen de legs met echte data (>0 gewicht); een tijdstip zonder enkel
// been met data blijft een gat (alongKn null). Bij 1 been = die reeks ongewijzigd.
function combineLegTimelines(
  legs: { cur: RouteCurrent | null; distNm: number }[],
): { series: { t: string; alongKn: number | null }[]; modelUnvalidated: boolean } {
  const withData = legs.filter((l) => l.cur && l.cur.series.length);
  if (!withData.length) return { series: [], modelUnvalidated: false };
  const modelUnvalidated = withData.some((l) => l.cur!.modelUnvalidated);

  // per been een tijd→waarde-map; de tijdstippen zijn het hetzelfde forecast-grid
  const maps = withData.map((l) => ({
    w: l.distNm > 0 ? l.distNm : 1,
    m: new Map(l.cur!.series.map((s) => [s.t, s.alongKn])),
  }));
  // vereniging van alle tijdstippen, chronologisch
  const times = Array.from(new Set(withData.flatMap((l) => l.cur!.series.map((s) => s.t)))).sort();

  const series = times.map((t) => {
    let sum = 0, wsum = 0;
    for (const { w, m } of maps) {
      const v = m.get(t);
      if (v == null) continue;
      sum += v * w; wsum += w;
    }
    return { t, alongKn: wsum > 0 ? sum / wsum : null };
  });
  return { series, modelUnvalidated };
}

// Stroom-dekkingsvenster [first,last] uit de gecombineerde leg-tijdlijnen: het
// bereik waar er échte stroomdata is (alongKn != null). Buiten dit venster toont
// de tijdlijn-strip '—' i.p.v. een verzonnen 0. Gedeeld door Tocht + Vaarplan.
function stroomSpanOf(legTimelines: { cur: RouteCurrent | null; distNm: number }[]): { first: number; last: number } | null {
  const ms = combineLegTimelines(legTimelines).series.filter((p) => p.alongKn != null).map((p) => tms(p.t));
  return ms.length ? { first: Math.min(...ms), last: Math.max(...ms) } : null;
}

function DepartureView({
  routeBearing, routeDistNm, route, selTrip, depMs, setDepMs, hwMs,
  depOptions, bestOption, depDay, setDepDay, depRange, setDepRange, dayNames, ready,
  routes, fromHaven, toHaven, chooseFrom, chooseTo, allHavens,
  fromStation, toStation, runSim, nowMs, viaHavens,
}: {
  routeBearing: number | null; routeDistNm: number | null; route: RouteMeta;
  selTrip: SimResult | null; depMs: number | null; setDepMs: (ms: number) => void; hwMs: number[];
  depOptions: DepOption[]; bestOption: DepOption | null; depDay: 0 | 1 | 2; setDepDay: (d: 0 | 1 | 2) => void;
  depRange: 12 | 24; setDepRange: (r: 12 | 24) => void; dayNames: string[]; ready: boolean;
  routes: RouteInfo[]; fromHaven: string; toHaven: string;
  chooseFrom: (h: string) => void; chooseTo: (h: string) => void;
  allHavens: string[]; fromStation: RouteHaven | null; toStation: RouteHaven | null;
  runSim: (dep: number) => SimResult | null; nowMs: number; viaHavens: ViaHaven[];
}) {
  const isMobile = useIsMobile();
  const naamOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of routes) { m.set(r.van.haven, r.van.naam); m.set(r.naar.haven, r.naar.naam); }
    return (h: string) => m.get(h) ?? h;
  }, [routes]);
  // Alle havens zijn kiesbaar; elke dropdown laat alleen de haven weg die in het andere
  // veld staat (Van ≠ Naar). allHavens is al op naam gesorteerd.
  const vanOptions = useMemo(() => allHavens.filter((h) => h !== toHaven), [allHavens, toHaven]);
  const naarOptions = useMemo(() => allHavens.filter((h) => h !== fromHaven), [allHavens, fromHaven]);

  // ── mobiele Tocht-tak (≤640px): eigen route-pill + 48u-sweep + vensters + strip.
  // Desktop-tak hieronder blijft ongewijzigd. Deelt route-/vertrek-state en runSim.
  if (isMobile) return (
    <DepartureMobile
      route={route} routeDistNm={routeDistNm} ready={ready}
      selTrip={selTrip} depMs={depMs} setDepMs={setDepMs} runSim={runSim} nowMs={nowMs}
      fromHaven={fromHaven} toHaven={toHaven} chooseFrom={chooseFrom} chooseTo={chooseTo}
      naamOf={naamOf} vanOptions={vanOptions} naarOptions={naarOptions}
      fromStation={fromStation} toStation={toStation} viaHavens={viaHavens} />
  );

  const w0 = selTrip?.steps[0];
  const twa0 = w0?.twa ?? 0;
  const sailLabel = twa0 < 50 ? "Aan de wind" : twa0 < 80 ? "Halve wind" : twa0 < 120 ? "Ruime wind" : twa0 < 160 ? "Bakstag" : "Voor de wind";
  const c0 = w0?.cur ?? 0;
  const selWarn = selTrip ? windAgainstCurrent(selTrip.steps, routeBearing ?? 0) : false;
  const anyStroom = route.stroomComplete || route.stroomPartial;
  const anyModelUnvalidated = route.legTimelines.some((s) => s.cur?.modelUnvalidated);

  // antwoordregel uit het beste vertrek
  const b = bestOption?.result;
  let answer: string | null = null;
  if (b && b.arrMs && !anyStroom) {
    // geen enkel been met stroomdata → geen mee/tegen of stroomeffect claimen
    answer = `Best vertrek: ${localHM(bestOption!.depMs)} · aankomst ${localHM(b.arrMs)} · zonder stroomdata`;
  } else if (b && b.arrMs) {
    const startMee = (b.steps[0]?.cur ?? 0) >= 0;
    const kent = b.kentMs && b.kentMs > b.departMs && b.kentMs < b.arrMs
      ? `${startMee ? "meestroom" : "tegenstroom"} tot kentering ${localHM(b.kentMs)}`
      : startMee ? "stroom mee" : "stroom tegen";
    const eff = `${b.effectMin <= 0 ? "−" : "+"}${Math.abs(b.effectMin)} min`;
    const caveat = route.stroomPartial ? " · deels zonder stroom" : "";
    answer = `Best vertrek: ${localHM(bestOption!.depMs)} · ${kent} · aankomst ${localHM(b.arrMs)} · ${eff}${caveat}`;
  }

  // redenregel: waarom dit vertrekuur gunstig is — combineert stroom + wind uit de
  // sim-stappen van het BESTE vertrek (geen sim-wijziging, alleen afgeleide tekst).
  let reason: string | null = null;
  if (b && b.arrMs && b.steps.length) {
    const s0 = b.steps[0];
    const body = b.steps.length > 1 ? b.steps.slice(0, -1) : b.steps;
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

    // stroom-component (alleen als de route stroomdata heeft)
    let stroomStr = "";
    if (anyStroom) {
      const startMee = (s0.cur ?? 0) >= 0;
      const kent = b.kentMs && b.kentMs > b.departMs && b.kentMs < b.arrMs;
      if (kent) {
        const hrs = Math.max(1, Math.round((b.kentMs! - b.departMs) / 3600000));
        stroomStr = startMee
          ? `meestroom eerste ${hrs} uur, kentering om ${localHM(b.kentMs!)}`
          : `tegenstroom tot kentering ${localHM(b.kentMs!)}`;
      } else {
        stroomStr = startMee ? "stroom mee vrijwel de hele tocht" : "stroom overwegend tegen";
      }
    }

    // wind-component: richting + kracht + zeilhoek bij vertrek, plus opbouw/draaiing
    let windStr = `${dirLabel16(s0.wDir)} ${Math.round(s0.wSpd)} kn ${sailPhrase(s0.twa)}`;
    const maxSpd = Math.max(...body.map((s) => s.wSpd));
    if (maxSpd - s0.wSpd >= 4) windStr += `, bouwt op naar ${Math.round(maxSpd)} kn`;
    const sEnd = body[body.length - 1];
    const veer = sEnd ? Math.abs(((sEnd.wDir - s0.wDir + 540) % 360) - 180) : 0;
    if (sEnd && veer >= 40) windStr += `, draait naar ${dirLabel16(sEnd.wDir)}`;

    const tail = anyStroom ? "snelste combinatie van stroom en zeilhoek" : "gunstigste zeilhoek van de dag";
    reason = (stroomStr ? `${cap(stroomStr)}. ${windStr}` : cap(windStr)) + ` — ${tail}.`;
  }

  return (
    <div style={{ padding: "24px var(--view-pad-x) 34px" }}>
      {/* 1. routekiezer header */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: COLORS.weer }}>
            {route.legCount > 1
              ? `${route.pathNamen.join(" → ")} · ${route.legCount} legs`
              : route.legCount === 1
                ? `Havenroute${route.viaPassage ? ` · via ${route.viaPassage}` : ""}`
                : "Rechte lijn · geen routedata"}
          </div>
          <div className="haven-row" style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "flex-start" }}>
            <HavenSelector label="Van" value={fromHaven} options={vanOptions} naamOf={naamOf} onSelect={chooseFrom}
              havenInfo={fromStation?.havenInfo ?? null} stationKey={fromStation?.key ?? null} bootDiepgang={DEFAULT_BOAT.draftM} />
            <span style={{ fontSize: 18, color: "rgba(233,233,237,.4)", marginTop: 22 }}>→</span>
            <HavenSelector label="Naar" value={toHaven} options={naarOptions} naamOf={naamOf} onSelect={chooseTo}
              havenInfo={toStation?.havenInfo ?? null} stationKey={toStation?.key ?? null} bootDiepgang={DEFAULT_BOAT.draftM} />
          </div>
          <div style={{ display: "flex", gap: 24, marginTop: 12, alignItems: "baseline" }}>
            <div><span className="kpi" style={{ fontSize: 24, fontWeight: 600 }}>{routeDistNm != null ? routeDistNm.toFixed(1).replace(".", ",") : "—"}</span> <span style={{ fontSize: 13, color: "rgba(233,233,237,.5)" }}>nm</span></div>
            <div><span className="kpi" style={{ fontSize: 24, fontWeight: 600 }}>{routeBearing != null ? String(Math.round(routeBearing)).padStart(3, "0") : "—"}°</span> <span style={{ fontSize: 13, color: "rgba(233,233,237,.5)" }}>koers</span></div>
            <div style={{ fontSize: 11, color: route.stroomComplete ? alpha(COLORS.stroom, 0.8) : route.stroomPartial ? alpha(COLORS.kentering, 0.9) : "rgba(233,233,237,.4)" }}>
              {route.stroomComplete ? "● stroom-forecast beschikbaar"
                : route.stroomPartial ? `◐ stroom deels beschikbaar — geen data: ${route.legsZonderStroom.join(", ")}`
                : "○ Geen stroomdata voor deze route"}
            </div>
          </div>
        </div>
      </div>

      {!ready ? <Loading label="route + wind laden…" /> : (
        <>
          {/* 2. antwoordregel — het antwoord vooraan, zeegroen; redenregel eronder */}
          {answer && (
            <div style={{ marginBottom: 16, padding: "12px 16px", borderRadius: 10, background: alpha(COLORS.stroom, 0.1), border: `1px solid ${alpha(COLORS.stroom, 0.3)}`, color: COLORS.stroom, fontVariantNumeric: "tabular-nums" }}>
              <div style={{ fontSize: 15, fontWeight: 500 }}>{answer}</div>
              {reason && <div style={{ fontSize: 12.5, fontWeight: 400, marginTop: 5, color: alpha(COLORS.stroom, 0.82) }}>{reason}</div>}
            </div>
          )}

          {/* 3. vertrekalternatieven — direct zichtbaar */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(233,233,237,.85)" }}>Vertrekalternatieven</div>
              <div className="seg">
                {([0, 1, 2] as const).map((d) => (
                  <span key={d} className="seg-opt" aria-current={depDay === d ? "true" : undefined} onClick={() => setDepDay(d)}>{dayNames[d]}</span>
                ))}
              </div>
              <div className="seg">
                <span className="seg-opt" aria-current={depRange === 12 ? "true" : undefined} onClick={() => setDepRange(12)}>12 u</span>
                <span className="seg-opt" aria-current={depRange === 24 ? "true" : undefined} onClick={() => setDepRange(24)}>24 u</span>
              </div>
              <div style={{ flex: 1 }} />
              <div style={{ fontSize: 11, color: "rgba(233,233,237,.3)" }}>klik een kaart voor het detail</div>
            </div>
            <DepartureCards options={depOptions} selMs={depMs ?? -1} onSelect={setDepMs} courseDeg={routeBearing ?? 0} />
          </div>

          {/* 4 + 5. detail — verschijnt pas als een kaart is geselecteerd */}
          {selTrip && depMs != null && (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "26px 0 14px", paddingBottom: 8, borderBottom: "1px solid rgba(233,233,237,.08)" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(233,233,237,.85)" }}>Detail voor vertrek {localHM(depMs)}</div>
                <div style={{ fontSize: 11, color: "rgba(233,233,237,.3)" }}>klik een kaart hierboven voor een ander uur</div>
              </div>

              {/* tags */}
              <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
                <span className="tag tag-wind" style={{ fontSize: 11 }}>{sailLabel} · TWA {Math.round(twa0)}°</span>
                <span className="tag tag-wind" style={{ fontSize: 11 }}>Wind {w0 ? dirLabel16(w0.wDir) : "—"} {w0 ? Math.round(w0.wSpd) : "—"} kt</span>
                <span className="tag tag-wind" style={{ fontSize: 11 }}>STW {selTrip.avgStw.toFixed(1)} kn</span>
                <span className="tag tag-stroom" style={{ fontSize: 11 }}>{c0 > 0.2 ? `Stroom mee ${c0.toFixed(1)} kn` : c0 < -0.2 ? `Stroom tegen ${Math.abs(c0).toFixed(1)} kn` : "Kentering"}</span>
                {selWarn && (
                  <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 999, fontWeight: 600, color: "#E0794B", background: "rgba(224,121,75,.12)", border: "1px solid rgba(224,121,75,.4)" }}>⚠ Wind tegen stroom · verwacht korte steile golf</span>
                )}
              </div>

              {/* summary — drie kaarten */}
              <div style={{ marginBottom: 20 }}><SummaryRow trip={selTrip} /></div>

              {/* getijstroom — altijd één tijdlijn: gewogen gemiddelde over alle legs */}
              {route.hasRoute && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(233,233,237,.85)" }}>Getijstroom langs de route</div>
                    <div style={{ fontSize: 11, color: "rgba(233,233,237,.35)" }}>▲ mee · ▼ tegen · gestreept = de tocht{anyModelUnvalidated ? " · model (ongevalideerd)" : ""}</div>
                  </div>
                  {(() => {
                    // altijd ÉÉN tijdlijn: gewogen gemiddelde over alle legs (op beenlengte)
                    const { series } = combineLegTimelines(route.legTimelines);
                    return (
                      <div style={{ background: "rgba(15,17,25,.35)", borderRadius: 12, padding: "12px 16px 6px", boxShadow: "inset 0 0 0 1px rgba(233,233,237,.06)" }}>
                        {series.length
                          ? <CurrentTimeline series={series} depMs={selTrip.departMs} arrMs={selTrip.arrMs} hwMs={hwMs} />
                          : <div style={{ padding: 20, fontSize: 12, color: "rgba(233,233,237,.4)" }}>Geen stroomdata voor deze route — zonder stroom gerekend.</div>}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* wind langs de route — zelfde tijdas als de stroomtijdlijn */}
              {route.hasRoute && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(233,233,237,.85)" }}>Wind langs de route</div>
                    {route.windStations.length > 0 && (
                      <div style={{ fontSize: 11, color: "rgba(233,233,237,.35)" }}>{route.windStations.join(" · ")}</div>
                    )}
                  </div>
                  {(() => {
                    // dezelfde as-grenzen als de stroomtijdlijn (zelfde formule als in
                    // CurrentTimeline, op dezelfde stroomreeks) zodat de trip-windows exact
                    // uitlijnen. Zonder stroomreeks valt WindTimeline terug op eigen extent.
                    const stroom = combineLegTimelines(route.legTimelines).series;
                    const tMin = stroom.length ? Math.max(tms(stroom[0].t), selTrip.departMs - 4 * H) : undefined;
                    const tMax = stroom.length ? Math.min(tms(stroom[stroom.length - 1].t), selTrip.departMs + 22 * H) : undefined;
                    return (
                      <div style={{ background: "rgba(15,17,25,.35)", borderRadius: 12, padding: "12px 16px 6px", boxShadow: "inset 0 0 0 1px rgba(233,233,237,.06)" }}>
                        {route.windSeries.length
                          ? <WindTimeline series={route.windSeries} depMs={selTrip.departMs} arrMs={selTrip.arrMs} tMin={tMin} tMax={tMax} />
                          : <div style={{ padding: 20, fontSize: 12, color: "rgba(233,233,237,.4)" }}>Geen winddata voor deze route.</div>}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* trip chart */}
              <div style={{ position: "relative", overflow: "hidden", borderRadius: 14, padding: "18px 24px 12px", background: "linear-gradient(135deg,#191c2b 0%,#141626 100%)", boxShadow: `inset 0 0 0 1px ${alpha(COLORS.weer, 0.2)}` }}>
                <TripChart trip={selTrip} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ════════════════════ MOBIELE TOCHT-VIEW (≤640px) ════════════════════
// Eigen variant conform de iPhone-mocks: route-pill → 48u-sweep → antwoord → andere
// vensters → passage-strip ("antwoord eerst, bewijs eronder"). Deelt route-/vertrek-
// state en runSim met de desktop-tak; geen nieuwe fetches of fysica. De sweep draait
// runSim over een 48u-raster (elk half uur) en leest per kandidaat de bestaande
// voorbijHorizon-vlag uit tripsim.

// neutrale UI-grijs voor 'traag' in het sweep-kleurverloop (geen semantisch token;
// alleen het eindpunt van de groen→grijs-fade, conform de mock)
const SLATE = [120, 124, 140] as const;

// lokaal uur (Europe/Amsterdam) + dag-label voor de vensterlijst
const amsHour = (ms: number) =>
  +new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", hourCycle: "h23", timeZone: "Europe/Amsterdam" }).format(ms);
function mobileDayLabel(ms: number, nowMs: number): string {
  const d = localDateISO(ms);
  if (d === localDateISO(nowMs)) return "vandaag";
  if (d === localDateISO(nowMs + 24 * H)) return "morgen";
  if (d === localDateISO(nowMs + 48 * H)) return "overmorgen";
  return new Intl.DateTimeFormat("nl-NL", { weekday: "long", timeZone: "Europe/Amsterdam" }).format(ms);
}

function DepartureMobile({
  route, routeDistNm, ready, selTrip, depMs, setDepMs, runSim, nowMs,
  fromHaven, toHaven, chooseFrom, chooseTo, naamOf, vanOptions, naarOptions,
  fromStation, toStation, viaHavens,
}: {
  route: RouteMeta; routeDistNm: number | null; ready: boolean;
  selTrip: SimResult | null; depMs: number | null; setDepMs: (ms: number) => void;
  runSim: (dep: number) => SimResult | null; nowMs: number;
  fromHaven: string; toHaven: string; chooseFrom: (h: string) => void; chooseTo: (h: string) => void;
  naamOf: (h: string) => string; vanOptions: string[]; naarOptions: string[];
  fromStation: RouteHaven | null; toStation: RouteHaven | null; viaHavens: ViaHaven[];
}) {
  const HALF = 30 * 60_000;
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => { if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pickerOpen]);

  // 48u-sweep: elk half uur vanaf het eerstvolgende hele half uur, door dezelfde runSim.
  const sweep = useMemo<DepOption[]>(() => {
    if (!ready || !nowMs) return [];
    const start = Math.ceil(nowMs / HALF) * HALF;
    const out: DepOption[] = [];
    for (let i = 0; i < 96; i++) {
      const dep = start + i * HALF;
      const r = runSim(dep);
      if (r) out.push({ depMs: dep, result: r });
    }
    return out;
  }, [ready, nowMs, runSim]); // eslint-disable-line react-hooks/exhaustive-deps

  // globaal beste vertrek (kortste haalbare vaartijd) over de 48u
  const best = useMemo(() => {
    const reach = sweep.filter((o) => o.result.arrMs != null);
    return reach.length ? reach.reduce((b, o) => (o.result.tripMin < b.result.tripMin ? o : b)) : null;
  }, [sweep]);

  // default: het sweep-beste vertrek zolang de gebruiker zelf niets koos (depMs == null).
  // Een route-wissel zet depMs op null (chooseFrom/To) → schuift mee naar het nieuwe beste.
  useEffect(() => {
    if (depMs == null && best) setDepMs(best.depMs);
  }, [depMs, best]); // eslint-disable-line react-hooks/exhaustive-deps

  // andere vensters = lokale duur-minima (excl. de beste), ≥4u uit elkaar, kortste eerst
  const vensters = useMemo(() => {
    const locMin = sweep.filter((o, i, a) => {
      if (o.result.arrMs == null) return false;
      const L = a[i - 1], R = a[i + 1];
      const lok = !L || L.result.arrMs == null || o.result.tripMin <= L.result.tripMin;
      const rok = !R || R.result.arrMs == null || o.result.tripMin <= R.result.tripMin;
      return lok && rok;
    });
    const picked: DepOption[] = [];
    for (const o of [...locMin].sort((a, b) => a.result.tripMin - b.result.tripMin)) {
      if (best && o.depMs === best.depMs) continue;
      if (picked.some((p) => Math.abs(p.depMs - o.depMs) < 4 * H)) continue;
      picked.push(o);
      if (picked.length >= 4) break;
    }
    return picked.sort((a, b) => a.depMs - b.depMs);
  }, [sweep, best]);

  // kentering-momenten over 48u = nuldoorgangen van de gecombineerde stroom-langs-reeks
  const kentTicks = useMemo(() => {
    const s = combineLegTimelines(route.legTimelines).series
      .filter((p) => p.alongKn != null).map((p) => ({ m: tms(p.t), v: p.alongKn as number }));
    const out: number[] = [];
    for (let i = 1; i < s.length; i++) {
      if ((s[i - 1].v >= 0) !== (s[i].v >= 0)) {
        const a = Math.abs(s[i - 1].v), b = Math.abs(s[i].v);
        const f = a + b === 0 ? 0 : a / (a + b);
        out.push(s[i - 1].m + f * (s[i].m - s[i - 1].m));
      }
    }
    return out;
  }, [route.legTimelines]);

  // stroom-dekkingsvenster (voor de strip: buiten dit bereik → '—', nooit een verzonnen 0)
  const stroomSpan = useMemo(() => stroomSpanOf(route.legTimelines), [route.legTimelines]);

  const vanNaam = fromStation?.naam ?? naamOf(fromHaven);
  const naarNaam = toStation?.naam ?? naamOf(toHaven);
  const routeSub = route.legCount > 1 ? `${route.legCount} legs`
    : route.viaPassage ? `via ${route.viaPassage}` : "directe route";

  return (
    <div style={{ padding: "12px 16px 40px", position: "relative" }}>
      {/* 1. route-pill → overlay met de twee bestaande HavenSelectors */}
      <div ref={pickerRef} style={{ position: "relative" }}>
        <div onClick={() => setPickerOpen((o) => !o)} className="haven-trigger"
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)", cursor: "pointer" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#e9e9ed" }}>{vanNaam} → {naarNaam}</div>
            <div style={{ fontSize: 11, color: "rgba(233,233,237,.45)", marginTop: 2 }}>
              {routeSub}{routeDistNm != null ? ` · ${routeDistNm.toFixed(1).replace(".", ",")} NM` : ""}
            </div>
          </div>
          <span style={{ fontSize: 18, color: "rgba(233,233,237,.4)" }}>⌄</span>
        </div>
        {pickerOpen && (
          <div style={{ position: "absolute", left: 0, right: 0, top: "calc(100% + 6px)", zIndex: 30, background: "#1e2035", borderRadius: 14, boxShadow: "0 8px 32px rgba(0,0,0,.5), 0 0 0 1px rgba(233,233,237,.1)", padding: 14, display: "flex", flexDirection: "column", gap: 14 }}>
            <HavenSelector label="Van" value={fromHaven} options={vanOptions} naamOf={naamOf} onSelect={chooseFrom}
              havenInfo={fromStation?.havenInfo ?? null} stationKey={fromStation?.key ?? null} bootDiepgang={DEFAULT_BOAT.draftM} />
            <HavenSelector label="Naar" value={toHaven} options={naarOptions} naamOf={naamOf} onSelect={chooseTo}
              havenInfo={toStation?.havenInfo ?? null} stationKey={toStation?.key ?? null} bootDiepgang={DEFAULT_BOAT.draftM} />
          </div>
        )}
      </div>

      {!ready ? <Loading label="route + wind laden…" /> : (
        <>
          {/* 2. sweep */}
          <div style={{ marginTop: 14, padding: "14px 12px 8px", borderRadius: 16, background: "rgba(255,255,255,.025)", border: "1px solid rgba(255,255,255,.07)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0 4px 6px" }}>
              <span style={{ fontSize: 12, color: "rgba(233,233,237,.55)" }}>Vertrek — komende 48u</span>
              <span style={{ fontSize: 10, color: "rgba(233,233,237,.4)" }}>as: duur</span>
            </div>
            <MobileSweep sweep={sweep} selMs={depMs} onSelect={setDepMs} kentTicks={kentTicks} />
            <div style={{ display: "flex", gap: 12, padding: "6px 4px 0", fontSize: 10, color: "rgba(233,233,237,.45)" }}>
              <span><Dot c={COLORS.stroom} />gunstig</span>
              <span><Dot c={COLORS.kentering} />kentering</span>
              <span><Dot c="rgba(233,233,237,.25)" />onzeker</span>
            </div>
          </div>

          {/* 3. antwoord (beste vertrek) */}
          {best && <MobileAnswer best={best} />}

          {/* 4. andere vensters (lokale optima, beste uitgesloten) */}
          {vensters.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ margin: "0 0 8px", fontSize: 12, color: "rgba(233,233,237,.4)" }}>Andere vensters</div>
              {vensters.map((o) => (
                <VensterRow key={o.depMs} opt={o} best={best} nowMs={nowMs} selected={depMs === o.depMs} onSelect={() => setDepMs(o.depMs)} />
              ))}
            </div>
          )}

          {/* 5. passage-strip bij het gekozen vertrek */}
          {selTrip && depMs != null && (
            <PassageStrip trip={selTrip} depMs={depMs} routeDistNm={routeDistNm}
              fromStation={fromStation} toStation={toStation} viaHavens={viaHavens} stroomSpan={stroomSpan} />
          )}
        </>
      )}
    </div>
  );
}

function Dot({ c }: { c: string }) {
  return <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: c, verticalAlign: "middle", marginRight: 4 }} />;
}

// Verticale-balken-sweep: omgekeerde duur-as (hoog = snel), kwaliteitskleur groen→grijs,
// kentering-tikken, onzeker-hatch (voorbijHorizon), gekozen-marker, tik-select per kolom.
function MobileSweep({ sweep, selMs, onSelect, kentTicks }: {
  sweep: DepOption[]; selMs: number | null; onSelect: (ms: number) => void; kentTicks: number[];
}) {
  if (!sweep.length) return null;
  const W = 351, Hg = 132, X0 = 40, X1 = 340, Y0 = 16, YB = 100;
  const start = sweep[0].depMs, end = sweep[sweep.length - 1].depMs;
  const span = Math.max(1, end - start);
  const tx = (ms: number) => X0 + ((ms - start) / span) * (X1 - X0);
  const durs = sweep.filter((o) => o.result.arrMs != null).map((o) => o.result.tripMin);
  const dMin = durs.length ? Math.min(...durs) : 0, dMax = durs.length ? Math.max(...durs) : 1;
  const dSpan = Math.max(1e-6, dMax - dMin);
  const pitch = (X1 - X0) / sweep.length;
  const bw = Math.max(1.6, pitch * 0.62);
  const HMIN = 10, HMAX = 78, G = [23, 168, 120];
  const firstUnc = sweep.find((o) => o.result.voorbijHorizon);
  const hm = (min: number) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, "0")}`;
  return (
    <svg viewBox={`0 0 ${W} ${Hg}`} width="100%" style={{ display: "block" }}>
      <defs>
        <pattern id="mSweepHatch" width={6} height={6} patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <line x1={0} y1={0} x2={0} y2={6} stroke="rgba(233,233,237,.18)" strokeWidth={1} />
        </pattern>
      </defs>
      <line x1={X0} y1={YB} x2={X1} y2={YB} stroke="rgba(255,255,255,.1)" strokeWidth={1} />
      {durs.length > 0 && <text x={34} y={24} textAnchor="end" fontSize={9} fill="rgba(233,233,237,.4)">{hm(dMin)}</text>}
      {durs.length > 0 && <text x={34} y={YB} textAnchor="end" fontSize={9} fill="rgba(233,233,237,.4)">{hm(dMax)}</text>}
      <text x={6} y={64} fontSize={9} fill="rgba(233,233,237,.35)" transform="rotate(-90 6 64)">duur</text>
      {sweep.map((o) => {
        const reach = o.result.arrMs != null;
        const norm = reach ? (o.result.tripMin - dMin) / dSpan : 1;   // 0 = snelst
        const hpx = reach ? HMIN + (1 - norm) * (HMAX - HMIN) : 6;
        const c = G.map((v, i) => Math.round(v + (SLATE[i] - v) * norm));
        const op = o.result.voorbijHorizon ? 0.28 : 1 - norm * 0.55;
        return (
          <rect key={o.depMs} x={tx(o.depMs) - bw / 2} y={YB - hpx} width={bw} height={hpx}
            fill={`rgb(${c[0]},${c[1]},${c[2]})`} fillOpacity={op} rx={0.8} />
        );
      })}
      {firstUnc && (
        <>
          <rect x={tx(firstUnc.depMs)} y={Y0} width={X1 - tx(firstUnc.depMs)} height={YB - Y0} fill="url(#mSweepHatch)" />
          <text x={(tx(firstUnc.depMs) + X1) / 2} y={12} textAnchor="middle" fontSize={8} fill="rgba(233,233,237,.4)">onzeker</text>
        </>
      )}
      {selMs != null && selMs >= start && selMs <= end && (
        <>
          <line x1={tx(selMs)} y1={14} x2={tx(selMs)} y2={YB} stroke={alpha(COLORS.stroom, 0.6)} strokeWidth={1} strokeDasharray="3 3" />
          <polygon points={`${tx(selMs) - 4},14 ${tx(selMs) + 4},14 ${tx(selMs)},20`} fill={COLORS.stroom} />
          <text x={tx(selMs)} y={122} textAnchor="middle" fontSize={9} fontWeight={600} fill={COLORS.stroom}>{localHM(selMs)}</text>
        </>
      )}
      {kentTicks.filter((k) => k >= start && k <= end).map((k, i) => (
        <line key={`k${i}`} x1={tx(k)} y1={YB} x2={tx(k)} y2={YB + 6} stroke={COLORS.kentering} strokeWidth={1.5} strokeOpacity={0.7} />
      ))}
      <text x={tx(start)} y={115} textAnchor="start" fontSize={9} fill="rgba(233,233,237,.4)">nu</text>
      <text x={tx(start + 24 * H)} y={115} textAnchor="middle" fontSize={9} fill="rgba(233,233,237,.4)">+24u</text>
      <text x={tx(end)} y={115} textAnchor="end" fontSize={9} fill="rgba(233,233,237,.4)">+48u</text>
      {/* tik-select: onzichtbare kolommen die de as vullen (nearest-kolom bij tik) */}
      {sweep.map((o) => (
        <rect key={`h${o.depMs}`} x={tx(o.depMs) - pitch / 2} y={Y0} width={pitch} height={YB - Y0}
          fill="transparent" style={{ cursor: "pointer" }} onClick={() => onSelect(o.depMs)} />
      ))}
    </svg>
  );
}

function MobileAnswer({ best }: { best: DepOption }) {
  const r = best.result;
  const startMee = (r.steps[0]?.cur ?? 0) >= 0;
  const kent = r.kentMs && r.kentMs > r.departMs && (r.arrMs == null || r.kentMs < r.arrMs);
  const why = r.voorbijHorizon ? "Beste haalbare venster · stroomdata deels onzeker."
    : kent ? `Grootste deel ${startMee ? "mee" : "tegen"}-stroom · kentering rond ${localHM(r.kentMs!)}.`
    : startMee ? "Grootste deel mee-stroom." : "Overwegend tegenstroom — gunstigste zeilhoek.";
  return (
    <div style={{ marginTop: 14, padding: 16, borderRadius: 16, background: alpha(COLORS.stroom, 0.08), border: `1px solid ${alpha(COLORS.stroom, 0.3)}` }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".5px", color: alpha(COLORS.stroom, 0.85) }}>Beste vertrek</div>
      <div className="kpi" style={{ fontSize: 26, fontWeight: 700, marginTop: 4, color: COLORS.sog }}>{localHM(best.depMs)}</div>
      <div style={{ fontSize: 13, color: "rgba(233,233,237,.6)", marginTop: 6, lineHeight: 1.4 }}>{why}</div>
      <div style={{ fontSize: 13, color: "rgba(233,233,237,.8)", marginTop: 8, display: "flex", gap: 16, flexWrap: "wrap", fontVariantNumeric: "tabular-nums" }}>
        <span>ETA <b style={{ color: COLORS.sog }}>{r.arrMs ? localHM(r.arrMs) : "—"}</b></span>
        <span>Duur <b style={{ color: COLORS.sog }}>{r.arrMs ? fmtDur(r.tripMin) : "—"}</b></span>
        <span>Ø <b style={{ color: COLORS.sog }}>{r.arrMs ? `${r.avgSog.toFixed(1).replace(".", ",")} kn` : "—"}</b></span>
      </div>
    </div>
  );
}

function VensterRow({ opt, best, nowMs, selected, onSelect }: {
  opt: DepOption; best: DepOption | null; nowMs: number; selected: boolean; onSelect: () => void;
}) {
  const r = opt.result;
  const delta = best ? Math.round(r.tripMin - best.result.tripMin) : 0;
  const startMee = (r.steps[0]?.cur ?? 0) >= 0;
  const kent = r.kentMs && r.kentMs > r.departMs && (r.arrMs == null || r.kentMs < r.arrMs);
  const char = r.voorbijHorizon ? "stroom-data onzeker"
    : kent ? `${startMee ? "mee" : "tegen"}, kentering ${localHM(r.kentMs!)}`
    : startMee ? "mee-stroom" : "tegenstroom";
  const h = amsHour(opt.depMs);
  const dayTxt = `${mobileDayLabel(opt.depMs, nowMs)}${h >= 22 || h < 6 ? " · nacht" : ""}`;
  return (
    <div onClick={onSelect} className="haven-trigger" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 12, marginBottom: 6, cursor: "pointer", background: selected ? alpha(COLORS.stroom, 0.09) : "rgba(255,255,255,.03)", border: `1px solid ${selected ? alpha(COLORS.stroom, 0.35) : "rgba(255,255,255,.06)"}` }}>
      <div style={{ flex: "0 0 auto", minWidth: 74 }}>
        <div className="kpi" style={{ fontSize: 16, fontWeight: 700, color: COLORS.sog, lineHeight: 1 }}>{localHM(opt.depMs)}</div>
        <div style={{ fontSize: 11, color: "rgba(233,233,237,.45)", marginTop: 3 }}>{dayTxt}</div>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(233,233,237,.75)" }}>{r.arrMs ? fmtDur(r.tripMin) : "n.b."}</div>
        <div style={{ fontSize: 11, color: "rgba(233,233,237,.45)", marginTop: 2 }}>{char}</div>
      </div>
      {r.voorbijHorizon
        ? <span style={{ flex: "0 0 auto", fontSize: 11, fontWeight: 600, padding: "4px 9px", borderRadius: 20, color: COLORS.kentering, background: alpha(COLORS.kentering, 0.12) }}>onzeker</span>
        : <span style={{ flex: "0 0 auto", fontSize: 11, fontWeight: 600, padding: "4px 9px", borderRadius: 20, color: "rgba(233,233,237,.55)", background: "rgba(255,255,255,.05)" }}>{delta >= 0 ? "+" : ""}{delta} min</span>}
    </div>
  );
}

// Passage-strip: verticale rijen (geen h-scroll) uit het tripsim-verloop. Hergebruikt
// sampleHourly + positionName uit VaarplanView; kentering als gele scheiding; ontbrekende
// stroom (buiten het dekkingsvenster) → '—', nooit een verzonnen 0.
// Vaarplan zonder geselecteerd vertrek (bv. herladen op deze tab): leeg met hint.
function VaarplanEmpty() {
  return (
    <div style={{ padding: "20px var(--view-pad-x) 34px" }}>
      <div style={{ fontSize: 14, color: "rgba(233,233,237,.5)" }}>
        Geen vertrekmoment geselecteerd. Kies eerst een vertrek in de Tocht-planner.
      </div>
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div style={{ padding: 60, display: "flex", alignItems: "center", justifyContent: "center", gap: 12, color: "rgba(233,233,237,.4)", fontSize: 13 }}>
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={COLORS.weer} strokeWidth={2} style={{ animation: "spin 1s linear infinite" }}><path d="M21 12a9 9 0 1 1-6.2-8.5" strokeLinecap="round" /></svg>
      {label}
    </div>
  );
}
