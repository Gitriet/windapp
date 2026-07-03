"use client";
import { compass } from "@/lib/format";

// Redesign direction rose (docs/redesign-prototype.html): a thin --rule ring with
// a tick every 15° — longer/thicker on N O Z W — cardinals in ink (Barlow), and a
// magenta needle running THROUGH the centre with an open paper ring at the hub. The
// long side points to where the wind comes FROM (app-wide vane convention).
const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
const on = (c: number, r: number, deg: number) => [c + r * Math.cos(rad(deg)), c + r * Math.sin(rad(deg))] as const;
const CARD: [string, number][] = [["N", 0], ["O", 90], ["Z", 180], ["W", 270]];

export default function Compass({ deg }: { deg: number; size?: number }) {
  const c = 60, r = 54;                                   // viewBox is 120×120
  const ticks = [];
  for (let d = 0; d < 360; d += 15) {
    const card = d % 90 === 0;
    const [x1, y1] = on(c, card ? r - 11 : r - 6, d), [x2, y2] = on(c, r - 0.5, d);
    ticks.push(
      <line key={d} x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={card ? "var(--ink)" : "var(--ink-3)"} strokeWidth={card ? 1.9 : 1.1} opacity={card ? 0.85 : 0.5} />,
    );
  }
  const [nx, ny] = on(c, r - 12, deg);                    // needle tip (FROM, long side)
  const [tx, ty] = on(c, 10, deg + 180);                  // short stub, opposite

  return (
    <svg viewBox="0 0 120 120" role="img" aria-label={`wind uit ${compass(deg)} (${Math.round(deg)}°)`}
         style={{ width: "100%", height: "100%", display: "block" }}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--rule)" strokeWidth={1} />
      {ticks}
      {CARD.map(([t, d]) => { const [x, y] = on(c, r - 22, d); return (
        <text key={t} x={x} y={y + 4} textAnchor="middle" fontFamily="var(--body)" fontSize={12} fontWeight={600} fill="var(--ink)">{t}</text>
      ); })}
      <line x1={tx} y1={ty} x2={nx} y2={ny} stroke="var(--magenta)" strokeWidth={2.8} strokeLinecap="round" />
      <circle cx={nx} cy={ny} r={3.2} fill="var(--magenta)" />
      <circle cx={c} cy={c} r={4.5} fill="var(--paper)" stroke="var(--magenta)" strokeWidth={2} />
    </svg>
  );
}
