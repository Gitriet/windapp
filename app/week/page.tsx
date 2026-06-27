"use client";
import { useEffect, useState } from "react";
import LocationPicker from "@/components/LocationPicker";
import Nav from "@/components/Nav";
import WeekTable from "@/components/WeekTable";
import { dirColor } from "@/lib/sailing";
import { isLakeArea } from "@/lib/stroom";
import type { Location, WeekDay } from "@/lib/types";

// hue strip uses the same dirColor as the bars, so the legend literally matches
const HUE = `linear-gradient(90deg, ${dirColor(0)}, ${dirColor(90)}, ${dirColor(180)}, ${dirColor(270)}, ${dirColor(360)})`;
const TRI = (
  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
    <path d="M8 1.5 L15 14 L1 14 Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <line x1="8" y1="6" x2="8" y2="10.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="8" cy="12.3" r="0.9" fill="currentColor" />
  </svg>
);

export default function Week() {
  const [locs, setLocs] = useState<Location[]>([]);
  const [key, setKey] = useState("");
  const [days, setDays] = useState<WeekDay[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/locations", { cache: "no-store" }).then((r) => r.json()).then((l: Location[]) => {
      setLocs(l);
      const wanted = new URLSearchParams(window.location.search).get("loc");
      const initial = l.find((x) => x.location_key === wanted) ?? l[0];
      if (initial) setKey(initial.location_key);
    }).catch((e) => setErr(String(e)));
  }, []);

  // keep the location in the URL so the Punt tab inherits it on switch.
  // build a fully-qualified URL — Safari rejects a bare relative "?loc=" query.
  useEffect(() => {
    if (!key) return;
    const url = new URL(window.location.href);
    url.search = `loc=${key}`;
    window.history.replaceState(null, "", url.href);
  }, [key]);

  useEffect(() => {
    if (!key) return;
    setLoading(true); setErr("");
    fetch(`/api/week/${key}`, { cache: "no-store" }).then((r) => r.json()).then((d) => {
      if (d.error) setErr(d.error); else setDays(d.days);
    }).catch((e) => setErr(String(e))).finally(() => setLoading(false));
  }, [key]);

  const selName = locs.find((l) => l.location_key === key)?.name ?? "";

  return (
    <>
      <header className="top">
        <h1>Windvoorspelling</h1>
        <Nav active="week" locKey={key}
             showStroom={!isLakeArea(locs.find((l) => l.location_key === key)?.area ?? "")} />
      </header>

      <div className="panel">
        <div className="flbl">Gekalibreerde locatie</div>
        <LocationPicker locations={locs} value={key} onChange={setKey} />
      </div>

      {err && <div className="panel"><span className="badge warn">fout</span> <span className="muted">{err}</span></div>}
      {loading && <div className="panel muted">Laden…</div>}

      {days && (
        <div className="card">
          <div className="card-head">
            <span className="ct">7 dagen{selName ? ` — ${selName}` : ""}</span>
            <span className="cr">max · piek kn</span>
          </div>
          <WeekTable days={days} locKey={key} />
          <div className="wk-legend">
            <span className="wk-hue">
              kleur = richting
              <span className="wk-huecol">
                <span className="wk-huebar" style={{ background: HUE }} />
                <span className="wk-huetick"><span>N</span><span>O</span><span>Z</span><span>W</span><span>N</span></span>
              </span>
            </span>
            <span>langer = harder (0–40 kn)</span>
            <span className="wk-legwarn">{TRI} harde wind</span>
          </div>
          <div className="note">daggemiddelden uit het globale model, zonder stationscorrectie · tik een dag voor het detail op de Punt-kaart</div>
        </div>
      )}
    </>
  );
}
