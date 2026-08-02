"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Location } from "@/lib/types";
import { DEFAULT_ROUTE_KEYS, type Trip } from "@/lib/route";
import { DEFAULT_BOAT, type BoatProfile } from "@/lib/polar";

const TRIP_KEY = "wa.trip";
const RECENT_KEY = "wa.recent";
const BOAT_KEY = "wa.boat";

export type RecentTrip = Trip & { savedAt: number };

type Ctx = {
  locations: Location[];
  loaded: boolean;
  trip: Trip;
  waypoints: Location[];                 // resolved, in order (unknown keys dropped)
  setWaypointKeys: (keys: string[]) => void;
  setWaypointAt: (index: number, key: string) => void;
  addWaypoint: (key: string) => void;
  removeWaypoint: (index: number) => void;
  setDate: (date: string) => void;
  setTime: (time: string) => void;
  recent: RecentTrip[];
  saveRecent: () => void;
  loadRecent: (t: RecentTrip) => void;
  boat: BoatProfile;
  setBoat: (patch: Partial<BoatProfile>) => void;
};

const RouteCtx = createContext<Ctx | null>(null);
export const useRoute = () => {
  const c = useContext(RouteCtx);
  if (!c) throw new Error("useRoute buiten RouteProvider");
  return c;
};

function todayLocalISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const defaultTrip = (): Trip => ({ waypointKeys: DEFAULT_ROUTE_KEYS, date: todayLocalISO(), time: "10:00" });

export function RouteProvider({ children }: { children: React.ReactNode }) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [trip, setTrip] = useState<Trip>(defaultTrip);
  const [recent, setRecent] = useState<RecentTrip[]>([]);
  const [boat, setBoatState] = useState<BoatProfile>(DEFAULT_BOAT);

  // hydrate from localStorage (client only)
  useEffect(() => {
    try {
      const t = localStorage.getItem(TRIP_KEY);
      if (t) setTrip((prev) => ({ ...prev, ...JSON.parse(t) }));
      const r = localStorage.getItem(RECENT_KEY);
      if (r) setRecent(JSON.parse(r));
      const b = localStorage.getItem(BOAT_KEY);
      if (b) setBoatState((prev) => ({ ...prev, ...JSON.parse(b) }));
    } catch { /* ignore corrupt storage */ }
  }, []);

  // fetch available locations once
  useEffect(() => {
    fetch("/api/locations", { cache: "no-store" })
      .then((r) => r.json())
      .then((l: Location[]) => {
        setLocations(l);
        // drop any stored keys that no longer exist; keep default if empty
        setTrip((prev) => {
          const have = new Set(l.map((x) => x.location_key));
          const keys = prev.waypointKeys.filter((k) => have.has(k));
          const finalKeys = keys.length >= 2 ? keys
            : DEFAULT_ROUTE_KEYS.filter((k) => have.has(k)).length >= 2
              ? DEFAULT_ROUTE_KEYS.filter((k) => have.has(k))
              : l.slice(0, 2).map((x) => x.location_key);
          return { ...prev, waypointKeys: finalKeys };
        });
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  // persist trip
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(TRIP_KEY, JSON.stringify(trip)); } catch { /* noop */ }
  }, [trip, loaded]);

  const byKey = useMemo(() => new Map(locations.map((l) => [l.location_key, l])), [locations]);
  const waypoints = useMemo(
    () => trip.waypointKeys.map((k) => byKey.get(k)).filter((x): x is Location => !!x),
    [trip.waypointKeys, byKey],
  );

  const value: Ctx = {
    locations, loaded, trip, waypoints,
    setWaypointKeys: (keys) => setTrip((p) => ({ ...p, waypointKeys: keys })),
    setWaypointAt: (i, key) => setTrip((p) => {
      const keys = p.waypointKeys.slice(); keys[i] = key; return { ...p, waypointKeys: keys };
    }),
    addWaypoint: (key) => setTrip((p) => {
      // voeg toe vlak vóór de eindbestemming (als VIA)
      const keys = p.waypointKeys.slice();
      keys.splice(Math.max(1, keys.length - 1), 0, key);
      return { ...p, waypointKeys: keys };
    }),
    removeWaypoint: (i) => setTrip((p) => {
      if (p.waypointKeys.length <= 2) return p;    // altijd minstens VAN + NAAR
      const keys = p.waypointKeys.slice(); keys.splice(i, 1); return { ...p, waypointKeys: keys };
    }),
    setDate: (date) => setTrip((p) => ({ ...p, date })),
    setTime: (time) => setTrip((p) => ({ ...p, time })),
    recent,
    saveRecent: () => setRecent((prev) => {
      const entry: RecentTrip = { ...trip, savedAt: Date.now() };
      const dedup = prev.filter((r) => r.waypointKeys.join(">") !== trip.waypointKeys.join(">"));
      const next = [entry, ...dedup].slice(0, 4);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* noop */ }
      return next;
    }),
    loadRecent: (t) => setTrip({ waypointKeys: t.waypointKeys, date: t.date, time: t.time }),
    boat,
    setBoat: (patch) => setBoatState((prev) => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem(BOAT_KEY, JSON.stringify(next)); } catch { /* noop */ }
      return next;
    }),
  };

  return <RouteCtx.Provider value={value}>{children}</RouteCtx.Provider>;
}
