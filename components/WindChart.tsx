"use client";
import type { CorrectedPoint } from "@/lib/types";
import { fmtTimeNL, localHM, localWeekdayShort } from "@/lib/tz";
import { compass } from "@/lib/format";
import { dirColor } from "@/lib/sailing";
import { AXIS, xFor, msForClientX, hourTicks, dayBands } from "@/lib/chartaxis";
import { WINDBAR_RED_KN } from "@/lib/constants";
import { sunEvents, isNight } from "@/lib/weather";
import { useChartWidth } from "./useChartWidth";

// One combined block on the shared time axis: a vane row on top, then the speed
// curve, then the axis. Height = speed (kn); the curve is a plain white line.
// Gusts = dashed orange, spread = grey band. Direction is read from the vanes on
// top (hue = degrees, same dirColor as the rose), not from the speed line.
const rad = (deg: number) => (deg * Math.PI) / 180;
const pt = (cx: number, cy: number, r: number, deg: number) =>
  [cx + r * Math.sin(rad(deg)), cy - r * Math.cos(rad(deg))] as const;
const ms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));

export default function WindChart(
  { points, t0, endMs, range, hoverMs, onHover, sun }:
  { points: CorrectedPoint[]; t0: number; endMs: number; range: number;
    hoverMs: number | null; onHover: (ms: number | null) => void;
    sun?: { sunrise: string[]; sunset: string[] } },
) {
  const [wrapRef, W] = useChartWidth<HTMLDivElement>();
  const pts = points.filter((p) => { const m = ms(p.time); return m >= t0 - 1 && m <= endMs + 1000; });
  if (!pts.length) return <p className="muted">Geen data.</p>;
  const n = pts.length;
  const { PADL, PADR } = AXIS;
  const vaneY = 15, plotT = 34, plotH = 150, plotB = plotT + plotH;
  const axisY = plotB + 6;
  const stripTop = axisY + 20, stripH = 6, H = stripTop + stripH + 2;
  const xf = (m: number) => xFor(m, t0, endMs, W);
  const x = (p: CorrectedPoint) => xf(ms(p.time));
  const maxY = Math.max(10, ...pts.map((p) => Math.max(p.gust_kn || 0, p.band_high_kn))) * 1.1;
  const y = (v: number) => plotT + plotH - (v / maxY) * plotH;

  const gustPath = pts.map((p, i) => `${i ? "L" : "M"}${x(p)},${y(p.gust_kn)}`).join(" ");
  const bandPath =
    pts.map((p, i) => `${i ? "L" : "M"}${x(p)},${y(p.band_high_kn)}`).join(" ") + " " +
    pts.slice().reverse().map((p) => `L${x(p)},${y(p.band_low_kn)}`).join(" ") + " Z";

  const yticks: number[] = [];
  for (let v = 10; v < maxY; v += 10) yticks.push(v);
  const bands = dayBands(t0, endMs);
  const ticks = hourTicks(t0, endMs, range, W);
  const multi = range > 1;
  const vaneStep = Math.max(1, Math.round(n / 8));   // ~8 vanes across the window

  // sun: faint night-shading spans + a marker at each sunrise/sunset in the window
  const sunEv = sun ? sunEvents(sun.sunrise, sun.sunset) : [];
  const sunMarks = sunEv
    .filter((e) => e.ms > t0 && e.ms < endMs)
    .map((e) => ({ x: xf(e.ms), rise: e.rise, ms: e.ms }));
  const nightSegs: [number, number][] = [];
  if (sunEv.length) {
    let cur = t0, night = isNight(t0, sunEv);
    for (const e of sunEv) {
      if (e.ms <= t0 || e.ms >= endMs) continue;
      if (night) nightSegs.push([cur, e.ms]);
      cur = e.ms; night = !e.rise;          // after sunset → night, after sunrise → day
    }
    if (night) nightSegs.push([cur, endMs]);
  }

  // shared hover: a crosshair at the hovered instant + a readout of the nearest hour
  const showHover = hoverMs != null && hoverMs >= t0 && hoverMs <= endMs;
  const hx = showHover ? xf(hoverMs!) : 0;
  let hp: CorrectedPoint | null = null;
  if (showHover) {
    let best = Infinity;
    for (const p of pts) { const d = Math.abs(ms(p.time) - hoverMs!); if (d < best) { best = d; hp = p; } }
  }
  const tipPct = Math.max(15, Math.min(85, (hx / W) * 100));
  const onMove = (e: { clientX: number; currentTarget: Element }) =>
    onHover(msForClientX(e.clientX, e.currentTarget.getBoundingClientRect(), t0, endMs, W));
  const clearHover = () => onHover(null);

  return (
    <div className="chartwrap" ref={wrapRef} onPointerMove={onMove} onPointerDown={onMove}
         onPointerLeave={clearHover} onPointerCancel={clearHover}>
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img"
         aria-label="windvoorspelling — snelheid in kn; richting in de vanen">
      {/* night shading — faint cool band over the hours between sunset and sunrise */}
      {nightSegs.map(([a, b], k) => (
        <rect key={`ns${k}`} x={xf(a)} y={plotT} width={Math.max(0, xf(b) - xf(a))}
              height={plotH} fill="#16243a" opacity={0.45} />
      ))}
      {/* day separators (multi-day only) */}
      {multi && bands.bounds.map((b, k) => (
        <line key={`db${k}`} x1={xf(b)} y1={vaneY + 5} x2={xf(b)} y2={plotB} stroke="#222c38" />
      ))}
      {/* kn grid, full width */}
      {yticks.map((v, k) => (
        <g key={`y${k}`}>
          <line x1={PADL} x2={W - PADR} y1={y(v)} y2={y(v)} className="grid" />
          <text x={PADL - 6} y={y(v) + 3} className="ytick">{v}</text>
        </g>
      ))}
      <path d={bandPath} className="band" />
      <path d={gustPath} className="gust" />
      {/* speed line — plain white; direction is read from the vanes on top */}
      <path d={pts.map((p, i) => `${i ? "L" : "M"}${x(p)},${y(p.speed_kn)}`).join(" ")}
            fill="none" stroke="var(--text)" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" />

      {/* vanes on top — pointing to where the wind comes FROM */}
      {pts.map((p, i) => {
        if (i % vaneStep !== 0) return null;
        const col = dirColor(p.dir_deg);
        const [tx, ty] = pt(x(p), vaneY, 11, p.dir_deg);          // tip sticks out a touch further
        const [bx, by] = pt(x(p), vaneY, 10, p.dir_deg + 180);
        const [l1x, l1y] = pt(tx, ty, 8, p.dir_deg + 158);        // longer + narrower head → pointier
        const [l2x, l2y] = pt(tx, ty, 8, p.dir_deg - 158);
        return (
          <g key={`v${i}`}>
            <line x1={bx} y1={by} x2={tx} y2={ty} stroke={col} strokeWidth={2.2} strokeLinecap="round" />
            <polygon points={`${tx},${ty} ${l1x},${l1y} ${l2x},${l2y}`} fill={col} stroke={col} strokeWidth={0.8} strokeLinejoin="round" />
          </g>
        );
      })}
      {/* axis: hour ticks in 1d, day names in 3d */}
      {!multi && ticks.map((tk, k) => (
        <g key={`h${k}`}>
          <line x1={xf(tk.ms)} y1={axisY} x2={xf(tk.ms)} y2={axisY + (tk.label ? 5 : 3)} stroke="#33485a" />
          {tk.label && <text x={xf(tk.ms)} y={axisY + 14} className="xtick">{tk.label}</text>}
        </g>
      ))}
      {multi && bands.segs.map((s, k) => (
        <text key={`dl${k}`} x={xf(s.mid)} y={axisY + 12} className="xtick">{k === 0 ? "nu" : s.label}</text>
      ))}
      {/* hard-wind strip under the axis: green, red where sustained wind ≥ threshold */}
      {pts.slice(0, n - 1).map((p, i) => (
        <rect key={`hw${i}`} x={x(p)} y={stripTop} width={Math.max(0, x(pts[i + 1]) - x(p))} height={stripH}
              fill={p.speed_kn >= WINDBAR_RED_KN ? "var(--hw)" : "var(--good)"} />
      ))}
      {/* sunrise (↑) / sunset (↓) markers + local time, on the shared axis */}
      {sunMarks.map((s, k) => (
        <g key={`sm${k}`}>
          <line x1={s.x} y1={plotT} x2={s.x} y2={plotB} stroke="#e2a857" strokeWidth={1} strokeDasharray="2 3" opacity={0.45} />
          {/* time only on a single day — across 3 days the labels would collide
              (the night shading still marks day/night there) */}
          {!multi && (
            <text x={s.x} y={plotT - 3} fill="#e2a857" fontSize={9.5} textAnchor="middle" opacity={0.95}>
              {(s.rise ? "↑" : "↓") + " " + localHM(s.ms)}
            </text>
          )}
        </g>
      ))}
      {showHover && <line className="crossline" x1={hx} y1={vaneY} x2={hx} y2={plotB} />}
      <title>{`${fmtTimeNL(pts[0].time)} – ${fmtTimeNL(pts[n - 1].time)}`}</title>
    </svg>
    {showHover && hp && (
      <div className="tip" style={{ left: `${tipPct}%` }}>
        <b>{localWeekdayShort(hoverMs!)} {localHM(hoverMs!)}</b>
        <span>{hp.speed_kn} kn · {compass(hp.dir_deg)} {hp.dir_deg}°</span>
        <span>vlaag {Math.round(hp.gust_kn)} kn</span>
      </div>
    )}
    </div>
  );
}
