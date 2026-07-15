// Kompasroos (port van docs/instrument-prototype.html). 36 ticks (elke 10°); de tick
// die de richting aanwijst WAAR DE WIND VANDAAN KOMT licht rood op, de buren gedempt
// rood. Cardinale letters buiten, in het midden de windrichting als letters (rood,
// glow) + graden (mono, gedempt).
import { compass } from "@/lib/format";

const CARD: [string, number][] = [
  ["N", 0], ["NO", 45], ["O", 90], ["ZO", 135], ["Z", 180], ["ZW", 225], ["W", 270], ["NW", 315],
];

export default function Kompas({ deg }: { deg: number }) {
  const cx = 100, cy = 100;
  const windDir = ((deg % 360) + 360) % 360;
  const ticks: JSX.Element[] = [];
  for (let a = 0; a < 360; a += 10) {
    const principal = a % 45 === 0;
    const dd = Math.abs(((a - windDir + 540) % 360) - 180);
    const lit = dd <= 5, near = dd <= 15;
    const rad = ((a - 90) * Math.PI) / 180, rOut = 90, rIn = principal ? 76 : 83;
    const x1 = cx + rOut * Math.cos(rad), y1 = cy + rOut * Math.sin(rad);
    const x2 = cx + (lit ? 70 : rIn) * Math.cos(rad), y2 = cy + (lit ? 70 : rIn) * Math.sin(rad);
    ticks.push(
      <line key={a} x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={lit ? "var(--led)" : near ? "#7a2b1f" : "#41525A"}
            strokeWidth={lit ? 3.4 : principal ? 2.4 : 1.4} strokeLinecap="round"
            style={lit ? { filter: "drop-shadow(0 0 4px rgba(255,46,27,.8))" } : undefined} />,
    );
  }
  return (
    <svg viewBox="0 0 200 200" role="img" aria-label={`wind uit ${compass(deg)} (${Math.round(windDir)}°)`}
         style={{ display: "block", width: "100%", height: "auto" }}>
      <circle cx={cx} cy={cy} r={94} fill="none" stroke="var(--hair)" strokeWidth={1} />
      {ticks}
      {CARD.map(([txt, a]) => {
        const principal = a % 90 === 0, rad = ((a - 90) * Math.PI) / 180, r = 58;
        return (
          <text key={txt} x={cx + r * Math.cos(rad)} y={cy + r * Math.sin(rad) + (principal ? 6 : 5)}
                textAnchor="middle" fill={principal ? "#E7EDEF" : "var(--label-dim)"}
                fontFamily="var(--cond)" fontWeight={600} fontSize={principal ? 18 : 13}
                letterSpacing=".08em">{txt}</text>
        );
      })}
      <text x={cx} y={cy - 3} textAnchor="middle" fill="var(--led)" fontFamily="var(--cond)"
            fontWeight={700} fontSize={22} letterSpacing=".06em"
            style={{ filter: "drop-shadow(0 0 6px rgba(255,46,27,.5))" }}>{compass(deg)}</text>
      <text x={cx} y={cy + 16} textAnchor="middle" fill="var(--label-dim)" fontFamily="var(--mono)"
            fontSize={12}>{Math.round(windDir)}°</text>
    </svg>
  );
}
