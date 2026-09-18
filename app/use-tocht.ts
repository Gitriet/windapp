"use client";
// Data + logica van de app, los van de presentatie. useTocht = de tochtplanning (havens,
// keten, wind/stroom/getij, 48u-sweep, beste vertrek, gekozen vertrek); useNu = de
// live conditie op één locatie. Verplaatst uit app/page.tsx; gedrag ongewijzigd.
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_BOAT } from "@/lib/polar";
import { simulateTrip, type SimResult, type SimWind } from "@/lib/tripsim";
import {
  DEFAULT_ROUTE_ID, fetchForecast, fetchWeek, fetchTide, fetchHavenTide, fetchRouteCurrent, fetchRoutes,
  toWindSamples, type ForecastResponse, type WeekResponse, type RouteCurrent, type RouteInfo, type RouteHaven,
} from "@/lib/planner-data";
import { bearing, routeDistanceNm } from "@/lib/route";
import { shortestPath } from "@/lib/netwerk-path";
import {
  combineWindStations, kenteringTicks, pickBest, type DepOption, type GustSample, type RouteMeta,
} from "@/lib/tocht";
import type { Location, TideData } from "@/lib/types";
import type { ViaHaven } from "./components/VaarplanView";

const H = 3_600_000;
const tms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));
export const isTide = (t: TideData | { tide: null } | null): t is TideData => !!t && "extremes" in t;

export function useTocht() {
  const [routes, setRoutes] = useState<RouteInfo[]>([]);
  const [fromHaven, setFromHaven] = useState<string>("");
  const [toHaven, setToHaven] = useState<string>("");
  const [depMs, setDepMs] = useState<number | null>(null);
  // per been een stroomreeks; wind per distinct station; getij bij vertrek- en aankomsthaven
  const [routeWind, setRouteWind] = useState<SimWind | null>(null);
  const [routeFc, setRouteFc] = useState<Record<string, ForecastResponse>>({});   // per station: vlagen + weer
  const [legCurrents, setLegCurrents] = useState<(RouteCurrent | null)[]>([]);
  const [routeTide, setRouteTide] = useState<TideData | null>(null);      // vertrekhaven
  const [routeTideTo, setRouteTideTo] = useState<TideData | null>(null);  // aankomsthaven
  const [nowMs, setNowMs] = useState<number>(0);
  const [err, setErr] = useState<string | null>(null);

  // ── mount: klok + havenroutes ──
  useEffect(() => {
    setNowMs(Date.now());
    let ignore = false;
    fetchRoutes().then((rts) => {
      if (ignore) return;
      setRoutes(rts);
      const def = rts.find((r) => r.id === DEFAULT_ROUTE_ID) ?? rts[0];
      if (def) { setFromHaven(def.van.haven); setToHaven(def.naar.haven); }
    }).catch((e) => { if (!ignore) setErr(String(e)); });
    return () => { ignore = true; };
  }, []);

  // Alle bekende havens (met coördinaten + dichtstbijzijnd station) uit de route-uiteinden.
  const havenMap = useMemo(() => {
    const m = new Map<string, RouteHaven>();
    for (const r of routes) { m.set(r.van.haven, r.van); m.set(r.naar.haven, r.naar); }
    return m;
  }, [routes]);
  const allHavens = useMemo(
    () => [...havenMap.values()].sort((a, b) => a.naam.localeCompare(b.naam, "nl")).map((h) => h.haven),
    [havenMap],
  );
  const naamOf = useMemo(() => (h: string) => havenMap.get(h)?.naam ?? h, [havenMap]);
  // elke kiezer laat alleen de haven weg die in het andere veld staat (Van ≠ Naar)
  const vanOptions = useMemo(() => allHavens.filter((h) => h !== toHaven), [allHavens, toHaven]);
  const naarOptions = useMemo(() => allHavens.filter((h) => h !== fromHaven), [allHavens, fromHaven]);

  // Kortste pad door het netwerk (Dijkstra op lengte_nm); null = geen pad.
  const chain = useMemo(() => shortestPath(routes, fromHaven, toHaven), [routes, fromHaven, toHaven]);
  // uiteinden in vaarrichting; zonder pad de losse havens (rechte-lijn-fallback)
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
  const routeBearing = waypoints.length >= 2 ? bearing(waypoints[0], waypoints[waypoints.length - 1]) : null;
  const routeDistNm = chain ? chain.totalNm
    : endpoints ? routeDistanceNm([endpoints.van, endpoints.naar]) : null;
  const stroomFlags = chain?.legs.map((l) => l.route.stroom) ?? [];
  const stroomComplete = stroomFlags.length > 0 && stroomFlags.every(Boolean);
  const stroomPartial = stroomFlags.some(Boolean) && !stroomComplete;
  const legsZonderStroom = chain?.legs.filter((l) => !l.route.stroom).map((l) => l.label) ?? [];

  // Van en Naar zijn vrij kiesbaar; bij een botsing draait de keuze de tocht om.
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

  // ── tochtdata bij tochtwissel ── wind per distinct station, stroom per been (teken
  // al gecorrigeerd in fetchRouteCurrent), getij bij beide havens via het eigen station.
  useEffect(() => {
    if (waypoints.length < 2) { setRouteWind(null); setLegCurrents([]); setRouteTideTo(null); return; }
    const keys = [...new Set(waypoints.map((w) => w.location_key))];
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
        const fcs: Record<string, ForecastResponse> = {};
        keys.forEach((k, i) => { wind[k] = toWindSamples(winds[i].points); fcs[k] = winds[i]; });
        setRouteWind(wind);
        setRouteFc(fcs);
        setLegCurrents(curs);
        setRouteTide(isTide(tide) ? tide : null);
        setRouteTideTo(isTide(tideTo) ? tideTo : null);
      } catch (e) {
        if (!ignore) setErr(String(e));
      }
    })();
    return () => { ignore = true; };
  }, [chain, waypoints]); // eslint-disable-line react-hooks/exhaustive-deps

  // 48u-vertrek-as: elk half uur vanaf het eerstvolgende hele half uur na nu (96 kandidaten).
  const candidates = useMemo(() => {
    if (!nowMs) return [];
    const half = H / 2;
    const start = Math.ceil(nowMs / half) * half;
    return Array.from({ length: 96 }, (_, i) => start + i * half);
  }, [nowMs]);

  const alongPerLeg = useMemo(
    () => (chain ? chain.legs.map((_, i) => legCurrents[i]?.series ?? []) : []),
    [chain, legCurrents],
  );
  // echte beenlengte per leg (langs de geul) zodat de gevaren afstand klopt met de getoonde
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
  const bestOption = useMemo(() => pickBest(depOptions), [depOptions]);

  // Zolang de gebruiker niets koos (depMs == null) volgt de selectie het beste vertrek.
  useEffect(() => {
    if (depMs == null && bestOption) setDepMs(bestOption.depMs);
  }, [depMs, bestOption]);

  const selTrip = useMemo(() => (depMs != null ? runSim(depMs) : null), [depMs, runSim]);

  const hwMs = useMemo(
    () => (routeTide?.extremes ?? []).filter((e) => e.kind === "HW").map((e) => tms(e.t)),
    [routeTide],
  );

  // tussenliggende havens (uitwijk) + cumulatieve nm-vanaf-vertrek, voor het vaarplan.
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

  const windSeries = useMemo(() => combineWindStations(routeWind), [routeWind]);
  const windStations = useMemo(() => {
    const hs = chain ? chain.havens : endpoints ? [endpoints.van, endpoints.naar] : [];
    return Array.from(new Set(hs.map((h) => h.stationNaam)));
  }, [chain, endpoints]);

  const routeMeta: RouteMeta = {
    hasRoute: !!chain,
    legCount: chain?.legs.length ?? 0,
    pathNamen: chain?.namen ?? [],
    viaHavens: chain?.viaNamen ?? [],
    viaPassage: chain && chain.legs.length === 1 ? (chain.legs[0].route.via ?? null) : null,
    stroomComplete, stroomPartial, legsZonderStroom,
    legTimelines: (chain?.legs ?? []).map((l, i) => ({ label: l.label, cur: legCurrents[i] ?? null, distNm: l.route.lengte_nm })),
    windSeries, windStations,
  };

  // vlagen van alle stations langs de route (voor de harde-wind-check) + weer bij vertrek
  const routeGusts = useMemo<GustSample[]>(
    () => Object.values(routeFc).flatMap((f) => f.points.map((p) => ({ ms: tms(p.time), gustKn: p.gust_kn }))),
    [routeFc],
  );
  const vanWeather = endpoints ? routeFc[endpoints.van.key]?.weather ?? null : null;

  const kentTicks = useMemo(() => kenteringTicks(routeMeta.legTimelines), [legCurrents, chain]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    routes, fromHaven, toHaven, chooseFrom, chooseTo, allHavens, naamOf, vanOptions, naarOptions,
    endpoints, routeBearing, routeDistNm, routeMeta, viaHavens,
    depMs, setDepMs, depOptions, bestOption, selTrip, kentTicks, firstDepMs: candidates[0] ?? null,
    routeGusts, vanWeather,
    routeTide, routeTideTo, hwMs, ready: !!routeWind, nowMs, err,
  };
}

export function useNu() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [locIdx, setLocIdx] = useState(0);
  const [fc, setFc] = useState<ForecastResponse | null>(null);
  const [week, setWeek] = useState<WeekResponse | null>(null);
  const [tide, setTide] = useState<TideData | { tide: null } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // ── mount: locatielijst; standaard Texel ──
  useEffect(() => {
    let ignore = false;
    (fetch("/api/locations", { cache: "no-store" }).then((r) => r.json()) as Promise<Location[]>)
      .then((locs) => {
        if (ignore) return;
        setLocations(locs);
        const ti = locs.findIndex((l) => l.location_key === "texel");
        if (ti >= 0) setLocIdx(ti);
      })
      .catch((e) => { if (!ignore) setErr(String(e)); });
    return () => { ignore = true; };
  }, []);

  // ── data bij locatiewissel ──
  const locKey = locations[locIdx]?.location_key;
  useEffect(() => {
    if (!locKey) return;
    let ignore = false;
    (async () => {
      try {
        const [f, w, t] = await Promise.all([fetchForecast(locKey), fetchWeek(locKey), fetchTide(locKey)]);
        if (ignore) return;
        setFc(f); setWeek(w); setTide(t);
      } catch (e) { if (!ignore) setErr(String(e)); }
    })();
    return () => { ignore = true; };
  }, [locKey]);

  return { locations, locIdx, setLocIdx, loc: locations[locIdx], fc, week, tide, err };
}
