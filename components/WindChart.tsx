"use client";
import type { CorrectedPoint } from "@/lib/types";
import { fmtTimeNL } from "@/lib/tz";
import { dirColor } from "@/lib/sailing";
import { AXIS, xFor, hourTicks, dayBands } from "@/lib/chartaxis";

// One combined block on the shared time axis: a vane row on top, then the speed
// curve, then the axis. Height = speed (kn); the curve is COLOURED per hour by
// wind direction (hue = degrees, same dirColor as the rose), so where the tint
// shifts you see the wind veer/back. Gusts = dashed orange, spread = grey band.
// No separate direction ribbon — direction lives in the line colour + vanes.
const rad = (deg: number) => (deg * Math.PI) / 180;
const pt = (cx: number, cy: number, r: number, deg: number) =>
  [cx + r * Math.sin(rad(deg)), cy - r * Math.cos(rad(deg))] as const;
const ms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));

export default function WindChart(
  { points, t0, endMs, range }:
  { points: CorrectedPoint[]; t0: number; endMs: number; range: number },
) {
  const pts = points.filter((p) => { const m = ms(p.time); return m >= t0 - 1 && m <= endMs + 1000; });
  if (!pts.length) return <p className="muted">Geen data.</p>;
  const n = pts.length;
  const { W, PADL, PADR } = AXIS;
  const vaneY = 15, plotT = 34, plotH = 150, plotB = plotT + plotH;
  const axisY = plotB + 6, H = axisY + 18;
  const x = (p: CorrectedPoint) => xFor(ms(p.time), t0, endMs);
  const maxY = Math.max(10, ...pts.map((p) => Math.max(p.gust_kn || 0, p.band_high_kn))) * 1.1;
  const y = (v: number) => plotT + plotH - (v / maxY) * plotH;

  const gustPath = pts.map((p, i) => `${i ? "L" : "M"}${x(p)},${y(p.gust_kn)}`).join(" ");
  const bandPath =
    pts.map((p, i) => `${i ? "L" : "M"}${x(p)},${y(p.band_high_kn)}`).join(" ") + " " +
    pts.slice().reverse().map((p) => `L${x(p)},${y(p.band_low_kn)}`).join(" ") + " Z";

  const yticks: number[] = [];
  for (let v = 10; v < maxY; v += 10) yticks.push(v);
  const bands = dayBands(t0, endMs);
  const ticks = hourTicks(t0, endMs, range);
  const multi = range > 1;
  const vaneStep = Math.max(1, Math.round(n / 8));   // ~8 vanes across the window

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img"
         aria-label="windvoorspelling — snelheid in kn, kleur = richting">
      {/* day separators (multi-day only) */}
      {multi && bands.bounds.map((b, k) => (
        <line key={`db${k}`} x1={xFor(b, t0, endMs)} y1={vaneY + 5} x2={xFor(b, t0, endMs)} y2={plotB} stroke="#222c38" />
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
      {/* speed line — one segment per hour, coloured by direction */}
      {pts.slice(0, n - 1).map((p, i) => (
        <line key={`s${i}`} x1={x(p)} y1={y(p.speed_kn)} x2={x(pts[i + 1])} y2={y(pts[i + 1].speed_kn)}
              stroke={dirColor(p.dir_deg)} strokeWidth={2.8} strokeLinecap="round" />
      ))}
      {/* vanes on top — pointing to where the wind comes FROM */}
      {pts.map((p, i) => {
        if (i % vaneStep !== 0) return null;
        const col = dirColor(p.dir_deg);
        const [tx, ty] = pt(x(p), vaneY, 10, p.dir_deg);
        const [bx, by] = pt(x(p), vaneY, 10, p.dir_deg + 180);
        const [l1x, l1y] = pt(tx, ty, 5, p.dir_deg + 150);
        const [l2x, l2y] = pt(tx, ty, 5, p.dir_deg - 150);
        return (
          <g key={`v${i}`}>
            <line x1={bx} y1={by} x2={tx} y2={ty} stroke={col} strokeWidth={2.2} />
            <polygon points={`${tx},${ty} ${l1x},${l1y} ${l2x},${l2y}`} fill={col} />
          </g>
        );
      })}
      {/* axis: hour ticks in 1d, day names in 3d */}
      {!multi && ticks.map((tk, k) => (
        <g key={`h${k}`}>
          <line x1={xFor(tk.ms, t0, endMs)} y1={axisY} x2={xFor(tk.ms, t0, endMs)} y2={axisY + (tk.label ? 5 : 3)} stroke="#33485a" />
          {tk.label && <text x={xFor(tk.ms, t0, endMs)} y={axisY + 14} className="xtick">{tk.label}</text>}
        </g>
      ))}
      {multi && bands.segs.map((s, k) => (
        <text key={`dl${k}`} x={xFor(s.mid, t0, endMs)} y={axisY + 12} className="xtick">{k === 0 ? "nu" : s.label}</text>
      ))}
      <title>{`${fmtTimeNL(pts[0].time)} – ${fmtTimeNL(pts[n - 1].time)}`}</title>
    </svg>
  );
}
