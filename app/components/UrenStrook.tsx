"use client";
// Uurstrook: per uur een staaf (13 uur vanaf het anker van een haven, of de uren van de tocht langs de route). Boven elke staaf de
// vlaag (kleur volgens de windstandaard), eronder de wind (kleur alleen volgens de wind) en de richting.
// Uren buiten de tochtperiode zijn gedimd. Op mobiel alleen de even uren. Alleen presentatie.
import { windErnst } from "@/lib/format";
import { verdict } from "@/lib/verdict";
import { localHM } from "@/lib/tz";
import type { UurPunt } from "@/lib/tocht";
import { WindArrow } from "./icons";
import s from "./UrenStrook.module.css";

const tms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));

export default function UrenStrook({ pts, kop, tocht, alleUren = false }: {
  pts: UurPunt[]; kop: string; tocht: { vanMs: number; totMs: number } | null;
  alleUren?: boolean;   // mobiel ook de oneven uren tonen (korte reeksen)
}) {
  const hm = (i: number) => (pts[i] ? localHM(tms(pts[i].time)) : "");
  const max = Math.max(20, Math.ceil(Math.max(...pts.map((p) => p.gust_kn)) / 10) * 10);
  return (
    <div className={`card ${s.uren}`}>
      <div className={s.sectie}>{kop} · {hm(0)}–{hm(pts.length - 1)}{tocht && ` · TOCHT ${localHM(tocht.vanMs)}–${localHM(tocht.totMs)}`}</div>
      <div className={s.staven}>
        {pts.map((p, i) => (
          <div key={p.time} className={s.staaf} data-desktop={!alleUren && i % 2 ? "" : undefined}
            data-buiten={tocht && (tms(p.time) < Math.floor(tocht.vanMs / 3_600_000) * 3_600_000 || tms(p.time) > tocht.totMs) ? "" : undefined}
            data-verdict={verdict(p.speed_kn, null) ?? undefined}>
            <span className={s.vlaag} data-ernst={windErnst(null, p.gust_kn)}>{Math.round(p.gust_kn)}</span>
            <span className={s.kn}>{Math.round(p.speed_kn)}</span>
            <span className={s.pijl}><WindArrow dir={p.dir_deg} /></span>
            <div className={s.balk} style={{ height: `${Math.round((p.speed_kn / max) * 65)}%` }} />
          </div>
        ))}
      </div>
      <div className={s.as}><span>{hm(0)}</span><span>{hm(Math.floor((pts.length - 1) / 2))}</span><span>{hm(pts.length - 1)}</span></div>
    </div>
  );
}
