// Weerglyph in vier categorieën (port van docs/instrument-prototype.html: glyph()).
// zon / zon-wolk / wolk / regen. Gedempte lijn (--label-dim); regendruppels in water.
import type { Glyph as GlyphType } from "@/lib/instrument";

const COL = "var(--label-dim)";

export default function Glyph({ type, scale = 1 }: { type: GlyphType; scale?: number }) {
  const els: JSX.Element[] = [];
  let ki = 0;
  const sun = (x: number, y: number, r: number) => {
    els.push(<circle key={ki++} cx={x} cy={y} r={r} fill="none" stroke={COL} strokeWidth={1.5} />);
    for (let k = 0; k < 8; k++) {
      const a = (k * 45 * Math.PI) / 180;
      els.push(<line key={ki++} x1={x + (r + 2) * Math.cos(a)} y1={y + (r + 2) * Math.sin(a)}
                     x2={x + (r + 4) * Math.cos(a)} y2={y + (r + 4) * Math.sin(a)}
                     stroke={COL} strokeWidth={1.3} strokeLinecap="round" />);
    }
  };
  const cloud = (x: number, y: number) => {
    els.push(<path key={ki++} d={`M${x - 8},${y + 3} a5,5 0 0 1 3,-9 a6,6 0 0 1 11,2 a4.5,4.5 0 0 1 -1,7 Z`}
                   fill="none" stroke={COL} strokeWidth={1.5} strokeLinejoin="round" />);
  };
  if (type === "sun") sun(16, 12, 5);
  else if (type === "cloud") cloud(16, 11);
  else if (type === "suncloud") { sun(11, 9, 4); cloud(19, 13); }
  else if (type === "rain") {
    cloud(16, 8);
    for (const x of [11, 16, 21]) {
      els.push(<line key={ki++} x1={x} y1={17} x2={x - 1.5} y2={22} stroke="var(--water)" strokeWidth={1.4} strokeLinecap="round" />);
    }
  }
  return (
    <svg viewBox="0 0 32 24" style={{ width: 26 * scale, height: 20 * scale }} aria-hidden="true">{els}</svg>
  );
}
