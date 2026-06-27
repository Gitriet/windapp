"use client";
import { currentAt, fmtHours, CUR_COLOR, type StroomPoint } from "@/lib/stroom";

// Verloop: stroomsterkte (kn) over de tijd, met nu-lijn en kentering-markers
// (slap water) met tijd. Eén neutrale lijnkleur — geen kleur=richting. Voorspeld
// (HP33). 1-op-1 geport uit stroom-mockup (flowChart).
const W = 358, H = 160, padL = 26, padB = 22, padT = 14;
const gw = W - padL - 8, gh = H - padB - padT;

export default function StroomFlow({ p, now }: { p: StroomPoint; now: number }) {
  const t0 = now - 2, t1 = now + 10;
  const x = (t: number) => padL + ((t - t0) / (t1 - t0)) * gw;
  const y = (v: number) => padT + gh - (v / p.max) * gh;

  // curve + kentering-detectie (dip naar ~0)
  const n = 80;
  const seg: JSX.Element[] = [];
  const slacks: number[] = [];
  let prev: { x: number; y: number; sp: number } | null = null;
  for (let i = 0; i < n; i++) {
    const t = t0 + (i / (n - 1)) * (t1 - t0);
    const c = currentAt(p, t);
    const px = x(t), py = y(c.speed);
    if (prev) {
      seg.push(<line key={`s${i}`} x1={prev.x.toFixed(1)} y1={prev.y.toFixed(1)} x2={px.toFixed(1)} y2={py.toFixed(1)}
                     stroke={CUR_COLOR} strokeWidth={2.4} strokeLinecap="round" />);
      if (c.speed < 0.12 && prev.sp >= 0.12) slacks.push(t);
    }
    prev = { x: px, y: py, sp: c.speed };
  }

  const grid = [1, 2].filter((v) => v <= p.max);

  return (
    <div className="card">
      <div className="card-h">verloop — knopen over tijd</div>
      <svg className="cflow" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="stroomsterkte over tijd">
        {grid.map((v) => (
          <g key={`g${v}`}>
            <line x1={padL} y1={y(v)} x2={W - 4} y2={y(v)} stroke="#19212b" />
            <text x={padL - 5} y={y(v) + 3} textAnchor="end" className="cflow-t">{v}</text>
          </g>
        ))}
        <text x={padL - 5} y={y(0) + 3} textAnchor="end" className="cflow-t">kn</text>

        {seg}

        {slacks.map((t, k) => (
          <g key={`k${k}`}>
            <circle cx={x(t)} cy={y(0)} r={3} fill="var(--muted)" />
            <text x={x(t)} y={y(0) + 14} textAnchor="middle" className="cflow-t">{fmtHours(t)}</text>
          </g>
        ))}

        <line x1={x(now)} y1={padT} x2={x(now)} y2={padT + gh} stroke="var(--accent)"
              strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />
        <text x={x(now)} y={padT - 3} textAnchor="middle" className="cflow-now">nu</text>
      </svg>
      <div className="cur-legend">stippen = kentering (slap water) · piek = max stroom · voorspeld (HP33)</div>
    </div>
  );
}
