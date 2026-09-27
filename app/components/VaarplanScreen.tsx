"use client";
// VAARPLAN — detail van het gekozen vertrek: tijdblok + KPI's, etappes (stroom per
// segment, kentering, wind), haveninfo met VHF uit de data, getijpoort, VHF-posten en
// uitwijkhavens. De gekozen etappe toont zijn eigen 24-uurs stroomkromme (bij een route
// zonder tussenstops = de hele tocht), plus de beste vertrektijden op stroom op de
// vertrekdag. Geen nieuwe berekeningen: alles uit SimResult, stroom, haveninfo en getij.
import { useMemo, useState } from "react";
import { localHM, localDateISO, localMidnight } from "@/lib/tz";
import { dirLabel16, fmtDuurKort, tijdblok } from "@/lib/format";
import {
  combineLegTimelines, effectLabel, etappes, letOp, stroomVerloop,
  type DepOption, type Etappe, type EtappeLeg, type GustSample, type LegTimeline, type ViaHaven,
} from "@/lib/tocht";
import { addDays, krommePieken, krommeSegmenten, rankOpStroom } from "@/lib/getij";
import type { SimWaypoint } from "@/lib/tripsim";
import type { AlongSample } from "@/lib/route";
import { gateDatumFor, gateWindows, windowContains } from "@/lib/gates";
import type { SimResult } from "@/lib/tripsim";
import type { RouteHaven } from "@/lib/planner-data";
import type { TideData } from "@/lib/types";
import type { BoatProfile } from "@/lib/polar";
import { Skeleton } from "./Shell";
import { WindArrow } from "./icons";
import s from "./VaarplanScreen.module.css";

const H = 3_600_000;
const tms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));
const noon = (d: string) => Date.parse(`${d}T12:00:00Z`);
const fmt = (d: string, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("nl-NL", { ...o, timeZone: "Europe/Amsterdam" }).format(noon(d)).replace(".", "").toUpperCase();
const komma = (n: number) => n.toFixed(1).replace(".", ",");

// Verkeersposten langs de NL-kust — handmatige seed, geselecteerd op de breedtegraad-
// strook van de tocht. Indicatief: controleer altijd de actuele kanalen (ANWB-almanak).
const VHF_VERKEERSPOSTEN: { naam: string; kanaal: number; latMin: number; latMax: number }[] = [
  { naam: "Den Helder Traffic", kanaal: 62, latMin: 52.85, latMax: 53.60 },
  { naam: "IJmuiden Traffic", kanaal: 61, latMin: 52.30, latMax: 52.75 },
  { naam: "Scheveningen Verkeer", kanaal: 21, latMin: 51.95, latMax: 52.30 },
  { naam: "Maas Approach (Hoek van Holland)", kanaal: 3, latMin: 51.75, latMax: 52.00 },
  { naam: "Centrale Vlissingen", kanaal: 14, latMin: 51.20, latMax: 51.75 },
];

export interface VaarplanScreenProps {
  ready: boolean;
  depMs: number | null;
  trip: SimResult | null;
  from: RouteHaven | null;
  to: RouteHaven | null;
  distanceNm: number | null;
  bearingDeg: number | null;
  legs: EtappeLeg[];
  gusts: GustSample[];
  fromTide: TideData | null;
  via: ViaHaven[];
  boat: BoatProfile;
  anyStroom: boolean;
  legTimelines: LegTimeline[];            // stroom per etappe (zelfde volgorde als legs)
  waypoints: SimWaypoint[];
  alongPerLeg: AlongSample[][];
  legDistNm?: number[];
}

export default function VaarplanScreen(p: VaarplanScreenProps) {
  if (!p.ready) return <Skeleton rows={3} height={72} label="vaarplan laden" />;
  const { trip, depMs, from, to } = p;
  if (!trip || depMs == null || !from || !to) return (
    <div className={s.leeg}>—<div className={s.noot}>kies een vertrek op ROUTE</div></div>
  );
  return <Plan {...p} trip={trip} depMs={depMs} from={from} to={to} />;
}

function Plan(p: VaarplanScreenProps & { trip: SimResult; depMs: number; from: RouteHaven; to: RouteHaven }) {
  const { trip, depMs, from, to, distanceNm, bearingDeg, legs, gusts, fromTide, via, boat, anyStroom } = p;
  const et = useMemo(() => etappes(trip, legs, gusts), [trip, legs, gusts]);
  const [selRaw, setSel] = useState(0);
  const sel = Math.min(selRaw, Math.max(0, et.length - 1));   // nieuwe route met minder etappes
  const warn = letOp(trip, bearingDeg ?? 0, gusts);
  const maxAbs = Math.max(0.3, ...et.flatMap((e) => e.segmenten.map(Math.abs)));
  const dag = localDateISO(depMs) === localDateISO(Date.now()) ? "vandaag"
    : new Intl.DateTimeFormat("nl-NL", { weekday: "long", timeZone: "Europe/Amsterdam" }).format(depMs);

  // getijpoort bij vertrek (zelfde regel als voorheen): alleen met drempel + referentievlak + getijcurve
  const poort = useMemo(() => {
    const datum = gateDatumFor(from.haven);
    if (!from.havenInfo?.drempel || !datum || !fromTide?.expected.length) return null;
    const wins = gateWindows(fromTide, datum, boat.draftM + boat.keelClearanceM, depMs - 2 * H, depMs + 26 * H);
    return windowContains(wins, depMs) ? "open" : "dicht";
  }, [from, fromTide, boat, depMs]);

  const latMin = Math.min(from.lat, to.lat), latMax = Math.max(from.lat, to.lat);
  const posten = VHF_VERKEERSPOSTEN.filter((v) => v.latMax >= latMin - 0.15 && v.latMin <= latMax + 0.15);

  return (
    <>
      <div>
        <div className={s.tijdblok}>{tijdblok(depMs, trip.arrMs)}</div>
        <div className={s.sub}>{dag}{anyStroom && trip.arrMs ? ` · ${effectLabel(trip.effectMin)}` : ""}</div>
      </div>
      <div className={s.kpis}>
        <Kpi label="AFSTAND" waarde={distanceNm != null ? `${komma(distanceNm)}\u00A0NM` : "—"} />
        <Kpi label="DUUR" waarde={trip.arrMs ? fmtDuurKort(trip.tripMin) : "—"} />
        <Kpi label="KOERS" waarde={bearingDeg != null ? `${String(Math.round(bearingDeg)).padStart(3, "0")}°` : "—"} />
      </div>
      {(warn.hardWind || warn.windTegenStroom) && (
        <div className={s.chips}>
          {warn.hardWind && <span className={s.letOp}>LET OP · HARDE WIND</span>}
          {warn.windTegenStroom && <span className={s.letOp}>LET OP · WIND TEGEN STROOM</span>}
        </div>
      )}

      <div>
        <div className={s.sectie}>ETAPPES · WIND &amp; STROOM</div>
        <div className={s.lijst}>
          {et.map((e, i) => (
            <button key={e.label} type="button" className={`card ${s.etappe}`} aria-pressed={i === sel} onClick={() => setSel(i)}>
              <div className={s.etappeKop}>
                <span className={s.etappeNaam}>{e.label}</span>
                <span className={s.etappeNm}>{komma(e.distNm)}&nbsp;NM</span>
              </div>
              {e.segmenten.length ? (
                <div className={s.balken} role="img" aria-label={`stroom langs ${e.label}`}>
                  {e.segmenten.map((c, i) => (
                    <div key={i} className={s.balk} data-mee={c >= 0 ? "" : undefined}
                      style={{ height: `${Math.max(20, Math.round((Math.abs(c) / maxAbs) * 100))}%` }} />
                  ))}
                  {e.kenteringFrac != null && <div className={s.kentering} style={{ left: `${e.kenteringFrac * 100}%` }} />}
                </div>
              ) : <div className={s.noot}>zonder stroomdata</div>}
              {e.windDir != null && e.windKn != null && (
                <div className={s.wind}>
                  <WindArrow dir={e.windDir} />
                  <span className={s.windKn}>{dirLabel16(e.windDir)}&nbsp;{Math.round(e.windKn)}&nbsp;KN</span>
                  {e.vlaagKn != null && <span className={s.vlaag}>VLAGEN&nbsp;{Math.round(e.vlaagKn)}</span>}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {et[sel] && <StroomKromme etappe={et[sel]} timeline={p.legTimelines[sel]} depMs={depMs} />}
      <Vertrektijden {...p} dag={localDateISO(depMs)} />

      <div>
        <div className={s.sectie}>HAVENINFO</div>
        <div className={s.lijst}>
          <Haven rol="VERTREK" haven={from} />
          <Haven rol="AANKOMST" haven={to} />
          <div className={`row ${s.poort}`} data-status={poort ?? "onbekend"}>
            GETIJPOORT VERTREK · {poort === "open" ? "OPEN BIJ VERTREK" : poort === "dicht" ? "DICHT BIJ VERTREK" : "ONBEKEND"}
          </div>
          <div className={`row ${s.compact}`}>
            <span className={s.compactLabel}>VHF</span>
            <span>16 nood &amp; oproep · 70 DSC{posten.map((v) => ` · ${v.kanaal} ${v.naam}`).join("")}</span>
          </div>
          <div className={`row ${s.compact}`}>
            <span className={s.compactLabel}>UITWIJK</span>
            <span>{via.length ? via.map((v) => `${v.haven.naam} (~${komma(v.nmFromStart)}\u00A0nm${v.haven.havenInfo?.getijgebonden ? ", getijgebonden" : ""})`).join(" · ") : "geen tussenhavens op deze route"}</span>
          </div>
        </div>
      </div>
    </>
  );
}

function Kpi({ label, waarde }: { label: string; waarde: string }) {
  return (
    <div className={`row ${s.kpi}`}>
      <div className={s.kpiLabel}>{label}</div>
      <div className={s.kpiWaarde}>{waarde}</div>
    </div>
  );
}

// Havenkaart: naam + eerste VHF-kanaal uit de data; subregel = havennaam (+ getijgebonden).
function Haven({ rol, haven }: { rol: string; haven: RouteHaven }) {
  const h = haven.havenInfo;
  const vhf = h?.vhf[0];
  return (
    <div className={`card ${s.haven}`}>
      <div className={s.etappeKop}>
        <span className={s.havenNaam}>{rol} · {haven.naam}</span>
        {vhf && <span className={s.havenVhf} title={vhf.dienst}>VHF&nbsp;{vhf.kanaal}</span>}
      </div>
      {h && <div className={s.havenSub}>{h.havenNaam}{h.getijgebonden ? " · getijgebonden" : ""}{h.sluis ? ` · ${h.sluis.naam}` : ""}</div>}
    </div>
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

// Beste vertrektijden op stroom (zonder wind) voor de hele tocht, op de vertrekdag.
function Vertrektijden({ dag, anyStroom, waypoints, alongPerLeg, legDistNm, fromTide }: VaarplanScreenProps & { dag: string }) {
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
        <div className={`${s.lijst} ${s.lijstTop}`}>
          {rijen.map((o) => {
            const best = o.depMs === r.beste?.depMs;
            return (
              <div key={o.depMs} className={`row ${s.blok} ${best ? "is-filled" : ""}`}>
                <span className={s.blokMain}>
                  <span className={s.blokTijd}>{tijdblok(o.depMs, o.result.arrMs)}</span>
                  <span className={s.blokReden}>{reden(o, fromTide)}</span>
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

// 24-uurs stroomkromme van de gekozen etappe, op de dag waarop de boot die etappe begint;
// de band markeert wanneer de boot op de etappe vaart. Gaten blijven gaten.
const W = 300, HG = 90, PAD = 6;
function StroomKromme({ etappe, timeline, depMs }: { etappe: Etappe; timeline?: LegTimeline; depMs: number }) {
  const dag = localDateISO(etappe.vanMs ?? depMs);
  const van = localMidnight(noon(dag)), tot = localMidnight(noon(addDays(dag, 1)));
  const { series } = combineLegTimelines(timeline ? [timeline] : []);
  const segs = krommeSegmenten(series, van, tot);
  const maxAbs = Math.max(0.5, ...segs.flat().map((q) => Math.abs(q.v)));
  const x = (ms: number) => ((Math.min(tot, Math.max(van, ms)) - van) / (tot - van)) * W;
  const y = (v: number) => HG / 2 - (v / maxAbs) * (HG / 2 - PAD);
  return (
    <div className={`card ${s.krommeKaart}`}>
      <div>
        <div className={s.sectie}>STROOM · {etappe.label.toUpperCase()} · 24 UUR</div>
        <div className={s.noot}>{fmt(dag, { weekday: "short", day: "numeric", month: "short" })}</div>
      </div>
      {!segs.length ? (
        <div className={s.leeg}>—<div className={s.noot}>geen stroomdata voor deze etappe op deze dag</div></div>
      ) : (
        <svg className={s.kromme} viewBox={`0 0 ${W} ${HG}`} role="img" aria-label={`stroom langs ${etappe.label} over 24 uur`}>
          {etappe.vanMs != null && etappe.totMs != null && (
            <rect x={x(etappe.vanMs)} width={Math.max(1, x(etappe.totMs) - x(etappe.vanMs))} y={0} height={HG} className={s.onderweg} />
          )}
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
        <span><span className={`${s.stip} ${s.stipOnderweg}`} />ONDERWEG</span>
      </div>
    </div>
  );
}
