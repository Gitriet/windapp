// Getijdagverloop (port van docs/instrument-prototype.html): de HW/LW-kentermomenten
// van de komende ~24 uur. Per kolom: type (HW/LW), een verticale watermarker op de
// relatieve hoogte, en de tijd. Leeg bij stations zonder getij.
import type { TideEvent } from "@/lib/instrument";
import { localHM } from "@/lib/tz";

// map een hoogte v binnen [lo,hi] naar y in de 3..26 SVG-ruimte (hoog = boven).
// Kortere span dan voorheen (was 4..40) zodat de rij compacter is; de HW/LW-
// undulatie blijft ~23 eenheden en dus leesbaar.
const TOP = 3, BOT = 26;
function mapY(v: number, lo: number, hi: number): number {
  const f = hi - lo < 1 ? 0.5 : (v - lo) / (hi - lo);
  return BOT - f * (BOT - TOP);
}

export default function GetijStrip({ events, lo, hi }: { events: TideEvent[]; lo: number; hi: number }) {
  if (!events.length) {
    return <div className="week getij"><div className="wd empty">geen getij</div></div>;
  }
  return (
    <div className="week getij">
      {events.map((e, i) => {
        const y = mapY(e.v, lo, hi);
        return (
          <div key={i} className="wd">
            <div className="day">{e.kind}</div>
            <div>
              <svg viewBox="0 0 24 28" style={{ width: 14, height: 24 }} aria-hidden="true">
                <line x1={12} y1={TOP} x2={12} y2={BOT} stroke="var(--water-dim)" strokeWidth={2} strokeLinecap="round" />
                <line x1={12} y1={y} x2={12} y2={BOT} stroke="var(--water)" strokeWidth={4} strokeLinecap="round" />
                <circle cx={12} cy={y} r={3} fill="var(--water-lit)"
                        style={{ filter: "drop-shadow(0 0 3px rgba(63,144,173,.7))" }} />
              </svg>
            </div>
            <div className="k">{localHM(e.ms)}</div>
          </div>
        );
      })}
    </div>
  );
}
