"use client";
// VAARPLAN — detail van het gekozen vertrek: tijdblok + KPI's, etappes (stroom per
// segment, kentering, wind), haveninfo met VHF uit de data, getijpoort, VHF-posten en
// uitwijkhavens. De gekozen etappe toont zijn eigen 24-uurs stroomkromme (bij een route
// zonder tussenstops = de hele tocht). Geen nieuwe berekeningen: alles uit SimResult, stroom, haveninfo en getij.
import { useId, useMemo, useState } from "react";
import { localDateISO, localHM } from "@/lib/tz";
import { dirLabel16, fmtDuurKort, tijdblok } from "@/lib/format";
import {
  combineLegTimelines, effectLabel, etappes, letOp,
  type Etappe, type EtappeLeg, type GustSample, type LegTimeline, type ViaHaven, type WaveSample,
} from "@/lib/tocht";
import { krommeBereik, krommeKenteringen, krommePieken, krommeSegmenten } from "@/lib/getij";
import { gateDatumFor, gateWindows, windowContains } from "@/lib/gates";
import type { SimResult } from "@/lib/tripsim";
import type { RouteHaven } from "@/lib/planner-data";
import { toegangVan, TOEGANG_LABEL } from "@/lib/haven-info";
import type { TideData } from "@/lib/types";
import type { BoatProfile } from "@/lib/polar";
import { Skeleton } from "./Shell";
import { HavenDetail, ToegangMarkering } from "./HavenSelector";
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
  waves: WaveSample[];
  fromTide: TideData | null;
  via: ViaHaven[];
  boat: BoatProfile;
  anyStroom: boolean;
  etappeTimelines: LegTimeline[][];       // stroom per etappe: de legs van die etappe (zelfde volgorde als legs)
}

export default function VaarplanScreen(p: VaarplanScreenProps) {
  if (!p.ready) return <Skeleton rows={3} height={72} label="vaarplan laden" tekst="Berekening wordt gemaakt…" />;
  const { trip, depMs, from, to } = p;
  if (!trip || depMs == null || !from || !to) return (
    <div className={s.leeg}>—<div className={s.noot}>kies een vertrek op ROUTE</div></div>
  );
  return <Plan {...p} trip={trip} depMs={depMs} from={from} to={to} />;
}

function Plan(p: VaarplanScreenProps & { trip: SimResult; depMs: number; from: RouteHaven; to: RouteHaven }) {
  const { trip, depMs, from, to, distanceNm, bearingDeg, legs, gusts, waves, fromTide, via, boat, anyStroom } = p;
  const et = useMemo(() => etappes(trip, legs, gusts, waves), [trip, legs, gusts, waves]);
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
                  {e.vlaagKn != null && <span className={s.vlaag}>VLAGEN <span className={s.windKn}>{Math.round(e.vlaagKn)}&nbsp;KN</span></span>}
                  {e.golfM != null && <span className={s.vlaag}>GOLF <span className={s.windKn}>{komma(e.golfM)}&nbsp;M</span></span>}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {et[sel] && <StroomKromme etappe={et[sel]} timelines={p.etappeTimelines[sel] ?? []} depMs={depMs} arrMs={trip.arrMs} />}

      <div>
        <div className={s.sectie}>HAVENINFO</div>
        <div className={s.lijst}>
          <Haven rol="VERTREK" haven={from} diepgang={boat.draftM} />
          <Haven rol="AANKOMST" haven={to} diepgang={boat.draftM} />
          {poort && (   // alleen bij een drempelhaven met getijcurve; anders geen regel
            <div className={`row ${s.poort}`} data-status={poort}>
              GETIJPOORT VERTREK · {poort === "open" ? "OPEN BIJ VERTREK" : "DICHT BIJ VERTREK"}
            </div>
          )}
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

// Havenkaart: naam + toegangsstip + eerste VHF-kanaal uit de data; subregel = havennaam + toegang.
// Klik klapt de volledige haveninfo open (zelfde detail als in de routekiezer).
function Haven({ rol, haven, diepgang }: { rol: string; haven: RouteHaven; diepgang: number }) {
  const [open, setOpen] = useState(false);
  const h = haven.havenInfo;
  const vhf = h?.vhf[0];
  const kop = (
    <>
      <div className={s.etappeKop}>
        <span className={s.havenNaam}>{rol} · {haven.naam}{h && <> <ToegangMarkering h={h} /></>}</span>
        <span className={s.havenVhf} title={vhf?.dienst}>
          {vhf && <>VHF&nbsp;{vhf.kanaal}</>}{h && <span className={s.chevron} aria-hidden>{open ? "▴" : "▾"}</span>}
        </span>
      </div>
      {h && <div className={s.havenSub}>{h.havenNaam} · {TOEGANG_LABEL[toegangVan(h)]}{h.sluis ? ` · ${h.sluis.naam}` : ""}</div>}
    </>
  );
  return (
    <div className={`card ${s.haven}`}>
      {h ? <button type="button" className={s.havenKnop} aria-expanded={open} onClick={() => setOpen((o) => !o)}>{kop}</button> : kop}
      {h && open && <div className={s.havenDetail}><HavenDetail havenInfo={h} bootDiepgang={diepgang} /></div>}
    </div>
  );
}

// Stroomkromme van de tocht: de vertrekdag (00–24), of bij een tocht over middernacht een
// venster dat met de tocht meeschuift (krommeBereik). De vaartijd (vertrek–aankomst) staat
// tussen twee haarlijnen en is in volle kleur, de rest gedimd; een gestreepte lijn = nu.
// Gaten blijven gaten. Een etappe via knooppunten bestaat uit meerdere legs: hun stroom
// telt naar lengte gewogen mee.
// Labels alleen binnen de vaartijd: bij een piek sterkte + tijd (mee erboven, tegen
// eronder), bij een kentering de tijd naast de open stip. Daarbuiten alleen gedimde
// stippen. LBL = ruimte voor de pieklabels.
const W = 300, HG = 116, PAD = 6, LBL = 12;
const kn = (v: number) => Math.abs(v).toFixed(1).replace(".", ",");
const labelX = (px: number) => Math.min(W - 34, Math.max(34, px));
// aslabel bij een meeschuivend venster: dag erbij, want het loopt over middernacht
const asLabel = (ms: number) =>
  `${new Intl.DateTimeFormat("nl-NL", { weekday: "short", timeZone: "Europe/Amsterdam" }).format(ms).replace(".", "").toUpperCase()} ${localHM(ms)}`;
function StroomKromme({ etappe, timelines, depMs, arrMs }: { etappe: Etappe; timelines: LegTimeline[]; depMs: number; arrMs: number | null }) {
  const { van, tot, dagweergave } = krommeBereik(depMs, arrMs);
  const eind = arrMs ?? depMs;
  const nu = Date.now();
  const inTocht = (ms: number) => ms >= depMs && ms <= eind;
  const { series } = combineLegTimelines(timelines);
  // alleen als élk stuk van de etappe stroomdata heeft; anders zou de curve een deel voor het geheel tonen
  const segs = etappe.stroom ? krommeSegmenten(series, van, tot) : [];
  const maxAbs = Math.max(0.5, ...segs.flat().map((q) => Math.abs(q.v)));
  const x = (ms: number) => ((Math.min(tot, Math.max(van, ms)) - van) / (tot - van)) * W;
  const y = (v: number) => HG / 2 - (v / maxAbs) * (HG / 2 - PAD - LBL);
  const kenteringen = segs.flatMap(krommeKenteringen);
  // lijn boven de nullijn = mee (groen), eronder = tegen (oker): dezelfde lijn twee keer, geknipt
  const clip = useId().replace(/:/g, "");
  return (
    <div className={`card ${s.krommeKaart}`}>
      <div className={s.sectie}>STROOM LANGS DE ROUTE · MEE / TEGEN</div>
      {!segs.length ? (
        <div className={s.leeg}>—<div className={s.noot}>{etappe.stroom ? "geen stroomdata voor deze etappe op deze dag" : "stroomdata ontbreekt voor een deel van de tocht"}</div></div>
      ) : (
        <svg className={s.kromme} viewBox={`0 0 ${W} ${HG}`} role="img" aria-label={`stroom langs ${etappe.label} over 24 uur`}>
          <line x1={0} x2={W} y1={HG / 2} y2={HG / 2} className={s.nullijn} />
          <clipPath id={`${clip}m`}><rect x={0} y={0} width={W} height={HG / 2} /></clipPath>
          <clipPath id={`${clip}t`}><rect x={0} y={HG / 2} width={W} height={HG / 2} /></clipPath>
          <clipPath id={`${clip}v`}><rect x={x(depMs)} y={0} width={Math.max(0, x(eind) - x(depMs))} height={HG} /></clipPath>
          {/* de hele dag gedimd, de vaartijd daaroverheen in volle kleur */}
          {[s.buiten, undefined].map((cls, laag) => (
            <g key={laag} className={cls} clipPath={laag ? `url(#${clip}v)` : undefined}>
              {segs.map((seg, i) => {
                const pts = seg.map((q) => `${x(q.ms).toFixed(1)},${y(q.v).toFixed(1)}`).join(" ");
                return (
                  <g key={i}>
                    <polyline className={s.lijn} points={pts} clipPath={`url(#${clip}m)`} />
                    <polyline className={`${s.lijn} ${s.lijnTegen}`} points={pts} clipPath={`url(#${clip}t)`} />
                  </g>
                );
              })}
            </g>
          ))}
          {[depMs, eind].map((ms) => <line key={ms} x1={x(ms)} x2={x(ms)} y1={0} y2={HG} className={s.vaartijd} />)}
          {nu > van && nu < tot && (
            <line x1={x(nu)} x2={x(nu)} y1={0} y2={HG} className={s.nuLijn} />
          )}
          {segs.flatMap(krommePieken).map((q) => (
            <g key={q.ms} className={inTocht(q.ms) ? undefined : s.buiten}>
              <circle cx={x(q.ms)} cy={y(q.v)} r={4} className={q.soort === "mee" ? s.piekMee : s.piekTegen} />
              {inTocht(q.ms) && <text x={labelX(x(q.ms))} y={q.soort === "mee" ? y(q.v) - 8 : y(q.v) + 15}
                className={`${s.krommeLabel} ${q.soort === "mee" ? s.labelMee : s.labelTegen}`}>
                {kn(q.v)} kn · {localHM(q.ms)}
              </text>}
            </g>
          ))}
          {/* tijd rechts van de kentering aan de kant waar de lijn niet loopt; aan de rechterrand
              links ervan (en dus aan de andere kant van de nullijn) */}
          {kenteringen.map(({ ms, naarMee }) => {
            const rechts = x(ms) > W - 30;
            return (
              <g key={ms} className={inTocht(ms) ? undefined : s.buiten}>
                <circle cx={x(ms)} cy={HG / 2} r={3} className={s.kentering} />
                {inTocht(ms) && <text x={x(ms) + (rechts ? -5 : 5)} y={naarMee !== rechts ? HG / 2 + 11 : HG / 2 - 5}
                  className={s.kenteringLabel} textAnchor={rechts ? "end" : "start"}>{localHM(ms)}</text>}
              </g>
            );
          })}
        </svg>
      )}
      <div className={s.as}>
        {dagweergave ? <><span>00:00</span><span>12:00</span><span>24:00</span></>
          : [van, (van + tot) / 2, tot].map((ms) => <span key={ms}>{asLabel(ms)}</span>)}
      </div>
      <div className={s.legenda}>
        <span><span className={`${s.stip} ${s.piekMee}`} />MEESTROOM</span>
        <span><span className={`${s.stip} ${s.piekTegen}`} />TEGENSTROOM</span>
        <span><span className={`${s.stip} ${s.stipKentering}`} />KENTERING</span>
        <span><span className={`${s.stip} ${s.stipVertrek}`} />VAARTIJD</span>
        <span><span className={`${s.stip} ${s.stipNu}`} />NU</span>
      </div>
    </div>
  );
}
