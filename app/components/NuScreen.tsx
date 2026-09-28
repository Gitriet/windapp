"use client";
// NU — weer op één haven (deel van WEER & GETIJ), geen advies. Herokaart: kompas met de
// draaiing komende 6 uur, wind + vlaag nu, een weerregel en twee tegels (wind, temp) voor
// de gekozen dag; daaronder de komende 12 uur (staven). Alleen presentatie.
import { dirLabel16 } from "@/lib/format";
import { verdict } from "@/lib/verdict";
import { wxLabel } from "@/lib/weather";
import { localDateISO, localHourDecimal } from "@/lib/tz";
import type { ForecastResponse } from "@/lib/planner-data";
import type { WeekDay } from "@/lib/types";
import { WindArrow, WxIcon } from "./icons";
import s from "./NuScreen.module.css";

const tms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));

// Contextzin uit de forecast: trend ~6u vooruit + draaiing. De bron staat in de zonekop.
function windContext(pts: ForecastResponse["points"]): string {
  const p0 = pts[0];
  const t = pts[Math.min(6, pts.length - 1)];
  const d = t.speed_kn - p0.speed_kn;
  const trend = d > 2 ? `bouwt op naar ${Math.round(t.speed_kn)}\u00A0kn`
    : d < -2 ? `neemt af naar ${Math.round(t.speed_kn)}\u00A0kn`
    : "vrij constant";
  const turn = Math.abs(((t.dir_deg - p0.dir_deg + 540) % 360) - 180);
  const draai = turn >= 25 ? `draait naar ${dirLabel16(t.dir_deg)}` : `blijft ${dirLabel16(p0.dir_deg)}`;
  return `${trend}, ${draai}`;
}

export interface NuScreenProps {
  fc: ForecastResponse;
  naam: string;                                         // havennaam in de kop
  dag: { date: string; day: WeekDay | undefined };      // gekozen dag (tegels + weerregel)
}

// Luchtdruk rond 12:00 lokaal op de gekozen dag uit de uurreeks; null buiten de reeks.
function drukOpDag(w: ForecastResponse["weather"], date: string): number | null {
  let best: number | null = null, bestD = Infinity;
  w?.time.forEach((t, i) => {
    const ms = tms(t), p = w.pressure[i];
    if (p == null || localDateISO(ms) !== date) return;
    const d = Math.abs(localHourDecimal(ms) - 12);
    if (d < bestD) { bestD = d; best = p; }
  });
  return best;
}

export default function NuScreen({ fc, naam, dag }: NuScreenProps) {
  const pts = fc.points;
  if (!pts.length) return (
    <div className={s.leeg}>—<div className={s.reden}>geen voorspelling beschikbaar voor {naam}</div></div>
  );
  const p0 = pts[0], p6 = pts[Math.min(6, pts.length - 1)];
  const d = dag.day;
  const wind = d?.windMin != null && d.speedMax != null ? `${Math.round(d.windMin)}–${Math.round(d.speedMax)}`
    : d?.speedMax != null ? `${Math.round(d.speedMax)}` : "—";
  const lucht = d ? wxLabel(d.code) : "";
  const weerZin = d ? `${lucht.charAt(0).toUpperCase()}${lucht.slice(1)}${d.pop != null && d.pop >= 30 ? `, ${Math.round(d.pop)}% kans op neerslag` : ""}` : null;
  const druk = drukOpDag(fc.weather, dag.date);

  return (
    <>
      <div className={`card ${s.hero}`}>
        <div className={s.kop}>WEER · {naam}</div>
        <div className={s.windRij}>
          <Kompas dir={p0.dir_deg} naar={p6.dir_deg} />
          <div>
            <div className={s.kern}>
              {Math.round(p0.speed_kn)}<span className={s.eenheid}>KN</span>
              <span className={s.vlaagNu}>{Math.round(p0.gust_kn)}</span><span className={s.eenheid}>VLAAG</span>
            </div>
            <div className={s.richting}>{dirLabel16(p0.dir_deg)} · {String(Math.round(p0.dir_deg)).padStart(3, "0")}°</div>
          </div>
        </div>
        <div className={s.weer}>
          {d && <span className={s.weerIcoon}><WxIcon code={d.code} size={24} /></span>}
          <div>
            <div>Komende 6 uur {windContext(pts)}</div>
            {weerZin && <div>{weerZin}</div>}
          </div>
        </div>
        <div className={s.tegels}>
          <div className={s.tegel}>
            <div className={s.tegelLabel}>WIND</div>
            <div className={s.tegelWaarde}>{wind}<span className={s.tegelEenheid}>kn</span></div>
            <div className={s.tegelSub}>VLAAG {d?.gust != null ? Math.round(d.gust) : "—"} KN</div>
          </div>
          <div className={s.tegel}>
            <div className={s.tegelLabel}>TEMP</div>
            <div className={s.tegelWaarde}>{d?.tmax != null ? `${Math.round(d.tmax)}°` : "—"}</div>
            <div className={s.tegelSub}>{druk != null ? `${Math.round(druk)} hPa` : "\u00A0"}</div>
          </div>
        </div>
      </div>
      <Uren pts={pts.slice(0, 13)} />
      <div className={s.model}>Wind: {p0.model_label}{p0.corrected ? " · gekalibreerd" : ""}</div>
    </>
  );
}

// Kompas: ring met N/O/Z/W, dunne lijn naar de windrichting nu, en een gestippelde
// boog naar de richting over ~6 uur (eindstip) — de draaiing in één oogopslag.
function Kompas({ dir, naar }: { dir: number; naar: number }) {
  const pt = (deg: number, r: number) => {
    const a = (deg * Math.PI) / 180;
    return [50 + r * Math.sin(a), 50 - r * Math.cos(a)].map((v) => v.toFixed(1)).join(" ");
  };
  const delta = ((naar - dir + 540) % 360) - 180;
  const R = 40;
  return (
    <svg className={s.kompas} viewBox="0 0 100 100" role="img"
      aria-label={`wind uit ${dirLabel16(dir)}${Math.abs(delta) >= 10 ? `, draait naar ${dirLabel16(naar)}` : ""}`}>
      <circle cx={50} cy={50} r={47} className={s.ring1} />
      <circle cx={50} cy={50} r={31} className={s.ring2} />
      <text x={50} y={14} className={s.noord}>N</text>
      <text x={88} y={54} className={s.windLetter}>O</text>
      <text x={50} y={93} className={s.windLetter}>Z</text>
      <text x={12} y={54} className={s.windLetter}>W</text>
      <line x1={50} y1={50} x2={pt(dir, 44).split(" ")[0]} y2={pt(dir, 44).split(" ")[1]} className={s.naald} />
      {Math.abs(delta) >= 10 && (
        <>
          <path d={`M${pt(dir, R)} A${R} ${R} 0 0 ${delta > 0 ? 1 : 0} ${pt(naar, R)}`} className={s.boog} />
          <circle cx={pt(naar, R).split(" ")[0]} cy={pt(naar, R).split(" ")[1]} r={3.5} className={s.eindStip} />
        </>
      )}
      <circle cx={50} cy={50} r={5} className={s.naaf} />
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
