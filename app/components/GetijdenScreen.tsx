"use client";
// GETIJDEN — getij + stroom zonder wind: weekstrip (ISO-week, bereik uit één bron),
// beste vertrektijden op stroom en de 24-uurs stroomkromme. Alleen presentatie.
import { useMemo, useState } from "react";
import { localHM, localDateISO, localMidnight } from "@/lib/tz";
import {
  addDays, binnenBereik, isoWeek, krommePieken, krommeSegmenten, rankOpStroom, weekDagen, type DagBereik,
} from "@/lib/getij";
import { combineLegTimelines, stroomVerloop, type DepOption, type LegTimeline } from "@/lib/tocht";
import type { SimWaypoint } from "@/lib/tripsim";
import type { AlongSample } from "@/lib/route";
import type { TideData } from "@/lib/types";
import { Skeleton } from "./Shell";
import s from "./GetijdenScreen.module.css";

const H = 3_600_000;
const tms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));
const noon = (d: string) => Date.parse(`${d}T12:00:00Z`);
const fmt = (d: string, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("nl-NL", { ...o, timeZone: "Europe/Amsterdam" }).format(noon(d)).replace(".", "").toUpperCase();

export interface GetijdenScreenProps {
  ready: boolean;
  nowMs: number;
  bereik: DagBereik | null;              // kiesbare dagen (één bron: useTocht.dagBereik)
  titel: string;                          // route.via of padnamen
  anyStroom: boolean;
  legTimelines: LegTimeline[];
  waypoints: SimWaypoint[];
  alongPerLeg: AlongSample[][];
  legDistNm?: number[];
  routeTide: TideData | null;
}

export default function GetijdenScreen(p: GetijdenScreenProps) {
  const vandaag = localDateISO(p.nowMs || Date.now());
  const [dag, setDag] = useState<string | null>(null);
  const [weekVan, setWeekVan] = useState<string | null>(null);
  const gekozen = dag ?? vandaag;
  const week = weekDagen(weekVan ?? gekozen);

  if (!p.ready) return <Skeleton rows={4} height={64} label="getij laden" />;

  const kies = (d: string) => { setDag(d); setWeekVan(d); };
  const vorigeKan = binnenBereik(addDays(week[0], -1), p.bereik) || (!!p.bereik && p.bereik.laatste < week[0]);
  const volgendeKan = binnenBereik(addDays(week[6], 1), p.bereik) || (!!p.bereik && p.bereik.eerste > week[6]);

  return (
    <>
      <div>
        <div className={s.kopRij}>
          <span className={s.sectie}>HISTORIE · KIES DATUM</span>
          <button type="button" className={s.vandaag} onClick={() => kies(vandaag)}>VANDAAG</button>
        </div>
        <div className={s.maandRij}>
          <button type="button" className={s.nav} aria-label="vorige week" disabled={!vorigeKan}
            onClick={() => setWeekVan(addDays(week[0], -7))}><span className={s.navVlak}>‹</span></button>
          <span className={s.maand}>{fmt(week[3], { month: "long" })} · WEEK {isoWeek(week[0])}</span>
          <button type="button" className={s.nav} aria-label="volgende week" disabled={!volgendeKan}
            onClick={() => setWeekVan(addDays(week[0], 7))}><span className={s.navVlak}>›</span></button>
        </div>
        <div className={s.week}>
          {week.map((d) => (
            <button key={d} type="button" className={`row ${s.tegel} ${d === gekozen ? "is-filled" : ""}`}
              aria-pressed={d === gekozen} disabled={!binnenBereik(d, p.bereik)} onClick={() => kies(d)}
              aria-label={fmt(d, { weekday: "long", day: "numeric", month: "long" })}>
              <span className={s.tegelDag}>{fmt(d, { weekday: "short" }).slice(0, 2)}</span>
              <span className={s.tegelNr}>{fmt(d, { day: "numeric" })}</span>
            </button>
          ))}
        </div>
      </div>
      <Vertrektijden {...p} dag={gekozen} />
      <Kromme {...p} dag={gekozen} />
    </>
  );
}

// Reden bij een vertrek: stroom bij vertrek + het getij-extreem kort ervóór (≤4u).
function reden(o: DepOption, tide: TideData | null): string {
  const v = stroomVerloop(o.result, true);
  const mee = v.kind === "mee";
  const ext = [...(tide?.extremes ?? [])].reverse().find((e) => tms(e.t) <= o.depMs && tms(e.t) >= o.depMs - 4 * H);
  const kent = "totMs" in v && v.totMs != null ? ` · kentering ${localHM(v.totMs)}` : "";
  return `${mee ? "meestroom" : "tegenstroom"}${ext ? ` vanaf ${ext.kind} ${localHM(tms(ext.t))}` : ""}${kent}`;
}

function Vertrektijden({ dag, anyStroom, waypoints, alongPerLeg, legDistNm, routeTide }: GetijdenScreenProps & { dag: string }) {
  const r = useMemo(
    () => (anyStroom ? rankOpStroom({ dag, waypoints, along: alongPerLeg, legDistNm }) : { beste: null, overige: [], gedekt: false }),
    [dag, anyStroom, waypoints, alongPerLeg, legDistNm],
  );
  const rijen = [...(r.beste ? [r.beste] : []), ...r.overige].sort((a, b) => a.depMs - b.depMs);
  return (
    <div>
      <div className={s.sectie}>BESTE VERTREKTIJDEN · {fmt(dag, { weekday: "short", day: "numeric", month: "short" })}</div>
      <div className={s.noot}>op stroom, zonder wind</div>
      {!rijen.length ? (
        <div className={s.leeg}>—<div className={s.noot}>{!anyStroom ? "geen stroomdata voor deze route" : r.gedekt ? "geen vertrek met meestroom op deze dag" : "geen stroomdata voor deze dag"}</div></div>
      ) : (
        <div className={s.lijst}>
          {rijen.map((o) => {
            const best = o.depMs === r.beste?.depMs;
            return (
              <div key={o.depMs} className={`row ${s.blok} ${best ? "is-filled" : ""}`}>
                <span className={s.blokMain}>
                  <span className={s.blokTijd}>{localHM(o.depMs)} → {o.result.arrMs ? localHM(o.result.arrMs) : "—"}</span>
                  <span className={s.blokReden}>{reden(o, routeTide)}</span>
                </span>
                {best ? <span className={s.badge}>BESTE</span> : <span className={s.label}>GOED</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 24-uurs stroomkromme (lokale dag): polyline per segment, gaten blijven gaten.
const W = 300, HG = 90, PAD = 6;
function Kromme({ dag, titel, legTimelines }: GetijdenScreenProps & { dag: string }) {
  const van = localMidnight(noon(dag)), tot = localMidnight(noon(addDays(dag, 1)));
  const { series } = combineLegTimelines(legTimelines);
  const segs = krommeSegmenten(series, van, tot);
  const maxAbs = Math.max(0.5, ...segs.flat().map((q) => Math.abs(q.v)));
  const x = (ms: number) => ((ms - van) / (tot - van)) * W;
  const y = (v: number) => HG / 2 - (v / maxAbs) * (HG / 2 - PAD);
  return (
    <div className={`card ${s.krommeKaart}`}>
      <div className={s.sectie}>STROOM {titel.toUpperCase()} · 24 UUR</div>
      {!segs.length ? (
        <div className={s.leeg}>—<div className={s.noot}>geen stroomdata voor deze dag</div></div>
      ) : (
        <svg className={s.kromme} viewBox={`0 0 ${W} ${HG}`} role="img" aria-label="stroom langs de route over 24 uur">
          <line x1={0} x2={W} y1={HG / 2} y2={HG / 2} className={s.nullijn} />
          {segs.map((seg, i) => (
            <polyline key={i} className={s.lijn} points={seg.map((q) => `${x(q.ms).toFixed(1)},${y(q.v).toFixed(1)}`).join(" ")} />
          ))}
          {segs.flatMap(krommePieken).map((q) => (
            <circle key={q.ms} cx={x(q.ms)} cy={y(q.v)} r={4} className={q.soort === "mee" ? s.piekMee : s.piekTegen} />
          ))}
        </svg>
      )}
      <div className={s.as}><span>00:00</span><span>12:00</span><span>24:00</span></div>
      <div className={s.legenda}>
        <span><span className={`${s.stip} ${s.piekMee}`} />MEESTROOM</span>
        <span><span className={`${s.stip} ${s.piekTegen}`} />TEGENSTROOM</span>
      </div>
    </div>
  );
}
