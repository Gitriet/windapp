"use client";
// SVG-componenten voor de Tocht-planner en Nu-view. Geport uit het DCLogic-prototype
// (design_handoff_tocht_planner), maar gevoed door echte data (SimResult uit de sim,
// AlongSample uit route-stroom, tide-extremen). Tijd-assen werken in ms; labels via
// de Europe/Amsterdam-helpers in lib/tz.ts.
import type { SimResult, SimStep } from "@/lib/tripsim";
import type { AlongSample } from "@/lib/route";
import { localHM, localMidnight } from "@/lib/tz";
import { COLORS, alpha } from "@/lib/colors";
import { relativeWindAngle } from "@/lib/wind";
import { WindRoseIcon } from "./WindRoseIcon";

const H = 3_600_000;
const P16 = ["N", "NNO", "NO", "ONO", "O", "OZO", "ZO", "ZZO", "Z", "ZZW", "ZW", "WZW", "W", "WNW", "NW", "NNW"];
export const dirLabel16 = (d: number) => P16[Math.round((((d % 360) + 360) % 360) / 22.5) % 16];
// Rond eerst de totale minuten af, splits dan pas — anders kan Math.round(min % 60)
// naar 60 afronden terwijl het uur al is afgekapt (1859,6 min → "30u60" i.p.v. "31u00").
export const fmtDur = (min: number) => { const m = Math.round(min); return `${Math.floor(m / 60)}u${String(m % 60).padStart(2, "0")}`; };
const tms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));

// waarschuwingskleur voor wind-tegen-stroom (oranje-rood, los van de amberkleur van wind)
const WARN = COLORS.waarschuwing;   // amber — waarschuwingen (bv. wind tegen stroom)

const angleDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

// Zeilhoek in woorden uit de TWA (0–180). Grenzen exact zoals gevraagd.
export function sailPhrase(twa: number): string {
  const a = Math.abs(twa);
  return a < 45 ? "aan de wind" : a < 90 ? "halve wind" : a < 135 ? "ruime wind" : "voor de wind";
}

// Gemiddelde wind: scalaire gemiddelde snelheid + vector-gemiddelde richting over de
// body-stappen (de laatste stap is een duplicaat-aankomststap). Met `windowMs` middelt
// hij alleen de stappen in [vertrek, vertrek+windowMs] — het VERTREKVENSTER — zodat een
// windstille start niet wordt weggemiddeld door een windrijke staart. Bij een tocht
// korter dan het venster vallen alle stappen erbinnen: dan is dit het tocht-gemiddelde.
export function tripWind(steps: SimStep[], windowMs?: number): { spd: number; dir: number; twa: number } {
  const all = steps.length > 1 ? steps.slice(0, -1) : steps;
  const t0 = all[0]?.tMs ?? 0;
  const win = windowMs != null ? all.filter((s) => s.tMs <= t0 + windowMs) : all;
  const body = win.length ? win : all;
  if (!body.length) return { spd: 0, dir: 0, twa: 0 };
  let e = 0, n = 0, spd = 0, twa = 0;
  for (const s of body) {
    const r = (s.wDir * Math.PI) / 180;
    e += Math.sin(r); n += Math.cos(r); spd += s.wSpd; twa += s.twa;
  }
  const k = body.length;
  const dir = ((Math.atan2(e / k, n / k) * 180) / Math.PI + 360) % 360;
  return { spd: spd / k, dir, twa: twa / k };
}

// Wind-tegen-stroom: waar wind > 15 kn EN |stroom| > 0,5 kn EN wind en stroom
// tegengesteld (hoek tussen wind-heen en stroom-heen > 90°). De stroomrichting leiden
// we af uit het teken van de langs-koers-component (cur ≥ 0 → met de koers mee) plus de
// routekoers — de sim levert geen stroomvector, dus dit is de eerlijkste benadering.
// Vlag de tocht als een noemenswaardig deel (≥ 25%) van de stappen eraan voldoet.
export function windAgainstCurrent(steps: SimStep[], courseDeg: number): boolean {
  const body = steps.length > 1 ? steps.slice(0, -1) : steps;
  if (!body.length) return false;
  let bad = 0;
  for (const s of body) {
    if (s.wSpd <= 15 || Math.abs(s.cur) <= 0.5) continue;
    const windToward = (s.wDir + 180) % 360;
    const curToward = s.cur >= 0 ? courseDeg : (courseDeg + 180) % 360;
    if (angleDiff(windToward, curToward) > 90) bad++;
  }
  return bad / body.length >= 0.25;
}

// eerste hele lokale 3-uurs tick op of na startMs
function threeHourTicks(startMs: number, endMs: number): number[] {
  const out: number[] = [];
  let m = localMidnight(startMs);
  while (m < startMs) m += 3 * H;
  for (; m <= endMs; m += 3 * H) out.push(m);
  return out;
}

// ── Stroom langs de route (contexttijdlijn boven de trip) ──────────────
export function CurrentTimeline({
  series, depMs, arrMs, hwMs, tMin, tMax,
}: { series: AlongSample[]; depMs: number; arrMs: number | null; hwMs: number[]; tMin?: number; tMax?: number }) {
  const W = 1070, height = 90, pl = 40, pr = 10, cw = W - pl - pr, mid = 42;
  const end = arrMs ?? depMs + 2 * H;
  const startMs = tMin ?? Math.max(series.length ? tms(series[0].t) : depMs, depMs - 2 * H);
  const endMs = tMax ?? Math.min(series.length ? tms(series[series.length - 1].t) : end, end + 2 * H);
  const span = Math.max(1, endMs - startMs);
  const x = (ms: number) => pl + ((ms - startMs) / span) * cw;
  const inWin = series
    .map((p) => ({ ms: tms(p.t), c: p.alongKn }))
    .filter((p): p is { ms: number; c: number } => p.c != null && p.ms >= startMs && p.ms <= endMs);
  const maxAbs = Math.max(0.6, ...inWin.map((p) => Math.abs(p.c)));
  const maxA = Math.ceil(maxAbs * 10) / 10;
  const amp = 26;
  const y = (v: number) => mid - (v / maxA) * amp;
  const slots = Math.max(1, Math.round(span / H));
  const bw = Math.min(30, Math.max(3, (cw / slots) * 0.55));   // cap → strakke balkjes bij weinig samples
  const wx1 = x(Math.max(startMs, depMs)), wx2 = x(Math.min(endMs, arrMs ?? depMs));
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="xMidYMid meet" style={{ display: "block" }}>
      <line x1={pl} y1={mid} x2={W - pr} y2={mid} stroke="rgba(233,233,237,.15)" />
      {/* kn-schaal (mee boven groen · tegen onder rood) */}
      <text x={pl - 5} y={y(maxA) + 3} textAnchor="end" fontSize={9} fill={alpha(COLORS.stroom, 0.75)} style={{ fontVariantNumeric: "tabular-nums" }}>{maxA.toFixed(1)}</text>
      <text x={pl - 5} y={mid + 3} textAnchor="end" fontSize={8} fill="rgba(233,233,237,.3)">kn</text>
      <text x={pl - 5} y={y(-maxA) + 3} textAnchor="end" fontSize={9} fill="rgba(192,122,122,.65)" style={{ fontVariantNumeric: "tabular-nums" }}>{maxA.toFixed(1)}</text>
      {/* trip-window */}
      {wx2 > wx1 && (
        <rect x={wx1} y={4} width={wx2 - wx1} height={height - 20} rx={6}
          fill={alpha(COLORS.weer, 0.1)} stroke={COLORS.weer} strokeWidth={1.2} strokeDasharray="5 3" />
      )}
      {/* diverging kn-balken: mee omhoog (groen), tegen omlaag (rood) */}
      {inWin.map((p, i) => {
        const yv = y(p.c), mee = p.c >= 0;
        return <rect key={i} x={x(p.ms) - bw / 2} y={Math.min(mid, yv)} width={bw} height={Math.abs(yv - mid)} rx={1.2}
          fill={mee ? COLORS.stroom : COLORS.stroomTegen} fillOpacity={0.85} />;
      })}
      {threeHourTicks(startMs, endMs).map((ms) => (
        <text key={`t${ms}`} x={x(ms)} y={height - 1} textAnchor="middle" fontSize={10}
          fill="rgba(233,233,237,.3)" style={{ fontVariantNumeric: "tabular-nums" }}>{localHM(ms)}</text>
      ))}
      {hwMs.filter((ms) => ms >= startMs && ms <= endMs).map((ms, i) => (
        <g key={`hw${i}`}>
          <line x1={x(ms)} y1={mid - 5} x2={x(ms)} y2={mid + 5} stroke={COLORS.water} strokeWidth={1.2} />
          <text x={x(ms)} y={12} textAnchor="middle" fontSize={9} fontWeight={600} fill={COLORS.water}>HW</text>
        </g>
      ))}
    </svg>
  );
}

// ── Wind langs de route (contexttijdlijn onder de stroom) ──────────────
// Zelfde tijdas-logica als CurrentTimeline (depMs−4u … depMs+22u, geklemd op de
// reeks) zodat wind en stroom op dezelfde as staan. Ambervulling + amberlijn,
// knopenschaal links, dezelfde gestreepte trip-window en kleine richtingpijlen.
// tMin/tMax: als meegegeven, exact de as-grenzen van de stroomtijdlijn — zo staan de
// selectiekaders van beide tijdlijnen pixel-identiek boven elkaar. Zonder → eigen extent.
export type WindTLSample = { t: string; speedKn: number; dirDeg: number };
export function WindTimeline({
  series, depMs, arrMs, tMin, tMax,
}: { series: WindTLSample[]; depMs: number; arrMs: number | null; tMin?: number; tMax?: number; }) {
  const W = 1070, height = 96, pl = 34, pr = 10, cw = W - pl - pr, top = 30, bot = height - 16;
  const end = arrMs ?? depMs + 2 * H;
  const startMs = tMin ?? Math.max(series.length ? tms(series[0].t) : depMs, depMs - 2 * H);
  const endMs = tMax ?? Math.min(series.length ? tms(series[series.length - 1].t) : end, end + 2 * H);
  const span = Math.max(1, endMs - startMs);
  const x = (ms: number) => pl + ((ms - startMs) / span) * cw;
  const inWin = series.map((p) => ({ ms: tms(p.t), v: p.speedKn, d: p.dirDeg })).filter((p) => p.ms >= startMs && p.ms <= endMs);
  const maxKn = Math.max(6, Math.ceil(Math.max(...inWin.map((p) => p.v), 0) / 2) * 2);
  const y = (v: number) => bot - (v / maxKn) * (bot - top);
  const slots = Math.max(1, Math.round(span / H));
  const bw = Math.min(30, Math.max(3, (cw / slots) * 0.55));   // cap → strakke balkjes bij weinig samples
  const wx1 = x(Math.max(startMs, depMs)), wx2 = x(Math.min(endMs, arrMs ?? depMs));
  const gridK = [0, maxKn / 2, maxKn];
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="xMidYMid meet" style={{ display: "block" }}>
      {gridK.map((v) => (
        <g key={`g${v}`}>
          <line x1={pl} y1={y(v)} x2={W - pr} y2={y(v)} stroke="rgba(233,233,237,.08)" />
          <text x={pl - 5} y={y(v) + 3} textAnchor="end" fontSize={9} fill="rgba(233,233,237,.3)" style={{ fontVariantNumeric: "tabular-nums" }}>{Math.round(v)}</text>
        </g>
      ))}
      {/* trip-window achter de balken */}
      {wx2 > wx1 && (
        <rect x={wx1} y={top - 5} width={wx2 - wx1} height={bot - top + 9} rx={6}
          fill={alpha(COLORS.weer, 0.1)} stroke={COLORS.weer} strokeWidth={1.2} strokeDasharray="5 3" />
      )}
      {/* wind-balken (zelfde vorm als de Nu-view, zonder vlaag-cap — route-wind heeft geen
          vlaag) + richting-pijltje boven elke balk, wijzend naar vanwaar de wind komt. */}
      {inWin.map((p, i) => (
        <g key={i}>
          <rect x={x(p.ms) - bw / 2} y={y(p.v)} width={bw} height={bot - y(p.v)} rx={1.5} fill={COLORS.wind} fillOpacity={0.82} />
          <g transform={`translate(${x(p.ms)} ${Math.max(top - 6, y(p.v) - 9)})`}>
            <path d="M10 3 L14 16 L10 13 L6 16 Z" fill={COLORS.wind} fillOpacity={0.8} transform={`rotate(${p.d}) scale(0.7) translate(-10 -10)`} />
          </g>
        </g>
      ))}
      {threeHourTicks(startMs, endMs).map((ms) => (
        <text key={`t${ms}`} x={x(ms)} y={height - 2} textAnchor="middle" fontSize={10}
          fill="rgba(233,233,237,.3)" style={{ fontVariantNumeric: "tabular-nums" }}>{localHM(ms)}</text>
      ))}
      <text x={pl - 5} y={top - 8} textAnchor="end" fontSize={9} fill={alpha(COLORS.wind, 0.7)}>kn</text>
    </svg>
  );
}

// ── Snelheid langs de route ─────────────────────────────────────────────
// SOG (kn) als verticale balken in dezelfde stijl als de wind-/stroom-tijdlijn,
// maar op de TOCHT-as (vertrek→aankomst) — snelheid bestaat alleen tijdens de tocht,
// dus die as vult de breedte i.p.v. een sliver op het 2u-forecastvenster.
export function SpeedTimeline({ trip }: { trip: SimResult }) {
  const steps = trip.steps;
  const W = 1070, height = 96, pl = 34, pr = 10, cw = W - pl - pr, top = 22, bot = height - 16;
  const depMs = trip.departMs;
  const arrMs = trip.arrMs ?? (steps.length ? steps[steps.length - 1].tMs : depMs);
  const span = Math.max(1, arrMs - depMs);
  const x = (ms: number) => pl + ((ms - depMs) / span) * cw;
  const pts = steps.map((s) => ({ ms: s.tMs, v: s.sog })).filter((p) => p.ms >= depMs && p.ms <= arrMs);
  const maxKn = Math.max(4, Math.ceil(Math.max(...pts.map((p) => p.v), 0) / 2) * 2);
  const y = (v: number) => bot - (v / maxKn) * (bot - top);
  const bw = Math.min(24, Math.max(3, (cw / Math.max(1, pts.length)) * 0.7));
  const gridK = [0, maxKn / 2, maxKn];
  const dur = span / H, tStep = dur > 12 ? 3 : dur >= 3 ? 1 : 0.25;
  const labels: number[] = [];
  for (let t = Math.ceil(depMs / (tStep * H)) * (tStep * H); t <= arrMs + 1000; t += tStep * H) labels.push(t);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="xMidYMid meet" style={{ display: "block" }}>
      {gridK.map((v) => (
        <g key={`g${v}`}>
          <line x1={pl} y1={y(v)} x2={W - pr} y2={y(v)} stroke="rgba(233,233,237,.08)" />
          <text x={pl - 5} y={y(v) + 3} textAnchor="end" fontSize={9} fill="rgba(233,233,237,.3)" style={{ fontVariantNumeric: "tabular-nums" }}>{Math.round(v)}</text>
        </g>
      ))}
      {pts.map((p, i) => (
        <rect key={i} x={x(p.ms) - bw / 2} y={y(p.v)} width={bw} height={bot - y(p.v)} rx={1.5} fill={COLORS.sog} fillOpacity={0.7} />
      ))}
      {labels.map((t) => (
        <text key={`t${t}`} x={x(t)} y={height - 2} textAnchor="middle" fontSize={10} fill="rgba(233,233,237,.3)" style={{ fontVariantNumeric: "tabular-nums" }}>{localHM(t)}</text>
      ))}
      <text x={pl - 5} y={top - 6} textAnchor="end" fontSize={9} fill={alpha(COLORS.sog, 0.6)}>kn</text>
    </svg>
  );
}

// ── Trip chart: SOG vs STW, met het stroomeffect als het gekleurde vlak ertussen ──
export function TripChart({ trip }: { trip: SimResult }) {
  const steps = trip.steps;
  const W = 1100, pl = 48, pr = 16;
  const sH = 210, wRowH = 52, gap = 16, labH = 20, topPad = 30, legendH = 20;
  const totalH = topPad + sH + gap + wRowH + labH + legendH;
  const cw = W - pl - pr;
  const depMs = trip.departMs, arrMs = trip.arrMs ?? steps[steps.length - 1]?.tMs ?? depMs + H;
  const dist = trip.distanceNm;
  const x = (ms: number) => pl + ((ms - depMs) / Math.max(1, arrMs - depMs)) * cw;
  // y-as aangetrokken op het bereik dat ertoe doet: onderkant = floor(min − 1)
  const lo = Math.min(...steps.map((s) => Math.min(s.stw, s.sog)));
  const hi = Math.max(...steps.map((s) => Math.max(s.stw, s.sog)));
  const yMin = Math.floor(lo - 1), yMax = Math.ceil(hi + 0.5);
  const ys = (v: number) => topPad + sH - ((v - yMin) / (yMax - yMin)) * sH;
  const wT = topPad + sH + gap, wMid = wT + wRowH / 2;

  const grid: React.ReactNode[] = [];
  const gStep = yMax - yMin > 6 ? 2 : 1;
  for (let v = Math.ceil(yMin); v <= yMax; v += gStep) {
    grid.push(<line key={`g${v}`} x1={pl} y1={ys(v)} x2={W - pr} y2={ys(v)} stroke="rgba(233,233,237,.06)" />);
    grid.push(<text key={`gl${v}`} x={pl - 6} y={ys(v) + 3.5} textAnchor="end" fontSize={10}
      fill="rgba(233,233,237,.28)" style={{ fontVariantNumeric: "tabular-nums" }}>{v} kn</text>);
  }

  // HET STROOMEFFECT = het vlak tussen SOG en STW. Groen waar SOG > STW (mee),
  // rood waar SOG < STW (tegen). Gesegmenteerd op het teken, met stevige dekking.
  const effect: React.ReactNode[] = [];
  let segS = 0;
  for (let i = 1; i <= steps.length; i++) {
    const prev = steps[i - 1].cur >= 0;
    const cur = i < steps.length ? steps[i].cur >= 0 : !prev;
    if (cur !== prev || i === steps.length) {
      const seg = steps.slice(segS, i);
      if (seg.length > 1) {
        const fwd = seg.map((s) => `${x(s.tMs)},${ys(s.sog)}`).join(" L");
        const bwd = [...seg].reverse().map((s) => `${x(s.tMs)},${ys(s.stw)}`).join(" L");
        effect.push(<path key={`ef${segS}`} d={`M${fwd} L${bwd} Z`}
          fill={prev ? alpha(COLORS.stroom, 0.34) : alpha(COLORS.stroomTegen, 0.34)} />);
      }
      segS = Math.max(0, i - 1);
    }
  }

  const sogPath = `M${steps.map((s) => `${x(s.tMs)},${ys(s.sog)}`).join(" L")}`;
  const stwPath = `M${steps.map((s) => `${x(s.tMs)},${ys(s.stw)}`).join(" L")}`;

  const winds: React.ReactNode[] = [];
  // hoogstens ~12 pijlen, ongeacht de tochtlengte (31 u → elke ~2,5 u een pijl)
  const nBarbs = 12;
  const barbStep = Math.max(1, Math.ceil(steps.length / nBarbs));
  for (let i = 0; i < steps.length; i += barbStep) {
    const s = steps[i], cx = x(s.tMs), arrowLen = 14, r = (s.wDir * Math.PI) / 180;
    const dx = Math.sin(r) * arrowLen, dy = -Math.cos(r) * arrowLen;
    const tipX = cx + dx * 0.6, tipY = wMid - 6 + dy * 0.6;
    const perpX = -Math.cos(r) * 3.5, perpY = -Math.sin(r) * 3.5;
    const backX = -Math.sin(r) * 4, backY = Math.cos(r) * 4;
    winds.push(
      <g key={`w${i}`}>
        <line x1={cx - dx * 0.6} y1={wMid - 6 - dy * 0.6} x2={cx + dx * 0.6} y2={wMid - 6 + dy * 0.6}
          stroke={COLORS.wind} strokeWidth={1.8} strokeLinecap="round" />
        <path d={`M${tipX} ${tipY} L${tipX - backX + perpX} ${tipY - backY + perpY} L${tipX - backX - perpX} ${tipY - backY - perpY} Z`} fill={COLORS.wind} />
        <text x={cx} y={wMid + 16} textAnchor="middle" fontSize={10} fontWeight={500} fill={COLORS.wind}
          style={{ fontVariantNumeric: "tabular-nums" }}>{Math.round(s.wSpd)}</text>
        <text x={cx} y={wMid + 26} textAnchor="middle" fontSize={8} fill={alpha(COLORS.wind, 0.5)}>{dirLabel16(s.wDir)}</text>
      </g>,
    );
  }

  const dur = (arrMs - depMs) / H;  // uren; label-interval adaptief op de tochtlengte
  const tStep = dur > 36 ? 6 : dur > 12 ? 3 : dur >= 3 ? 1 : 0.25;   // uur
  const timeLabels: React.ReactNode[] = [];
  for (let t = Math.ceil(depMs / (tStep * H)) * (tStep * H); t <= arrMs + 1000; t += tStep * H) {
    timeLabels.push(<text key={`tl${t}`} x={x(t)} y={wT + wRowH + 16} textAnchor="middle" fontSize={11}
      fill="rgba(233,233,237,.35)" style={{ fontVariantNumeric: "tabular-nums" }}>{localHM(t)}</text>);
  }

  // afstandmarkers: interval adaptief op de tochtlengte + altijd het eindpunt.
  // De laatste veelvoud vlak vóór het eind wordt overgeslagen zodat hij niet op het
  // eindpunt-label botst.
  const nmStep = dist < 10 ? 1 : dist <= 50 ? 5 : dist <= 150 ? 10 : 25;
  const distMarks: number[] = [];
  for (let d = 0; d < dist - nmStep * 0.5; d += nmStep) distMarks.push(d);
  distMarks.push(dist);
  // legenda staat onderaan (eigen regel), zodat "kentering HH:MM" bovenaan hem nooit raakt
  const lg = totalH - 6;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${totalH}`} preserveAspectRatio="xMidYMid meet" style={{ display: "block" }}>
      {grid}
      {effect}
      <path d={sogPath} fill="none" stroke="#e9e9ed" strokeWidth={2.5} strokeLinejoin="round" />
      <path d={stwPath} fill="none" stroke={COLORS.wind} strokeWidth={2} strokeDasharray="6 4" strokeLinejoin="round" />
      <text x={pl - 6} y={wMid - 8} textAnchor="end" fontSize={9} fill={alpha(COLORS.wind, 0.6)}>wind</text>
      <line x1={pl} y1={wT - 2} x2={W - pr} y2={wT - 2} stroke="rgba(233,233,237,.06)" />
      {winds}
      {trip.kentMs && trip.kentMs > depMs && trip.kentMs < arrMs && (
        <g>
          <line x1={x(trip.kentMs)} y1={topPad} x2={x(trip.kentMs)} y2={wT + wRowH} stroke="#e8b94a" strokeWidth={1.5} strokeDasharray="4 3" />
          <text x={x(trip.kentMs)} y={topPad - 6} textAnchor="middle" fontSize={10} fontWeight={500} fill="#e8b94a">kentering {localHM(trip.kentMs)}</text>
        </g>
      )}
      {timeLabels}
      {distMarks.map((d, i) => {
        const st = steps.find((s) => s.prog >= d - 0.01);
        if (!st) return null;
        const mx = x(st.tMs);
        return (
          <g key={`dm${i}`}>
            <text x={mx} y={topPad - 20} textAnchor="middle" fontSize={9} fill="rgba(233,233,237,.25)">
              {i === distMarks.length - 1 ? dist.toFixed(1).replace(".", ",") : d}
            </text>
            <line x1={mx} y1={topPad - 16} x2={mx} y2={topPad - 12} stroke="rgba(233,233,237,.12)" />
          </g>
        );
      })}
      <text x={W - pr} y={topPad - 20} textAnchor="end" fontSize={9} fill="rgba(233,233,237,.2)">nm</text>
      {/* legenda */}
      <line x1={pl + 8} y1={lg} x2={pl + 26} y2={lg} stroke="#e9e9ed" strokeWidth={2.5} />
      <text x={pl + 30} y={lg + 4} fontSize={11} fill="rgba(233,233,237,.55)">SOG</text>
      <line x1={pl + 74} y1={lg} x2={pl + 92} y2={lg} stroke={COLORS.wind} strokeWidth={2} strokeDasharray="6 4" />
      <text x={pl + 96} y={lg + 4} fontSize={11} fill="rgba(233,233,237,.55)">STW (polaire)</text>
      <rect x={pl + 210} y={lg - 5} width={12} height={10} rx={2} fill={alpha(COLORS.stroom, 0.34)} />
      <rect x={pl + 226} y={lg - 5} width={12} height={10} rx={2} fill={alpha(COLORS.stroomTegen, 0.34)} />
      <text x={pl + 244} y={lg + 4} fontSize={11} fill="rgba(233,233,237,.55)">vlak = stroomeffect (groen mee / rood tegen)</text>
      {steps[0] && <circle cx={x(depMs)} cy={ys(steps[0].sog)} r={5} fill="#e9e9ed" stroke="#161826" strokeWidth={2} />}
      {steps.length > 0 && <circle cx={x(arrMs)} cy={ys(steps[steps.length - 1].sog)} r={5} fill="#d2cefd" stroke="#161826" strokeWidth={2} />}
    </svg>
  );
}

// ── Samenvatting (6 metrics) ───────────────────────────────────────────
export function SummaryRow({ trip }: { trip: SimResult }) {
  const effCol = trip.effectMin <= 0 ? COLORS.stroom : COLORS.stroomTegen;
  const effSign = trip.effectMin <= 0 ? "" : "+";
  const items: [string, string, string | undefined][] = [
    ["Aankomst", trip.arrMs ? localHM(trip.arrMs) : "—", undefined],
    ["Vaartijd", trip.arrMs ? fmtDur(trip.tripMin) : "—", undefined],
    ["Stroomeffect", `${effSign}${trip.effectMin} min`, effCol],
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
      {items.map(([label, value, col], i) => (
        <div key={i} style={{ background: "rgba(15,17,25,.4)", borderRadius: 10, padding: "10px 12px", boxShadow: "inset 0 0 0 1px rgba(233,233,237,.06)" }}>
          <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: ".08em", color: "rgba(233,233,237,.35)", whiteSpace: "nowrap" }}>{label}</div>
          <div className="kpi" style={{ fontSize: 18, fontWeight: 600, marginTop: 3, color: col || "#e9e9ed" }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

// ── Vertrekalternatieven ───────────────────────────────────────────────
export type DepOption = { depMs: number; result: SimResult };
export function DepartureCards({
  options, selMs, onSelect, courseDeg,
}: { options: DepOption[]; selMs: number; onSelect: (ms: number) => void; courseDeg: number }) {
  const reachable = options.filter((o) => o.result.arrMs != null);
  const bestOpt = reachable.length
    ? reachable.reduce((b, o) => (o.result.tripMin < b.result.tripMin ? o : b)) : null;
  const bestMs = bestOpt?.depMs ?? null;
  const bestMin = bestOpt?.result.tripMin ?? null;   // snelste vaartijd — ijkpunt voor de kleur
  return (
    // vaste kaartbreedte + wrap: weinig (slimme) vensters vullen niet de volle breedte
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {options.map((o) => {
        const t = o.result, sel = o.depMs === selMs, best = o.depMs === bestMs;
        const unreach = t.arrMs == null;
        // vaartijd-kleur = SNELHEID t.o.v. het snelste vertrek: BEST groen, binnen 30 min
        // neutraal, meer dan 30 min trager rood. (Niet het stroomeffect — dat is maar één
        // component en blijft los als getal staan.)
        const slowerMin = bestMin != null ? t.tripMin - bestMin : 0;
        const quality = unreach ? "rgba(233,233,237,.3)"
          : slowerMin <= 0 ? COLORS.stroom : slowerMin <= 30 ? "#6f6a86" : COLORS.stroomTegen;
        // zeilconditie (amber) + wind-tegen-stroom-vlag uit de sim-stappen. Wind = het
        // VERTREKVENSTER (eerste 2 u), niet het tocht-gemiddelde.
        const w = tripWind(t.steps, 2 * 3600_000);
        const warn = !unreach && windAgainstCurrent(t.steps, courseDeg);
        return (
          <div key={o.depMs} onClick={() => onSelect(o.depMs)} style={{
            width: 96, padding: "8px 4px 6px", borderRadius: 8, cursor: "pointer", textAlign: "center", position: "relative",
            background: sel ? alpha(COLORS.weer, 0.16) : "rgba(15,17,25,.35)",
            border: sel ? `1.5px solid ${COLORS.weer}` : "1px solid rgba(233,233,237,.06)", transition: "all .15s",
          }}>
            {best && (
              <div style={{ position: "absolute", top: -7, left: "50%", transform: "translateX(-50%)", fontSize: 8, fontWeight: 700, background: COLORS.stroom, color: "#fff", padding: "1px 5px", borderRadius: 3, letterSpacing: ".04em", textTransform: "uppercase", whiteSpace: "nowrap" }}>best</div>
            )}
            {warn && (
              <div title="Wind tegen stroom" style={{ position: "absolute", top: 3, right: 3, fontSize: 10, lineHeight: 1, color: WARN }}>⚠</div>
            )}
            <div className="kpi" style={{ fontSize: 14, fontWeight: 600 }}>{localHM(o.depMs)}</div>
            <div style={{ fontSize: 10, color: "rgba(233,233,237,.4)", marginTop: 1, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{unreach ? "—" : `→ ${localHM(t.arrMs!)}`}</div>
            <div className="kpi" style={{ fontSize: 12, fontWeight: 500, marginTop: 3, color: quality }}>{unreach ? "n.b." : fmtDur(t.tripMin)}</div>
            <div style={{ fontSize: 10, marginTop: 2, color: "rgba(233,233,237,.4)", fontWeight: 500 }}>
              {unreach ? "" : `${t.effectMin <= 0 ? "" : "+"}${t.effectMin} min`}
            </div>
            {!unreach && (
              <div style={{ marginTop: 4, paddingTop: 4, borderTop: "1px solid rgba(233,233,237,.06)", display: "flex", justifyContent: "center" }}>
                <WindRoseIcon speed={w.spd} angle={relativeWindAngle(w.dir, courseDeg)} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Windveren (Nu-view) ────────────────────────────────────────────────
function Barb({ kt, dir, color }: { kt: number; dir: number; color: string }) {
  let rem = kt;
  const flags = Math.floor(rem / 50); rem -= flags * 50;
  const full = Math.floor(rem / 10); rem -= full * 10;
  const half = Math.floor(rem / 5);
  const el: React.ReactNode[] = [<line key="s" x1={24} y1={6} x2={24} y2={46} stroke={color} strokeWidth={2} strokeLinecap="round" />];
  let y = 7;
  for (let i = 0; i < flags; i++) { el.push(<path key={`fl${i}`} d={`M24 ${y} L37 ${y + 3} L24 ${y + 6} Z`} fill={color} />); y += 9; }
  for (let i = 0; i < full; i++) { el.push(<line key={`f${i}`} x1={24} y1={y} x2={38} y2={y - 5} stroke={color} strokeWidth={2} strokeLinecap="round" />); y += 6; }
  if (half) el.push(<line key="hf" x1={24} y1={y} x2={31} y2={y - 2.5} stroke={color} strokeWidth={2} strokeLinecap="round" />);
  return <svg width={46} height={52} viewBox="0 0 48 52" style={{ transform: `rotate(${dir}deg)`, overflow: "visible" }}>{el}</svg>;
}

export function WindBarbs({ items, color = COLORS.wind }: { items: { kt: number; dir: number; label: string }[]; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
      {items.map((x, i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, flex: 1 }}>
          <Barb kt={x.kt} dir={x.dir} color={color} />
          <div style={{ fontSize: 13, fontWeight: 600, color: "#e9e9ed", fontVariantNumeric: "tabular-nums" }}>{x.kt}</div>
          <div style={{ fontSize: 11, color: "rgba(233,233,237,.5)" }}>{x.label}</div>
        </div>
      ))}
    </div>
  );
}

// ── Kompasroos (Nu-view) ───────────────────────────────────────────────
export function Compass({ dir }: { dir: number }) {
  return (
    <svg width={172} height={172} viewBox="0 0 172 172">
      <circle cx={86} cy={86} r={76} fill="rgba(15,17,25,.55)" stroke="#3f424d" />
      <circle cx={86} cy={86} r={76} fill="none" stroke="#5d5294" strokeWidth={1} strokeDasharray="2 6" opacity={0.6} />
      <text x={86} y={24} textAnchor="middle" fontSize={12} fill="rgba(233,233,237,.7)">N</text>
      <text x={86} y={156} textAnchor="middle" fontSize={12} fill="rgba(233,233,237,.4)">Z</text>
      <text x={150} y={90} textAnchor="middle" fontSize={12} fill="rgba(233,233,237,.4)">O</text>
      <text x={22} y={90} textAnchor="middle" fontSize={12} fill="rgba(233,233,237,.4)">W</text>
      <g transform={`rotate(${dir} 86 86)`}>
        <path d="M86 26 L96 82 L86 73 L76 82 Z" fill={COLORS.wind} />
        <line x1={86} y1={73} x2={86} y2={140} stroke="#5d5294" strokeWidth={3.5} strokeLinecap="round" />
      </g>
      <circle cx={86} cy={86} r={5} fill="#d2cefd" />
      <text x={86} y={120} textAnchor="middle" fontSize={13} fontWeight={600} fill="#e9e9ed">{Math.round(dir)}°</text>
    </svg>
  );
}
