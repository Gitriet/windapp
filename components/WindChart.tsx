"use client";
import type { CorrectedPoint } from "@/lib/types";
import { compass } from "@/lib/format";
import { fmtTimeNL } from "@/lib/tz";
import { dirColor } from "@/lib/sailing";
import { AXIS, xFor, hourTicks, dayBands } from "@/lib/chartaxis";

// Speed line + spread band + gusts (top), a row of wind vanes pointing toward
// the SOURCE coloured by the cyclic direction hue, and a bottom band over the
// same axis showing wind direction. x is mapped by TIME over the shared
// [t0, endMs] window so it lines up with the tide chart; the window length
// follows the 1/2/3-day range switch. A subtle lead tint marks day1/2/3;
// calendar day labels + an hour axis come from the shared axis module.
const rad = (deg: number) => (deg * Math.PI) / 180;
const pt = (cx: number, cy: number, r: number, deg: number) =>
  [cx + r * Math.sin(rad(deg)), cy - r * Math.cos(rad(deg))] as const;
const ms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));

export default function WindChart(
  { points, t0, endMs, range, startDay = 0, onPickDay }:
  { points: CorrectedPoint[]; t0: number; endMs: number; range: number;
    startDay?: number; onPickDay?: (day: number) => void },
) {
  const pts = points.filter((p) => { const m = ms(p.time); return m >= t0 - 1 && m <= endMs + 1000; });
  if (!pts.length) return <p className="muted">Geen data.</p>;
  const n = pts.length;
  const { W, PADL } = AXIS;
  const plotT = 22, plotH = 176, plotB = plotT + plotH;
  const vaneY = plotB + 22, bandT = plotB + 36, bandH = 16;
  const axisY = bandT + bandH + 4, H = axisY + 18;
  const x = (p: CorrectedPoint) => xFor(ms(p.time), t0, endMs);
  const maxY = Math.max(10, ...pts.map((p) => Math.max(p.gust_kn || 0, p.band_high_kn))) * 1.1;
  const y = (v: number) => plotT + plotH - (v / maxY) * (plotH - 12);

  const speedPath = pts.map((p, i) => `${i ? "L" : "M"}${x(p)},${y(p.speed_kn)}`).join(" ");
  const gustPath = pts.map((p, i) => `${i ? "L" : "M"}${x(p)},${y(p.gust_kn)}`).join(" ");
  const bandPath =
    pts.map((p, i) => `${i ? "L" : "M"}${x(p)},${y(p.band_high_kn)}`).join(" ") + " " +
    pts.slice().reverse().map((p) => `L${x(p)},${y(p.band_low_kn)}`).join(" ") + " Z";

  // subtle lead tint (day1/2/3) — informative background, not labelled here
  const segs: { from: CorrectedPoint; to: CorrectedPoint; lead: number }[] = [];
  pts.forEach((p) => {
    const last = segs[segs.length - 1];
    if (last && last.lead === p.lead) last.to = p;
    else segs.push({ from: p, to: p, lead: p.lead });
  });

  const yticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxY * f));
  const bands = dayBands(t0, endMs);
  const ticks = hourTicks(t0, endMs, range);

  const bandLabel = (p: CorrectedPoint) => compass(p.dir_deg);
  const bandColor = (p: CorrectedPoint) => dirColor(p.dir_deg);

  // label each colour change, but skip labels too close together so rapid
  // oscillations near a boundary don't pile into unreadable text (colours stay).
  const transitions: { x: number; lbl: string }[] = [];
  let last = "", lastX = -Infinity;
  pts.forEach((p, i) => {
    const lbl = bandLabel(p);
    if (i === 0 || lbl !== last) {
      if (i === 0 || x(p) - lastX >= 48) { transitions.push({ x: x(p), lbl }); lastX = x(p); }
      last = lbl;
    }
  });

  const vaneEvery = Math.max(1, Math.round((n / (endMs - t0)) * 3 * 3600000)); // ~every 3h

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="windvoorspelling">
      {segs.map((s, k) => (
        <rect key={`s${k}`} x={x(s.from)} y={plotT} width={Math.max(0, x(s.to) - x(s.from))} height={plotH}
              fill={s.lead === 1 ? "transparent" : s.lead === 2 ? "#ffffff08" : "#ffffff12"} />
      ))}
      {/* calendar day labels + midnight separators (shared with the tide chart) */}
      {bands.bounds.map((b, k) => (
        <line key={`db${k}`} x1={xFor(b, t0, endMs)} y1={plotT} x2={xFor(b, t0, endMs)} y2={bandT + bandH} stroke="#1b2a36" />
      ))}
      {bands.segs.map((s, k) => {
        // in multi-day views the day label zooms to 1d of that day (deel 1)
        const clk = range > 1 && !!onPickDay;
        return (
          <text key={`dl${k}`} x={xFor(s.mid, t0, endMs)} y={13}
                className={"seg" + (clk ? " clk" : "")}
                onClick={clk ? () => onPickDay!(startDay + k) : undefined}>{s.label}</text>
        );
      })}
      {yticks.map((v, k) => (
        <g key={`y${k}`}>
          <line x1={PADL} x2={W - AXIS.PADR} y1={y(v)} y2={y(v)} className="grid" />
          <text x={PADL - 6} y={y(v) + 3} className="ytick">{v}</text>
        </g>
      ))}
      <path d={bandPath} className="band" />
      <path d={gustPath} className="gust" />
      <path d={speedPath} className="speed" />

      {/* wind vanes — always real wind direction, pointing to the source */}
      {pts.map((p, i) => {
        if (i % vaneEvery !== 0) return null;
        const col = dirColor(p.dir_deg);
        const [tx, ty] = pt(x(p), vaneY, 7, p.dir_deg);
        const [bx, by] = pt(x(p), vaneY, 7, p.dir_deg + 180);
        const [l1x, l1y] = pt(tx, ty, 3.5, p.dir_deg + 150);
        const [l2x, l2y] = pt(tx, ty, 3.5, p.dir_deg - 150);
        return (
          <g key={`v${i}`}>
            <line x1={bx} y1={by} x2={tx} y2={ty} stroke={col} strokeWidth={1.5} />
            <polygon points={`${tx},${ty} ${l1x},${l1y} ${l2x},${l2y}`} fill={col} />
          </g>
        );
      })}

      {/* bottom band: wind direction hue */}
      {pts.slice(0, n - 1).map((p, i) => (
        <rect key={`b${i}`} x={x(p)} y={bandT} width={x(pts[i + 1]) - x(p) + 0.6} height={bandH} fill={bandColor(p)} />
      ))}
      {transitions.map((tr, k) => (
        <g key={`t${k}`}>
          {tr.x > PADL + 0.5 && <line x1={tr.x} y1={bandT} x2={tr.x} y2={bandT + bandH} stroke="#0a1116" />}
          <text x={tr.x + 3} y={bandT + 12} fontSize="9" fontWeight={700} fill="#0a1116">{tr.lbl}</text>
        </g>
      ))}

      {/* shared hour axis */}
      {ticks.map((tk, k) => (
        <g key={`h${k}`}>
          <line x1={xFor(tk.ms, t0, endMs)} y1={axisY} x2={xFor(tk.ms, t0, endMs)} y2={axisY + (tk.label ? 5 : 3)} stroke="#33485a" />
          {tk.label && <text x={xFor(tk.ms, t0, endMs)} y={axisY + 15} className="xtick">{tk.label}</text>}
        </g>
      ))}
      <title>{`${fmtTimeNL(pts[0].time)} – ${fmtTimeNL(pts[n - 1].time)}`}</title>
    </svg>
  );
}
