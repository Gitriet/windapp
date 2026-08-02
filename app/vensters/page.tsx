"use client";
import { useMemo } from "react";
import { useRoute } from "@/components/route/RouteProvider";
import RouteHeader, { fmtDate } from "@/components/route/RouteHeader";
import TabBar from "@/components/route/TabBar";
import Eta from "@/components/route/Eta";
import { useForecasts, useTide, useRouteStroom, usePassageData, type StroomSeriesPoint } from "@/components/route/hooks";
import { pointAtMs, worstCaseWind } from "@/lib/instrument";
import { compass } from "@/lib/format";
import { computePassage, type PassageResult } from "@/lib/passage";
import { evaluateGate, gateDatumFor, type GateStatus } from "@/lib/gates";
import {
  classifyVenster, combineVenster, certaintyLabel, stroomExtremes, stroomKentering,
  MS_HOUR, type VensterStatus,
} from "@/lib/route";
import { localHM } from "@/lib/tz";

const ms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));
const DAY_START_H = 6, DAY_END_H = 21;   // getoonde vensterband (lokale uren)

function hourMsOn(date: string, h: number): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, h, 0, 0, 0).getTime();
}

type Slot = {
  h: number; ms: number; windKn: number; gustKn: number; dir: number;
  status: VensterStatus; star: boolean; vertrek: boolean; dim: boolean;
  passage: PassageResult | null;
  gate: GateStatus; gateMarginM: number | null;
};

export default function VenstersPage() {
  const { waypoints, trip, boat } = useRoute();
  const routeKeys = waypoints.map((w) => w.location_key);
  const forecasts = useForecasts(routeKeys);

  // getijpoort-referentie: het VIA-punt (doorgang), anders de bestemming
  const gateKey = waypoints.length > 2 ? waypoints[waypoints.length - 2].location_key : waypoints[waypoints.length - 1]?.location_key ?? null;
  const gateName = waypoints.find((w) => w.location_key === gateKey)?.name ?? "";
  const tide = useTide(gateKey);
  const gateDatum = gateKey ? gateDatumFor(gateKey) : null;

  const dayStart = hourMsOn(trip.date, DAY_START_H);
  const dayEnd = hourMsOn(trip.date, DAY_END_H);
  const stroom = useRouteStroom(routeKeys, new Date(dayStart).toISOString(), new Date(dayEnd).toISOString());

  // de integratie loopt door tot ná het laatste vertrekuur, dus een ruimer venster
  const passage = usePassageData(routeKeys,
    new Date(dayStart).toISOString(), new Date(dayStart + 30 * MS_HOUR).toISOString());

  const haveFc = routeKeys.every((k) => forecasts[k]);

  const slots: Slot[] = useMemo(() => {
    if (!haveFc) return [];
    const out: Slot[] = [];
    let firstGo = true;
    for (let h = DAY_START_H; h <= DAY_END_H; h++) {
      const t = hourMsOn(trip.date, h);
      const { windKn, gustKn, dir, any } = worstCaseWind(routeKeys.map((k) => forecasts[k].points), t);
      if (!any) continue;

      // vaartijd + ETA vanaf dít vertrekuur (fase 2)
      const res = passage.ready
        ? computePassage({ waypoints, departMs: t, boat, wind: passage.wind, current: passage.current })
        : null;

      // poort: passagetijd komt uit de integratie, wordt hier niet opnieuw geschat
      const gateLeg = res?.legs.find((l) => l.toId === gateKey) ?? null;
      const gatePassMs = gateLeg?.etaArrival?.getTime() ?? null;
      const verdict = evaluateGate(tide, gateDatum, boat, gatePassMs, dayStart, dayStart + 30 * MS_HOUR);

      const windStatus = classifyVenster(windKn, gustKn);
      const status = combineVenster(windStatus, verdict.status);
      const isGo = status === "go";
      const vertrek = isGo && firstGo;
      if (isGo) firstGo = false;

      out.push({
        h, ms: t, windKn, gustKn, dir, status, star: isGo, vertrek,
        dim: t < Date.now() - 30 * 60000,
        passage: res, gate: verdict.status, gateMarginM: verdict.marginM,
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [haveFc, JSON.stringify(routeKeys), trip.date, passage.ready, boat, tide, gateKey]);

  const cert = useMemo(() => {
    if (!haveFc) return undefined;
    const dep = hourMsOn(trip.date, Number(trip.time.split(":")[0]));
    let spread = 0;
    for (const k of routeKeys) {
      const p = pointAtMs(forecasts[k].points, dep);
      if (p) spread = Math.max(spread, p.band_high_kn - p.band_low_kn);
    }
    return certaintyLabel(spread, (dep - Date.now()) / MS_HOUR);
  }, [haveFc, JSON.stringify(routeKeys), trip.date, trip.time]);

  const nowMs = Date.now();
  const showNow = nowMs >= dayStart && nowMs <= dayEnd;

  return (
    <>
      <RouteHeader certainty={cert} />
      <div className="screen-head">
        <div>
          <h2>Vertrekvensters</h2>
          <div className="sub">{fmtDate(trip.date)} · per uur</div>
        </div>
        <div className="legend-dots">
          <i style={{ background: "var(--no)" }} /><i style={{ background: "var(--tight)" }} /><i style={{ background: "var(--go)" }} />
        </div>
      </div>

      <StroomTimeline stroom={stroom?.series} available={stroom?.available} start={dayStart} end={dayEnd} />

      {!gateDatum && gateKey && (
        <div className="stroomline" style={{ paddingTop: 8, paddingBottom: 8 }}>
          <div className="lbl" style={{ marginBottom: 4 }}>Getijpoort {gateName}</div>
          <div className="gap-note">
            Geen referentievlak bekend — poort niet berekend.<br />
            Nodig: kaartdiepte over de drempel én het reductievlak (ALAT) t.o.v. NAP voor dit station.
          </div>
        </div>
      )}

      {!haveFc ? (
        <div className="status load">Vensters berekenen…</div>
      ) : slots.length === 0 ? (
        <div className="status load">Geen voorspelling voor deze dag binnen de horizon.</div>
      ) : (
        <div className="venster-row">
          <div className="agenda">
            {slots.map((s, i) => (
              <div key={s.h} style={{ display: "contents" }}>
                {showNow && i > 0 && slots[i - 1].ms < nowMs && s.ms >= nowMs && (
                  <div className="nowline"><i /><span>● nu {localHM(nowMs)}</span><i /></div>
                )}
                <div className={`slot ${s.status}${s.status === "go" ? " go" : ""}${s.dim ? " dim" : ""}`}>
                  <div className="edge" />
                  <div className="hour">
                    <span>{String(s.h).padStart(2, "0")}</span>
                    {s.star && <span className="star" style={{ color: "var(--go)" }}>★</span>}
                  </div>
                  <div className="body">
                    <div className="wind">
                      <b>{Math.round(s.windKn)}</b>
                      <u>kn {compass(s.dir)}</u>
                      {s.passage?.legs.some((l) => l.tacking) && <span className="tackmark">⇄ kruisrak</span>}
                      {gateDatum && s.gate !== "onbekend" && (
                        <span className={`pill ${s.gate}`}>
                          poort {s.gate}{s.gateMarginM != null ? ` ${s.gateMarginM >= 0 ? "+" : ""}${s.gateMarginM.toFixed(1)} m` : ""}
                        </span>
                      )}
                      {s.vertrek && <span className="vertrek">VERTREK</span>}
                    </div>
                    {s.passage ? (
                      <Eta ms={s.passage.etaArrival?.getTime() ?? null} boat={boat}
                           source={s.passage.currentSource} prefix="aankomst" />
                    ) : (
                      <div className="eta"><span className="t none">aankomst —</span>
                        <span className="src">vaartijd wordt berekend…</span></div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <VStroom stroom={stroom?.series} available={stroom?.available} start={dayStart} end={dayEnd} />
        </div>
      )}
      <TabBar />
    </>
  );
}

// ── horizontale stroom-timeline: wanneer mee vs tegen langs de route ──
function StroomTimeline({ stroom, available, start, end }: { stroom?: StroomSeriesPoint[]; available?: boolean; start: number; end: number }) {
  const seg = useMemo(() => stroomSegments(stroom, start, end), [stroom, start, end]);
  return (
    <div className="stroomline">
      <div className="lbl">Stroom langs route</div>
      {available && seg ? (
        <>
          <div className="bar">
            <div className={`seg ${seg.leftTegen ? "tegen" : "mee"}`} style={{ flex: Math.max(0.05, seg.fracLeft) }}>
              <span>{seg.leftTegen ? "← VLOED · TEGEN" : "→ EB · MEE"}</span>
            </div>
            <div className="split" />
            <div className={`seg ${seg.leftTegen ? "mee" : "tegen"}`} style={{ flex: Math.max(0.05, 1 - seg.fracLeft) }}>
              <span>{seg.leftTegen ? "→ EB · MEE" : "← VLOED · TEGEN"}</span>
            </div>
          </div>
          <div className="ticks">
            <div className="tk" style={{ flex: Math.max(0.05, seg.fracLeft) }}>
              <span>{localHM(start)}</span>
              {seg.kenteringMs && <span className="hw">keert {localHM(seg.kenteringMs)}</span>}
            </div>
            <div className="split" style={{ width: 2, flex: "none" }} />
            <div className="tk" style={{ flex: Math.max(0.05, 1 - seg.fracLeft) }}>
              <span /><span>{localHM(end)}</span>
            </div>
          </div>
        </>
      ) : (
        <div className="unavail">Geen stroomdata voor deze route · model ongevalideerd</div>
      )}
    </div>
  );
}

// ── verticale stroombalk: sterkte tegen (boven) / mee (onder) + kentering ──
function VStroom({ stroom, available, start, end }: { stroom?: StroomSeriesPoint[]; available?: boolean; start: number; end: number }) {
  const s = useMemo(() => (available ? stroomExtremes(stroom, start, end) : null), [stroom, available, start, end]);
  if (!s) return null;
  const H = 460, W = 48, kent = Math.round(H * s.tegenFrac);
  return (
    <div className="vstroom">
      <div className="vh">stroom</div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <rect x="0" y="0" width={W} height={kent} fill="#2A0D0D" />
        <rect x="6" y="0" width={W - 12} height={kent} fill="#E84040" opacity=".28" rx="2" />
        <rect x="0" y={kent} width={W} height={H - kent} fill="#0A2219" />
        <rect x="6" y={kent} width={W - 12} height={H - kent} fill="#1DC87A" opacity=".22" rx="2" />
        {kent > 8 && kent < H - 8 && (
          <>
            <line x1="0" y1={kent} x2={W} y2={kent} stroke="#DDE9F8" strokeWidth="1.5" opacity=".7" />
            <text x={W / 2} y={kent - 4} textAnchor="middle" fontFamily="var(--mono)" fontSize="7" fill="#DDE9F8" opacity=".6">keert</text>
          </>
        )}
        {s.maxTegen > 0.05 && (<>
          <text x={W / 2} y={kent / 2 + 3} textAnchor="middle" fontFamily="var(--mono)" fontSize="10" fill="#E84040" fontWeight="600">{s.maxTegen.toFixed(1)}</text>
          <text x={W / 2} y={kent / 2 + 13} textAnchor="middle" fontFamily="var(--mono)" fontSize="7" fill="#E84040">kn</text>
        </>)}
        {s.maxMee > 0.05 && (<>
          <text x={W / 2} y={kent + (H - kent) / 2 + 3} textAnchor="middle" fontFamily="var(--mono)" fontSize="10" fill="#1DC87A" fontWeight="600">{s.maxMee.toFixed(1)}</text>
          <text x={W / 2} y={kent + (H - kent) / 2 + 13} textAnchor="middle" fontFamily="var(--mono)" fontSize="7" fill="#1DC87A">kn</text>
        </>)}
        <text x={W / 2} y="12" textAnchor="middle" fontFamily="var(--mono)" fontSize="7" fill="#3B5872">{localHM(start).slice(0, 2)}</text>
        <text x={W / 2} y={H - 3} textAnchor="middle" fontFamily="var(--mono)" fontSize="7" fill="#3B5872">{localHM(end).slice(0, 2)}</text>
      </svg>
    </div>
  );
}

function stroomSegments(series: StroomSeriesPoint[] | undefined, start: number, end: number) {
  return stroomKentering(series, start, end);
}
