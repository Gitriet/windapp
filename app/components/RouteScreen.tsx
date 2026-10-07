"use client";
// ROUTE — beslisscherm: één advieskaart (5 toestanden) + alle vertrekvensters (48u).
// Alleen presentatie; alle afleidingen komen uit lib/tocht.ts.
import { localHM, localDateISO } from "@/lib/tz";
import { aankomstLabel, dirLabel16, fmtDuurKort, sailPhrase, tijdblok } from "@/lib/format";
import { wxLabel } from "@/lib/weather";
import {
  adviesState, adviesTitel, adviesUitleg, effectLabel, letOp, pickSnelste, stroomVerloop, weatherAt,
  type AdviesKind, type DepOption, type GustSample, type StroomVerloop,
} from "@/lib/tocht";
import type { TideData, WeatherSeries } from "@/lib/types";
import type { SimResult } from "@/lib/tripsim";
import { Skeleton } from "./Shell";
import { WindArrow, WindHoekIcon, WxIcon } from "./icons";
import s from "./RouteScreen.module.css";

const H = 3_600_000;
const tms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));

// "morgen" / "overmorgen" / weekdag; vandaag = leeg. Nachtvertrek krijgt "· nacht".
function dagLabel(ms: number, nowMs: number): string {
  const d = localDateISO(ms);
  const dag = d === localDateISO(nowMs) ? ""
    : d === localDateISO(nowMs + 24 * H) ? "morgen"
    : d === localDateISO(nowMs + 48 * H) ? "overmorgen"
    : new Intl.DateTimeFormat("nl-NL", { weekday: "long", timeZone: "Europe/Amsterdam" }).format(ms);
  const uur = +new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", hourCycle: "h23", timeZone: "Europe/Amsterdam" }).format(ms);
  const nacht = uur >= 22 || uur < 6;
  return [dag, nacht ? "nacht" : ""].filter(Boolean).join(" · ");
}

const DISC: Record<AdviesKind, string> = { "ga-nu": "✓", vertrek: "✓", onzeker: "?", "geen-venster": "–", "zonder-stroom": "~", "minst-slecht": "!" };

function stroomNotitie(v: StroomVerloop): string {
  if (!("totMs" in v)) return v.kind === "geen" ? "zonder stroomdata" : "stroomdata onzeker";
  const tot = v.totMs != null ? ` tot ${localHM(v.totMs)}` : "";
  return v.kind === "mee" ? (tot ? `mee${tot}` : "mee-stroom") : (tot ? `tegen${tot}` : "tegenstroom");
}

// stroom bij "nu vertrekken": tegen/mee tot de kentering, of de hele tocht
function nuStroom(v: StroomVerloop): string {
  if (!("totMs" in v)) return stroomNotitie(v);
  const wat = v.kind === "mee" ? "stroom mee" : "stroom tegen";
  return v.totMs != null ? `${wat} tot ${localHM(v.totMs)}` : `${wat}, hele tocht`;
}

export interface RouteScreenProps {
  ready: boolean;
  fout: boolean;                      // laden mislukt: geen wachtscherm, de foutmelding staat erboven
  nowMs: number;
  best: DepOption | null;
  venster: { vanMs: number; totMs: number } | null;   // beste vertrek ± VENSTER_MARGE_MIN ("nog steeds gunstig")
  vensters: DepOption[];
  firstDepMs: number | null;
  horizonUur: number;                 // betrouwbare vertrekken reiken zo ver vooruit
  nuOptie: DepOption | null;          // het eerstvolgende vertrek (voor "nu vertrekken")
  anyStroom: boolean;
  distanceNm: number | null;          // lengte van de hele tocht
  depMs: number | null;
  selTrip: SimResult | null;          // het gekozen vertrek (voor de uitlegzin)
  routeBearing: number | null;
  routeTide: TideData | null;
  routeGusts: GustSample[];
  vanWeather: WeatherSeries | null;
  onSelect: (depMs: number) => void; // vertrek kiezen (blijft op ROUTE)
  onOpenVaarplan: () => void;        // naar VAARPLAN met het gekozen vertrek
}

export default function RouteScreen(p: RouteScreenProps) {
  if (!p.ready) return p.fout ? null : (
    <>
      <Skeleton rows={1} height={300} label="advies laden" tekst="Route wordt berekend…" />
      <Skeleton rows={3} height={52} label="vertrekken laden" />
    </>
  );
  return (
    <>
      <AdviesKaart {...p} />
      <VertrekLijst {...p} />
    </>
  );
}

function AdviesKaart({ best, venster, distanceNm, selTrip, firstDepMs, horizonUur, anyStroom, nowMs, routeBearing, routeTide, routeGusts, vanWeather, onOpenVaarplan }: RouteScreenProps) {
  const kind = adviesState(best, firstDepMs, anyStroom);
  const r = best?.result ?? null;
  // een ander vertrek gekozen (uit de lijst): de hele kaart toont dat vertrek; anders het beste
  const gekozen = selTrip && best && selTrip.departMs !== best.depMs ? selTrip : null;
  const rShow = gekozen ?? r;
  const depShow = gekozen ? gekozen.departMs : best?.depMs ?? 0;
  const hm = best ? localHM(best.depMs) : "";
  const dag = best ? dagLabel(best.depMs, nowMs) : "";
  const eta = rShow?.arrMs && best ? aankomstLabel(depShow, rShow.arrMs) : null;   // staat in de hero, achter de titel
  const afstand = distanceNm != null ? `${distanceNm.toFixed(1).replace(".", ",")}\u00A0NM` : "";
  const feiten = rShow ? [afstand, fmtDuurKort(rShow.tripMin)].filter(Boolean).join(" · ") : "";   // afstand · duur, onder de hero
  // "nog steeds gunstig tussen …": alleen bij het advies zelf (niet bij onzeker/minst slecht/zonder stroom)
  const bereik = !gekozen && venster && (kind === "ga-nu" || kind === "vertrek") ? venster : null;
  const sub = !best || !r || !rShow ? "Geen haalbaar vertrek binnen 48 uur."
    : !gekozen && kind === "onzeker" ? `Beste venster ${hm}${dag ? ` (${dag})` : ""} · stroomdata deels onzeker`
    : !gekozen && kind === "zonder-stroom" ? `Beste vertrek ${hm}${dag ? ` (${dag})` : ""} · rekent zonder getijstroom`
    : `${dagLabel(depShow, nowMs) ? `${dagLabel(depShow, nowMs)} · ` : ""}${effectLabel(rShow.effectMin)}`;

  const s0 = rShow?.steps[0];
  const verloop = rShow ? stroomVerloop(rShow, anyStroom) : null;
  const hw = best && routeTide ? routeTide.extremes.find((e) => e.kind === "HW" && tms(e.t) >= depShow) : undefined;
  const warn = rShow ? letOp(rShow, routeBearing ?? 0, routeGusts) : null;
  const letOpActief = !!(warn?.hardWind || warn?.windTegenStroom);
  const uitleg = gekozen ? adviesUitleg(gekozen, anyStroom, false) : r ? adviesUitleg(r, anyStroom, true, horizonUur) : null;
  const wx = best ? weatherAt(vanWeather, depShow) : null;
  const toonKind: AdviesKind = gekozen ? "vertrek" : kind;

  return (
    <div className={`card ${s.advies}`}>
      <div className={s.head}>
        <span className={s.disc} data-kind={toonKind} aria-hidden>{DISC[toonKind]}</span>
        <span className={s.label}>{gekozen ? "Gekozen vertrek" : kind === "minst-slecht" ? `Minst slecht · komende ${horizonUur}\u00A0u` : "Huidig advies"}</span>
      </div>
      <div>
        <div className={s.titel}>
          {adviesTitel(toonKind, best ? depShow : null, letOpActief)}
          {eta && <span className={s.titelEta}>ETA&nbsp;{eta}</span>}
        </div>
        {feiten && <div className={s.feiten}>{feiten}</div>}
        <div className={s.sub}>{sub}</div>
        {bereik && <div className={s.sub}>Nog steeds gunstig tussen {localHM(bereik.vanMs)} en {localHM(bereik.totMs)}</div>}
      </div>
      {rShow && s0 && (
        <div className={s.chips}>
          <span className={`${s.chip} ${s.chipWind}`}><WindArrow dir={s0.wDir} />{dirLabel16(s0.wDir)}&nbsp;{Math.round(s0.wSpd)}&nbsp;KN</span>
          <span className={`${s.chip} ${s.chipWind}`}><WindHoekIcon rel={s0.wDir - s0.course} />{sailPhrase(s0.twa).toUpperCase()}</span>
          {/* MEE-chip alleen als de stroom per saldo helpt (effectMin ≤ 0) */}
          {verloop && "totMs" in verloop && !(verloop.kind === "mee" && rShow.effectMin > 0) && (
            <span className={`${s.chip} ${verloop.kind === "mee" ? s.chipMee : s.chipTegen}`}>
              {verloop.kind === "mee" ? "MEE" : "TEGEN"} {verloop.totMs != null ? `TOT ${localHM(verloop.totMs)}` : "HELE TOCHT"}
            </span>
          )}
          {hw && <span className={`${s.chip} ${s.chipHw}`}>HW&nbsp;{localHM(tms(hw.t))}</span>}
          {warn?.hardWind && <span className={`${s.chip} ${s.chipLetOp}`}>LET OP · HARDE WIND</span>}
          {warn?.windTegenStroom && <span className={`${s.chip} ${s.chipLetOp}`}>LET OP · WIND TEGEN STROOM</span>}
        </div>
      )}
      {uitleg && <div className={s.uitleg}>{uitleg}</div>}
      {wx && wx.temp != null && (
        <div className={s.weer}>
          <WxIcon code={wx.code} size={18} />
          <span className={s.weerTemp}>{Math.round(wx.temp)}°C</span>
          <span className={s.weerTekst}>
            · {wxLabel(wx.code)}{wx.precip != null ? ` · ${wx.precip > 0 ? `${wx.precip.toFixed(1).replace(".", ",")} mm neerslag` : "geen neerslag"}` : ""}
          </span>
        </div>
      )}
      {best && (
        <button type="button" className={`is-filled ${s.cta}`} onClick={onOpenVaarplan}>BEKIJK VAARPLAN →</button>
      )}
    </div>
  );
}

function VertrekLijst({ best, vensters, nuOptie, anyStroom, depMs, nowMs, onSelect }: RouteScreenProps) {
  const rows = [...(best ? [best] : []), ...vensters].sort((a, b) => a.depMs - b.depMs);
  if (!rows.length) return null;
  const snelste = pickSnelste(rows);
  // ligt het beste vertrek later: wat kost nu vertrekken, en waarom (stroom tegen tot …)
  const nu = nuOptie && best && nuOptie.depMs !== best.depMs && nuOptie.result.arrMs ? nuOptie.result : null;
  return (
    <div>
      {nu && best && (
        <button type="button" className={s.nu} onClick={() => onSelect(nu.departMs)}>
          <span className={s.nuLabel}>NU VERTREKKEN · {localHM(nu.departMs)}</span>
          <span>
            {fmtDuurKort(nu.tripMin)} · {nuStroom(stroomVerloop(nu, anyStroom))}
            {nu.tripMin > best.result.tripMin ? ` · ${fmtDuurKort(nu.tripMin - best.result.tripMin)} langer dan om ${localHM(best.depMs)}` : ""}
          </span>
        </button>
      )}
      <div className={s.sectie}>ALLE VERTREKKEN · 48 UUR</div>
      <div className={s.lijst}>
        {rows.map((o) => {
          const r = o.result, isBest = o.depMs === best?.depMs, s0 = r.steps[0];
          const gekozen = o.depMs === (depMs ?? best?.depMs);   // de gekozen rij is gevuld, niet per se de beste
          const dag = dagLabel(o.depMs, nowMs);
          const notitie = [dag, s0 ? `${dirLabel16(s0.wDir)}\u00A0${Math.round(s0.wSpd)}\u00A0kn` : "", stroomNotitie(stroomVerloop(r, anyStroom))]
            .filter(Boolean).join(" · ");
          return (
            <button key={o.depMs} type="button" className={`row ${s.rij} ${gekozen ? "is-filled" : ""}`}
              aria-current={gekozen ? "true" : undefined} onClick={() => onSelect(o.depMs)}>
              {s0 && <WindArrow dir={s0.wDir} />}
              <span className={s.rijMain}>
                <span className={s.rijTijd}>{tijdblok(o.depMs, r.arrMs)}</span>
                <span className={s.rijSub}>{notitie}</span>
              </span>
              {isBest && <span className={s.badge}>BESTE</span>}
              {!isBest && o.depMs === snelste?.depMs && <span className={s.badge}>SNELST</span>}
              <span className={s.duur}>{fmtDuurKort(r.tripMin)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
