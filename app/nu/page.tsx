"use client";
import { useState } from "react";
import { useRoute } from "@/components/route/RouteProvider";
import RouteHeader from "@/components/route/RouteHeader";
import TabBar from "@/components/route/TabBar";
import Compass from "@/components/route/Compass";
import { useForecast, useTide, useRouteStroom } from "@/components/route/hooks";
import { pointAtMs, tideNow } from "@/lib/instrument";
import { compass, beaufort } from "@/lib/format";
import { certaintyLabel, MS_HOUR } from "@/lib/route";
import { localHM } from "@/lib/tz";
import type { WeatherSeries } from "@/lib/types";

const ms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));
const OFFSETS = [
  { k: "nu", h: 0 }, { k: "+3u", h: 3 }, { k: "+6u", h: 6 }, { k: "+12u", h: 12 }, { k: "+24u", h: 24 },
];

function visAt(w: WeatherSeries | undefined, targetMs: number): number | null {
  if (!w || !w.time.length) return null;
  let bi = 0, best = Infinity;
  for (let i = 0; i < w.time.length; i++) { const d = Math.abs(ms(w.time[i]) - targetMs); if (d < best) { best = d; bi = i; } }
  return w.vis[bi] ?? null;
}

export default function NuPage() {
  const { waypoints, trip } = useRoute();
  const [wpIdx, setWpIdx] = useState(0);
  const [offIdx, setOffIdx] = useState(0);
  const wp = waypoints[Math.min(wpIdx, waypoints.length - 1)] ?? null;
  const key = wp?.location_key ?? null;

  const { data: fc, err } = useForecast(key);
  const tide = useTide(key);
  const routeKeys = waypoints.map((w) => w.location_key);
  const now = fc?.points[0] ? ms(fc.points[0].time) : Date.now();
  const stroom = useRouteStroom(routeKeys,
    fc ? new Date(now).toISOString() : null,
    fc ? new Date(now + 25 * MS_HOUR).toISOString() : null);

  const pts = fc?.points ?? [];
  const targetMs = now + OFFSETS[offIdx].h * MS_HOUR;
  const p = pts.length ? (pointAtMs(pts, targetMs) ?? pts[0]) : null;

  // stroom bij doeltijd
  const sPt = stroom?.available && stroom.series
    ? stroom.series.reduce<{ t: string; alongKn: number | null } | null>((best, s) =>
        best && Math.abs(Date.parse(best.t) - targetMs) <= Math.abs(Date.parse(s.t) - targetMs) ? best : s, null)
    : null;

  const tn = tide && p ? tideNow(tide, targetMs) : null;
  const vis = visAt(fc?.weather, targetMs);
  const spread = p ? p.band_high_kn - p.band_low_kn : 0;
  const hoursAhead = (targetMs - Date.now()) / MS_HOUR;
  const cert = certaintyLabel(spread, hoursAhead);

  return (
    <>
      <RouteHeader />
      {err ? <div className="status err">{err}</div> : !p ? (
        <div className="status load">Laden…</div>
      ) : (
        <div className="nu-body">
          <div className="chips">
            {OFFSETS.map((o, i) => (
              <button key={o.k} className={"chip" + (i === offIdx ? " on" : "")} onClick={() => setOffIdx(i)}>
                {i === 0 && <span className="live" />}{o.k}
              </button>
            ))}
          </div>

          <div className="wptabs">
            {waypoints.map((w, i) => (
              <button key={w.location_key} className={"wptab" + (i === wpIdx ? " on" : "")} onClick={() => setWpIdx(i)}>
                {i === wpIdx ? "● " : ""}{w.name}
              </button>
            ))}
          </div>

          <div className="windcard">
            <div className="head">{wp?.name} · {OFFSETS[offIdx].k === "nu" ? `nu ${localHM(targetMs)}` : `${OFFSETS[offIdx].k} · ${localHM(targetMs)}`}</div>
            <div className="row">
              <div className="rose"><Compass deg={p.dir_deg} /></div>
              <div className="read">
                <div className="big">{Math.round(p.speed_kn)}<em>kn</em></div>
                <div className="dir">{compass(p.dir_deg)} · {p.dir_deg}° · {beaufort(p.speed_kn)} bft</div>
                <div className="gustchip">
                  <span className="k">vlagen</span>
                  <span className="v">{Math.round(p.gust_kn)} kn</span>
                </div>
              </div>
            </div>
          </div>

          <div className="metrics">
            <div className="metric getij">
              <div className="k">Getij</div>
              {tn ? (
                <>
                  <div className="v">{tn.level >= 0 ? "+" : ""}{Math.round(tn.level)}<em>cm</em></div>
                  <div className="sub">{tn.rising ? "vloed" : "eb"}{tn.next ? ` · ${tn.next.kind} ${localHM(tn.next.ms)}` : ""}</div>
                </>
              ) : (<><div className="v" style={{ color: "var(--t3)" }}>—</div><div className="sub">geen getij</div></>)}
            </div>
            <div className="metric stroom">
              <div className="k">Stroom</div>
              {sPt && sPt.alongKn != null ? (
                <>
                  <div className="v">{Math.abs(sPt.alongKn).toFixed(1)}<em>kn</em></div>
                  <div className="sub">{sPt.alongKn >= 0 ? "→ mee route" : "← tegen route"}</div>
                </>
              ) : (<><div className="v" style={{ color: "var(--t3)" }}>—</div><div className="sub">geen data</div></>)}
            </div>
            <div className="metric zicht">
              <div className="k">Zicht</div>
              {vis != null ? (() => {
                const km = vis / 1000;
                const label = km >= 10 ? "goed" : km >= 4 ? "matig" : "slecht";
                return (<><div className="v">{label}</div><div className="sub">{km >= 10 ? ">10 km" : `${km.toFixed(1)} km`}</div></>);
              })() : (<><div className="v" style={{ color: "var(--t3)" }}>—</div><div className="sub">—</div></>)}
            </div>
          </div>

          <div className="certbar">
            <div className="k">Modelzekerheid {OFFSETS[offIdx].k === "nu" ? "nu" : OFFSETS[offIdx].k}</div>
            <span className={`pill ${cert}`}>{cert}</span>
          </div>

          <Sparkline points={pts} nowMs={now} targetMs={targetMs} />
        </div>
      )}
      <TabBar />
    </>
  );
}

// 24u wind-sparkline uit de echte punten. Drempel 22 kn gestippeld, nu-marker rood.
function Sparkline({ points, nowMs, targetMs }: { points: { time: string; speed_kn: number }[]; nowMs: number; targetMs: number }) {
  const W = 322, H = 56, PAD_T = 6, PAD_B = 14;
  const start = nowMs, end = nowMs + 24 * MS_HOUR;
  const inWin = points.filter((p) => ms(p.time) >= start - MS_HOUR && ms(p.time) <= end + MS_HOUR);
  if (inWin.length < 2) return null;
  const maxKn = Math.max(30, ...inWin.map((p) => p.speed_kn)) * 1.05;
  const x = (m: number) => ((m - start) / (end - start)) * W;
  const y = (kn: number) => PAD_T + (1 - kn / maxKn) * (H - PAD_T - PAD_B);
  const path = inWin.map((p, i) => `${i ? "L" : "M"}${x(ms(p.time)).toFixed(1)},${y(p.speed_kn).toFixed(1)}`).join(" ");
  const nowX = x(Math.max(start, Math.min(end, targetMs)));
  const yThresh = y(22);
  const ticks = [start, start + 6 * MS_HOUR, start + 12 * MS_HOUR, start + 18 * MS_HOUR, end];
  return (
    <div className="sparkcard">
      <div className="k">Wind · komende 24u · kn</div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ height: 56 }}>
        <line x1="0" y1={yThresh} x2={W} y2={yThresh} stroke="var(--bd)" strokeWidth="1" strokeDasharray="2 4" />
        <text x={W - 2} y={yThresh - 2} textAnchor="end" fontSize="8" fill="var(--t3)">22</text>
        <path d={`${path} L${W},${H - PAD_B} L0,${H - PAD_B} Z`} fill="var(--t1)" fillOpacity=".06" />
        <path d={path} fill="none" stroke="var(--t1)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <line x1={nowX} y1="0" x2={nowX} y2={H - PAD_B} stroke="var(--no)" strokeWidth="1.5" strokeDasharray="3 2" />
        {ticks.map((t, i) => (
          <text key={i} x={Math.max(4, Math.min(W - 4, x(t)))} y={H - 2}
                textAnchor={i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"}
                fontSize="8" fill="var(--t3)">{localHM(t).slice(0, 2)}</text>
        ))}
      </svg>
    </div>
  );
}
