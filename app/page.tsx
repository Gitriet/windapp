"use client";
import { useEffect, useState } from "react";
import WindChart from "@/components/WindChart";
import { ktsToBft, compass, fmtTime } from "@/lib/format";
import type { Location, CorrectedPoint } from "@/lib/types";

export default function Home() {
  const [locs, setLocs] = useState<Location[]>([]);
  const [key, setKey] = useState("");
  const [data, setData] = useState<{ location: Location; points: CorrectedPoint[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/locations").then((r) => r.json()).then((l: Location[]) => {
      setLocs(l);
      if (l[0]) setKey(l[0].location_key);
    }).catch((e) => setErr(String(e)));
  }, []);

  useEffect(() => {
    if (!key) return;
    setLoading(true); setErr("");
    fetch(`/api/forecast/${key}`).then((r) => r.json()).then((d) => {
      if (d.error) setErr(d.error); else setData(d);
    }).catch((e) => setErr(String(e))).finally(() => setLoading(false));
  }, [key]);

  const now = data?.points?.[0];
  return (
    <>
      <header className="top">
        <h1>🌬 Windvoorspelling</h1>
        <nav className="tabs"><a className="active" href="/">Punt</a><a href="/route">Route</a></nav>
      </header>

      <div className="panel">
        <label>Gekalibreerde locatie</label>
        <select value={key} onChange={(e) => setKey(e.target.value)}>
          {locs.map((l) => (
            <option key={l.location_key} value={l.location_key}>{l.name} — {l.area}</option>
          ))}
        </select>
      </div>

      {err && <div className="panel"><span className="badge warn">fout</span> <span className="muted">{err}</span></div>}
      {loading && <div className="panel muted">Laden…</div>}

      {now && data && (
        <>
          <div className="panel">
            <div className="now">
              <span className="big">{now.speed_kn}<span className="unit"> kn</span></span>
              <span className="bft">{ktsToBft(now.speed_kn)} bft</span>
              <span>{compass(now.dir_deg)} ({now.dir_deg}°)</span>
              <span className="muted">vlagen {now.gust_kn} kn</span>
              <span className="muted">spreiding {now.band_low_kn}–{now.band_high_kn} kn</span>
            </div>
            <div className="chips">
              <span className="chip">model: {now.model_label}</span>
              <span className={"badge " + (now.corrected ? "ok" : "warn")}>
                {now.corrected ? "gecorrigeerd" : "ongecorrigeerd"}
              </span>
              <span className="chip">{fmtTime(now.time)} UTC</span>
            </div>
          </div>

          <div className="panel"><WindChart points={data.points} /></div>
          <p className="muted" style={{ fontSize: 13 }}>
            Lijn = bias-gecorrigeerde wind van het per-lead aanbevolen model; vlak =
            spreiding tussen alle modellen (gecorrigeerd). Verder vooruit (day2/day3)
            is de spreiding doorgaans groter.
          </p>
        </>
      )}
    </>
  );
}
