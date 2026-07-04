"use client";
import { useEffect, useState } from "react";
import Meteogram from "@/components/Meteogram";
import Compass from "@/components/Compass";
import LocationPicker from "@/components/LocationPicker";
import Nav from "@/components/Nav";
import { ktsToBft, compass } from "@/lib/format";
import { fmtTimeNL, localHM, localWeekdayShort, dayMidnights } from "@/lib/tz";
import { wxLabel } from "@/lib/weather";
import { stroomForLocation } from "@/lib/stroom";
import { BORROWED_WIND } from "@/lib/borrowed";
import type { Location, CorrectedPoint, TideData, TidePoint, WeatherSeries } from "@/lib/types";

const DAY_MS = 24 * 3600 * 1000;
const ms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));
const msT = (iso: string) => Date.parse(iso);

// pressure tendency over the next ~3h: arrow + the change in hPa
function pressInfo(pressure: (number | null)[], i: number): { arrow: string; d: number } | null {
  const a = pressure[i], b = pressure[Math.min(i + 3, pressure.length - 1)];
  if (a == null || b == null) return null;
  const d = b - a;
  return { arrow: d > 0.6 ? "↗" : d < -0.6 ? "↘" : "→", d };
}

function levelAt(series: TidePoint[], m: number): number {
  if (!series.length) return 0;
  if (m <= msT(series[0].t)) return series[0].v;
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1], b = series[i], ta = msT(a.t), tb = msT(b.t);
    if (m >= ta && m <= tb) { const f = (m - ta) / Math.max(1, tb - ta); return a.v + f * (b.v - a.v); }
  }
  return series[series.length - 1].v;
}

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
      const initial = l.find((x) => x.location_key === sp.get("loc")) ?? l[0];
      if (initial) setKey(initial.location_key);
    }).catch((e) => setErr(String(e)));
  }, []);

  useEffect(() => {
    if (!key) return;
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
  const heroIsPeak = !startsNow;
  const heroMs = hero ? ms(hero.time) : firstMs;

  const heroWxIdx = wx && hero ? wx.time.findIndex((t) => ms(t) === heroMs) : -1;
  const wxHero = wx && wx.code.length && heroWxIdx >= 0
    ? { temp: wx.temp[heroWxIdx], label: wxLabel(wx.code[heroWxIdx]),
        pressure: wx.pressure[heroWxIdx], press: pressInfo(wx.pressure, heroWxIdx) }
    : null;

  const tideHero = (() => {
    if (!tide || tide.unavailable) return null;
    const series = tide.expected.length ? tide.expected : tide.astro;
    if (!series.length) return null;
    const cur = levelAt(series, heroMs), ahead = levelAt(series, heroMs + 30 * 60000);
    const nextHW = tide.extremes.find((e) => e.kind === "HW" && msT(e.t) > heroMs);
    return { cur, rising: ahead >= cur, nextHW };
  })();

  const dayStats = dayStarts.map((s, i) => {
    const cnt = pts.filter((p) => { const m = ms(p.time); return m >= s && m < s + DAY_MS; }).length;
    return { i, n: cnt, label: i === 0 ? "nu" : localWeekdayShort(s) };
  }).filter((d) => d.n > 0).slice(0, 4);

  const pickRange = (d: number) => { setRange(d); if (d !== 1) setDayIndex(0); };
  const pickDay = (d: number) => { setRange(1); setDayIndex(Math.min(Math.max(0, d), maxDay)); };
  const modelInfo = hero ? `${hero.model_label} · ${heroIsPeak ? `piek ${localWeekdayShort(t0)} ${localHM(heroMs)}` : fmtTimeNL(hero.time)}` : "";

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
              <div className="dir"><b>{compass(hero.dir_deg)} · {hero.dir_deg}°</b> &nbsp;·&nbsp; {ktsToBft(hero.speed_kn)} bft</div>
            </div>
            <div className="rest">
              {tideHero && (
                <div className="item">
                  <div className="k">Getij</div>
                  <div className="v">{tideHero.cur >= 0 ? "+" : ""}{Math.round(tideHero.cur)}<small> cm</small></div>
                  <div className="s"><b>{tideHero.rising ? "vloed" : "eb"}</b>{tideHero.nextHW && ` · HW ${localHM(msT(tideHero.nextHW.t))}`}</div>
                </div>
              )}
              {wxHero && wxHero.pressure != null && (
                <div className="item">
                  <div className="k">Luchtdruk</div>
                  <div className="v">{Math.round(wxHero.pressure)}<small> hPa</small></div>
                  {wxHero.press && (
                    <div className={"s" + (wxHero.press.d > 0.6 ? " up" : wxHero.press.d < -0.6 ? " down" : "")}>
                      {wxHero.press.arrow} {wxHero.press.d >= 0 ? "+" : ""}{wxHero.press.d.toFixed(1)} / 3 u
                    </div>
                  )}
                </div>
              )}
              {wxHero && (
                <div className="item">
                  <div className="k">Weer</div>
                  <div className="v">{wxHero.temp != null ? Math.round(wxHero.temp) : "–"}<small> °C</small></div>
                  <div className="s">{wxHero.label}</div>
                </div>
              )}
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
          </div>

          <Meteogram points={data.points} weather={wx} tide={tide} stream={streamPt}
                     t0={t0} endMs={endMs} range={range} hoverMs={hoverMs} onHover={setHoverMs} />

          <div className="legend">
            <span><i style={{ borderColor: "var(--wind)" }} />snelheid</span>
            <span><i className="dash" style={{ borderColor: "var(--gust)" }} />vlagen</span>
            <span><span className="box" style={{ background: "rgba(26,39,51,0.09)" }} />spreiding</span>
            <span><i className="dot" style={{ borderColor: "var(--pressure)" }} />luchtdruk</span>
            {tide && <span><span className="box sea" />waterstand</span>}
            <span><i style={{ borderColor: "var(--green)" }} />vaarbaar</span>
            <span><i style={{ borderColor: "var(--amber)" }} />krap</span>
            <span><i style={{ borderColor: "var(--magenta)" }} />nu</span>
            <span className="model">{modelInfo}</span>
            <details>
              <summary>uitleg</summary>
              <p><b>Luchtdruk &amp; wind.</b> Wind ontstaat door verschillen in luchtdruk:
              lucht stroomt van hoge- naar lagedruk, en hoe scherper dat verschil, hoe harder
              het waait. Een dalende druk kondigt vaak een naderend lagedrukgebied met
              toenemende, buiiger wind aan; een stijgende druk wijst meestal op rustiger,
              stabieler weer. Het lint op de horizon beoordeelt de vaarbaarheid op de vlagen.</p>
            </details>
          </div>
        </>
      )}
    </div>
  );
}
