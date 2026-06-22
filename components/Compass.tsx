"use client";
import { compass } from "@/lib/format";
import { dirColor } from "@/lib/sailing";

// The definitive compass (from the mockup). The outer ring is a continuous cyclic
// colour wheel — each bearing carries the same hue the band and vanes use for that
// direction, so the compass doubles as the colour legend. The dark inner face keeps
// it readable; the windvane arrow takes the current wind direction's colour (with a
// thin dark edge so it stays legible against the ring) and points to the SOURCE.
// dirColor uses a fixed 60% lightness, so no hue ever drops out / goes too faint.
const rad = (d: number) => (d * Math.PI) / 180;
const pt = (cx: number, cy: number, r: number, deg: number) =>
  [cx + r * Math.sin(rad(deg)), cy - r * Math.cos(rad(deg))] as const;

export default function Compass({ deg, size = 98 }: { deg: number; size?: number }) {
  const cx = size / 2, cy = size / 2, R = size / 2 - 2, col = dirColor(deg), rim = R - 1, step = 6;

  const arcs = Array.from({ length: 360 / step }, (_, k) => k * step).map((a) => {
    const [x1, y1] = pt(cx, cy, rim, a - 0.5);
    const [x2, y2] = pt(cx, cy, rim, a + step + 0.5);
    return { d: `M ${x1} ${y1} A ${rim} ${rim} 0 0 1 ${x2} ${y2}`, c: dirColor(a) };
  });
  const ticks = Array.from({ length: 12 }, (_, k) => k * 30).map((a) => {
    const m = a % 90 === 0;
    const [x1, y1] = pt(cx, cy, R - 4, a);
    const [x2, y2] = pt(cx, cy, R - 4 - (m ? 7 : 4), a);
    return { x1, y1, x2, y2, c: m ? "#3a4d5c" : "#243440", w: m ? 1.4 : 1 };
  });
  const labels: [string, number][] = [["N", 0], ["O", 90], ["Z", 180], ["W", 270]];
  const [tx, ty] = pt(cx, cy, R - 13, deg);
  const [blx, bly] = pt(cx, cy, 6, deg + 150);
  const [brx, bry] = pt(cx, cy, 6, deg - 150);
  const [tlx, tly] = pt(cx, cy, R - 15, deg + 180);

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img"
         style={{ flexShrink: 0, fontFamily: "var(--mono)" }}
         aria-label={`windrichting uit ${compass(deg)} (${Math.round(deg)} graden)`}>
      {arcs.map((a, i) => (
        <path key={i} d={a.d} fill="none" stroke={a.c} strokeWidth={3} strokeLinecap="butt" opacity={0.9} />
      ))}
      <circle cx={cx} cy={cy} r={R - 3} fill="#0d141b" stroke="#1d2c38" strokeWidth={1} />
      {ticks.map((t, i) => (
        <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={t.c} strokeWidth={t.w} />
      ))}
      {labels.map(([l, a]) => {
        const [lx, ly] = pt(cx, cy, R - 17, a);
        return (
          <text key={l} x={lx} y={ly + 4} textAnchor="middle" fontSize={11}
                fill={a === 0 ? "#a9bccb" : "#6b8190"} fontWeight={a === 0 ? 700 : 400}>{l}</text>
        );
      })}
      <line x1={cx} y1={cy} x2={tlx} y2={tly} stroke="#2c4150" strokeWidth={2} />
      <polygon points={`${tx},${ty} ${blx},${bly} ${cx},${cy} ${brx},${bry}`} fill={col} stroke="#0a1116" strokeWidth={0.6} />
      <circle cx={cx} cy={cy} r={2.6} fill="#16232e" stroke={col} strokeWidth={1} />
      <text x={cx} y={cy + R * 0.45} textAnchor="middle" fontSize={12} fill="#e9f1f6" fontWeight={700}>{compass(deg)}</text>
    </svg>
  );
}
