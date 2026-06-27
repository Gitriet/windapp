"use client";
import { useEffect, useState } from "react";
import WindChart from "@/components/WindChart";
import TideChart from "@/components/TideChart";
import WeatherStrip from "@/components/WeatherStrip";
import WeatherIcon from "@/components/WeatherIcon";
import Compass from "@/components/Compass";
import LocationPicker from "@/components/LocationPicker";
import Nav from "@/components/Nav";
import { ktsToBft, compass } from "@/lib/format";
import { fmtTimeNL, localHM, localDayLabel, localWeekdayShort, dayMidnights } from "@/lib/tz";
import { wxGroup, wxLabel } from "@/lib/weather";
import { circMeanDeg, dirColor } from "@/lib/sailing";
import type { Location, CorrectedPoint, TideData, WeatherSeries } from "@/lib/types";

const DAY_MS = 24 * 3600 * 1000;
const ms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));
const hhmm = (iso: string) => localHM(Date.parse(iso));

export default function Home() {
  const [locs, setLocs] = useState<Location[]>([]);
  const [key, setKey] = useState("");
  const [range, setRange] = useState(3);
  // day-index = which day the window starts on; decoupled from range. The day
  // tabs drive both: 3d → range 3 / day 0, a day tab → range 1 / that day.
  const [dayIndex, setDayIndex] = useState(0);
  const [data, setData] = useState<{ location: Location; points: CorrectedPoint[]; weather: WeatherSeries } | null>(null);
  const [tide, setTide] = useState<TideData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    // deep-link from the 7-day tab: ?day=&range= zooms onto a specific day
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

  // keep the location in the URL so the 7-day tab inherits it on switch.
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
  const wx = data?.weather;
  const isLand = !!data && /land/i.test(data.location.area);

  // available days = forecast start (now), then each local midnight up to the
  // horizon; the window starts at the chosen day and spans `range` days.
  const pts = data?.points ?? [];
  const firstMs = pts.length ? ms(pts[0].time) : 0;
  const lastMs = pts.length ? ms(pts[pts.length - 1].time) : 0;
  const dayStarts = pts.length ? [firstMs, ...dayMidnights(firstMs, lastMs)] : [0];
  const maxDay = dayStarts.length - 1;
  const di = Math.min(Math.max(0, dayIndex), maxDay);
  const t0 = dayStarts[di];
  const endMs = t0 + range * DAY_MS;
  const isRange = range > 1;

  // the hero moves with the selected tab. When the window starts now (the "nu"
  // tab and the 3d overview), it shows the live reading. For a future day-tab
  // there is no "now", so it shows that day's PEAK — the max-speed hour — with
  // direction, bft, weather and time all taken from that hour.
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
  const wxHero = wx && wx.code.length
    ? { group: wxGroup(wx.code[heroIdx]), temp: wx.temp[heroIdx], cloud: wx.cloud[heroIdx], label: wxLabel(wx.code[heroIdx]) }
    : null;

  // per-day stats for the day tabs (avg kn + a direction colour swatch)
  const dayStats = dayStarts.map((s, i) => {
    const ps = pts.filter((p) => { const m = ms(p.time); return m >= s && m < s + DAY_MS; });
    return {
      i, n: ps.length, label: i === 0 ? "nu" : localWeekdayShort(s),
      avgKn: ps.length ? Math.round(ps.reduce((a, p) => a + p.speed_kn, 0) / ps.length) : 0,
      avgDeg: ps.length ? circMeanDeg(ps.map((p) => p.dir_deg)) : 0,
    };
  }).filter((d) => d.n > 0).slice(0, 4);

  const pickRange = (d: number) => { setRange(d); if (d !== 1) setDayIndex(0); };
  const pickDay = (d: number) => { setRange(1); setDayIndex(Math.min(Math.max(0, d), maxDay)); };

  const nextTide = tide
    ? (["HW", "LW"] as const).map((k) => tide.extremes.find((e) => e.kind === k && Date.parse(e.t) >= Date.now()))
        .filter(Boolean).sort((a, b) => Date.parse(a!.t) - Date.parse(b!.t))
    : [];

  const dayRangeLabel = isRange
    ? `nu – ${dayStats[dayStats.length - 1]?.label ?? ""} · 3 dagen`
    : di === 0 ? "vandaag" : localDayLabel(t0);

  return (
    <>
      <header className="top">
        <h1>Windvoorspelling</h1>
        <Nav active="punt" locKey={key} />
      </header>

      <LocationPicker locations={locs} value={key} onChange={setKey} />

      {err && <div className="panel"><span className="badge warn">fout</span> <span className="muted">{err}</span></div>}
      {loading && <div className="panel muted">Laden…</div>}

      {now && data && (
        <>
          {/* HERO: rose + numbers → weather → badges. Nothing in between. */}
          <div className="hero">
            <div className="hero-row">
              <div className="rose-wrap"><Compass deg={hero.dir_deg} /></div>
              <div className="hero-data">
                <div className="hero-kn"><b>{hero.speed_kn}</b><span>kn</span></div>
                <div className="hero-meta">
                  <b>{compass(hero.dir_deg)}</b> {hero.dir_deg}° · {ktsToBft(hero.speed_kn)} bft
                </div>
                {wxHero && (
                  <div className="hero-weather">
                    <WeatherIcon group={wxHero.group} size={17} className="wxicon" />
                    {wxHero.temp != null && <span className="wxtemp">{Math.round(wxHero.temp)}°</span>}
                    <span>{wxHero.label}</span>
                    {wxHero.cloud != null && <span className="wxcloud">· {wxHero.cloud}% bewolking</span>}
                  </div>
                )}
              </div>
            </div>

            <div className="badge-row">
              {isLand && (
                <span className="badge land" title="wind aan de wal — niet representatief voor open water">landstation</span>
              )}
              <span className="badge">{hero.model_label}</span>
              <span className={"badge" + (hero.corrected ? " ok" : "")}>
                {hero.corrected ? "gecorrigeerd" : "ongecorrigeerd"}
              </span>
              {/* live timestamp for "nu"; the peak hour (labelled) for a future day */}
              <span className="badge">
                {heroIsPeak ? `piek ${localWeekdayShort(t0)} ${localHM(ms(hero.time))}` : fmtTimeNL(hero.time)}
              </span>
            </div>
          </div>

          {/* DAY TABS — replace the 1d/2d/3d toggle */}
          <div className="daysec">
            <div className="section-label">Kies een dag</div>
            <div className="daytabs" role="tablist" aria-label="Dag of overzicht">
              <button role="tab" aria-selected={isRange} onClick={() => pickRange(3)}
                      className={"daytab range" + (isRange ? " on" : "")}>
                <span className="dd muted">3d</span>
                <span className="dv">overzicht</span>
                <span className="swatch wide" />
              </button>
              {dayStats.map((d) => (
                <button role="tab" key={d.i} aria-selected={!isRange && di === d.i}
                        onClick={() => pickDay(d.i)}
                        className={"daytab" + (!isRange && di === d.i ? " on" : "")}>
                  <span className={"dd" + (d.i === 0 ? "" : " muted")}>{d.label}</span>
                  <span className="dv">{d.avgKn} kn</span>
                  <span className="swatch" style={{ background: dirColor(d.avgDeg) }} />
                </button>
              ))}
            </div>
          </div>

          {/* WIND */}
          <div className="card">
            <div className="card-head">
              <span className="ct">Wind — {data.location.name}</span>
              <span className="cr">{dayRangeLabel}</span>
            </div>
            <WindChart points={data.points} t0={t0} endMs={endMs} range={range} />
            <div className="glegend">
              <span><i className="sw grad" />snelheid</span>
              <span><i className="sw" style={{ background: "var(--gust)" }} />vlagen</span>
              <span><i className="sw" style={{ background: "var(--spread)" }} />spreiding</span>
            </div>
          </div>

          {/* WEATHER STRIP — sky only (no wind) + a temperature wave, shared axis */}
          {wx && wx.time.length > 0 && (
            <WeatherStrip weather={wx} t0={t0} endMs={endMs} range={range} />
          )}

          {/* TIDE */}
          {tide && (
            <div className="card">
              <div className="card-head">
                <span className="ct">Getij — {tide.name}</span>
                <span className="cr">cm NAP</span>
              </div>
              {tide.unavailable ? (
                <p className="tide-note">Getij tijdelijk niet beschikbaar — bron RWS onbereikbaar. Probeer het later opnieuw.</p>
              ) : (
                <>
                  <div className="tide-strip">
                    {nextTide.map((e) => (
                      <div className={"ev " + e!.kind.toLowerCase()} key={e!.kind}>
                        <span className="pin" />
                        {e!.kind === "HW" ? "Hoogwater" : "Laagwater"} {hhmm(e!.t)} <small>· {Math.round(e!.v)} cm</small>
                      </div>
                    ))}
                  </div>
                  <TideChart data={tide} t0={t0} endMs={endMs} range={range} />
                  <div className="glegend">
                    {!tide.expectedMissing && <span><i className="sw" style={{ background: "var(--tide)" }} />verwacht</span>}
                    <span><i className="sw" style={{ background: "var(--tide2)" }} />astronomisch</span>
                  </div>
                  {(tide.expectedMissing || tide.astroStale) && (
                    <p className="tide-note">
                      {tide.expectedMissing
                        ? "Alleen astronomisch getij — verwachting (incl. windopzet) tijdelijk niet beschikbaar."
                        : "Verwachting incl. windopzet."}
                      {tide.astroStale && " Astronomisch: laatst bekende (bron RWS onbereikbaar)."}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
