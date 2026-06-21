"use client";
import type { CorrectedPoint } from "@/lib/types";
import { fmtTime, compass } from "@/lib/format";

// Inline SVG: corrected speed line, model-spread band, gusts (dashed), with
// lead (day1/2/3) segments shaded so growing uncertainty is visible.
export default function WindChart({ points }: { points: CorrectedPoint[] }) {
  if (!points.length) return <p className="muted">Geen data.</p>;

  const W = 760, H = 320, padL = 40, padR = 16, padT = 16, padB = 40;
  const iw = W - padL - padR, ih = H - padT - padB;

  const maxY = Math.max(10, ...points.map((p) => Math.max(p.gust_kn || 0, p.band_high_kn))) * 1.1;
  const x = (i: number) => padL + (i / Math.max(1, points.length - 1)) * iw;
  const y = (v: number) => padT + ih - (v / maxY) * ih;

  const speedPath = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.speed_kn)}`).join(" ");
  const gustPath = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.gust_kn)}`).join(" ");
  const bandPath =
    points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.band_high_kn)}`).join(" ") +
    " " + points.slice().reverse().map((p, j) => {
      const i = points.length - 1 - j;
      return `L${x(i)},${y(p.band_low_kn)}`;
    }).join(" ") + " Z";

  // lead segment boundaries
  const segs: { from: number; to: number; lead: number }[] = [];
  points.forEach((p, i) => {
    const last = segs[segs.length - 1];
    if (last && last.lead === p.lead) last.to = i;
    else segs.push({ from: i, to: i, lead: p.lead });
  });

  const yticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxY * f));
  const tickEvery = Math.ceil(points.length / 6);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="windvoorspelling">
      {segs.map((s, k) => (
        <g key={k}>
          <rect x={x(s.from)} y={padT} width={Math.max(0, x(s.to) - x(s.from))} height={ih}
                fill={s.lead === 1 ? "transparent" : s.lead === 2 ? "#ffffff08" : "#ffffff12"} />
          <text x={(x(s.from) + x(s.to)) / 2} y={padT + 12} className="seg">day{s.lead}</text>
        </g>
      ))}
      {yticks.map((v, k) => (
        <g key={k}>
          <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} className="grid" />
          <text x={padL - 6} y={y(v) + 3} className="ytick">{v}</text>
        </g>
      ))}
      <path d={bandPath} className="band" />
      <path d={gustPath} className="gust" />
      <path d={speedPath} className="speed" />
      {points.map((p, i) =>
        i % tickEvery === 0 ? (
          <g key={i}>
            <text x={x(i)} y={H - padB + 14} className="xtick">{fmtTime(p.time)}</text>
            <text x={x(i)} y={padT + 26} className="arrow">{compass(p.dir_deg)}</text>
          </g>
        ) : null,
      )}
      <text x={padL} y={H - 6} className="legend">
        ● gecorrigeerde wind (kn) · ┄ vlagen · vlak = modelspreiding
      </text>
    </svg>
  );
}
