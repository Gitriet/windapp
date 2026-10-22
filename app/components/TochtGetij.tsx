"use client";
// Getij van vertrek- én aankomsthaven in één grafiek: twee curves (cm NAP) op dezelfde tijdas, het venster is de
// tocht met 2 uur marge. De tochtperiode is gearceerd; op elke curve staat het moment van vertrek resp. ETA, met
// eronder de waterstand en of het stijgt of daalt. HW/LW als stip met tijd en hoogte. Alleen presentatie.
import { localHM } from "@/lib/tz";
import { signedCm } from "@/lib/format";
import { tideNow } from "@/lib/instrument";
import { rasterWaarden } from "@/lib/grafiek";
import type { TideData, TidePoint } from "@/lib/types";
import { Raster, RASTER_GUT } from "./Raster";
import s from "./TochtGetij.module.css";

const H = 3_600_000;
const CYCLUS = 13 * H;
const tms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));
const W = 300, HG = 110, PAD = 6, LBL = 11;

export type GetijDeel = { naam: string; tide: TideData | null; ankerMs: number; ankerLabel: string };

// Getijreeks voor de curve: verwachting waar die reikt, astronomisch daarbuiten.
function getijReeks(t: TideData): { pts: TidePoint[]; expEnd: number } {
  const expEnd = t.expected.length ? tms(t.expected[t.expected.length - 1].t) : -Infinity;
  return { pts: [...t.expected, ...t.astro.filter((p) => tms(p.t) > expEnd)], expEnd };
}

export default function TochtGetij({ delen, vanMs, totMs }: { delen: GetijDeel[]; vanMs: number; totMs: number }) {
  // venster: de tocht met 2 uur marge, minstens een hele getijcyclus (12u25, afgerond 13 uur) breed
  const marge = Math.max(2 * H, (CYCLUS - (totMs - vanMs)) / 2);
  const van = vanMs - marge, tot = totMs + marge;
  const reeksen = delen.map((d) => {
    if (!d.tide) return { d, pts: [] as { ms: number; v: number }[], astro: false };
    const { pts, expEnd } = getijReeks(d.tide);
    const sel = pts.map((p) => ({ ms: tms(p.t), v: p.v })).filter((p) => p.ms >= van && p.ms <= tot);
    return { d, pts: sel, astro: sel.length > 0 && sel[0].ms > expEnd };
  });
  const alle = reeksen.flatMap((r) => r.pts);
  if (alle.length < 2) return <div className={s.noot}>geen getijdata voor deze tocht</div>;
  const lo = Math.min(0, ...alle.map((p) => p.v)), hi = Math.max(0, ...alle.map((p) => p.v));
  const rast = rasterWaarden(lo, hi, 3);
  const x = (ms: number) => RASTER_GUT + ((ms - van) / (tot - van)) * (W - RASTER_GUT);
  const y = (v: number) => PAD + LBL + ((hi - v) / (hi - lo || 1)) * (HG - 2 * (PAD + LBL));
  const lijnPts = (pts: { ms: number; v: number }[]) => pts.map((p) => `${x(p.ms).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const x0 = x(vanMs), x1 = x(totMs);
  return (
    <div className={s.wrap}>
      {reeksen.map((r, i) => {
        const d = r.d;
        const tn = d.tide ? tideNow(d.tide, d.ankerMs) : null;
        const ext = d.tide ? d.tide.extremes.map((e) => ({ ms: tms(e.t), v: e.v, hw: e.kind === "HW" })).filter((e) => e.ms >= van && e.ms <= tot) : [];
        const ax = x(d.ankerMs);
        return (
          <div key={d.naam} className={`${s.grafiek} ${i === 0 ? s.hA : s.hB}`}>
            <div className={s.kop}>
              <span className={s.standLabel}>{d.ankerLabel} {localHM(d.ankerMs)} · {d.naam.toUpperCase()}</span>
              <span className={s.standWaarde}>{tn ? `${tn.rising ? "↑" : "↓"} ${signedCm(tn.level)}` : "—"}<span className={s.eenheid}>cm</span></span>
            </div>
            <svg className={s.kromme} viewBox={`0 0 ${W} ${HG}`} role="img" aria-label={`waterstand ${d.naam} tijdens de tocht`}>
              <Raster waarden={rast.waarden} y={y} x1={W} fmt={(v) => `${v > 0 ? "+" : "−"}${Math.abs(v)}`} />
              <line x1={RASTER_GUT} x2={W} y1={y(0)} y2={y(0)} className={s.nullijn} />
              <rect x={x0} y={0} width={Math.max(0, x1 - x0)} height={HG} className={s.band} />
              <line x1={x0} x2={x0} y1={0} y2={HG} className={s.ankerLijn} />
              <line x1={x1} x2={x1} y1={0} y2={HG} className={s.ankerLijn} />
              {r.pts.length > 1 && <polyline className={s.lijn} points={lijnPts(r.pts)} />}
              {ext.map((e) => (
                <g key={e.ms}>
                  <circle cx={x(e.ms)} cy={y(e.v)} r={3} className={s.stipExt} />
                  <text x={Math.min(W - 26, Math.max(RASTER_GUT + 26, x(e.ms)))} y={e.hw ? y(e.v) - 6 : y(e.v) + 13} className={s.extTijd}>
                    <tspan className={s.extCm}>{signedCm(e.v)}</tspan> · {localHM(e.ms)}
                  </text>
                </g>
              ))}
              {tn && <circle cx={ax} cy={y(tn.level)} r={4} className={s.ankerStip} />}
            </svg>
            <div className={s.as} style={{ paddingLeft: `${(RASTER_GUT / W) * 100}%` }}><span>{localHM(van)}</span><span>{localHM((van + tot) / 2)}</span><span>{localHM(tot)}</span></div>
          </div>
        );
      })}
      <div className={s.noot}>cm t.o.v. NAP · zelfde tijd- en hoogteschaal{reeksen.some((r) => r.astro) ? " · deels astronomisch (zonder windopzet)" : ""}</div>
    </div>
  );
}
