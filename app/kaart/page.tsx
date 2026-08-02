"use client";
import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRoute } from "@/components/route/RouteProvider";
import RouteHeader from "@/components/route/RouteHeader";
import TabBar from "@/components/route/TabBar";
import LocationDetailSheet from "@/components/route/LocationDetailSheet";
import { useRouteStroom, useTide, usePassageData } from "@/components/route/hooks";
import { tideNow, nearestIndex } from "@/lib/instrument";
import { MS_HOUR } from "@/lib/route";
import { computePassage, passageOrigin } from "@/lib/passage";
import { localHM } from "@/lib/tz";
import type { MapEta } from "@/components/route/MapView";

const MapView = dynamic(() => import("@/components/route/MapView"), { ssr: false, loading: () => <div className="map" /> });

const DAY_START_H = 6, DAY_END_H = 21;
function hourMsOn(date: string, h: number): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, h).getTime();
}

export default function KaartPage() {
  const { waypoints, trip, boat } = useRoute();
  const routeKeys = waypoints.map((w) => w.location_key);
  const [detailKey, setDetailKey] = useState<string | null>(null);

  // scrubber-uren over de dag
  const hours = useMemo(() => {
    const out: number[] = [];
    for (let h = DAY_START_H; h <= DAY_END_H; h++) out.push(hourMsOn(trip.date, h));
    return out;
  }, [trip.date]);
  const [idx, setIdx] = useState(() => nearestIndex(hours, Date.now()));
  const atMs = hours[Math.min(idx, hours.length - 1)];

  const dayStart = hours[0], dayEnd = hours[hours.length - 1];
  const stroom = useRouteStroom(routeKeys, new Date(dayStart).toISOString(), new Date(dayEnd).toISOString(), new Date(atMs).toISOString());
  const tide = useTide(routeKeys[0] ?? null);
  const tn = tide ? tideNow(tide, atMs) : null;

  // ETA per waypoint vanaf de gekozen vertrektijd (fase 2)
  const departMs = useMemo(() => {
    const [hh, mm] = trip.time.split(":").map(Number);
    const [y, m, d] = trip.date.split("-").map(Number);
    return new Date(y, m - 1, d, hh, mm).getTime();
  }, [trip.date, trip.time]);
  const pdata = usePassageData(routeKeys,
    new Date(departMs).toISOString(), new Date(departMs + 30 * MS_HOUR).toISOString());
  const passage = useMemo(() => (pdata.ready
    ? computePassage({ waypoints, departMs, boat, wind: pdata.wind, current: pdata.current })
    : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pdata.ready, JSON.stringify(routeKeys), departMs, boat]);

  const etas: Record<string, MapEta> | undefined = useMemo(() => {
    if (!passage) return undefined;
    const src = passageOrigin(boat, passage.currentSource);
    const out: Record<string, MapEta> = {
      [routeKeys[0]]: { label: `vertrek ${localHM(departMs)}`, src },
    };
    for (const l of passage.legs) {
      out[l.toId] = {
        label: l.etaArrival ? `aankomst ${localHM(l.etaArrival.getTime())}` : "onhaalbaar",
        src: l.etaArrival ? src : "binnen de horizon niet te halen",
      };
    }
    return out;
  }, [passage, boat, departMs, routeKeys]);

  const detailLoc = waypoints.find((w) => w.location_key === detailKey) ?? null;
  const detailPassageMs = passage?.legs.find((l) => l.toId === detailKey)?.etaArrival?.getTime()
    ?? (detailKey === routeKeys[0] ? departMs : null);

  return (
    <>
      <RouteHeader />
      <div className="timehead">
        <div>
          <span className="h">{localHM(atMs)}</span>
          {tn && <span className="ph">· {tn.rising ? "vloed ↑" : "eb ↓"}</span>}
        </div>
        <span className="badge">model ongevalideerd</span>
      </div>

      <MapView waypoints={waypoints} arrows={stroom?.available ? (stroom.arrows ?? []) : []}
               legs={passage?.legs.map((l) => ({ tacking: l.tacking }))} etas={etas}
               onWaypointClick={setDetailKey} />

      <div className="scrubber">
        <button className="nav" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0} aria-label="Vorig uur">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15,18 9,12 15,6" /></svg>
        </button>
        <div className="track">
          {hours.map((h, i) => {
            const on = i === idx;
            const near = Math.abs(i - idx) <= 2 || on;   // 5 stops × 48px raakvlak past op 375px
            if (!near) return null;
            return (
              <button key={h} className={"stop" + (on ? " on" : "")} onClick={() => setIdx(i)}>
                {on && <span className="t">{localHM(h)}</span>}
                <i />
              </button>
            );
          })}
        </div>
        <button className="nav" onClick={() => setIdx((i) => Math.min(hours.length - 1, i + 1))} disabled={idx === hours.length - 1} aria-label="Volgend uur">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9,18 15,12 9,6" /></svg>
        </button>
      </div>

      <TabBar />
      <LocationDetailSheet location={detailLoc} passageMs={detailPassageMs}
                           onClose={() => setDetailKey(null)} />
    </>
  );
}
