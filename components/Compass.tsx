"use client";
import { compass } from "@/lib/format";
import { dirColor } from "@/lib/sailing";

// Direction rose: a continuous colour ring (same hue=direction scale as the wind
// chart, via dirColor) with the eight compass labels OUTSIDE the ring — N O Z W
// large, NO ZO ZW NW small/muted. The core is empty except the pointer, which
// points to where the wind comes FROM (app-wide vane convention).
const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
const pt = (cx: number, cy: number, r: number, deg: number) =>
  [cx + r * Math.cos(rad(deg)), cy + r * Math.sin(rad(deg))] as const;

const CARD: [string, number][] = [["N", 0], ["O", 90], ["Z", 180], ["W", 270]];
const INTER: [string, number][] = [["NO", 45], ["ZO", 135], ["ZW", 225], ["NW", 315]];

export default function Compass({ deg, size = 118 }: { deg: number; size?: number }) {
  const cx = size / 2, cy = size / 2;
  const r = size * 0.356, ir = size * 0.263, lr = size * 0.432; // ring, inner, labels
  const arcs = [];
  for (let a = 0; a < 360; a += 4) {
    const [x0, y0] = pt(cx, cy, r, a), [x1, y1] = pt(cx, cy, r, a + 4);
    const [xi1, yi1] = pt(cx, cy, ir, a + 4), [xi0, yi0] = pt(cx, cy, ir, a);
    arcs.push(
      <path key={a} fill={dirColor(a)}
            d={`M${x0} ${y0} A${r} ${r} 0 0 1 ${x1} ${y1} L${xi1} ${yi1} A${ir} ${ir} 0 0 0 ${xi0} ${yi0} Z`} />,
    );
  }
  const [px, py] = pt(cx, cy, ir - 4, deg);

  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`wind uit ${compass(deg)} (${Math.round(deg)}°)`}
         style={{ width: "100%", height: "100%", display: "block", fontFamily: "var(--mono)" }}>
      {arcs}
      {CARD.map(([t, d]) => { const [x, y] = pt(cx, cy, lr, d); return (
        <text key={t} x={x} y={y + 3.9} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--text)">{t}</text>
      ); })}
      {INTER.map(([t, d]) => { const [x, y] = pt(cx, cy, lr - 1, d); return (
        <text key={t} x={x} y={y + 2.8} textAnchor="middle" fontSize={8} fontWeight={500} fill="var(--faint)">{t}</text>
      ); })}
      <line x1={cx} y1={cy} x2={px} y2={py} stroke="var(--text)" strokeWidth={2.5} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={3.2} fill="var(--text)" />
    </svg>
  );
}
