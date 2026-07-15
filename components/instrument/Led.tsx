// 7-segment LED-getal als SVG (port van docs/instrument-prototype.html: segPath + led).
// Rood opgelicht segment (--led) met glow, gedoofd segment (--led-dim). Geen
// fontafhankelijkheid — puur paden.
import { useId } from "react";

const SEG: Record<string, string> = {
  "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc",
  "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcdfg", "-": "g", " ": "",
};

const TH = 8, L = 14, R = 86, T = 16, M = 90, B = 164;
const H = (cy: number) => `M${L},${cy} l${TH},-${TH} L${R - TH},${cy - TH} L${R},${cy} L${R - TH},${cy + TH} L${L + TH},${cy + TH} Z`;
const V = (cx: number, y1: number, y2: number) => `M${cx},${y1} l${TH},${TH} L${cx + TH},${y2 - TH} L${cx},${y2} L${cx - TH},${y2 - TH} L${cx - TH},${y1 + TH} Z`;
const segPath = (id: string): string => (
  { a: H(T), g: H(M), d: H(B), f: V(L, T + 4, M - 4), b: V(R, T + 4, M - 4), e: V(L, M + 4, B - 4), c: V(R, M + 4, B - 4) } as Record<string, string>
)[id];

const DH = 180, DW = 100, ADV = 118, DOTW = 42;

export default function Led({ value, height = 30 }: { value: string; height?: number }) {
  const filterId = `ledglow-${useId().replace(/:/g, "")}`;
  const glow = { filter: `url(#${filterId})` };
  let x = 0;
  const parts: JSX.Element[] = [];
  let ki = 0;
  for (const ch of value) {
    if (ch === ".") {
      parts.push(<circle key={ki++} cx={x + 16} cy={DH - 14} r={12} className="lon" style={glow} />);
      x += DOTW; continue;
    }
    const segs = SEG[ch] ?? "";
    for (const s of "abcdefg") {
      const on = segs.includes(s);
      parts.push(
        <path key={ki++} d={segPath(s)} className={on ? "lon" : "loff"} style={on ? glow : undefined} transform={`translate(${x},0)`} />,
      );
    }
    x += ADV;
  }
  const w = x - (value.endsWith(".") ? DOTW : ADV) + DW;
  return (
    <svg viewBox={`0 0 ${w} ${DH}`} style={{ height, width: "auto", overflow: "visible" }} aria-hidden="true">
      <defs>
        <filter id={filterId} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {parts}
    </svg>
  );
}
