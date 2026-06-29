"use client";
import { useEffect, useMemo, useState } from "react";
import Nav from "@/components/Nav";
import LocationPicker from "@/components/LocationPicker";
import VarenOverview from "@/components/VarenOverview";
import VarenDetail from "@/components/VarenDetail";
import { buildDayModels, VAREN_STREAM } from "@/lib/varen";
import type { Location, CorrectedPoint, TideData } from "@/lib/types";

// Vaarcondities-route — een aparte weergave naast Punt/7 dagen/Stroom, op dezelfde
// echte datalaag (forecast + tide API). Overzicht ↔ detail via interne state, net
// als de Stroom-tab. De koers is alleen hier instelbaar en herberekent uitsluitend
// de "op je koers"-stroken.

export default function Varen() {
  const [locs, setLocs] = useState<Location[]>([]);
  const [key, setKey] = useState("");
  const [data, setData] = useState<{ location: Location; points: CorrectedPoint[] } | null>(null);
  const [tide, setTide] = useState<TideData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [view, setView] = useState<"over" | "det">("over");
  const [curDay, setCurDay] = useState(0);
  const [course, setCourse] = useState(40);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    fetch("/api/locations", { cache: "no-store" }).then((r) => r.json()).then((l: Location[]) => {
      setLocs(l);
      const initial = l.find((x) => x.location_key === sp.get("loc")) ?? l[0];
      if (initial) setKey(initial.location_key);
    }).catch((e) => setErr(String(e)));
  }, []);

  // keep ?loc= so the other tabs inherit it (matches the Punt page)
  useEffect(() => {
    if (!key) return;
    const url = new URL(window.location.href);
    url.search = `loc=${key}`;
    window.history.replaceState(null, "", url.href);
  }, [key]);

  useEffect(() => {
    if (!key) return;
    setView("over"); setCurDay(0);
    setLoading(true); setErr("");
    fetch(`/api/forecast/${key}`, { cache: "no-store" }).then((r) => r.json()).then((d) => {
      if (d.error) setErr(d.error); else setData({ location: d.location, points: d.points });
    }).catch((e) => setErr(String(e))).finally(() => setLoading(false));
  }, [key]);

  useEffect(() => {
    if (!key) return;
    setTide(null);
    fetch(`/api/tide/${key}`, { cache: "no-store" }).then((r) => r.json()).then((d) => {
      setTide(d && d.code ? d : null);
    }).catch(() => setTide(null));
  }, [key]);

  const days = useMemo(
    () => (data ? buildDayModels(data.points, tide, VAREN_STREAM[key] ?? null) : []),
    [data, tide, key],
  );
  const day = days[Math.min(curDay, days.length - 1)];

  const changeCourse = (delta: number) => setCourse((c) => (((c + delta) % 360) + 360) % 360);
  const openDetail = (idx: number) => { setCurDay(idx); setView("det"); };

  return (
    <>
      <header className="top">
        <h1>Windvoorspelling</h1>
        <Nav active="varen" locKey={key} />
      </header>

      <LocationPicker locations={locs} value={key} onChange={setKey} />

      {err && <div className="panel"><span className="badge warn">fout</span> <span className="muted">{err}</span></div>}
      {loading && <div className="panel muted">Laden…</div>}

      {data && days.length > 0 && (
        view === "over"
          ? (
            <>
              <div className="vd-loc">
                <b>{data.location.name}</b><span>{data.location.area}</span>
              </div>
              <VarenOverview days={days} onPick={openDetail} />
            </>
          )
          : day && (
            <VarenDetail
              day={day} course={course}
              onCourse={changeCourse}
              onBack={() => setView("over")}
              tideName={tide?.name ?? null}
            />
          )
      )}
    </>
  );
}
