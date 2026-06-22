"use client";
import type { CorrectedPoint } from "@/lib/types";
import { fmtTime, compass } from "@/lib/format";
import { dirColor, relAngle, sail } from "@/lib/sailing";

// Speed line + spread band + gusts (top), a row of wind vanes pointing toward
// the SOURCE coloured by the cyclic direction hue, and a bottom band over the
// same axis: direction hue (no course) or sailability (course set). Vanes always
// show the real wind direction. Three equal day sections to 72h.
const rad = (deg: number) => (deg * Math.PI) / 180;
const pt = (cx: number, cy: number, r: number, deg: number) =>
  [cx + r * Math.sin(rad(deg)), cy - r * Math.cos(rad(deg))] as const;

export default function WindChart({ points, course }: { points: CorrectedPoint[]; course: number | null }) {
  if (!points.length) return <p className="muted">Geen data.</p>;
  const n = points.length;
  const W = 760, ml = 40, mr = 26, plotT = 22, plotH = 176;
  const plotB = plotT + plotH, vaneY = plotB + 22, bandT = plotB + 36, bandH = 16;
  const H = bandT + bandH + 22;
  const iw = W - ml - mr;
  const x = (i: number) => ml + (i / Math.max(1, n - 1)) * iw;
  const maxY = Math.max(10, ...points.map((p) => Math.max(p.gust_kn || 0, p.band_high_kn))) * 1.1;
  const y = (v: number) => plotT + plotH - (v / maxY) * (plotH - 12);

  const speedPath = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.speed_kn)}`).join(" ");
  const gustPath = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.gust_kn)}`).join(" ");
  const bandPath =
    points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.band_high_kn)}`).join(" ") + " " +
    points.slice().reverse().map((p, j) => `L${x(n - 1 - j)},${y(p.band_low_kn)}`).join(" ") + " Z";

  const segs: { from: number; to: number; lead: number }[] = [];
  points.forEach((p, i) => {
    const last = segs[segs.length - 1];
    if (last && last.lead === p.lead) last.to = i;
    else segs.push({ from: i, to: i, lead: p.lead });
  });

  const yticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxY * f));
  const tickEvery = Math.ceil(n / 6);

  const bandLabel = (p: CorrectedPoint) =>
    course === null ? compass(p.dir_deg) : sail(relAngle(p.dir_deg, course)).label.split(" ")[0];
  const bandColor = (p: CorrectedPoint) =>
    course === null ? dirColor(p.dir_deg) : sail(relAngle(p.dir_deg, course)).color;

  // label each colour change, but skip labels too close together so rapid
  // oscillations near a boundary don't pile into unreadable text (colours stay).
  const transitions: { i: number; lbl: string }[] = [];
  let last = "", lastX = -Infinity;
  points.forEach((p, i) => {
    const lbl = bandLabel(p);
    if (i === 0 || lbl !== last) {
      if (i === 0 || x(i) - lastX >= 48) { transitions.push({ i, lbl }); lastX = x(i); }
      last = lbl;
    }
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="windvoorspelling">
      {segs.map((s, k) => (
        <g key={k}>
          <rect x={x(s.from)} y={plotT} width={Math.max(0, x(s.to) - x(s.from))} height={plotH}
                fill={s.lead === 1 ? "transparent" : s.lead === 2 ? "#ffffff08" : "#ffffff12"} />
          <text x={(x(s.from) + x(s.to)) / 2} y={14} className="seg">day{s.lead}</text>
        </g>
      ))}
      {yticks.map((v, k) => (
        <g key={k}>
          <line x1={ml} x2={W - mr} y1={y(v)} y2={y(v)} className="grid" />
          <text x={ml - 6} y={y(v) + 3} className="ytick">{v}</text>
        </g>
      ))}
      <path d={bandPath} className="band" />
      <path d={gustPath} className="gust" />
      <path d={speedPath} className="speed" />

      {/* wind vanes — always real wind direction, pointing to the source */}
      {points.map((p, i) => {
        if (i % 3 !== 0) return null;
        const col = dirColor(p.dir_deg);
        const [tx, ty] = pt(x(i), vaneY, 7, p.dir_deg);
        const [bx, by] = pt(x(i), vaneY, 7, p.dir_deg + 180);
        const [l1x, l1y] = pt(tx, ty, 3.5, p.dir_deg + 150);
        const [l2x, l2y] = pt(tx, ty, 3.5, p.dir_deg - 150);
        return (
          <g key={`v${i}`}>
            <line x1={bx} y1={by} x2={tx} y2={ty} stroke={col} strokeWidth={1.5} />
            <polygon points={`${tx},${ty} ${l1x},${l1y} ${l2x},${l2y}`} fill={col} />
          </g>
        );
      })}

      {/* bottom band: direction hue, or sailability when a course is set */}
      {points.slice(0, n - 1).map((p, i) => (
        <rect key={`b${i}`} x={x(i)} y={bandT} width={x(i + 1) - x(i) + 0.6} height={bandH} fill={bandColor(p)} />
      ))}
      {transitions.map((tr, k) => (
        <g key={`t${k}`}>
          {tr.i > 0 && <line x1={x(tr.i)} y1={bandT} x2={x(tr.i)} y2={bandT + bandH} stroke="#0a1116" />}
          <text x={x(tr.i) + 3} y={bandT + 12} fontSize="9" fontWeight={700} fill="#0a1116">{tr.lbl}</text>
        </g>
      ))}

      {points.map((p, i) =>
        i % tickEvery === 0 || i === n - 1 ? (
          <text key={`x${i}`} x={x(i)} y={H - 5} className="xtick">{fmtTime(p.time)}</text>
        ) : null,
      )}
    </svg>
  );
}
