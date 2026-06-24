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
import { fmtTimeNL, localHM, localDayLabel, dayMidnights } from "@/lib/tz";
import { wxGroup, wxLabel } from "@/lib/weather";
import type { Location, CorrectedPoint, TideData, WeatherSeries } from "@/lib/types";

const DAY_MS = 24 * 3600 * 1000;
const hhmm = (iso: string) => localHM(Date.parse(iso + (iso.endsWith("Z") ? "" : "Z")));

export default function Home() {
  const [locs, setLocs] = useState<Location[]>([]);
  const [key, setKey] = useState("");
  const [range, setRange] = useState(3);
  // day-index = which day the window starts on (deel 1); decoupled from range.
  // only navigable on 1d; multi-day is always the overview from now (index 0).
  const [dayIndex, setDayIndex] = useState(0);
  const [data, setData] = useState<{ location: Location; points: CorrectedPoint[]; weather: WeatherSeries } | null>(null);
  const [tide, setTide] = useState<TideData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    // deep-link from the 7-day tab: ?day=&range= zooms onto a specific day
    const r = Number(sp.get("range"));
    if (r === 1 || r === 2 || r === 3) setRange(r);
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
  const wxNow = wx && wx.code.length
    ? { group: wxGroup(wx.code[0]), temp: wx.temp[0], cloud: wx.cloud[0], label: wxLabel(wx.code[0]) }
    : null;
  // available days = forecast start (now), then each local midnight up to the
  // horizon; the window starts at the chosen day and spans `range` days.
  const pts = data?.points ?? [];
  const firstMs = pts.length ? Date.parse(pts[0].time + "Z") : 0;
  const lastMs = pts.length ? Date.parse(pts[pts.length - 1].time + "Z") : 0;
  const dayStarts = pts.length ? [firstMs, ...dayMidnights(firstMs, lastMs)] : [0];
  const maxDay = dayStarts.length - 1;
  const di = Math.min(Math.max(0, dayIndex), maxDay);
  const t0 = dayStarts[di];
  const endMs = t0 + range * DAY_MS;

  const pickRange = (d: number) => { setRange(d); if (d !== 1) setDayIndex(0); };
  const pickDay = (d: number) => { setRange(1); setDayIndex(Math.min(Math.max(0, d), maxDay)); };
  const nextTide = tide
    ? ["HW", "LW"].map((k) => tide.extremes.find((e) => e.kind === k && Date.parse(e.t) >= Date.now()))
        .filter(Boolean).sort((a, b) => Date.parse(a!.t) - Date.parse(b!.t))
    : [];

  return (
    <>
      <header className="top">
        <h1>Windvoorspelling</h1>
        <Nav active="punt" locKey={key} />
      </header>

      <div className="panel">
        <div className="flbl">Gekalibreerde locatie</div>
        <LocationPicker locations={locs} value={key} onChange={setKey} />
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
                {wxNow && (
                  <div className="wxnow">
                    <WeatherIcon group={wxNow.group} size={20} className="wxicon" />
                    {wxNow.temp != null && <span className="wxtemp">{Math.round(wxNow.temp)}°</span>}
                    <span className="wxlab">{wxNow.label}</span>
                    {wxNow.cloud != null && <span className="wxcloud">{wxNow.cloud}% bewolking</span>}
                  </div>
                )}
              </div>
            </div>
            <div className="tags">
              <span className="tag">model: {now.model_label}</span>
              <span className={"tag" + (now.corrected ? " corr" : "")}>
                {now.corrected ? "gecorrigeerd" : "ongecorrigeerd"}
              </span>
              <span className="tag">{fmtTimeNL(now.time)}</span>
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
                            onClick={() => pickRange(d)}>{d}d</button>
                  ))}
                </div>
              </div>
            </div>
            <div className={"srow" + (range !== 1 ? " off" : "")}>
              <div className="step" role="group" aria-label="Dag kiezen">
                <button className="sbtn" aria-label="Vorige dag"
                        disabled={range !== 1 || di === 0} onClick={() => setDayIndex(di - 1)}>‹</button>
                <span className="sdate">{di === 0 ? "vandaag" : localDayLabel(t0)}</span>
                <button className="sbtn" aria-label="Volgende dag"
                        disabled={range !== 1 || di >= maxDay} onClick={() => setDayIndex(di + 1)}>›</button>
              </div>
            </div>
            <WeatherStrip weather={data.weather} t0={t0} endMs={endMs} range={range} />
            <WindChart points={data.points} t0={t0} endMs={endMs} range={range}
                       startDay={di} onPickDay={pickDay} />
            <div className="legend">
              <div className="lgi"><span className="lgsw" style={{ background: "var(--accent)" }} />snelheid</div>
              <div className="lgi"><span className="lgsw" style={{ background: "var(--gust)" }} />vlagen</div>
              <div className="lgi"><span className="lgsw" style={{ background: "var(--spread)" }} />spreiding</div>
            </div>
            <div className="note">
              onderste band = windrichting · vaantjes wijzen naar waar de wind vandaan komt
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
                rechtstreeks uit RWS, zonder correctie · tijden in Nederlandse tijd
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
