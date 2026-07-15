"use client";
import { useEffect, useState } from "react";
import LocationPicker from "@/components/LocationPicker";
import Led from "@/components/instrument/Led";
import VBar from "@/components/instrument/VBar";
import Kompas from "@/components/instrument/Kompas";
import WindDagStrip, { type WindStep } from "@/components/instrument/WindDagStrip";
import GetijStrip from "@/components/instrument/GetijStrip";
import WeekStrip, { type WeekCol } from "@/components/instrument/WeekStrip";
import { localHM, localHourShort, localWeekdayShort } from "@/lib/tz";
import {
  glyphOf, weatherAt, pointAtMs, tideNow, tideDay,
} from "@/lib/instrument";
import type { Location, CorrectedPoint, TideData, WeatherSeries, WeekDay } from "@/lib/types";

const ms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));
const HOUR = 3_600_000;

export default function Home() {
  const [locs, setLocs] = useState<Location[]>([]);
  const [key, setKey] = useState("");
  const [data, setData] = useState<{ location: Location; points: CorrectedPoint[]; weather: WeatherSeries } | null>(null);
  const [tide, setTide] = useState<TideData | null>(null);
  const [week, setWeek] = useState<WeekDay[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    fetch("/api/locations", { cache: "no-store" }).then((r) => r.json()).then((l: Location[]) => {
      setLocs(l);
      const saved = localStorage.getItem("lastLoc");
      const initial =
        l.find((x) => x.location_key === sp.get("loc")) ??
        l.find((x) => x.location_key === saved) ??
        l[0];
      if (initial) setKey(initial.location_key);
    }).catch((e) => setErr(String(e)));
  }, []);

  useEffect(() => {
    if (!key) return;
    localStorage.setItem("lastLoc", key);
    const url = new URL(window.location.href);
    url.search = `loc=${key}`;
    window.history.replaceState(null, "", url.href);
  }, [key]);

  useEffect(() => {
    if (!key) return;
    setErr("");
    fetch(`/api/forecast/${key}`, { cache: "no-store" }).then((r) => r.json()).then((d) => {
      if (d.error) setErr(d.error); else setData(d);
    }).catch((e) => setErr(String(e)));
  }, [key]);

  useEffect(() => {
    if (!key) return;
    setTide(null);
    fetch(`/api/tide/${key}`, { cache: "no-store" }).then((r) => r.json()).then((d) => {
      setTide(d && d.code && !d.unavailable ? d : null);
    }).catch(() => setTide(null));
  }, [key]);

  useEffect(() => {
    if (!key) return;
    setWeek(null);
    fetch(`/api/week/${key}`, { cache: "no-store" }).then((r) => r.json()).then((d) => {
      setWeek(d && d.days ? d.days : null);
    }).catch(() => setWeek(null));
  }, [key]);

  const pts = data?.points ?? [];
  const now = pts[0];
  const nowMs = now ? ms(now.time) : 0;
  const wxNow = now ? weatherAt(data?.weather, nowMs) : { temp: null, pressure: null, pop: null };
  // actuele neerslagkans naast de temp-LED, alleen vanaf 20% (daaronder ruis).
  const POP_MIN_PCT = 20;
  const popNow = wxNow.pop != null && wxNow.pop >= POP_MIN_PCT ? Math.round(wxNow.pop) : null;

  // wind dagverloop: nu + 7 stappen van 3 uur. Vlaag alleen tonen als ze zinnig
  // boven de wind ligt (≥3 kn verschil), anders ruist het naast de wind.
  const GUST_MIN_DELTA_KN = 3;
  const steps: WindStep[] = now ? Array.from({ length: 8 }, (_, i) => {
    const target = nowMs + i * 3 * HOUR;
    const p = pointAtMs(pts, target) ?? now;
    const w = weatherAt(data?.weather, ms(p.time));
    const k = Math.round(p.speed_kn), g = Math.round(p.gust_kn);
    return {
      label: i === 0 ? "nu" : localHourShort(ms(p.time)).padStart(2, "0"),
      k, g: g - k >= GUST_MIN_DELTA_KN ? g : null,
      t: w.temp != null ? Math.round(w.temp) : null,
      dir: p.dir_deg, now: i === 0,
    };
  }) : [];

  // getij nu + kentermomenten (gedeelde LW→HW schaal)
  const tn = tide && now ? tideNow(tide, nowMs) : null;
  const td = tide && now ? tideDay(tide, nowMs, tn?.level) : null;

  // week
  const weekCols: WeekCol[] = (week ?? []).slice(0, 7).map((d) => ({
    day: dayShort(d.date),
    glyph: glyphOf(d.code),
    t: d.tmax != null ? Math.round(d.tmax) : null,
    k: d.speedMax != null ? Math.round(d.speedMax) : null,
  }));

  return (
    <div className="instrument">
      <div className="device">
        <div className="panel">
          <div className="loc-wrap">
            <LocationPicker locations={locs} value={key} onChange={setKey} />
          </div>

          {err && <div className="inst-err">{err}</div>}

          {now ? (
            <>
              <div className="inst">
                <div className="wbar">
                  <VBar side="left" title="WIND"
                        min={0} max={40} value={now.speed_kn} gust={now.gust_kn}
                        seg="var(--led)" glow="rgba(255,46,27,.55)" cap
                        ticks={[{ v: 0, label: "0" }, { v: 10, label: "10" }, { v: 20, label: "20" }, { v: 30, label: "30" }, { v: 40, label: "40" }]} />
                </div>
                <div className="rose"><Kompas deg={now.dir_deg} /></div>
                <div className="tbar">
                  {tn && td ? (
                    <VBar side="right" title="GETIJ"
                          min={td.lo} max={td.hi} value={tn.level}
                          seg="var(--water)" mark="var(--water-lit)" glow="rgba(63,144,173,.6)"
                          rising fallingArrow={!tn.rising}
                          ticks={tn.next ? [{ v: tn.next.kind === "HW" ? td.hi : td.lo, label: localHM(tn.next.ms) }] : []} />
                  ) : (
                    <VBar side="right" title="GETIJ" min={0} max={1} value={0}
                          seg="var(--water)" mark="var(--water-lit)" glow="rgba(63,144,173,.6)" />
                  )}
                </div>
              </div>

              <div className="cells">
                <div className="cell">
                  <span className="lab">Wind knopen</span>
                  <Led value={now.speed_kn.toFixed(1)} />
                </div>
                <div className="cell">
                  <span className="lab">Temp °C</span>
                  <div className="cell-val">
                    <Led value={wxNow.temp != null ? String(Math.round(wxNow.temp)) : "-"} />
                    {popNow != null && (
                      <div className="cell-pop">
                        <Led value={String(popNow)} height={16} />
                        <span className="cell-pct">%</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="cell">
                  <span className="lab">Druk hPa</span>
                  <Led value={wxNow.pressure != null ? String(Math.round(wxNow.pressure)) : "-"} />
                </div>
              </div>

              <WindDagStrip steps={steps} />
              <GetijStrip events={td?.events ?? []} lo={td?.lo ?? 0} hi={td?.hi ?? 1} />
              <WeekStrip days={weekCols} />
            </>
          ) : (
            !err && <div className="inst-load">Laden…</div>
          )}
        </div>
      </div>
    </div>
  );
}

// weekdag "do","vr",… uit een lokale datum "YYYY-MM-DD"
function dayShort(date: string): string {
  return localWeekdayShort(Date.parse(date + "T12:00:00Z"));
}
