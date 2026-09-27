"use client";
// NU — live conditie op één haven (deel van WEER & GETIJ), geen advies: kompaskaart,
// chips, windregel en komende 12 uur (staven). Dagverwachting en HW/LW staan in de
// dagblokken van WeerGetijScreen. Alleen presentatie.
import { beaufort, bftLabel, dirLabel16 } from "@/lib/format";
import { verdict } from "@/lib/verdict";
import type { ForecastResponse } from "@/lib/planner-data";
import { WindArrow } from "./icons";
import s from "./NuScreen.module.css";

const komma = (n: number) => n.toFixed(1).replace(".", ",");

// Contextzin uit de forecast: trend ~6u vooruit + draaiing + bron (meting/model).
function windContext(pts: ForecastResponse["points"]): string {
  const p0 = pts[0];
  const t = pts[Math.min(6, pts.length - 1)];
  const d = t.speed_kn - p0.speed_kn;
  const trend = d > 2 ? `bouwt op naar ${Math.round(t.speed_kn)}\u00A0kn`
    : d < -2 ? `neemt af naar ${Math.round(t.speed_kn)}\u00A0kn`
    : "vrij constant";
  const turn = Math.abs(((t.dir_deg - p0.dir_deg + 540) % 360) - 180);
  const draai = turn >= 25 ? `draait naar ${dirLabel16(t.dir_deg)}` : `blijft ${dirLabel16(p0.dir_deg)}`;
  const bron = p0.corrected ? "meting" : "model";
  const zin = `${trend}, ${draai} · ${bron}`;
  return zin.charAt(0).toUpperCase() + zin.slice(1);
}

export interface NuScreenProps {
  fc: ForecastResponse;
  naam: string;
  voet?: React.ReactNode;   // extra regel onderin de kompaskaart (dagweer van de gekozen dag)
}

export default function NuScreen({ fc, naam, voet }: NuScreenProps) {
  const pts = fc.points;
  if (!pts.length) return (
    <div className={s.leeg}>—<div className={s.reden}>geen voorspelling beschikbaar voor {naam}</div></div>
  );
  const p0 = pts[0];
  const bft = beaufort(p0.speed_kn);
  const temp0 = fc.weather?.temp?.[0] ?? null;
  const wave0 = fc.weather?.wave?.[0] ?? null;

  return (
    <>
      <div className={`card ${s.kompasKaart}`}>
        <Kompas dir={p0.dir_deg} />
        <div>
          <div className={s.kern}>{Math.round(p0.speed_kn)}<span className={s.kernEenheid}>KN</span></div>
          <div className={s.richting}>{dirLabel16(p0.dir_deg)} · {String(Math.round(p0.dir_deg)).padStart(3, "0")}°</div>
          <div className={s.bft}>BFT&nbsp;{bft} · {bftLabel(bft).toUpperCase()} · VLAAG&nbsp;{Math.round(p0.gust_kn)}&nbsp;KN</div>
          <div className={s.chips}>
            {temp0 != null && <span className={s.chip}>{Math.round(temp0)}°C</span>}
            <span className={s.chip} data-leeg={wave0 == null ? "" : undefined}>GOLF&nbsp;{wave0 != null ? `${komma(wave0)}\u00A0M` : "—"}</span>
          </div>
          {wave0 == null && <div className={s.reden}>geen golfdata voor dit punt</div>}
        </div>
        {voet && <div className={s.voet}>{voet}</div>}
      </div>
      <div className={s.context}>{windContext(pts)}</div>

      <Uren pts={pts.slice(0, 13)} />
      <div className={s.model}>Wind: {p0.model_label}{p0.corrected ? " · gekalibreerd" : ""}</div>
    </>
  );
}

// Kompasroos: 3 concentrische ringen, N/O/Z/W, oker naald op de windrichting.
function Kompas({ dir }: { dir: number }) {
  return (
    <svg className={s.kompas} viewBox="0 0 100 100" aria-label={`wind uit ${dirLabel16(dir)}`}>
      <circle cx={50} cy={50} r={46} className={s.ring1} />
      <circle cx={50} cy={50} r={36} className={s.ring2} />
      <circle cx={50} cy={50} r={26} className={s.ring3} />
      <g className={s.tick}><line x1={50} y1={4} x2={50} y2={13} /><line x1={50} y1={87} x2={50} y2={96} /><line x1={4} y1={50} x2={13} y2={50} /><line x1={87} y1={50} x2={96} y2={50} /></g>
      <text x={50} y={13} className={s.noord}>N</text>
      <text x={90} y={53} className={s.wind}>O</text>
      <text x={50} y={93} className={s.wind}>Z</text>
      <text x={10} y={53} className={s.wind}>W</text>
      <path d="M50 16 L61 50 L50 42 L39 50 Z" className={s.naald} transform={`rotate(${dir} 50 50)`} />
      <circle cx={50} cy={50} r={4} className={s.naaf} />
    </svg>
  );
}

// Komende 12 uur: per uur een staaf; op mobiel alleen de even uren (data-desktop op de
// oneven uren → verborgen < 768px). Kleur van staaf + knopencijfer volgt verdict().
function Uren({ pts }: { pts: ForecastResponse["points"] }) {
  const max = Math.max(20, Math.ceil(Math.max(...pts.map((p) => p.gust_kn)) / 10) * 10);
  return (
    <div className={`card ${s.uren}`}>
      <div className={s.sectie}>KOMENDE 12 UUR</div>
      <div className={s.staven}>
        {pts.map((p, i) => (
          <div key={p.time} className={s.staaf} data-desktop={i % 2 ? "" : undefined} data-nu={i === 0 ? "" : undefined}
            data-verdict={verdict(p.speed_kn, p.gust_kn) ?? undefined}>
            <span className={s.vlaag}>{Math.round(p.gust_kn)}</span>
            <span className={s.kn}>{Math.round(p.speed_kn)}</span>
            <span className={s.pijl}><WindArrow dir={p.dir_deg} /></span>
            <div className={s.balk} style={{ height: `${Math.round((p.speed_kn / max) * 65)}%` }} />
          </div>
        ))}
      </div>
      <div className={s.as}><span>NU</span><span>+6U</span><span>+12U</span></div>
    </div>
  );
}
