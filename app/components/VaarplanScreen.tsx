"use client";
// VAARPLAN — detail van het gekozen vertrek: tijdblok + KPI's, etappes (stroom per
// segment, kentering, wind), haveninfo met VHF uit de data, getijpoort, VHF-posten en
// uitwijkhavens. Geen nieuwe berekeningen: alles uit SimResult, haveninfo en getij.
import { useMemo } from "react";
import { localHM, localDateISO } from "@/lib/tz";
import { dirLabel16, fmtDuurKort, tijdblok } from "@/lib/format";
import { effectLabel, etappes, letOp, type EtappeLeg, type GustSample, type ViaHaven } from "@/lib/tocht";
import { gateDatumFor, gateWindows, windowContains } from "@/lib/gates";
import type { SimResult } from "@/lib/tripsim";
import type { RouteHaven } from "@/lib/planner-data";
import type { TideData } from "@/lib/types";
import type { BoatProfile } from "@/lib/polar";
import { Skeleton } from "./Shell";
import { WindArrow } from "./icons";
import s from "./VaarplanScreen.module.css";

const H = 3_600_000;
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
  boatNaam: string;
  anyStroom: boolean;
}

export default function VaarplanScreen(p: VaarplanScreenProps) {
  if (!p.ready) return <Skeleton rows={3} height={72} label="vaarplan laden" />;
  const { trip, depMs, from, to } = p;
  if (!trip || depMs == null || !from || !to) return (
    <div className={s.leeg}>—<div className={s.noot}>kies een vertrek op ROUTE</div></div>
  );
  return <Plan {...p} trip={trip} depMs={depMs} from={from} to={to} />;
}

function Plan({ trip, depMs, from, to, distanceNm, bearingDeg, legs, gusts, fromTide, via, boat, boatNaam, anyStroom }:
  VaarplanScreenProps & { trip: SimResult; depMs: number; from: RouteHaven; to: RouteHaven }) {
  const et = useMemo(() => etappes(trip, legs, gusts), [trip, legs, gusts]);
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
          {et.map((e) => (
            <div key={e.label} className={`card ${s.etappe}`}>
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
            </div>
          ))}
        </div>
      </div>

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
          <div className={s.noot}>VHF indicatief — controleer de actuele kanalen (ANWB Wateralmanak). {boatNaam} · {Math.round(boat.performance * 100)}% polaire</div>
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
