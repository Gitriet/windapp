"use client";
import { useEffect, useRef, useState } from "react";
import {
  AW, AH, AMAX, T, HALF, ATLAS_LAND, CUR_COLOR,
  field, onLand, phaseLag, fmtHours, type StroomPoint,
} from "@/lib/stroom";

// Stroomatlas: scrub/play door het getij; het hele veld keert om met eb en vloed.
// Eén neutrale kleur — richting leest alleen uit de pijl. Pijllengte/-dikte schalen
// met de sterkte op vaste schaal (0–AMAX). Kentering trekt als een lijn door het
// gebied (faseverschuiving); stilvallende punten worden een vage ring (slap water).

// één stroompijl op (x,y), richting deg, sterkte speed. Geen pijl maar een vage
// ring zodra het water stilvalt.
function arrow(x: number, y: number, deg: number, speed: number, i: number) {
  if (speed < 0.09) {
    return <circle key={i} cx={x} cy={y} r={1.9} fill="none" stroke="#4a677a" strokeWidth={1} />;
  }
  const f = Math.min(1, speed / AMAX), L = 5 + f * 15, hl = 3 + f * 3, w = +(0.7 + f * 1.6).toFixed(2);
  const r = (deg * Math.PI) / 180, dx = Math.sin(r), dy = -Math.cos(r);
  const x1 = x - dx * L / 2, y1 = y - dy * L / 2, x2 = x + dx * L / 2, y2 = y + dy * L / 2;
  const b1 = ((deg + 152) * Math.PI) / 180, b2 = ((deg + 208) * Math.PI) / 180;
  const w1x = x2 + Math.sin(b1) * hl, w1y = y2 - Math.cos(b1) * hl;
  const w2x = x2 + Math.sin(b2) * hl, w2y = y2 - Math.cos(b2) * hl;
  return (
    <g key={i}>
      <line x1={x1.toFixed(1)} y1={y1.toFixed(1)} x2={x2.toFixed(1)} y2={y2.toFixed(1)}
            stroke={CUR_COLOR} strokeWidth={w} strokeLinecap="round" />
      <path d={`M${w1x.toFixed(1)} ${w1y.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)} L${w2x.toFixed(1)} ${w2y.toFixed(1)}`}
            fill="none" stroke={CUR_COLOR} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

function fieldArrows(p: StroomPoint, t: number) {
  const out: JSX.Element[] = [];
  let i = 0;
  for (let y = 14; y < AH - 10; y += 22) {
    for (let x = 14; x < AW - 8; x += 23) {
      if (p.geo === "marsdiep" && onLand(x, y)) continue;
      const tl = (((t - phaseLag(p, x)) % T) + T) % T;     // lokale fase (faseverschuiving)
      const ebbL = tl < HALF, localL = ebbL ? tl : tl - HALF;
      const sf = Math.abs(Math.sin((Math.PI * localL) / HALF));
      const fld = field(p, x, y), speed = fld.max * sf, deg = ebbL ? fld.ebbDir : fld.flood;
      out.push(arrow(x, y, deg, speed, i++));
    }
  }
  return out;
}

// klok (HW-referentie) + fase-label; nooit opkomend/afgaand-tekst
function phaseLabel(t: number): string {
  const ph = ((t % T) + T) % T, ebb = ph < HALF;
  if (ph < 0.35 || ph > T - 0.35) return "HW";
  if (Math.abs(ph - HALF) < 0.35) return "LW";
  return ebb ? `${Math.round(ph)}u na HW` : `${Math.round(T - ph)}u voor HW`;
}

export default function StroomAtlas({ p, now }: { p: StroomPoint; now: number }) {
  const [t, setT] = useState(() => (((now - p.hw) % T) + T) % T);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // reset naar 'nu' wanneer je een ander punt opent
  useEffect(() => { setT((((now - p.hw) % T) + T) % T); setPlaying(false); }, [p.key, now]);

  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => setT((v) => (v + 0.16 > T ? 0 : v + 0.16)), 90);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [playing]);

  return (
    <div className="card">
      <div className="card-h">stroomatlas — sleep door het tij</div>
      <div className="atlas-hd">
        <span className="atlas-clk"><b>{fmtHours(p.hw + t)}</b> · {phaseLabel(t)}</span>
      </div>

      <svg className="atlas-map" viewBox={`0 0 ${AW} ${AH}`} role="img" aria-label="stroomatlas">
        <rect x={0} y={0} width={AW} height={AH} fill="var(--water)" />
        {p.geo === "marsdiep" && ATLAS_LAND.map((pl, k) => (
          <path key={`l${k}`} d={`M${pl.map((pt) => pt.join(" ")).join(" L")} Z`}
                fill="var(--land)" stroke="#39434f" strokeWidth={0.8} />
        ))}
        {fieldArrows(p, t)}
      </svg>

      <div className="atlas-controls">
        <button className="atlas-play" onClick={() => setPlaying((v) => !v)}
                aria-label={playing ? "pauze" : "afspelen"}>{playing ? "❚❚" : "▶"}</button>
        <input type="range" min={0} max={T.toFixed(2)} step={0.1} value={t}
               onChange={(e) => { setPlaying(false); setT(parseFloat(e.target.value)); }} />
      </div>
      <div className="atlas-ticks">
        <span>HW {fmtHours(p.hw)}</span>
        <span>LW {fmtHours(p.hw + HALF)}</span>
        <span>HW {fmtHours(p.hw + T)}</span>
      </div>
      <div className="cur-legend">
        {p.geo === "marsdiep"
          ? "echte kustlijn · stroom trechtert door het zeegat en waaiert uit · "
          : "eigen geografie volgt per punt · "}
        kentering trekt door het gebied · voorspeld (HP33)
      </div>
    </div>
  );
}
