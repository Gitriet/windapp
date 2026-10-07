"use client";
// VAARPLAN — detail van het gekozen vertrek: tijdblok + KPI's, etappes (stroom per
// segment, kentering, wind), haveninfo met VHF uit de data, getijpoort, VHF-posten en
// uitwijkhavens. De gekozen etappe toont zijn eigen 24-uurs stroomkromme (bij een route
// zonder tussenstops = de hele tocht). Geen nieuwe berekeningen: alles uit SimResult, stroom, haveninfo en getij.
import { useId, useMemo, useState } from "react";
import { localDateISO, localHM } from "@/lib/tz";
import { dirLabel16, fmtDuurKort, sailPhrase, tijdblok } from "@/lib/format";
import {
  effectLabel, etappes, letOp,
  type Etappe, type EtappeLeg, type GustSample, type ViaHaven, type WaveSample,
} from "@/lib/tocht";
import { krommeKenteringen } from "@/lib/getij";
import { gladReeks, rasterWaarden } from "@/lib/grafiek";
import { toegangsVensters } from "@/lib/gates";
import type { SimResult, SimStep } from "@/lib/tripsim";
import type { RouteHaven } from "@/lib/planner-data";
import { toegangVan, TOEGANG_LABEL } from "@/lib/haven-info";
import KUST from "@/lib/kust.json";
import { DOORVAART } from "@/lib/alternatieven";
import type { TideData } from "@/lib/types";
import type { BoatProfile } from "@/lib/polar";
import { Skeleton } from "./Shell";
import { HavenDetail, ToegangMarkering } from "./HavenSelector";
import { WindArrow, WindHoekIcon } from "./icons";
import { Raster, RASTER_GUT } from "./Raster";
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
  toTide: TideData | null;                // getij bij de aankomsthaven (alleen havens met toegangsmodel)
  via: ViaHaven[];
  boat: BoatProfile;
  anyStroom: boolean;
  punten: RouteHaven[];                   // de gevaren route: havens én knooppunten in vaarvolgorde
  lijn: { lat: number; lon: number }[];   // route-geometrie voor het kaartje
}

export default function VaarplanScreen(p: VaarplanScreenProps) {
  if (!p.ready) return (
    <>
      <Skeleton rows={1} height={200} label="vaarplan laden" tekst="Berekening wordt gemaakt…" />
      <Skeleton rows={2} height={110} label="etappes laden" />
    </>
  );
  const { trip, depMs, from, to } = p;
  if (!trip || depMs == null || !from || !to) return (
    <div className={s.leeg}>—<div className={s.noot}>kies een vertrek op ROUTE</div></div>
  );
  return <Plan {...p} trip={trip} depMs={depMs} from={from} to={to} />;
}

function Plan(p: VaarplanScreenProps & { trip: SimResult; depMs: number; from: RouteHaven; to: RouteHaven }) {
  const { trip, depMs, from, to, distanceNm, bearingDeg, legs, gusts, waves, fromTide, toTide, via, boat, anyStroom } = p;
  const et = useMemo(() => etappes(trip, legs, gusts, waves), [trip, legs, gusts, waves]);
  const [selRaw, setSel] = useState(0);
  const sel = Math.min(selRaw, Math.max(0, et.length - 1));   // nieuwe route met minder etappes
  const warn = letOp(trip, bearingDeg ?? 0, gusts);
  const maxAbs = Math.max(0.3, ...et.flatMap((e) => e.segmenten.map(Math.abs)));
  const dag = localDateISO(depMs) === localDateISO(Date.now()) ? "vandaag"
    : new Intl.DateTimeFormat("nl-NL", { weekday: "long", timeZone: "Europe/Amsterdam" }).format(depMs);

  // toegang tot de haven bij vertrek en bij aankomst (ETA): venster uit de drempeldiepte (exact) of, voor
  // havens zonder diepte-data op de halftij-lijst, uit laag- en hoogwater (indicatie). Alleen havens met
  // een toegangsmodel en een getijcurve krijgen een regel. Het advies verandert er niet door: het is een melding.
  const vereist = boat.draftM + boat.keelClearanceM;
  const poorten = useMemo(() => [
    toegangRegel("VERTREK", from, fromTide, depMs, vereist),
    trip.arrMs != null ? toegangRegel("AANKOMST", to, toTide, trip.arrMs, vereist) : null,
  ].filter((x): x is ToegangRegel => x != null), [from, to, fromTide, toTide, depMs, trip.arrMs, vereist]);

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
      {(warn.hardWind || warn.windTegenStroom || poorten.some((g) => !g.open)) && (
        <div className={s.chips}>
          {warn.hardWind && <span className={s.letOp}>LET OP · HARDE WIND</span>}
          {warn.windTegenStroom && <span className={s.letOp}>LET OP · WIND TEGEN STROOM</span>}
          {poorten.filter((g) => !g.open).map((g) => <span key={g.rol} className={s.letOp}>LET OP · HAVEN {g.rol} DICHT BIJ {g.rol === "VERTREK" ? "VERTREK" : "ETA"}</span>)}
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

      {et[sel] && <StroomKromme etappe={et[sel]} steps={trip.steps} progVan={et.slice(0, sel).reduce((a, e) => a + e.distNm, 0)} />}
      {et[sel] && <WindTegel steps={trip.steps} gusts={gusts} depMs={depMs} arrMs={trip.arrMs} />}
      {et[sel] && <SnelheidTegel steps={trip.steps} depMs={depMs} arrMs={trip.arrMs} distanceNm={distanceNm} />}

      <div>
        <div className={s.sectie}>HAVENINFO</div>
        <div className={s.lijst}>
          <Haven rol="VERTREK" haven={from} diepgang={boat.draftM} />
          <Haven rol="AANKOMST" haven={to} diepgang={boat.draftM} />
          {poorten.map((g) => (   // alleen havens met een toegangsmodel en getijcurve; anders geen regel
            <div key={g.rol} className={`row ${s.poort}`} data-status={g.open ? "open" : "dicht"}>{g.tekst}</div>
          ))}
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

type ToegangRegel = { rol: "VERTREK" | "AANKOMST"; open: boolean; tekst: string };
const venster = (w: { fromMs: number; toMs: number }) => `${localHM(w.fromMs)}–${localHM(w.toMs)}`;
// Eén regel per haven: open/dicht op het tijdstip `ms` (vertrek of ETA), met het venster waarin je erin kunt.
function toegangRegel(rol: "VERTREK" | "AANKOMST", haven: RouteHaven, tide: TideData | null, ms: number, vereistM: number): ToegangRegel | null {
  const bron = tide ? (tide.expected.length ? tide.expected : tide.astro) : [];
  if (!tide || !bron.length) return null;
  // buiten de getijreeks weten we het niet: dan geen regel (nooit 'dicht' door gebrek aan data)
  const utc = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));
  if (ms < utc(bron[0].t) || ms > utc(bron[bron.length - 1].t)) return null;
  const t = toegangsVensters(haven.haven, tide, vereistM, ms - 14 * H, ms + 14 * H);
  if (!t) return null;
  const nu = t.vensters.find((w) => ms >= w.fromMs && ms <= w.toMs);
  const volgend = t.vensters.find((w) => w.fromMs > ms);
  const moment = rol === "VERTREK" ? "VERTREK" : `ETA ${localHM(ms)}`;
  const naam = t.soort === "halftij" ? "TOEGANG (INDICATIE, HALFTIJ)" : "GETIJPOORT";
  const tekst = nu ? `${naam} ${rol} · OPEN BIJ ${moment} · ${venster(nu)}`
    : `${naam} ${rol} · DICHT BIJ ${moment}${volgend ? ` · OPEN ${venster(volgend)}` : ""}`;
  return { rol, open: !!nu, tekst };
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

// Kaartje van de route op een eigen kustlijn (lib/kust.json, gemaakt door scripts/maak-kust.py uit PDOK Top10NL
// en Natural Earth, vereenvoudigd): land als vlak, droogvallende platen als lichter vlak, zee als achtergrond,
// in de kleuren van de app. Geen externe kaartdienst. De route (echte punten langs de vaargeul), vertrek (groen), aankomst (vol) en alleen
// de havens die ertoe doen — vertrek, aankomst en tussenhavens van deze route. Namen worden zo
// geplaatst dat ze nooit over de route of over een andere naam lopen. Noord boven.
const KW = 300, KH_MIN = 140, KH_MAX = 330, KPAD = 18, KMIN = 0.5;   // KMIN: minimaal venster in graden, de kust is grof; de hoogte volgt de vorm van de route
const wereldX = (lon: number) => (lon + 180) / 360;   // genormeerd Web Mercator (0–1)
const wereldY = (lat: number) => {
  const r = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
};
type Vak = { x0: number; x1: number; y0: number; y1: number };
// kustringen met hun omhullende (lon/lat), zodat alleen de ringen in beeld getekend worden
const metBereik = (ringen: number[][]) => ringen.map((r) => {
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
  for (let i = 0; i < r.length; i += 2) { a = Math.min(a, r[i]); b = Math.max(b, r[i]); c = Math.min(c, r[i + 1]); d = Math.max(d, r[i + 1]); }
  return { r, lon0: a / 1e4, lon1: b / 1e4, lat0: c / 1e4, lat1: d / 1e4 };
});
const LAND = metBereik(KUST.land), PLATEN = metBereik(KUST.platen);
function RouteKaart({ punten, lijn }: { punten: RouteHaven[]; lijn: { lat: number; lon: number }[] }) {
  const alle = lijn.length >= 2 ? lijn : punten;
  if (alle.length < 2) return null;
  const xs = alle.map((q) => wereldX(q.lon)), ys = alle.map((q) => wereldY(q.lat));
  const minSpan = wereldX(KMIN) - wereldX(0);   // KMIN graden in genormeerde eenheden
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  // kaarthoogte naar de vorm van de route (liggend of staand), zodat het kader zo vol mogelijk is
  const KH = Math.round(Math.min(KH_MAX, Math.max(KH_MIN, (KW - 2 * KPAD) * (Math.max(y1 - y0, minSpan) / Math.max(x1 - x0, minSpan)) + 2 * KPAD)));
  const sc = Math.min((KW - 2 * KPAD) / Math.max(x1 - x0, minSpan), (KH - 2 * KPAD) / Math.max(y1 - y0, minSpan));   // eenheden per genormeerde eenheid
  const px = (q: { lat: number; lon: number }) => (wereldX(q.lon) - cx) * sc + KW / 2;
  const py = (q: { lat: number; lon: number }) => (wereldY(q.lat) - cy) * sc + KH / 2;
  // land en platen: alle ringen in beeld als één pad (even-odd, dus meren en binnenwater blijven open)
  const lonMin = (-KW / 2 / sc + cx) * 360 - 180, lonMax = (KW / 2 / sc + cx) * 360 - 180;
  const latVan = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
  const latMax = latVan(cy - KH / 2 / sc), latMin = latVan(cy + KH / 2 / sc);
  const pad = (ringen: ReturnType<typeof metBereik>) => ringen.filter((q) => q.lon1 >= lonMin && q.lon0 <= lonMax && q.lat1 >= latMin && q.lat0 <= latMax).map(({ r }) => {
    const pts: string[] = [];
    for (let i = 0; i < r.length; i += 2) pts.push(`${px({ lon: r[i] / 1e4, lat: r[i + 1] / 1e4 }).toFixed(1)},${py({ lon: r[i] / 1e4, lat: r[i + 1] / 1e4 }).toFixed(1)}`);
    return `M${pts.join("L")}Z`;
  }).join("");
  const land = pad(LAND), platen = pad(PLATEN);

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
  const echt = punten.filter((h, i) => h.soort !== "knoop" && !(i > 0 && i < punten.length - 1 && DOORVAART.includes(h.haven)));
  const dots: Vak[] = echt.map((h) => ({ x0: px(h) - 5, x1: px(h) + 5, y0: py(h) - 5, y1: py(h) + 5 }));
  const geplaatst: Vak[] = [];
  const namen = echt.map((h, i) => {
    const x = px(h), y = py(h), w = h.naam.length * 5.6 + 4;
    const kand = [
      { anchor: "start", tx: x + 8, v: { x0: x + 7, x1: x + 8 + w, y0: y - 7, y1: y + 4 } },
      { anchor: "end", tx: x - 8, v: { x0: x - 8 - w, x1: x - 7, y0: y - 7, y1: y + 4 } },
      { anchor: "middle", tx: x, ty: y - 9, v: { x0: x - w / 2, x1: x + w / 2, y0: y - 18, y1: y - 7 } },
      { anchor: "middle", tx: x, ty: y + 16, v: { x0: x - w / 2, x1: x + w / 2, y0: y + 6, y1: y + 18 } },
      // schuin erboven/eronder, als rechts, links, boven en onder allemaal bezet zijn
      { anchor: "start", tx: x + 7, ty: y - 8, v: { x0: x + 6, x1: x + 7 + w, y0: y - 17, y1: y - 6 } },
      { anchor: "start", tx: x + 7, ty: y + 15, v: { x0: x + 6, x1: x + 7 + w, y0: y + 6, y1: y + 17 } },
      { anchor: "end", tx: x - 7, ty: y - 8, v: { x0: x - 7 - w, x1: x - 6, y0: y - 17, y1: y - 6 } },
      { anchor: "end", tx: x - 7, ty: y + 15, v: { x0: x - 7 - w, x1: x - 6, y0: y + 6, y1: y + 17 } },
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
        <path d={platen} fillRule="evenodd" className={s.kaartPlat} />
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
function TijdAs({ van, tot, dagweergave, inset = 0 }: { van: number; tot: number; dagweergave: boolean; inset?: number }) {
  return (
    <div className={s.as} style={inset ? { paddingLeft: `${(inset / W) * 100}%` } : undefined}>
      {dagweergave ? <><span>00:00</span><span>12:00</span><span>24:00</span></>
        : [van, (van + tot) / 2, tot].map((ms) => <span key={ms}>{asLabel(ms)}</span>)}
    </div>
  );
}

// WIND-tegel: windsnelheid (kn) langs de route, met
// eronder de windhoek t.o.v. de boot: per zeilhoek-stuk (aan de wind / halve wind / ruime wind /
// voor de wind) een vak met het icoon (boot, ring, bolletje = waar de wind de boot raakt).
// Eigen tijdas = de vaartijd (vertrek–aankomst); de data zijn de sim-stappen van het gekozen vertrek.
const WH = 56, WPAD = 4, WLBL = 12, BAND_Y = 64, BAND_H = 26, WTOT = BAND_Y + BAND_H;
function WindTegel({ steps, gusts, depMs, arrMs }: { steps: SimStep[]; gusts: GustSample[]; depMs: number; arrMs: number | null }) {
  const eind = arrMs ?? depMs;
  const van = depMs, tot = Math.max(eind, depMs + 1);   // eigen tijdas: precies de vaartijd
  const pts = steps.filter((q) => q.tMs >= depMs && q.tMs <= eind);
  if (pts.length < 2) return null;
  const gl = gladReeks(pts.map((q) => ({ ms: q.tMs, v: q.wSpd })), van, tot);
  const rast = rasterWaarden(0, Math.max(10, ...gl.map((q) => q.v)), 3);
  const x = (ms: number) => RASTER_GUT + ((Math.min(tot, Math.max(van, ms)) - van) / (tot - van)) * (W - RASTER_GUT);
  const y = (v: number) => WH - WPAD - (v / rast.top) * (WH - WPAD - WLBL);
  const lijn = gl.map((q) => `${x(q.ms).toFixed(1)},${y(q.v).toFixed(1)}`);
  const top = gl.reduce((m, q) => (q.v > m.v ? q : m), gl[0]);
  const eerste = gl[0], laatste = gl[gl.length - 1];
  // hardste vlaag binnen de vaartijd (uurwaarden van de stations langs de route; vanaf het uur van vertrek)
  const vlagen = gusts.filter((g) => g.ms >= Math.floor(depMs / H) * H && g.ms <= eind);
  const vlaag = vlagen.length ? vlagen.reduce((m, g) => (g.gustKn > m.gustKn ? g : m)) : null;
  // beginlabel boven het hoogste punt van de lijn onder het label, zodat de lijn er niet doorheen loopt
  const startLabelY = Math.min(...gl.filter((q) => x(q.ms) <= x(eerste.ms) + 30).map((q) => y(q.v)));
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
        <Raster waarden={rast.waarden} y={y} x1={W} />
        <polygon className={s.windVlak} points={`${x(eerste.ms).toFixed(1)},${WH - WPAD} ${lijn.join(" ")} ${x(laatste.ms).toFixed(1)},${WH - WPAD}`} />
        <polyline className={s.windLijn} points={lijn.join(" ")} />
        <circle cx={x(top.ms)} cy={y(top.v)} r={3} className={s.windStipRand} />
        <text x={labelX(x(top.ms))} y={y(top.v) - 6} className={s.windLabel}>{Math.round(top.v)} kn · {localHM(top.ms)}</text>
        {x(top.ms) - x(eerste.ms) > 70 && (
          <text x={x(eerste.ms) + 4} y={startLabelY - 5} className={`${s.windLabel} ${s.windLabelStart}`}>{Math.round(eerste.v)} kn</text>
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
      <TijdAs van={van} tot={tot} dagweergave={false} inset={RASTER_GUT} />
      {vlaag && <div className={s.windVlagen}>Vlagen tot {Math.round(vlaag.gustKn)}&nbsp;kn rond {localHM(vlaag.ms)}</div>}
    </div>
  );
}

// SNELHEID-tegel: vaarsnelheid over de grond (kn) langs de tocht, uit de sim-stappen van het gekozen vertrek
// (door het water + stroom). Eigen tijdas = de vaartijd. De lijn is gemiddeld over een uur (de stroom springt
// op de etappegrenzen), met een subtiel raster en de snelheden in een smalle marge links. Hoogste
// snelheid als label boven de lijn; gemiddelde en laagste eronder als tekst (nooit een label over de lijn).
const SH = 70;
function SnelheidTegel({ steps, depMs, arrMs, distanceNm }: { steps: SimStep[]; depMs: number; arrMs: number | null; distanceNm: number | null }) {
  const eind = arrMs ?? depMs;
  const raw = steps.filter((q) => q.tMs >= depMs && q.tMs <= eind);
  if (raw.length < 2) return null;
  const van = depMs, tot = Math.max(eind, depMs + 1);
  const pts = gladReeks(raw.map((q) => ({ ms: q.tMs, v: q.sog })), van, tot);
  const rast = rasterWaarden(0, Math.max(...pts.map((q) => q.v)), 4);
  const axMax = Math.max(rast.top, rast.stap * 2);
  const x = (ms: number) => RASTER_GUT + ((Math.min(tot, Math.max(van, ms)) - van) / (tot - van)) * (W - RASTER_GUT);
  const y = (v: number) => SH - WPAD - (v / axMax) * (SH - WPAD - WLBL);
  const lijn = pts.map((q) => `${x(q.ms).toFixed(1)},${y(q.v).toFixed(1)}`);
  const top = pts.reduce((m, q) => (q.v > m.v ? q : m), pts[0]);
  const laag = pts.reduce((m, q) => (q.v < m.v ? q : m), pts[0]);
  const gem = distanceNm != null && arrMs ? distanceNm / ((arrMs - depMs) / H) : null;
  return (
    <div className={`card ${s.krommeKaart}`}>
      <div className={s.sectie}>SNELHEID ONDERWEG · KN</div>
      <svg className={s.kromme} viewBox={`0 0 ${W} ${SH}`} role="img" aria-label="vaarsnelheid langs de route">
        <Raster waarden={rast.waarden} y={y} x1={W} />
        <polygon className={s.snelVlak} points={`${x(pts[0].ms).toFixed(1)},${SH - WPAD} ${lijn.join(" ")} ${x(pts[pts.length - 1].ms).toFixed(1)},${SH - WPAD}`} />
        <polyline className={s.snelLijn} points={lijn.join(" ")} />
        <circle cx={x(top.ms)} cy={y(top.v)} r={3} className={s.snelStip} />
        <text x={labelX(x(top.ms))} y={y(top.v) - 6} className={s.snelLabel}>{kn(top.v)} kn · {localHM(top.ms)}</text>
      </svg>
      <TijdAs van={van} tot={tot} dagweergave={false} inset={RASTER_GUT} />
      <div className={s.snelTekst}>
        {gem != null && <>Gemiddeld {kn(gem)}&nbsp;kn · </>}laagst {kn(laag.v)}&nbsp;kn rond {localHM(laag.ms)}
      </div>
    </div>
  );
}

// Stroomkromme van de tocht: de stroom die de boot zelf meemaakt op de gekozen etappe, op de plek waar
// ze op elk moment is (de simulatiestappen, dus per been de eigen getijfase). Niet het gemiddelde over de
// route op een klokuur: de getijgolf loopt langs de kust en dat gemiddelde zou een andere tocht tonen.
// X-as = de vaartijd van deze etappe. Gestreepte lijn = nu. Een etappe zonder (complete) stroomdata
// toont een streepje. Labels: bij een piek sterkte + tijd (mee erboven, tegen eronder), bij een
// kentering de tijd naast de open stip. LBL = ruimte voor de pieklabels.
const W = 300, HG = 116, PAD = 6, LBL = 12;
const kn = (v: number) => Math.abs(v).toFixed(1).replace(".", ",");
const labelX = (px: number) => Math.min(W - 34, Math.max(RASTER_GUT + 34, px));   // niet in de marge met rasterwaarden
// aslabel bij een meeschuivend venster: dag erbij, want het loopt over middernacht
const asLabel = (ms: number) =>
  `${new Intl.DateTimeFormat("nl-NL", { weekday: "short", timeZone: "Europe/Amsterdam" }).format(ms).replace(".", "").toUpperCase()} ${localHM(ms)}`;
// Per getijfase (zelfde teken) alleen het sterkste punt: de stroom op de boot springt op de etappegrenzen
// (eigen getijfase per been), en dat geeft anders kleine schijnpieken. Fases onder 0,15 kn krijgen geen label.
function faseTop(seg: { ms: number; v: number }[]): { ms: number; v: number; soort: "mee" | "tegen" }[] {
  const out: { ms: number; v: number; soort: "mee" | "tegen" }[] = [];
  let top: { ms: number; v: number } | null = null;
  const sluit = () => { if (top && Math.abs(top.v) >= 0.15) out.push({ ...top, soort: top.v > 0 ? "mee" : "tegen" }); top = null; };
  seg.forEach((q, i) => {
    if (i && (q.v >= 0) !== (seg[i - 1].v >= 0)) sluit();
    if (!top || Math.abs(q.v) > Math.abs(top.v)) top = q;
  });
  sluit();
  return out;
}
function StroomKromme({ etappe, steps, progVan }: { etappe: Etappe; steps: SimStep[]; progVan: number }) {
  const st = etappe.stroom ? steps.filter((q) => q.prog >= progVan - 1e-9 && q.prog <= progVan + etappe.distNm + 1e-9) : [];
  const seg = st.length > 1 ? gladReeks(st.map((q) => ({ ms: q.tMs, v: q.cur })), st[0].tMs, st[st.length - 1].tMs) : [];
  const segs = seg.length > 1 ? [seg] : [];
  const van = seg[0]?.ms ?? 0, tot = seg[seg.length - 1]?.ms ?? 1;
  const nu = Date.now();
  const data = Math.max(0.5, ...seg.map((q) => Math.abs(q.v)));
  const rast = rasterWaarden(-data, data, 3);
  const maxAbs = Math.max(rast.top, -rast.bodem);   // schaal = buitenste rasterlijn
  const x = (ms: number) => RASTER_GUT + ((Math.min(tot, Math.max(van, ms)) - van) / (tot - van)) * (W - RASTER_GUT);
  const y = (v: number) => HG / 2 - (v / maxAbs) * (HG / 2 - PAD - LBL);
  const kenteringen = segs.flatMap(krommeKenteringen);
  // lijn boven de nullijn = mee (groen), eronder = tegen (oker): dezelfde lijn twee keer, geknipt
  const clip = useId().replace(/:/g, "");
  return (
    <div className={`card ${s.krommeKaart}`}>
      <div className={s.sectie}>STROOM ONDERWEG · KN</div>
      {!segs.length ? (
        <div className={s.leeg}>—<div className={s.noot}>{etappe.stroom ? "geen stroomdata voor deze etappe" : "stroomdata ontbreekt voor een deel van de tocht"}</div></div>
      ) : (
        <svg className={s.kromme} viewBox={`0 0 ${W} ${HG}`} role="img" aria-label={`stroom onderweg op ${etappe.label}`}>
          <Raster waarden={rast.waarden} y={y} x1={W} fmt={(v) => `${v > 0 ? "+" : "−"}${String(Math.abs(v)).replace(".", ",")}`} />
          <line x1={RASTER_GUT} x2={W} y1={HG / 2} y2={HG / 2} className={s.nullijn} />
          <clipPath id={`${clip}m`}><rect x={0} y={0} width={W} height={HG / 2} /></clipPath>
          <clipPath id={`${clip}t`}><rect x={0} y={HG / 2} width={W} height={HG / 2} /></clipPath>
          {segs.map((sg, i) => {
            const pts = sg.map((q) => `${x(q.ms).toFixed(1)},${y(q.v).toFixed(1)}`).join(" ");
            return (
              <g key={i}>
                <polyline className={s.lijn} points={pts} clipPath={`url(#${clip}m)`} />
                <polyline className={`${s.lijn} ${s.lijnTegen}`} points={pts} clipPath={`url(#${clip}t)`} />
              </g>
            );
          })}
          {nu > van && nu < tot && (
            <line x1={x(nu)} x2={x(nu)} y1={0} y2={HG} className={s.nuLijn} />
          )}
          {segs.flatMap(faseTop).map((q) => (
            <g key={q.ms}>
              <circle cx={x(q.ms)} cy={y(q.v)} r={4} className={q.soort === "mee" ? s.piekMee : s.piekTegen} />
              <text x={labelX(x(q.ms))} y={q.soort === "mee" ? y(q.v) - 8 : y(q.v) + 15}
                className={`${s.krommeLabel} ${q.soort === "mee" ? s.labelMee : s.labelTegen}`}>
                {kn(q.v)} kn · {localHM(q.ms)}
              </text>
            </g>
          ))}
          {/* tijd rechts van de kentering aan de kant waar de lijn niet loopt; aan de rechterrand
              links ervan (en dus aan de andere kant van de nullijn) */}
          {kenteringen.map(({ ms, naarMee }) => {
            const rechts = x(ms) > W - 30;
            return (
              <g key={ms}>
                <circle cx={x(ms)} cy={HG / 2} r={3} className={s.kentering} />
                <text x={x(ms) + (rechts ? -5 : 5)} y={naarMee !== rechts ? HG / 2 + 11 : HG / 2 - 5}
                  className={s.kenteringLabel} textAnchor={rechts ? "end" : "start"}>{localHM(ms)}</text>
              </g>
            );
          })}
        </svg>
      )}
      {segs.length > 0 && <TijdAs van={van} tot={tot} dagweergave={false} inset={RASTER_GUT} />}
      <div className={s.legenda}>
        <span><span className={`${s.stip} ${s.piekMee}`} />MEESTROOM</span>
        <span><span className={`${s.stip} ${s.piekTegen}`} />TEGENSTROOM</span>
        <span><span className={`${s.stip} ${s.stipKentering}`} />KENTERING</span>
        <span><span className={`${s.stip} ${s.stipNu}`} />NU</span>
      </div>
    </div>
  );
}
