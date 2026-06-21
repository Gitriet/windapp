"use client";
import { useEffect, useState } from "react";
import RouteTable from "@/components/RouteTable";
import type { Location, WaypointForecast } from "@/lib/types";

export default function RoutePage() {
  const [locs, setLocs] = useState<Location[]>([]);
  const [wps, setWps] = useState<string[]>([]);
  const [pick, setPick] = useState("");
  const [departure, setDeparture] = useState("");
  const [speed, setSpeed] = useState(5);
  const [out, setOut] = useState<WaypointForecast[] | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/locations").then((r) => r.json()).then((l: Location[]) => {
      setLocs(l); if (l[0]) setPick(l[0].location_key);
    }).catch((e) => setErr(String(e)));
    const d = new Date();
    setDeparture(new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  }, []);

  const nameOf = (k: string) => locs.find((l) => l.location_key === k)?.name ?? k;

  async function run() {
    if (wps.length < 1) { setErr("Voeg minstens één waypoint toe."); return; }
    setLoading(true); setErr(""); setOut(null);
    try {
      const r = await fetch("/api/route", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waypoints: wps, departure, boatSpeedKn: speed }),
      });
      const d = await r.json();
      if (d.error) setErr(d.error); else setOut(d.waypoints);
    } catch (e) { setErr(String(e)); } finally { setLoading(false); }
  }

  return (
    <>
      <header className="top">
        <h1>🌬 Windvoorspelling</h1>
        <nav className="tabs"><a href="/">Punt</a><a className="active" href="/route">Route</a></nav>
      </header>

      <div className="panel">
        <p className="muted" style={{ marginTop: 0 }}>
          Rijg gekalibreerde punten aaneen. Per waypoint volgt het passagemoment uit
          vertrektijd en bootsnelheid, en daaruit de lead (day1/2/3) en het model.
        </p>
        <div className="row">
          <div>
            <label>Waypoint toevoegen</label>
            <select value={pick} onChange={(e) => setPick(e.target.value)}>
              {locs.map((l) => <option key={l.location_key} value={l.location_key}>{l.name}</option>)}
            </select>
          </div>
          <button onClick={() => pick && setWps([...wps, pick])}>+ toevoegen</button>
          <div>
            <label>Vertrektijd (lokaal)</label>
            <input type="datetime-local" value={departure} onChange={(e) => setDeparture(e.target.value)} />
          </div>
          <div>
            <label>Bootsnelheid (kn)</label>
            <input type="number" min={1} max={40} value={speed}
                   onChange={(e) => setSpeed(Number(e.target.value))} style={{ width: 90 }} />
          </div>
          <button className="primary" onClick={run}>Bereken route</button>
        </div>

        {wps.length > 0 && (
          <div className="chips">
            {wps.map((k, i) => (
              <span className="chip" key={i}>{i + 1}. {nameOf(k)}
                <button onClick={() => setWps(wps.filter((_, j) => j !== i))}>✕</button>
              </span>
            ))}
            <button onClick={() => setWps([])} style={{ fontSize: 13 }}>wis</button>
          </div>
        )}
      </div>

      {err && <div className="panel"><span className="badge warn">fout</span> <span className="muted">{err}</span></div>}
      {loading && <div className="panel muted">Laden…</div>}

      {out && (
        <div className="panel">
          <RouteTable waypoints={out} />
          <p className="muted" style={{ fontSize: 13 }}>
            Latere waypoints kijken day2/day3 vooruit; de spreidingskolom laat de
            groeiende onzekerheid over de tocht zien. Alleen gekalibreerde punten —
            water ertussen wordt niet geïnterpoleerd.
          </p>
        </div>
      )}
    </>
  );
}
