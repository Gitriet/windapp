"use client";
import { useEffect, useState } from "react";
import WindChart from "@/components/WindChart";
import Compass from "@/components/Compass";
import { ktsToBft, fmtTime, compass } from "@/lib/format";
import { COURSES, relAngle, sail } from "@/lib/sailing";
import type { Location, CorrectedPoint } from "@/lib/types";

export default function Home() {
  const [locs, setLocs] = useState<Location[]>([]);
  const [key, setKey] = useState("");
  const [course, setCourse] = useState<number | null>(null);
  const [data, setData] = useState<{ location: Location; points: CorrectedPoint[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/locations", { cache: "no-store" }).then((r) => r.json()).then((l: Location[]) => {
      setLocs(l); if (l[0]) setKey(l[0].location_key);
    }).catch((e) => setErr(String(e)));
  }, []);

  useEffect(() => {
    if (!key) return;
    setLoading(true); setErr("");
    fetch(`/api/forecast/${key}`, { cache: "no-store" }).then((r) => r.json()).then((d) => {
      if (d.error) setErr(d.error); else setData(d);
    }).catch((e) => setErr(String(e))).finally(() => setLoading(false));
  }, [key]);

  const now = data?.points?.[0];
  const pos = now && course !== null ? sail(relAngle(now.dir_deg, course)) : null;

  return (
    <>
      <header className="top">
        <h1>Windvoorspelling</h1>
        <nav className="tabs"><a className="active" href="/">Punt</a><a href="/route">Route</a></nav>
      </header>

      <div className="panel">
        <div className="flbl">Gekalibreerde locatie</div>
        <select value={key} onChange={(e) => setKey(e.target.value)}>
          {locs.map((l) => (
            <option key={l.location_key} value={l.location_key}>{l.name} — {l.area}</option>
          ))}
        </select>
        <div className="course">
          <div className="flbl">Koers <span className="lc">(optioneel — schakelt naar koers-relatief)</span></div>
          <div className="cbtns">
            {COURSES.map(([lab, deg]) => (
              <button key={lab} className={"cbtn" + (course === deg ? " on" : "")}
                      onClick={() => setCourse(deg)}>{lab}</button>
            ))}
          </div>
        </div>
      </div>

      {err && <div className="panel"><span className="badge warn">fout</span> <span className="muted">{err}</span></div>}
      {loading && <div className="panel muted">Laden…</div>}

      {now && data && (
        <>
          <div className="panel">
            <div className="ovh">
              <Compass deg={now.dir_deg} />
              <div style={{ flex: 1 }}>
                <div className="big">{now.speed_kn}<span className="u">kn</span></div>
                <div className="sub">
                  <span><b>{ktsToBft(now.speed_kn)}</b> bft</span>
                  <span>{compass(now.dir_deg)} <b>{now.dir_deg}°</b></span>
                  <span>vlagen <b>{now.gust_kn}</b></span>
                  <span>spreiding <b>{now.band_low_kn}–{now.band_high_kn}</b></span>
                </div>
                {pos && (
                  <div className="pos" style={{ background: pos.color + "22", color: pos.color, borderColor: pos.color + "66" }}>
                    koers {compass(course as number)} · {pos.label}
                  </div>
                )}
              </div>
            </div>
            <div className="tags">
              <span className="tag">model: {now.model_label}</span>
              <span className={"tag" + (now.corrected ? " corr" : "")}>
                {now.corrected ? "gecorrigeerd" : "ongecorrigeerd"}
              </span>
              <span className="tag">{fmtTime(now.time)} UTC</span>
            </div>
          </div>

          <div className="panel">
            <WindChart points={data.points} course={course} />
            <div className="legend">
              <div className="lgi"><span className="lgsw" style={{ background: "var(--accent)" }} />snelheid</div>
              <div className="lgi"><span className="lgsw" style={{ background: "var(--gust)" }} />vlagen</div>
              <div className="lgi"><span className="lgsw" style={{ background: "var(--spread)" }} />spreiding</div>
            </div>
            <div className="note">
              {course === null
                ? "onderste band = windrichting · vaantjes wijzen naar waar de wind vandaan komt"
                : "onderste band = zeilbaarheid op jouw koers · rood = te dicht aan de wind · relatief aan het boottype"}
            </div>
          </div>
        </>
      )}
    </>
  );
}
