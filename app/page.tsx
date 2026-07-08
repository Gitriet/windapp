"use client";
import { useEffect, useState } from "react";
import Meteogram from "@/components/Meteogram";
import Compass from "@/components/Compass";
import LocationPicker from "@/components/LocationPicker";
import Nav from "@/components/Nav";
import { compass } from "@/lib/format";
import { localWeekdayShort, dayMidnights } from "@/lib/tz";
import { stroomForLocation } from "@/lib/stroom";
import { BORROWED_WIND, UNCORRECTED_WIND } from "@/lib/borrowed";
import type { Location, CorrectedPoint, TideData, WeatherSeries } from "@/lib/types";

const DAY_MS = 24 * 3600 * 1000;
const ms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));

export default function Home() {
  const [locs, setLocs] = useState<Location[]>([]);
  const [key, setKey] = useState("");
  const [range, setRange] = useState(1);
  const [dayIndex, setDayIndex] = useState(0);
  const [data, setData] = useState<{ location: Location; points: CorrectedPoint[]; weather: WeatherSeries } | null>(null);
  const [tide, setTide] = useState<TideData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [hoverMs, setHoverMs] = useState<number | null>(null);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const r = Number(sp.get("range"));
    if (r === 1 || r === 3) setRange(r); else if (r === 2) setRange(3);
    const d = Number(sp.get("day"));
    if (Number.isInteger(d) && d >= 0) setDayIndex(d);
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
    setLoading(true); setErr("");
    fetch(`/api/forecast/${key}`, { cache: "no-store" }).then((r) => r.json()).then((d) => {
      if (d.error) setErr(d.error); else setData(d);
    }).catch((e) => setErr(String(e))).finally(() => setLoading(false));
  }, [key]);

  useEffect(() => {
    if (!key) return;
    setTide(null);
    fetch(`/api/tide/${key}`, { cache: "no-store" }).then((r) => r.json()).then((d) => {
      setTide(d && d.code ? d : null);
    }).catch(() => setTide(null));
  }, [key]);

  const now = data?.points?.[0];
  const wx = data?.weather;
  const isLand = !!data && /land/i.test(data.location.area);
  const borrow = key ? BORROWED_WIND[key] : undefined;
  const uncorrected = key ? UNCORRECTED_WIND.has(key) : false;
  const streamPt = key ? stroomForLocation(key) : null;

  const pts = data?.points ?? [];
  const firstMs = pts.length ? ms(pts[0].time) : 0;
  const lastMs = pts.length ? ms(pts[pts.length - 1].time) : 0;
  const dayStarts = pts.length ? [firstMs, ...dayMidnights(firstMs, lastMs)] : [0];
  const maxDay = dayStarts.length - 1;
  const di = Math.min(Math.max(0, dayIndex), maxDay);
  const t0 = dayStarts[di];
  const endMs = t0 + range * DAY_MS;
  const isRange = range > 1;

  // the hero reads the selected view: live "now" on nu/3d, that day's PEAK hour
  // on a future day-tab.
  const startsNow = di === 0;
  let heroIdx = 0;
  if (!startsNow) {
    let bestV = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const m = ms(pts[i].time);
      if (m < t0 || m > endMs) continue;
      if (pts[i].speed_kn > bestV) { bestV = pts[i].speed_kn; heroIdx = i; }
    }
  }
  const hero = pts[heroIdx] ?? now;
  const heroMs = hero ? ms(hero.time) : firstMs;

  const heroWxIdx = wx && hero ? wx.time.findIndex((t) => ms(t) === heroMs) : -1;
  const wxHero = wx && wx.code.length && heroWxIdx >= 0
    ? { pressure: wx.pressure[heroWxIdx], temp: wx.temp[heroWxIdx] }
    : null;

  const dayStats = dayStarts.map((s, i) => {
    const cnt = pts.filter((p) => { const m = ms(p.time); return m >= s && m < s + DAY_MS; }).length;
    return { i, n: cnt, label: i === 0 ? "nu" : localWeekdayShort(s) };
  }).filter((d) => d.n > 0).slice(0, 4);

  const pickRange = (d: number) => { setRange(d); if (d !== 1) setDayIndex(0); };
  const pickDay = (d: number) => { setRange(1); setDayIndex(Math.min(Math.max(0, d), maxDay)); };
  const modelInfo = hero ? hero.model_label : "";

  return (
    <div className="punt-dash">
      <div className="top">
        <h1>Windvoorspelling</h1>
        <Nav active="punt" locKey={key} />
        <div className="pd-loc">
          <LocationPicker locations={locs} value={key} onChange={setKey} />
        </div>
      </div>

      {err && <div className="panel"><span className="badge warn">fout</span> <span className="muted">{err}</span></div>}
      {loading && !data && <div className="panel muted">Laden…</div>}

      {now && data && hero && (
        <>
          <div className="hero">
            <div className="rose"><Compass deg={hero.dir_deg} /></div>
            <div className="main">
              <div className="num">{hero.speed_kn}<small>kn</small></div>
              <div className="dir"><b>{compass(hero.dir_deg)} · {wxHero?.temp != null ? `${Math.round(wxHero.temp)}°C` : `${hero.dir_deg}°`}{wxHero?.pressure != null ? ` · ${Math.round(wxHero.pressure)} hPa` : ""}</b></div>
            </div>
          </div>

          <div className="days">
            {dayStats.map((d) => (
              <button key={d.i} onClick={() => pickDay(d.i)} className={!isRange && di === d.i ? "active" : ""}>{d.label}</button>
            ))}
            <button onClick={() => pickRange(3)} className={isRange ? "active" : ""}>3d</button>
            {isLand && <span className="landtag">landstation</span>}
            {borrow && (
              <span className="borrowtag"
                    title={`De windgrafiek toont ${borrow.donorName} — Texelhors heeft geen gevalideerde meetreeks. Het getij is van Texel (Oudeschild).`}>
                wind: {borrow.donorName}
              </span>
            )}
            {uncorrected && (
              <span className="uncorrtag"
                    title="Wind uit een globaal model op deze locatie, zonder stationscorrectie — er is hier geen gevalideerd meetstation. Het getij komt van RWS.">
                ongecorrigeerd
              </span>
            )}
            <span className="days-info">
              <span className="model">{modelInfo}</span>
            </span>
          </div>

          <Meteogram points={data.points} weather={wx} tide={tide} stream={streamPt}
                     t0={t0} endMs={endMs} range={range} hoverMs={hoverMs} onHover={setHoverMs} />

          <div className="legend">
            <span><i style={{ borderColor: "var(--wind)" }} />snelheid</span>
            <span><i className="dash" style={{ borderColor: "var(--gust)" }} />vlagen</span>
            <span><span className="box" style={{ background: "rgba(26,39,51,0.09)" }} />spreiding</span>
            <span><i className="dot" style={{ borderColor: "var(--pressure)" }} />luchtdruk</span>
            {tide && <span><span className="box sea" />waterstand</span>}
            <span><i style={{ borderColor: "var(--green)" }} />goed</span>
            <span><i style={{ borderColor: "var(--amber)" }} />stevig</span>
            <span><i style={{ borderColor: "var(--magenta)" }} />nu</span>
          </div>
        </>
      )}
    </div>
  );
}
