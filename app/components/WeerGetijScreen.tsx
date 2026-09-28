"use client";
// WEER & GETIJ — één datumkiezer (weekstrip) voor weer én getij, en per haven (subtabs
// VERTREK / AANKOMST) het dagblok (weer, HW/LW, getijcurve) en de live wind.
// Weer en getij zijn eigenschappen van de haven; stroom hoort bij de etappe (VAARPLAN).
// Alleen de gekozen dag wordt getoond; de schakelaar kiest vertrek- of aankomsthaven.
// Alleen presentatie.
import { useState } from "react";
import { localHM, localDateISO, localMidnight } from "@/lib/tz";
import { addDays, binnenBereik, datumBereik, stripDagen } from "@/lib/getij";
import type { ForecastResponse, RouteHaven, WeekResponse } from "@/lib/planner-data";
import type { TideData, TidePoint } from "@/lib/types";
import NuScreen from "./NuScreen";
import { Skeleton } from "./Shell";
import s from "./WeerGetijScreen.module.css";

const tms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));
const noon = (d: string) => Date.parse(`${d}T12:00:00Z`);
const fmt = (d: string, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("nl-NL", { ...o, timeZone: "Europe/Amsterdam" }).format(noon(d)).replace(".", "").toUpperCase();


export type HavenData = { fc?: ForecastResponse; week?: WeekResponse; tide?: TideData | null };
type Rol = "van" | "naar";
const SUBTABS: { id: Rol; label: string }[] = [{ id: "van", label: "VERTREK" }, { id: "naar", label: "AANKOMST" }];

export interface WeerGetijScreenProps {
  nowMs: number;
  havens: Record<Rol, RouteHaven | null>;
  data: Record<Rol, HavenData>;
}

// Getijreeks voor de curve: verwachting waar die reikt, astronomisch daarbuiten.
function getijReeks(t: TideData): { pts: TidePoint[]; expEnd: number } {
  const expEnd = t.expected.length ? tms(t.expected[t.expected.length - 1].t) : -Infinity;
  return { pts: [...t.expected, ...t.astro.filter((p) => tms(p.t) > expEnd)], expEnd };
}

// Kiesbare dagen: waar weer of getij van een van beide havens data heeft.
function bereikVan(data: HavenData[]) {
  return datumBereik(data.flatMap((d) => {
    const days = d.week?.days ?? [];
    const pts = d.tide ? getijReeks(d.tide).pts.map((p) => tms(p.t)) : [];
    return [
      days.length ? { first: noon(days[0].date), last: noon(days[days.length - 1].date) } : null,
      pts.length ? { first: Math.min(...pts), last: Math.max(...pts) } : null,
    ];
  }));
}

export default function WeerGetijScreen({ nowMs, havens, data }: WeerGetijScreenProps) {
  const vandaag = localDateISO(nowMs || Date.now());
  const [dag, setDag] = useState<string | null>(null);
  const [stripVan, setStripVan] = useState<string | null>(null);
  const [rol, setRol] = useState<Rol>("van");
  const gekozen = dag && dag >= vandaag ? dag : vandaag;
  const week = stripDagen(stripVan ?? vandaag, vandaag);
  const bereik = bereikVan([data.van, data.naar]);

  const vorigeKan = week[0] > vandaag;
  const volgendeKan = binnenBereik(addDays(week[6], 1), bereik);
  const maanden = [...new Set([week[0], week[6]].map((d) => fmt(d, { month: "long" })))].join(" · ");
  const haven = havens[rol], hd = data[rol];

  return (
    <>
      <div className="schakelaar" role="radiogroup" aria-label="Haven">
        {SUBTABS.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={t.id === rol}
            className={`schakelaar-stand ${t.id === rol ? "is-filled" : ""}`} onClick={() => setRol(t.id)}>
            <span className="schakelaar-rol">{t.label}</span>
            <span className="schakelaar-naam">{havens[t.id]?.naam ?? "…"}</span>
          </button>
        ))}
      </div>

      <div>
        <div className={s.maandRij}>
          <button type="button" className={s.nav} aria-label="vorige 7 dagen" disabled={!vorigeKan}
            onClick={() => setStripVan(addDays(week[0], -7))}><span className={s.navVlak}>‹</span></button>
          <span className={s.maand}>{maanden}</span>
          <button type="button" className={s.nav} aria-label="volgende 7 dagen" disabled={!volgendeKan}
            onClick={() => setStripVan(addDays(week[0], 7))}><span className={s.navVlak}>›</span></button>
        </div>
        <div className={s.week}>
          {week.map((d) => (
            <button key={d} type="button" className={`row ${s.tegel} ${d === gekozen ? "is-filled" : ""}`}
              aria-pressed={d === gekozen} disabled={!binnenBereik(d, bereik)} onClick={() => setDag(d)}
              aria-label={fmt(d, { weekday: "long", day: "numeric", month: "long" })}>
              <span className={s.tegelDag}>{fmt(d, { weekday: "short" }).slice(0, 2)}</span>
              <span className={s.tegelNr}>{fmt(d, { day: "numeric" })}</span>
            </button>
          ))}
        </div>
      </div>

      {!haven || !hd.fc || !hd.week ? <Skeleton rows={3} height={120} label="weer en getij laden" tekst="Weer en getij ophalen…" /> : (
        <>
          <div className={s.nu}>
            <NuScreen fc={hd.fc} naam={haven.naam} dag={{ date: gekozen, day: hd.week.days.find((w) => w.date === gekozen) }} vandaag={vandaag} />
          </div>
          <div>
            <div className={`${s.sectie} ${s.kop}`}>GETIJ · {haven.naam}</div>
            <GetijDag dag={gekozen} tide={hd.tide ?? null} />
          </div>
        </>
      )}
    </>
  );
}

// Getij van de gekozen dag: de getijcurve met HW/LW (tijd + hoogte) in de grafiek.
function GetijDag({ dag, tide }: { dag: string; tide: TideData | null }) {
  const ext = (tide?.extremes ?? []).filter((e) => localDateISO(tms(e.t)) === dag);
  return (
    <div className={`card ${s.blok}`}>
      {!tide ? <div className={s.noot}>geen getijstation voor deze haven</div>
        : !ext.length && <div className={s.noot}>geen getijdata voor deze dag</div>}
      {tide && <GetijKromme tide={tide} dag={dag} />}
    </div>
  );
}

// 24-uurs waterstand (cm NAP) van de lokale dag; HW/LW als stip met tijd en hoogte erbij
// (HW erboven, LW eronder), NAP als nullijn. LBL = ruimte voor die labels boven en onder.
const W = 300, HG = 96, PAD = 6, LBL = 11;
function GetijKromme({ tide, dag }: { tide: TideData; dag: string }) {
  const van = localMidnight(noon(dag)), tot = localMidnight(noon(addDays(dag, 1)));
  const { pts: reeks, expEnd } = getijReeks(tide);
  const pts = reeks.map((p) => ({ ms: tms(p.t), v: p.v })).filter((p) => p.ms >= van && p.ms <= tot);
  if (pts.length < 2) return null;
  const lo = Math.min(0, ...pts.map((p) => p.v)), hi = Math.max(0, ...pts.map((p) => p.v));
  const x = (ms: number) => ((ms - van) / (tot - van)) * W;
  const y = (v: number) => PAD + LBL + ((hi - v) / (hi - lo || 1)) * (HG - 2 * (PAD + LBL));
  const ext = tide.extremes.map((e) => ({ ms: tms(e.t), v: e.v, hw: e.kind === "HW" })).filter((e) => e.ms >= van && e.ms <= tot);
  return (
    <div className={s.krommeWrap}>
      <svg className={s.kromme} viewBox={`0 0 ${W} ${HG}`} role="img" aria-label="waterstand over 24 uur">
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} className={s.nullijn} />
        <polyline className={s.lijn} points={pts.map((p) => `${x(p.ms).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ")} />
        {ext.map((e) => (
          <g key={e.ms}>
            <circle cx={x(e.ms)} cy={y(e.v)} r={3.5} className={s.stipExt} />
            <text x={Math.min(W - 26, Math.max(26, x(e.ms)))} y={e.hw ? y(e.v) - 7 : y(e.v) + 14} className={s.extTijd}>
              {localHM(e.ms)} <tspan className={s.extCm}>{e.v > 0 ? "+" : ""}{Math.round(e.v)}</tspan>
            </text>
          </g>
        ))}
      </svg>
      <div className={s.as}><span>00:00</span><span>12:00</span><span>24:00</span></div>
      <div className={s.noot}>cm t.o.v. NAP · {tide.name}{pts[0].ms > expEnd ? " · astronomisch (zonder windopzet)" : ""}</div>
    </div>
  );
}
