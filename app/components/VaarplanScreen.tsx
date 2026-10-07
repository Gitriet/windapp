"use client";
// VAARPLAN — detail van het gekozen vertrek: tijdblok + KPI's, etappes (stroom per
// segment, kentering, wind), haveninfo met VHF uit de data, getijpoort, VHF-posten en
// uitwijkhavens. De gekozen etappe toont zijn eigen 24-uurs stroomkromme (bij een route
// zonder tussenstops = de hele tocht). Geen nieuwe berekeningen: alles uit SimResult, stroom, haveninfo en getij.
import { useId, useMemo, useState } from "react";
import { localDateISO, localHM } from "@/lib/tz";
import { dirLabel16, fmtDuurKort, sailPhrase, tijdblok } from "@/lib/format";
import {
  combineLegTimelines, effectLabel, etappes, letOp,
  type Etappe, type EtappeLeg, type GustSample, type LegTimeline, type ViaHaven, type WaveSample,
} from "@/lib/tocht";
import { krommeBereik, krommeKenteringen, krommePieken, krommeSegmenten } from "@/lib/getij";
import { gateDatumFor, gateWindows, windowContains } from "@/lib/gates";
import type { SimResult, SimStep } from "@/lib/tripsim";
import type { RouteHaven } from "@/lib/planner-data";
import { toegangVan, TOEGANG_LABEL } from "@/lib/haven-info";
import KUST from "@/lib/kust.json";
import type { TideData } from "@/lib/types";
import type { BoatProfile } from "@/lib/polar";
import { Skeleton } from "./Shell";
import { HavenDetail, ToegangMarkering } from "./HavenSelector";
import { WindArrow, WindHoekIcon } from "./icons";
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
  punten: RouteHaven[];                   // de gevaren route: havens én knooppunten in vaarvolgorde
  lijn: { lat: number; lon: number }[];   // route-geometrie voor het kaartje
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

      <RouteKaart punten={p.punten} lijn={p.lijn} />

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
      {et[sel] && <WindTegel steps={trip.steps} gusts={gusts} depMs={depMs} arrMs={trip.arrMs} />}

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

// Kaartje van de route op een eigen kustlijn (lib/kust.json: Natural Earth 1:10m, publiek domein, bijgesneden
// en vereenvoudigd): land als vlak, zee als achtergrond, in de kleuren van de app. Geen externe
// kaartdienst. De route (echte punten langs de vaargeul), vertrek (groen), aankomst (vol) en alleen
// de havens die ertoe doen — vertrek, aankomst en tussenhavens van deze route. Namen worden zo
// geplaatst dat ze nooit over de route of over een andere naam lopen. Noord boven.
const KW = 300, KH = 200, KPAD = 26, KMIN = 0.5;   // KMIN: minimaal venster in graden, de kust is grof
const wereldX = (lon: number) => (lon + 180) / 360;   // genormeerd Web Mercator (0–1)
const wereldY = (lat: number) => {
  const r = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
};
type Vak = { x0: number; x1: number; y0: number; y1: number };
function RouteKaart({ punten, lijn }: { punten: RouteHaven[]; lijn: { lat: number; lon: number }[] }) {
  const alle = lijn.length >= 2 ? lijn : punten;
  if (alle.length < 2) return null;
  const xs = alle.map((q) => wereldX(q.lon)), ys = alle.map((q) => wereldY(q.lat));
  const minSpan = wereldX(KMIN) - wereldX(0);   // KMIN graden in genormeerde eenheden
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const sc = Math.min((KW - 2 * KPAD) / Math.max(x1 - x0, minSpan), (KH - 2 * KPAD) / Math.max(y1 - y0, minSpan));   // eenheden per genormeerde eenheid
  const px = (q: { lat: number; lon: number }) => (wereldX(q.lon) - cx) * sc + KW / 2;
  const py = (q: { lat: number; lon: number }) => (wereldY(q.lat) - cy) * sc + KH / 2;
  // land: alle ringen als één pad (even-odd, dus meren en binnenwater blijven open)
  const land = KUST.ringen.map((r) => {
    const pts: string[] = [];
    for (let i = 0; i < r.length; i += 2) pts.push(`${px({ lon: r[i] / 1e4, lat: r[i + 1] / 1e4 }).toFixed(1)},${py({ lon: r[i] / 1e4, lat: r[i + 1] / 1e4 }).toFixed(1)}`);
    return `M${pts.join("L")}Z`;
  }).join("");

  // namen: alleen routehavens, op de eerste plek rond de stip die geen route of andere naam raakt
  const route = alle.map((q) => ({ x: px(q), y: py(q) }));
  const raakt = (v: Vak) => route.some((q, i) => {
    const p = route[i + 1];
    if (!p) return q.x >= v.x0 && q.x <= v.x1 && q.y >= v.y0 && q.y <= v.y1;
    const stap = Math.max(1, Math.ceil(Math.hypot(p.x - q.x, p.y - q.y) / 1.5));
    for (let t = 0; t <= stap; t++) {
      const x = q.x + ((p.x - q.x) * t) / stap, y = q.y + ((p.y - q.y) * t) / stap;
      if (x >= v.x0 && x <= v.x1 && y >= v.y0 && y <= v.y1) return true;
    }
    return false;
  });
  const echt = punten.filter((h) => h.soort !== "knoop");
  const dots: Vak[] = echt.map((h) => ({ x0: px(h) - 5, x1: px(h) + 5, y0: py(h) - 5, y1: py(h) + 5 }));
  const geplaatst: Vak[] = [];
  const namen = echt.map((h, i) => {
    const x = px(h), y = py(h), w = h.naam.length * 5.6 + 4;
    const kand = [
      { anchor: "start", tx: x + 8, v: { x0: x + 7, x1: x + 8 + w, y0: y - 7, y1: y + 4 } },
      { anchor: "end", tx: x - 8, v: { x0: x - 8 - w, x1: x - 7, y0: y - 7, y1: y + 4 } },
      { anchor: "middle", tx: x, ty: y - 9, v: { x0: x - w / 2, x1: x + w / 2, y0: y - 18, y1: y - 7 } },
      { anchor: "middle", tx: x, ty: y + 16, v: { x0: x - w / 2, x1: x + w / 2, y0: y + 6, y1: y + 18 } },
    ];
    const vrij = (v: Vak) => v.x0 >= 2 && v.x1 <= KW - 2 && v.y0 >= 2 && v.y1 <= KH - 2 && !raakt(v)
      && !geplaatst.some((g) => v.x0 < g.x1 && v.x1 > g.x0 && v.y0 < g.y1 && v.y1 > g.y0)
      && !dots.some((d, j) => j !== i && v.x0 < d.x1 && v.x1 > d.x0 && v.y0 < d.y1 && v.y1 > d.y0);
    const kies = kand.find((c) => vrij(c.v));
    if (!kies) return null;   // geen vrije plek: liever geen naam dan een naam over een lijn
    geplaatst.push(kies.v);
    return { key: h.haven, naam: h.naam, x: kies.tx, y: kies.ty ?? y + 3, anchor: kies.anchor as "start" | "end" | "middle" };
  });
  const van = echt[0], naar = echt[echt.length - 1];
  return (
    <div className={`card ${s.krommeKaart}`}>
      <div className={s.sectie}>ROUTE</div>
      <svg className={s.kaart} viewBox={`0 0 ${KW} ${KH}`} role="img" aria-label={`kaartje van de route ${punten[0].naam} naar ${punten[punten.length - 1].naam}`}>
        <path d={land} fillRule="evenodd" className={s.kaartLand} />
        <polyline className={s.kaartRouteRand} points={route.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" ")} />
        <polyline className={s.kaartRoute} points={route.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" ")} />
        {echt.slice(1, -1).map((h) => <circle key={h.haven} cx={px(h)} cy={py(h)} r={3} className={s.kaartTussen} />)}
        {van && <circle cx={px(van)} cy={py(van)} r={4.5} className={s.kaartVan} />}
        {naar && <circle cx={px(naar)} cy={py(naar)} r={4.5} className={s.kaartNaar} />}
        {namen.map((m) => m && <text key={m.key} x={m.x} y={m.y} textAnchor={m.anchor} className={s.kaartNaam}>{m.naam}</text>)}
      </svg>
    </div>
  );
}

// Aslabels onder een tijdgrafiek: de vertrekdag (00–24) of het meeschuivende venster.
function TijdAs({ van, tot, dagweergave }: { van: number; tot: number; dagweergave: boolean }) {
  return (
    <div className={s.as}>
      {dagweergave ? <><span>00:00</span><span>12:00</span><span>24:00</span></>
        : [van, (van + tot) / 2, tot].map((ms) => <span key={ms}>{asLabel(ms)}</span>)}
    </div>
  );
}

// WIND-tegel: windsnelheid (kn) langs de route, met
// eronder de windhoek t.o.v. de boot: per zeilhoek-stuk (aan de wind / halve wind / ruime wind /
// voor de wind) een vak met het icoon (boot, ring, bolletje = waar de wind de boot raakt).
// Eigen tijdas = de vaartijd (vertrek–aankomst); de data zijn de sim-stappen van het gekozen vertrek.
const WH = 44, WPAD = 4, WLBL = 12, BAND_Y = 52, BAND_H = 26, WTOT = BAND_Y + BAND_H;
function WindTegel({ steps, gusts, depMs, arrMs }: { steps: SimStep[]; gusts: GustSample[]; depMs: number; arrMs: number | null }) {
  const eind = arrMs ?? depMs;
  const van = depMs, tot = Math.max(eind, depMs + 1);   // eigen tijdas: precies de vaartijd
  const pts = steps.filter((q) => q.tMs >= depMs && q.tMs <= eind);
  if (pts.length < 2) return null;
  const maxW = Math.max(10, ...pts.map((q) => q.wSpd));
  const x = (ms: number) => ((Math.min(tot, Math.max(van, ms)) - van) / (tot - van)) * W;
  const y = (v: number) => WH - WPAD - (v / maxW) * (WH - WPAD - WLBL);
  const lijn = pts.map((q) => `${x(q.tMs).toFixed(1)},${y(q.wSpd).toFixed(1)}`);
  const top = pts.reduce((m, q) => (q.wSpd > m.wSpd ? q : m), pts[0]);
  const eerste = pts[0], laatste = pts[pts.length - 1];
  // hardste vlaag binnen de vaartijd (uurwaarden van de stations langs de route; vanaf het uur van vertrek)
  const vlagen = gusts.filter((g) => g.ms >= Math.floor(depMs / H) * H && g.ms <= eind);
  const vlaag = vlagen.length ? vlagen.reduce((m, g) => (g.gustKn > m.gustKn ? g : m)) : null;
  // beginlabel boven het hoogste punt van de lijn onder het label, zodat de lijn er niet doorheen loopt
  const startLabelY = Math.min(...pts.filter((q) => x(q.tMs) <= x(eerste.tMs) + 30).map((q) => y(q.wSpd)));
  // zeilhoek-stukken: opeenvolgende stappen met dezelfde omschrijving
  const stukken: { fraseer: string; van: number; tot: number; stappen: SimStep[] }[] = [];
  pts.forEach((q, i) => {
    const fraseer = sailPhrase(q.twa), t1 = pts[i + 1]?.tMs ?? q.tMs;
    const vorige = stukken[stukken.length - 1];
    if (vorige && vorige.fraseer === fraseer) { vorige.tot = t1; vorige.stappen.push(q); }
    else stukken.push({ fraseer, van: q.tMs, tot: t1, stappen: [q] });
  });
  return (
    <div className={`card ${s.krommeKaart}`}>
      <div className={s.sectie}>WIND ONDERWEG · KN</div>
      <svg className={s.kromme} viewBox={`0 0 ${W} ${WTOT}`} role="img" aria-label="windsnelheid en windhoek langs de route">
        <polygon className={s.windVlak} points={`${x(eerste.tMs).toFixed(1)},${WH - WPAD} ${lijn.join(" ")} ${x(laatste.tMs).toFixed(1)},${WH - WPAD}`} />
        <polyline className={s.windLijn} points={lijn.join(" ")} />
        <circle cx={x(top.tMs)} cy={y(top.wSpd)} r={3} className={s.windStipRand} />
        <text x={labelX(x(top.tMs))} y={y(top.wSpd) - 6} className={s.windLabel}>{Math.round(top.wSpd)} kn · {localHM(top.tMs)}</text>
        {x(top.tMs) - x(eerste.tMs) > 70 && (
          <text x={x(eerste.tMs) + 4} y={startLabelY - 5} className={`${s.windLabel} ${s.windLabelStart}`}>{Math.round(eerste.wSpd)} kn</text>
        )}
        {stukken.map((st, i) => {
          const x0 = x(st.van), x1 = x(st.tot), breed = x1 - x0, midX = (x0 + x1) / 2;
          const icoon = breed >= 22, mid_ = st.stappen[Math.floor(st.stappen.length / 2)];
          return (
            <g key={i}>
              <rect x={x0} y={BAND_Y} width={Math.max(0, breed)} height={BAND_H} className={s.hoekVak} />
              {icoon && <WindHoekIcon rel={mid_.wDir - mid_.course} size={20} x={midX - 10} y={BAND_Y + 3} className={s.hoekIcoon} />}
            </g>
          );
        })}
      </svg>
      <TijdAs van={van} tot={tot} dagweergave={false} />
      {vlaag && <div className={s.windVlagen}>Vlagen tot {Math.round(vlaag.gustKn)}&nbsp;kn rond {localHM(vlaag.ms)}</div>}
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
      <div className={s.sectie}>STROOM LANGS DE ROUTE</div>
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
      <TijdAs van={van} tot={tot} dagweergave={dagweergave} />
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
