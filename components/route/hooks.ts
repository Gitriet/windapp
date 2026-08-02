"use client";
import { useEffect, useState } from "react";
import type { CorrectedPoint, Location, TideData, WeatherSeries } from "@/lib/types";
import type { PassageWind, PassageCurrent } from "@/lib/passage";

export type Forecast = { location: Location; points: CorrectedPoint[]; weather: WeatherSeries };
export type StroomSeriesPoint = { t: string; alongKn: number | null; magKn: number | null };
export type RouteStroom = {
  available: boolean; reason?: string; box?: string; bearing?: number; analysis_time?: string | null;
  series?: StroomSeriesPoint[];
  arrows?: { lat: number; lon: number; u: number; v: number }[];
  vectors?: {
    points: { f: number; lat: number; lon: number }[];
    times: string[]; u: (number | null)[][]; v: (number | null)[][];
  };
  route?: [number, number][]; mid?: { lat: number; lon: number };
};

function useJson<T>(url: string | null): { data: T | null; err: string } {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!url) { setData(null); return; }
    let live = true;
    setErr("");
    fetch(url, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (!live) return; if (d && d.error) setErr(String(d.error)); else setData(d); })
      .catch((e) => { if (live) setErr(String(e)); });
    return () => { live = false; };
  }, [url]);
  return { data, err };
}

export function useForecast(key: string | null) {
  return useJson<Forecast>(key ? `/api/forecast/${key}` : null);
}

export function useTide(key: string | null) {
  const { data } = useJson<TideData>(key ? `/api/tide/${key}` : null);
  // /api/tide levert {tide:null} of {unavailable} voor niet-Wad-punten
  return data && (data as unknown as { tide?: null }).tide === null ? null : data;
}

// Forecasts voor meerdere waypoints tegelijk (vensters). Herlaadt bij key-wijziging.
export function useForecasts(keys: string[]) {
  const [map, setMap] = useState<Record<string, Forecast>>({});
  const sig = keys.join(",");
  useEffect(() => {
    let live = true;
    Promise.all(keys.map((k) =>
      fetch(`/api/forecast/${k}`, { cache: "no-store" }).then((r) => r.json()).then((d) => [k, d] as const).catch(() => [k, null] as const),
    )).then((pairs) => {
      if (!live) return;
      const out: Record<string, Forecast> = {};
      for (const [k, d] of pairs) if (d && !d.error && d.points) out[k] = d;
      setMap(out);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return map;
}

// Invoer voor de ETA-integratie: windreeksen per waypoint + stroomVECTOREN langs de
// route. Eén keer ophalen; daarna kunnen schermen synchroon zoveel vertrektijden
// doorrekenen als ze willen (computePassage is puur en snel).
export function usePassageData(keys: string[], fromISO: string | null, toISO: string | null) {
  const forecasts = useForecasts(keys);
  const url = keys.length >= 2 && fromISO && toISO
    ? `/api/route-stroom?keys=${keys.join(",")}&from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}&vectors=9`
    : null;
  const stroom = useJson<RouteStroom>(url).data;

  const ready = keys.length >= 2 && keys.every((k) => forecasts[k]) && (url === null || stroom !== null);
  const wind: PassageWind = {};
  for (const k of keys) {
    const f = forecasts[k];
    if (f) wind[k] = f.points.map((p) => ({ time: p.time, speed_kn: p.speed_kn, dir_deg: p.dir_deg }));
  }
  const current: PassageCurrent = stroom?.available && stroom.vectors ? stroom.vectors : null;
  return { ready, wind, current, stroomAvailable: !!stroom?.available };
}

export function useRouteStroom(keys: string[], fromISO: string | null, toISO: string | null, atISO?: string | null) {
  const url = keys.length >= 2 && fromISO && toISO
    ? `/api/route-stroom?keys=${keys.join(",")}&from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}${atISO ? `&at=${encodeURIComponent(atISO)}` : ""}`
    : null;
  return useJson<RouteStroom>(url).data;
}
