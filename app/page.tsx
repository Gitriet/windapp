"use client";
import { useEffect, useState } from "react";
import WindChart from "@/components/WindChart";
import TideChart from "@/components/TideChart";
import Compass from "@/components/Compass";
import LocationPicker from "@/components/LocationPicker";
import { ktsToBft, fmtTime, compass } from "@/lib/format";
import { COURSES, relAngle, sail } from "@/lib/sailing";
import type { Location, CorrectedPoint, TideData } from "@/lib/types";

const DAY_MS = 24 * 3600 * 1000;
const hhmm = (iso: string) => {
  const d = new Date(iso);
  return String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0");
};

export default function Home() {
  const [locs, setLocs] = useState<Location[]>([]);
  const [key, setKey] = useState("");
  const [course, setCourse] = useState<number | null>(null);
  const [range, setRange] = useState(3);
  const [data, setData] = useState<{ location: Location; points: CorrectedPoint[] } | null>(null);
  const [tide, setTide] = useState<TideData | null>(null);
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

  useEffect(() => {
    if (!key) return;
    setLoading(true); setErr("");
    fetch(`/api/forecast/${key}`, { cache: "no-store" }).then((r) => r.json()).then((d) => {
      if (d.error) setErr(d.error); else setData(d);
    }).catch((e) => setErr(String(e))).finally(() => setLoading(false));
  }, [key]);

  // tide is a separate layer, only for Wad stations (others return {tide:null})
  useEffect(() => {
    if (!key) return;
    setTide(null);
    fetch(`/api/tide/${key}`, { cache: "no-store" }).then((r) => r.json()).then((d) => {
      setTide(d && d.code ? d : null);
    }).catch(() => setTide(null));
  }, [key]);

  const now = data?.points?.[0];
  const pos = now && course !== null ? sail(relAngle(now.dir_deg, course)) : null;
  const t0 = now ? Date.parse(now.time + "Z") : 0;
  const endMs = t0 + range * DAY_MS;
  const nextTide = tide
    ? ["HW", "LW"].map((k) => tide.extremes.find((e) => e.kind === k && Date.parse(e.t) >= Date.now()))
        .filter(Boolean).sort((a, b) => Date.parse(a!.t) - Date.parse(b!.t))
    : [];

  return (
    <>
      <header className="top">
        <h1>Windvoorspelling</h1>
        <nav className="tabs">
          <a className="active" href="/">Punt</a><a href="/map">Kaart</a>
        </nav>
      </header>

      <div className="panel">
        <div className="flbl">Gekalibreerde locatie</div>
        <LocationPicker locations={locs} value={key} onChange={setKey} />
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
            <div className="hdr">
              <span className="flbl">Wind — {data.location.name}</span>
              <div className="hr">
                <span className="loc">bereik</span>
                <div className="hrange" role="group" aria-label="Bereik in dagen">
                  {[1, 2, 3].map((d) => (
                    <button key={d} className={"rbtn" + (range === d ? " on" : "")}
                            aria-pressed={range === d} aria-label={`${d} ${d === 1 ? "dag" : "dagen"}`}
                            onClick={() => setRange(d)}>{d}d</button>
                  ))}
                </div>
              </div>
            </div>
            <WindChart points={data.points} course={course} t0={t0} endMs={endMs} range={range} />
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

          {tide && (
            <div className="panel">
              <div className="hdr"><span className="flbl">Getij</span><span className="loc">{tide.name} · cm NAP</span></div>
              <div className="nextstrip">
                {nextTide.map((e) => (
                  <div className="ns" key={e!.kind}>
                    <span className="nsdot" style={{ background: e!.kind === "HW" ? "var(--hw)" : "var(--lw)" }} />
                    <span className="nslab">{e!.kind === "HW" ? "Hoogwater" : "Laagwater"}</span>
                    <span className="nsval">{hhmm(e!.t)} · {Math.round(e!.v)} cm</span>
                  </div>
                ))}
              </div>
              <TideChart data={tide} t0={t0} endMs={endMs} range={range} />
              <div className="legend">
                <div className="lgi"><span className="lgln" style={{ borderColor: "var(--tide)" }} />verwacht</div>
                <div className="lgi"><span className="lgln dashed" style={{ borderColor: "var(--tide2)" }} />astronomisch</div>
              </div>
              <div className="note">
                zelfde {range} {range === 1 ? "dag" : "dagen"} als de wind · verschil tussen de lijnen = windopzet ·
                rechtstreeks uit RWS, zonder correctie · tijden in UTC
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
