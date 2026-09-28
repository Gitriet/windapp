"use client";
// WEER — weer op één haven voor de GEKOZEN dag (deel van WEER & GETIJ), geen advies.
// Vandaag: kompas + wind nu, trend komende 6 uur, komende 12 uur. Andere dag: hetzelfde
// vanaf 09:00 van die dag. Tegels = de hele (resterende) dag uit de gecorrigeerde uren;
// buiten die reeks (~3 dagen) alleen de ongecorrigeerde dagverwachting. Alleen presentatie.
import { dirLabel16 } from "@/lib/format";
import { verdict } from "@/lib/verdict";
import { wxLabel } from "@/lib/weather";
import { localDateISO, localHM, localHourDecimal } from "@/lib/tz";
import { dagVenster, dagWind } from "@/lib/dagweer";
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
  dag: { date: string; day: WeekDay | undefined };      // gekozen dag
  vandaag: string;                                      // lokale datum van vandaag
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

// "ZONDAG" voor een ISO-datum (lokaal)
const weekdag = (date: string) =>
  new Intl.DateTimeFormat("nl-NL", { weekday: "long", timeZone: "Europe/Amsterdam" }).format(Date.parse(`${date}T12:00:00Z`)).toUpperCase();

export default function NuScreen({ fc, naam, dag, vandaag }: NuScreenProps) {
  const isNu = dag.date === vandaag;
  const venster = dagVenster(fc.points, dag.date, vandaag);
  const p0 = venster[0], p6 = venster[Math.min(6, venster.length - 1)];
  const d = dag.day;
  // wind-tegel: gecorrigeerde uren waar die er zijn, anders de ongecorrigeerde dagverwachting
  const dw = venster.length ? dagWind(fc.points, dag.date) : null;
  const wMin = dw?.min ?? d?.windMin ?? null, wMax = dw?.max ?? d?.speedMax ?? null, wVlaag = dw?.gust ?? d?.gust ?? null;
  const wind = wMin != null && wMax != null ? `${Math.round(wMin)}–${Math.round(wMax)}` : wMax != null ? `${Math.round(wMax)}` : "—";
  // windrij: uit het uurvenster; voorbij de uurreeks de dagverwachting (max + overheersende richting)
  const w = p0 ? { kn: p0.speed_kn, vlaag: p0.gust_kn, dir: p0.dir_deg, naar: p6.dir_deg }
    : d?.speedMax != null && d.dir != null ? { kn: d.speedMax, vlaag: d.gust, dir: d.dir, naar: d.dir } : null;
  const moment = p0 ? (isNu ? "NU" : `VANAF ${localHM(tms(p0.time))}`) : "DAGVERWACHTING";
  const lucht = d ? wxLabel(d.code) : "";
  const weerZin = d ? `${lucht.charAt(0).toUpperCase()}${lucht.slice(1)}${d.pop != null && d.pop >= 30 ? `, ${Math.round(d.pop)}% kans op neerslag` : ""}` : null;
  const druk = drukOpDag(fc.weather, dag.date);
  const tGem = d?.tmin != null && d.tmax != null ? (d.tmin + d.tmax) / 2 : null;   // gemiddelde van dagmin en -max

  return (
    <>
      <div className={`card ${s.hero}`}>
        <div className={s.kop}><span>WEER · {naam}</span><span className={s.moment}>{p0 && <span className={s.bron}>{p0.model_label} · </span>}{moment}</span></div>
        {w && <div className={s.windRij}>
          <Kompas dir={w.dir} naar={w.naar} />
          <div>
            <div className={s.kern}>
              {Math.round(w.kn)}<span className={s.eenheid}>{p0 ? "KN" : "KN MAX"}</span>
              {w.vlaag != null && <><span className={s.vlaagNu}>{Math.round(w.vlaag)}</span><span className={s.eenheid}>VLAAG</span></>}
            </div>
            <div className={s.richting}>{dirLabel16(w.dir)} · {String(Math.round(w.dir)).padStart(3, "0")}°{!p0 && " · overheersend"}</div>
          </div>
        </div>}
        <div className={s.weer}>
          {d && <span className={s.weerIcoon}><WxIcon code={d.code} size={24} /></span>}
          <div>
            {p0 && <div>{isNu ? "Komende 6 uur" : `${localHM(tms(p0.time))}–${localHM(tms(p6.time))}`} {windContext(venster)}</div>}
            {weerZin && <div>{weerZin}</div>}
          </div>
        </div>
        <div className={s.tegels}>
          <div className={s.tegel}>
            <div className={s.tegelLabel}>WIND {isNu ? "VANDAAG" : weekdag(dag.date)}</div>
            <div className={s.tegelWaarde}>{wind}<span className={s.tegelEenheid}>kn</span></div>
            <div className={s.tegelSub}>VLAAG {wVlaag != null ? Math.round(wVlaag) : "—"} KN</div>
            {!dw && <div className={s.tegelSub}>ONGECORRIGEERD</div>}
          </div>
          <div className={s.tegel}>
            <div className={s.tegelLabel}>GEM. TEMP</div>
            <div className={s.tegelWaarde}>{tGem != null ? `${Math.round(tGem)}°` : "—"}</div>
            <div className={s.tegelSub}>{druk != null ? `${Math.round(druk)} hPa` : "\u00A0"}</div>
          </div>
        </div>
      </div>
      {p0 ? <Uren pts={venster} isNu={isNu} /> : <div className={s.model}>Wind: dagverwachting, ongecorrigeerd (uurverwachting reikt ~3 dagen vooruit)</div>}
    </>
  );
}

// Kompas: ring met N/O/Z/W, oker vaan in de vorm van de uurpijlen (WindArrow), punt op
// de windrichting nu (zelfde kleur als de richtingregel), en binnen de ring een gestippelde boog naar de richting over ~6 uur.
function Kompas({ dir, naar }: { dir: number; naar: number }) {
  const pt = (deg: number, r: number) => {
    const a = (deg * Math.PI) / 180;
    return [50 + r * Math.sin(a), 50 - r * Math.cos(a)].map((v) => v.toFixed(1)).join(" ");
  };
  const delta = ((naar - dir + 540) % 360) - 180;
  const R = 24;   // binnen de binnenring: vrij van de windletters
  return (
    <svg className={s.kompas} viewBox="0 0 100 100" role="img"
      aria-label={`wind uit ${dirLabel16(dir)}${Math.abs(delta) >= 10 ? `, draait naar ${dirLabel16(naar)}` : ""}`}>
      <circle cx={50} cy={50} r={47} className={s.ring1} />
      <circle cx={50} cy={50} r={31} className={s.ring2} />
      <text x={50} y={14} className={s.noord}>N</text>
      <text x={88} y={54} className={s.windLetter}>O</text>
      <text x={50} y={93} className={s.windLetter}>Z</text>
      <text x={12} y={54} className={s.windLetter}>W</text>
      {Math.abs(delta) >= 10 && (
        <>
          <path d={`M${pt(dir, R)} A${R} ${R} 0 0 ${delta > 0 ? 1 : 0} ${pt(naar, R)}`} className={s.boog} />
          <circle cx={pt(naar, R).split(" ")[0]} cy={pt(naar, R).split(" ")[1]} r={3.5} className={s.eindStip} />
        </>
      )}
      <g transform={`rotate(${dir} 50 50)`} className={s.naald}>
        <path d="M50 16 L57 58 L50 52 L43 58 Z" />
      </g>
      <circle cx={50} cy={50} r={4} className={s.naaf} />
    </svg>
  );
}

// 12 uur vanaf het venster-begin: per uur een staaf; op mobiel alleen de even uren
// (data-desktop op de oneven uren → verborgen < 768px). Kleur volgt verdict(). Vandaag
// is de eerste staaf "nu" (de rest gedimd); op een andere dag geen nu-markering.
function Uren({ pts, isNu }: { pts: ForecastResponse["points"]; isNu: boolean }) {
  const hm = (i: number) => (pts[i] ? localHM(tms(pts[i].time)) : "");
  const max = Math.max(20, Math.ceil(Math.max(...pts.map((p) => p.gust_kn)) / 10) * 10);
  return (
    <div className={`card ${s.uren}`}>
      <div className={s.sectie}>{isNu ? "KOMENDE 12 UUR" : `${hm(0)} – ${hm(pts.length - 1)}`}</div>
      <div className={s.staven} data-nu-modus={isNu ? "" : undefined}>
        {pts.map((p, i) => (
          <div key={p.time} className={s.staaf} data-desktop={i % 2 ? "" : undefined} data-nu={isNu && i === 0 ? "" : undefined}
            data-verdict={verdict(p.speed_kn, p.gust_kn) ?? undefined}>
            <span className={s.vlaag}>{Math.round(p.gust_kn)}</span>
            <span className={s.kn}>{Math.round(p.speed_kn)}</span>
            <span className={s.pijl}><WindArrow dir={p.dir_deg} /></span>
            <div className={s.balk} style={{ height: `${Math.round((p.speed_kn / max) * 65)}%` }} />
          </div>
        ))}
      </div>
      <div className={s.as}>{isNu ? <><span>NU</span><span>+6U</span><span>+12U</span></> : <><span>{hm(0)}</span><span>{hm(6)}</span><span>{hm(12)}</span></>}</div>
    </div>
  );
}
