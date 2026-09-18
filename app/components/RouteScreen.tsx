"use client";
// ROUTE — beslisscherm: één advieskaart (5 toestanden) + alle vertrekvensters (48u).
// Alleen presentatie; alle afleidingen komen uit lib/tocht.ts.
import { localHM, localDateISO } from "@/lib/tz";
import { dirLabel16 } from "@/lib/format";
import { wxLabel } from "@/lib/weather";
import {
  adviesState, adviesUitleg, effectLabel, letOp, stroomVerloop, weatherAt,
  type AdviesKind, type DepOption, type GustSample, type StroomVerloop,
} from "@/lib/tocht";
import type { TideData, WeatherSeries } from "@/lib/types";
import { Skeleton } from "./Shell";
import { WindArrow, WxIcon } from "./icons";
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

const TITEL: Record<AdviesKind, (hm: string) => string> = {
  "ga-nu": () => "GA NU",
  vertrek: (hm) => `VERTREK ${hm}`,
  onzeker: () => "ONZEKER",
  "geen-venster": () => "GEEN VENSTER",
  "zonder-stroom": () => "ZONDER STROOM",
};
const DISC: Record<AdviesKind, string> = { "ga-nu": "✓", vertrek: "✓", onzeker: "?", "geen-venster": "–", "zonder-stroom": "~" };

function stroomNotitie(v: StroomVerloop): string {
  if (!("totMs" in v)) return v.kind === "geen" ? "zonder stroomdata" : "stroomdata onzeker";
  const tot = v.totMs != null ? ` tot ${localHM(v.totMs)}` : "";
  return v.kind === "mee" ? (tot ? `mee${tot}` : "mee-stroom") : (tot ? `tegen${tot}` : "tegenstroom");
}

export interface RouteScreenProps {
  ready: boolean;
  nowMs: number;
  best: DepOption | null;
  vensters: DepOption[];
  firstDepMs: number | null;
  anyStroom: boolean;
  depMs: number | null;
  routeBearing: number | null;
  routeTide: TideData | null;
  routeGusts: GustSample[];
  vanWeather: WeatherSeries | null;
  onPick: (depMs: number) => void;   // selecteer vertrek + open VAARPLAN
}

export default function RouteScreen(p: RouteScreenProps) {
  if (!p.ready) return (
    <>
      <Skeleton rows={1} height={300} label="advies laden" />
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

function AdviesKaart({ best, firstDepMs, anyStroom, nowMs, routeBearing, routeTide, routeGusts, vanWeather, onPick }: RouteScreenProps) {
  const kind = adviesState(best, firstDepMs, anyStroom);
  const r = best?.result ?? null;
  const hm = best ? localHM(best.depMs) : "";
  const dag = best ? dagLabel(best.depMs, nowMs) : "";
  const eta = r?.arrMs ? `ETA ${localHM(r.arrMs)}` : "ETA —";
  const sub = !best || !r ? "Geen haalbaar vertrek binnen 48 uur."
    : kind === "onzeker" ? `Beste venster ${hm}${dag ? ` (${dag})` : ""} · ${eta} · stroomdata deels onzeker`
    : kind === "zonder-stroom" ? `Beste vertrek ${hm}${dag ? ` (${dag})` : ""} · ${eta} · rekent zonder getijstroom`
    : `${dag ? `${dag} · ` : ""}${eta} · ${effectLabel(r.effectMin)}`;

  const s0 = r?.steps[0];
  const verloop = r ? stroomVerloop(r, anyStroom) : null;
  const hw = best && routeTide ? routeTide.extremes.find((e) => e.kind === "HW" && tms(e.t) >= best.depMs) : undefined;
  const warn = r ? letOp(r, routeBearing ?? 0, routeGusts) : null;
  const uitleg = r ? adviesUitleg(r, anyStroom) : null;
  const wx = best ? weatherAt(vanWeather, best.depMs) : null;

  return (
    <div className={`card ${s.advies}`}>
      <div className={s.head}>
        <span className={s.disc} data-kind={kind} aria-hidden>{DISC[kind]}</span>
        <span className={s.label}>Huidig advies</span>
      </div>
      <div>
        <div className={s.titel}>{TITEL[kind](hm)}</div>
        <div className={s.sub}>{sub}</div>
      </div>
      {r && s0 && (
        <div className={s.chips}>
          <span className={`${s.chip} ${s.chipWind}`}><WindArrow dir={s0.wDir} size={11} />{dirLabel16(s0.wDir)} {Math.round(s0.wSpd)} KN</span>
          {verloop && "totMs" in verloop && (
            <span className={`${s.chip} ${verloop.kind === "mee" ? s.chipMee : s.chipTegen}`}>
              {verloop.kind === "mee" ? "MEE" : "TEGEN"} {verloop.totMs != null ? `TOT ${localHM(verloop.totMs)}` : "HELE TOCHT"}
            </span>
          )}
          {hw && <span className={`${s.chip} ${s.chipHw}`}>HW {localHM(tms(hw.t))}</span>}
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
        <button type="button" className={`is-filled ${s.cta}`} onClick={() => onPick(best.depMs)}>BEKIJK VAARPLAN →</button>
      )}
    </div>
  );
}

function VertrekLijst({ best, vensters, anyStroom, depMs, nowMs, onPick }: RouteScreenProps) {
  const rows = [...(best ? [best] : []), ...vensters].sort((a, b) => a.depMs - b.depMs);
  if (!rows.length) return null;
  return (
    <div>
      <div className={s.sectie}>ALLE VERTREKKEN · 48 UUR</div>
      <div className={s.lijst}>
        {rows.map((o) => {
          const r = o.result, isBest = o.depMs === best?.depMs, s0 = r.steps[0];
          const delta = best ? Math.round(r.tripMin - best.result.tripMin) : 0;
          const dag = dagLabel(o.depMs, nowMs);
          const notitie = [dag, s0 ? `${dirLabel16(s0.wDir)} ${Math.round(s0.wSpd)} kn` : "", stroomNotitie(stroomVerloop(r, anyStroom))]
            .filter(Boolean).join(" · ");
          return (
            <button key={o.depMs} type="button" className={`row ${s.rij} ${isBest ? "is-filled" : ""}`}
              aria-current={o.depMs === depMs ? "true" : undefined} onClick={() => onPick(o.depMs)}>
              {s0 && <WindArrow dir={s0.wDir} size={16} />}
              <span className={s.rijMain}>
                <span className={s.rijTijd}>{localHM(o.depMs)} → {r.arrMs ? localHM(r.arrMs) : "—"}</span>
                <span className={s.rijSub}>{notitie}</span>
              </span>
              {isBest ? <span className={s.badge}>BESTE</span>
                : r.voorbijHorizon ? <span className={s.delta}>ONZEKER</span>
                : <span className={s.delta}>{delta > 0 ? "+" : delta < 0 ? "−" : "±"}{Math.abs(delta)} MIN</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
