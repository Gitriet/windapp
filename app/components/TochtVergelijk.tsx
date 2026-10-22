"use client";
// Vertrek en aankomst naast elkaar: wind (groot), vlaag (kleur volgens de windstandaard), richting en weer op het
// moment van vertrek (vertrekhaven) en ETA (aankomsthaven), plus de wind onderweg. Alleen presentatie.
import { dirLabel16, knBereik, windErnst } from "@/lib/format";
import { weatherAt, type WindOnderweg } from "@/lib/tocht";
import { wxLabel } from "@/lib/weather";
import { localHM } from "@/lib/tz";
import type { ForecastResponse } from "@/lib/planner-data";
import { WxIcon } from "./icons";
import s from "./TochtVergelijk.module.css";

export type TochtDeel = {
  rol: string;                                   // "OP VERTREK" / "BIJ AANKOMST"
  naam: string;
  ankerMs: number;
  venster: ForecastResponse["points"];           // uren vanaf het anker; leeg = buiten de uurverwachting
  weather: ForecastResponse["weather"];
};

const tms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));

// Trend ~6 uur vooruit + draaiing.
function windContext(pts: ForecastResponse["points"]): string {
  const p0 = pts[0], t = pts[Math.min(6, pts.length - 1)];
  const d = t.speed_kn - p0.speed_kn;
  const trend = d > 2 ? `bouwt op naar ${Math.round(t.speed_kn)} kn` : d < -2 ? `neemt af naar ${Math.round(t.speed_kn)} kn` : "vrij constant";
  const turn = Math.abs(((t.dir_deg - p0.dir_deg + 540) % 360) - 180);
  return `${trend}, ${turn >= 25 ? `draait naar ${dirLabel16(t.dir_deg)}` : `blijft ${dirLabel16(p0.dir_deg)}`}`;
}

export default function TochtVergelijk({ delen, onderweg }: { delen: TochtDeel[]; onderweg: WindOnderweg | null | undefined }) {
  return (
    <div className={`card ${s.vergelijk}`}>
      <div className={s.kolommen}>
        {delen.map((d, i) => {
          const p0 = d.venster[0];
          const wx = weatherAt(d.weather, d.ankerMs);
          return (
            <div key={d.rol} className={s.deel}>
              <div className={s.rol}>{d.rol} <span className={s.tijd}>{localHM(d.ankerMs)}</span></div>
              <div className={s.haven}><span className={`${s.dot} ${i === 0 ? s.dotA : s.dotB}`} />{d.naam}</div>
              {p0 ? (
                <>
                  <div className={s.kn}>{Math.round(p0.speed_kn)}<span className={s.eenheid}>KN</span></div>
                  <div className={s.vlaagRij}>
                    <span className={s.vlaag} data-ernst={windErnst(null, p0.gust_kn)}>{Math.round(p0.gust_kn)}</span>
                    <span className={s.eenheid}>VLAAG</span>
                  </div>
                  <div className={s.richting}>{dirLabel16(p0.dir_deg)} · {String(Math.round(p0.dir_deg)).padStart(3, "0")}°</div>
                  <div className={s.context}>{windContext(d.venster)}</div>
                </>
              ) : <div className={s.context}>Geen uurverwachting op dit moment.</div>}
              {wx && wx.temp != null && (
                <div className={s.weer}>
                  <WxIcon code={wx.code} size={18} />
                  <span>{Math.round(wx.temp)}°C · {wxLabel(wx.code)}{wx.precip != null ? ` · ${wx.precip > 0 ? `${wx.precip.toFixed(1).replace(".", ",")} mm` : "geen neerslag"}` : ""}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {onderweg && (
        <div className={s.onderweg}>
          <span className={s.onderwegLabel}>ONDERWEG VANAF {localHM(onderweg.vanMs)}</span>
          <span className={s.onderwegWind}>{knBereik([onderweg.windMin, onderweg.windMax])}<span className={s.eenheid}>KN</span></span>
          {onderweg.vlaagMax != null && onderweg.vlaagMin != null && (
            <span className={s.onderwegVlaag} data-ernst={windErnst(null, onderweg.vlaagMax)}>
              VLAGEN {knBereik([onderweg.vlaagMin, onderweg.vlaagMax])} KN
            </span>
          )}
        </div>
      )}
    </div>
  );
}
