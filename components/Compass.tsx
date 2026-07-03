"use client";
import { compass } from "@/lib/format";

// v4 direction rose: a thin --rule ring with a degree tick every 10° (cardinals
// emphasised), N O Z W condensed labels, and a magenta needle with a counterweight
// tail + a paper centre cap. The needle points to where the wind comes FROM
// (app-wide vane convention).
const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
const on = (c: number, r: number, deg: number) => [c + r * Math.cos(rad(deg)), c + r * Math.sin(rad(deg))] as const;
const CARD: [string, number][] = [["N", 0], ["O", 90], ["Z", 180], ["W", 270]];

export default function Compass({ deg, size = 112 }: { deg: number; size?: number }) {
  const c = 60, r = 52;                                   // viewBox is 120×120
  const ticks = [];
  for (let d = 0; d < 360; d += 10) {
    const card = d % 90 === 0, mid = d % 30 === 0;
    const r1 = card ? r - 11 : mid ? r - 8 : r - 4.5;
    const [x1, y1] = on(c, r1, d), [x2, y2] = on(c, r - 0.5, d);
    ticks.push(
      <line key={d} x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={card ? "var(--ink)" : "var(--ink-3)"} strokeWidth={card ? 1.8 : mid ? 1.2 : 0.8} />,
    );
  }
  const [nx, ny] = on(c, r - 13, deg);                    // needle tip (FROM)
  const [tx, ty] = on(c, 14, deg + 180);                  // counterweight tail

  return (
    <svg viewBox="0 0 120 120" role="img" aria-label={`wind uit ${compass(deg)} (${Math.round(deg)}°)`}
         style={{ width: "100%", height: "100%", display: "block" }}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--rule)" strokeWidth={1} />
      {ticks}
      {CARD.map(([t, d]) => { const [x, y] = on(c, r - 21, d); return (
        <text key={t} x={x} y={y + 4} textAnchor="middle" fontFamily="var(--cond)" fontSize={13} fontWeight={600} fill="var(--ink)">{t}</text>
      ); })}
      <line x1={tx} y1={ty} x2={nx} y2={ny} stroke="var(--magenta)" strokeWidth={3.5} strokeLinecap="round" />
      <circle cx={nx} cy={ny} r={4} fill="var(--magenta)" />
      <circle cx={c} cy={c} r={4.5} fill="var(--paper)" stroke="var(--ink)" strokeWidth={2} />
    </svg>
  );
}
