"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import WindMap from "@/components/WindMap";
import { COURSES, dirColor, sail } from "@/lib/sailing";
import { compass, fmtTime } from "@/lib/format";
import type { MapData } from "@/lib/types";

export default function MapPage() {
  const router = useRouter();
  const [data, setData] = useState<MapData | null>(null);
  const [course, setCourse] = useState<number | null>(null);
  const [hour, setHour] = useState(0);
  const [err, setErr] = useState("");
  const tlRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef(false);

  useEffect(() => {
    fetch("/api/map", { cache: "no-store" }).then((r) => r.json()).then((d) => {
      if (d.error) setErr(d.error); else setData(d);
    }).catch((e) => setErr(String(e)));
  }, []);

  const N = data?.times.length ?? 0;
  const setFromX = (clientX: number) => {
    const el = tlRef.current; if (!el || N < 2) return;
    const r = el.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    setHour(Math.min(N - 1, Math.round((f * (N - 1)) / 3) * 3));   // snap to 3-hour steps
  };

  const pct = N > 1 ? (hour / (N - 1)) * 100 : 0;
  const dayOf = (iso: string) => fmtTime(iso).slice(0, 2);
  const isMidnight = (iso: string) => new Date(iso + "Z").getUTCHours() === 0;

  return (
    <>
      <header className="top">
        <h1>Windvoorspelling</h1>
        <nav className="tabs">
          <a href="/">Punt</a><a className="active" href="/map">Kaart</a>
        </nav>
      </header>

      <div className="panel">
        <div className="flbl">Koers <span className="lc">(optioneel — kleurt naar zeilbaarheid)</span></div>
        <div className="cbtns">
          {COURSES.map(([lab, deg]) => (
            <button key={lab} className={"cbtn" + (course === deg ? " on" : "")}
                    onClick={() => setCourse(deg)}>{lab}</button>
          ))}
        </div>
        <div className="tlrow" style={{ marginTop: 16 }}>
          <div className="tl" ref={tlRef}
               onPointerDown={(e) => { dragRef.current = true; try { e.currentTarget.setPointerCapture(e.pointerId); } catch {} setFromX(e.clientX); }}
               onPointerMove={(e) => { if (dragRef.current) setFromX(e.clientX); }}
               onPointerUp={() => { dragRef.current = false; }}>
            <div className="tl-fill" style={{ width: pct + "%" }} />
            <div className="tl-ticks">
              {data && data.times.map((t, i) => i % 12 === 0 ? (
                <span key={i} style={{ left: (i / (N - 1)) * 100 + "%" }}>
                  {isMidnight(t) && <b>{dayOf(t)}</b>}
                </span>
              ) : null)}
            </div>
            <div className="tl-knob" style={{ left: pct + "%" }} />
          </div>
          <span className="tv">{data ? fmtTime(data.times[hour]) + " UTC" : "—"}</span>
        </div>
      </div>

      {err && <div className="panel"><span className="badge warn">fout</span> <span className="muted">{err}</span></div>}

      {data ? (
        <div className="panel">
          <div className="mapwrap">
            <WindMap data={data} course={course} hour={hour}
                     onPick={(key) => router.push(`/?loc=${key}`)} />
          </div>
          <div className="legend">
            {course === null
              ? ["N", "O", "Z", "W"].map((c, i) => (
                  <div key={c} className="lgi"><span className="lgsw" style={{ background: dirColor(i * 90) }} />{c}</div>))
              : ([["in de wind", "#df4b4b"], ["aan de wind", "#f4a259"], ["halve wind", "#5fd0a6"],
                  ["ruimschoots", "#3fb6c9"], ["voor de wind", "#6f9fe0"]] as [string, string][]).map(([t, c]) => (
                  <div key={t} className="lgi"><span className="lgsw" style={{ background: c }} />{t}</div>))}
          </div>
          <div className="note">
            {course === null
              ? "stroming volgt de wind (waarheen) · label en kleur tonen de windrichting (waaruit) · klik een station voor de puntweergave"
              : `kleur = zeilbaarheid op koers ${compass(course)} · rood = te dicht aan de wind · klik een station voor de puntweergave`}
          </div>
          <div className="note" style={{ marginTop: 4 }}>
            De stroming waait mee met de wind; label en kleur tonen de richting wáár de wind vandaan komt —
            net als het kompas in de puntweergave, dat naar de bron wijst. Alleen de gekalibreerde meetpunten;
            geen windveld ertussen.
          </div>
        </div>
      ) : !err && <div className="panel muted">Kaart laden…</div>}
    </>
  );
}
