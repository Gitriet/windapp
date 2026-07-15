// 7-daagse strip (port van docs/instrument-prototype.html): per dag de weekdag, een
// weerglyph, de dagtemp (prominent) en de windsnelheid in knopen.
import Glyph from "./Glyph";
import type { Glyph as GlyphType } from "@/lib/instrument";

export type WeekCol = { day: string; glyph: GlyphType; t: number | null; k: number | null };

export default function WeekStrip({ days }: { days: WeekCol[] }) {
  return (
    <div className="week">
      {days.map((d, i) => (
        <div key={i} className="wd">
          <div className="day">{d.day}</div>
          <div><Glyph type={d.glyph} /></div>
          <div className="t">{d.t != null ? `${d.t}°` : "—"}</div>
          <div className="k">{d.k != null ? d.k : "—"}<span style={{ fontSize: 9 }}>kn</span></div>
        </div>
      ))}
    </div>
  );
}
