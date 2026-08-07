"use client";
// Vaarplan — leesbare samenvatting van één gekozen vertrekmoment. Geen nieuwe
// berekeningen: alles komt uit de al berekende SimResult (tripsim), de haveninfo, de
// getijcurve en de wind die de Tocht-planner al in state heeft. Vijf secties, één lange
// scrollbare kolom. Kleuren per datatype: wind = amber, stroom = zeegroen/rood,
// getij = blauw, UI = violet.
import { Fragment, useMemo } from "react";
import { COLORS, alpha } from "@/lib/colors";
import { localHM } from "@/lib/tz";
import { dirLabel16, sailPhrase, fmtDur, tripWind } from "./charts";
import type { SimResult, SimStep } from "@/lib/tripsim";
import type { RouteHaven } from "@/lib/planner-data";
import type { TideData, TideExtreme } from "@/lib/types";
import type { BoatProfile } from "@/lib/polar";
import { gateWindows, gateDatumFor, windowContains, type GateWindow } from "@/lib/gates";

const H = 3_600_000;
const tms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));

export type ViaHaven = { haven: RouteHaven; nmFromStart: number };

export interface VaarplanViewProps {
  depMs: number;
  trip: SimResult;                 // de volledige tripsim-output (selTrip)
  from: RouteHaven;                // vertrekhaven, met havenInfo
  to: RouteHaven;                  // aankomsthaven, met havenInfo
  distanceNm: number | null;
  bearingDeg: number | null;
  routeLabel: { pathNamen: string[]; viaPassage: string | null; legCount: number };
  fromTide: TideData | null;       // getijcurve vertrekhaven (routeTide) — enige beschikbare
  via: ViaHaven[];                 // tussenliggende havens (uitwijk); leeg bij directe route
  boat: BoatProfile;
}

// Verkeersposten langs de NL-kust — handmatige seed, geselecteerd op de breedtegraad-
// strook van de tocht. Indicatief: controleer altijd de actuele kanalen (ANWB-almanak).
// kanaal 16 (nood/oproep) + DSC 70 gelden overal en staan los hieronder.
const VHF_VERKEERSPOSTEN: { naam: string; kanaal: number; latMin: number; latMax: number }[] = [
  { naam: "Den Helder Traffic", kanaal: 62, latMin: 52.85, latMax: 53.60 },
  { naam: "IJmuiden Traffic", kanaal: 61, latMin: 52.30, latMax: 52.75 },
  { naam: "Scheveningen Verkeer", kanaal: 21, latMin: 51.95, latMax: 52.30 },
  { naam: "Maas Approach (Hoek van Holland)", kanaal: 3, latMin: 51.75, latMax: 52.00 },
  { naam: "Centrale Vlissingen", kanaal: 14, latMin: 51.20, latMax: 51.75 },
];

// ── afgeleide teksten (geen sim-wijziging, puur formatteren) ────────────

// Windzin over de tocht: begin-richting/-snelheid, opbouw naar de max (met tijd),
// en de draaiing naar de eindrichting. Eén à twee zinnen.
function weatherSentence(steps: SimStep[]): string {
  const body = steps.length > 1 ? steps.slice(0, -1) : steps;
  if (!body.length) return "Geen winddata voor deze tocht.";
  const s0 = body[0], sEnd = body[body.length - 1];
  let maxStep = body[0];
  for (const s of body) if (s.wSpd > maxStep.wSpd) maxStep = s;

  let out = `${dirLabel16(s0.wDir)} ${Math.round(s0.wSpd)} kn bij vertrek`;
  if (maxStep.wSpd - s0.wSpd >= 4) {
    out += `, bouwt op naar ${Math.round(maxStep.wSpd)} kn rond ${localHM(maxStep.tMs)}`;
  } else if (s0.wSpd - Math.min(...body.map((s) => s.wSpd)) >= 4) {
    const minStep = body.reduce((a, b) => (b.wSpd < a.wSpd ? b : a));
    out += `, zakt naar ${Math.round(minStep.wSpd)} kn rond ${localHM(minStep.tMs)}`;
  }
  const veer = Math.abs(((sEnd.wDir - s0.wDir + 540) % 360) - 180);
  out += veer >= 30 ? `, draait naar ${dirLabel16(sEnd.wDir)}` : `, blijft ${dirLabel16(s0.wDir)}`;
  return out.charAt(0).toUpperCase() + out.slice(1) + ".";
}

// Eerste HW en LW ná een tijdstip uit de al-berekende extremes (geen findHighLow nodig).
function nextExtreme(tide: TideData | null, afterMs: number, kind: "HW" | "LW"): TideExtreme | null {
  if (!tide) return null;
  return tide.extremes.find((e) => e.kind === kind && tms(e.t) >= afterMs)
    ?? tide.extremes.find((e) => e.kind === kind) ?? null;
}

// Sampling van de sim-stappen op heel-uur-intervallen + de eerste en laatste stap.
function sampleHourly(steps: SimStep[]): SimStep[] {
  if (!steps.length) return [];
  const dep = steps[0].tMs, arr = steps[steps.length - 1].tMs;
  const nearest = (target: number) =>
    steps.reduce((best, s) => (Math.abs(s.tMs - target) < Math.abs(best.tMs - target) ? s : best));
  const picks: SimStep[] = [steps[0]];
  for (let h = Math.ceil(dep / H) * H; h < arr; h += H) {
    const s = nearest(h);
    if (s.tMs > picks[picks.length - 1].tMs) picks.push(s);
  }
  const last = steps[steps.length - 1];
  if (last.tMs > picks[picks.length - 1].tMs) picks.push(last);
  return picks;
}

// Positienaam uit prog (nm langs de route): dichtstbijzijnde milestone-haven binnen 2 nm,
// anders de simpele fallback "~X nm gevaren". (Kustplaats-namen zijn nice-to-have; buiten scope.)
function positionName(progNm: number, milestones: { naam: string; nm: number }[]): string {
  let near: { naam: string; nm: number } | null = null;
  for (const m of milestones) {
    if (near == null || Math.abs(m.nm - progNm) < Math.abs(near.nm - progNm)) near = m;
  }
  if (near && Math.abs(near.nm - progNm) < 2) return near.naam;
  return `~${progNm.toFixed(1).replace(".", ",")} nm gevaren`;
}

// ── kleine UI-bouwstenen ────────────────────────────────────────────────
function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: "rgba(15,17,25,.4)", borderRadius: 10, padding: "12px 14px", boxShadow: "inset 0 0 0 1px rgba(233,233,237,.06)" }}>
      <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: ".08em", color: "rgba(233,233,237,.35)", whiteSpace: "nowrap" }}>{label}</div>
      <div className="kpi" style={{ fontSize: 22, fontWeight: 600, marginTop: 4, color: "#e9e9ed" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "rgba(233,233,237,.45)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 11px", borderRadius: 999, fontSize: 12, fontWeight: 600, color, background: alpha(color, 0.14), border: `1px solid ${alpha(color, 0.32)}`, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: COLORS.weer, margin: "28px 0 12px" }}>{children}</div>;
}

// ════════════════════════════════════════════════════════════════════════
export default function VaarplanView({
  depMs, trip, from, to, distanceNm, bearingDeg, routeLabel, fromTide, via, boat,
}: VaarplanViewProps) {
  const steps = trip.steps;

  // milestones voor de positie-naamgeving: vertrek@0, tussenhavens, aankomst@totaal
  const milestones = useMemo(() => {
    const ms: { naam: string; nm: number }[] = [{ naam: from.naam, nm: 0 }];
    for (const v of via) ms.push({ naam: v.haven.naam, nm: v.nmFromStart });
    if (distanceNm != null) ms.push({ naam: to.naam, nm: distanceNm });
    return ms;
  }, [from, to, via, distanceNm]);

  const rows = useMemo(() => sampleHourly(steps), [steps]);
  const wind = useMemo(() => tripWind(steps, 2 * H), [steps]);   // vertrekvenster (eerste 2u)
  const kentMs = trip.kentMs;

  // vertrek-gate uit de al aanwezige getijcurve (pure functie — geen fetch)
  const fromGate = useMemo(() => {
    const datum = gateDatumFor(from.haven);
    if (!from.havenInfo?.drempel || !datum || !fromTide?.expected.length) return null;
    const req = boat.draftM + boat.keelClearanceM;
    const wins = gateWindows(fromTide, datum, req, depMs - 2 * H, depMs + 26 * H);
    return { windows: wins, openAtDep: windowContains(wins, depMs) };
  }, [from, fromTide, boat, depMs]);

  const routeTitle = routeLabel.pathNamen.length >= 2 ? routeLabel.pathNamen.join(" → ") : `${from.naam} → ${to.naam}`;
  const routeSub = routeLabel.viaPassage ? `via ${routeLabel.viaPassage}`
    : routeLabel.legCount > 1 ? `${routeLabel.legCount} legs via het netwerk`
    : "directe route";

  const effCol = trip.effectMin <= 0 ? COLORS.stroom : COLORS.stroomTegen;
  const effSign = trip.effectMin <= 0 ? "" : "+";

  const hwV = nextExtreme(fromTide, depMs, "HW");
  const lwV = nextExtreme(fromTide, depMs, "LW");

  return (
    <div style={{ padding: "18px var(--view-pad-x) 48px" }}>
      {/* ── Sectie 1: Kop ─────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
        <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={COLORS.weer} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx={12} cy={5} r={2.4} /><path d="M12 22V8M5 12H2a10 10 0 0 0 20 0h-3M12 12l0 0" /><path d="M5 12a7 7 0 0 0 14 0" /></svg>
        <div style={{ fontSize: 24, fontWeight: 600, color: "#e9e9ed" }}>{routeTitle}</div>
      </div>
      <div style={{ fontSize: 13, color: "rgba(233,233,237,.5)", marginTop: 3, marginLeft: 32 }}>{routeSub}</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10, marginTop: 16 }}>
        <MetricCard label="Vertrek" value={localHM(depMs)} />
        <MetricCard label="Aankomst" value={trip.arrMs ? localHM(trip.arrMs) : "—"} />
        <MetricCard label="Vaartijd" value={trip.arrMs ? fmtDur(trip.tripMin) : "—"} />
        <MetricCard label="Gem. snelheid" value={trip.arrMs ? `${trip.avgSog.toFixed(1).replace(".", ",")} kn` : "—"} sub="SOG" />
        <MetricCard label="Afstand" value={distanceNm != null ? `${distanceNm.toFixed(1).replace(".", ",")} nm` : "—"} sub={bearingDeg != null ? `koers ${String(Math.round(bearingDeg)).padStart(3, "0")}°` : undefined} />
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <Badge color={COLORS.wind}>Wind {dirLabel16(wind.dir)} {Math.round(wind.spd)} kn · {sailPhrase(wind.twa)}</Badge>
        <Badge color={effCol}>Stroom {effSign}{trip.effectMin} min</Badge>
        <Badge color={COLORS.weer}>{boat.archetype} · {Math.round(boat.performance * 100)}%</Badge>
      </div>

      {/* ── Sectie 2: Weer en getij ───────────────────────────────────── */}
      <SectionTitle>Weer en getij</SectionTitle>
      <div style={{ fontSize: 14, lineHeight: 1.55, color: "rgba(233,233,237,.8)", background: "rgba(15,17,25,.35)", borderRadius: 10, padding: "12px 16px", boxShadow: `inset 0 0 0 1px ${alpha(COLORS.wind, 0.14)}` }}>
        {weatherSentence(steps)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
        <TidePanel titel={`Getij ${from.naam}`} hw={hwV} lw={lwV} available={!!fromTide} />
        <TidePanel titel={`Getij ${to.naam}`} hw={null} lw={null} available={false}
          note="Getijcurve aankomsthaven niet in de planner-state — open de haven in de planner voor het getij." />
      </div>

      {/* ── Sectie 3: Tijdlijn ────────────────────────────────────────── */}
      <SectionTitle>Tijdlijn</SectionTitle>
      <div style={{ overflowX: "auto", background: "rgba(15,17,25,.35)", borderRadius: 12, boxShadow: "inset 0 0 0 1px rgba(233,233,237,.06)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 520 }}>
          <thead>
            <tr style={{ color: "rgba(233,233,237,.4)", fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em" }}>
              <th style={{ textAlign: "left", padding: "10px 14px" }}>Tijd</th>
              <th style={{ textAlign: "left", padding: "10px 14px" }}>Positie</th>
              <th style={{ textAlign: "left", padding: "10px 14px" }}>Wind</th>
              <th style={{ textAlign: "left", padding: "10px 14px" }}>Stroom</th>
              <th style={{ textAlign: "right", padding: "10px 14px" }}>SOG</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => {
              const prev = rows[i - 1];
              // kentering-tussenrij: stroom wisselt van teken t.o.v. de vorige rij
              const flip = prev && (prev.cur >= 0) !== (s.cur >= 0);
              const kMs = kentMs && kentMs > (prev?.tMs ?? -Infinity) && kentMs <= s.tMs ? kentMs : null;
              const curCol = s.cur > 0.15 ? COLORS.stroom : s.cur < -0.15 ? COLORS.stroomTegen : "rgba(233,233,237,.5)";
              const curTxt = `${s.cur >= 0 ? "+" : "−"}${Math.abs(s.cur).toFixed(1)} kn`;
              return (
                <Fragment key={i}>
                  {flip && (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", padding: "6px 14px", fontSize: 11, color: COLORS.kentering, letterSpacing: ".04em" }}>
                        · · · kentering {localHM(kMs ?? s.tMs)} · · ·
                      </td>
                    </tr>
                  )}
                  <tr style={{ borderTop: "1px solid rgba(233,233,237,.05)" }}>
                    <td style={{ padding: "9px 14px", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: "#e9e9ed" }}>{localHM(s.tMs)}</td>
                    <td style={{ padding: "9px 14px", color: "rgba(233,233,237,.7)" }}>{positionName(s.prog, milestones)}</td>
                    <td style={{ padding: "9px 14px", color: COLORS.wind, fontVariantNumeric: "tabular-nums" }}>{dirLabel16(s.wDir)} {Math.round(s.wSpd)} kn</td>
                    <td style={{ padding: "9px 14px", color: curCol, fontVariantNumeric: "tabular-nums" }}>{curTxt}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#e9e9ed" }}>{s.sog.toFixed(1)} kn</td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Sectie 4: Havens ──────────────────────────────────────────── */}
      <SectionTitle>Havens</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <HavenCard rol="Vertrek" haven={from} gate={fromGate} />
        <HavenCard rol="Aankomst" haven={to} gate={null} />
      </div>

      {/* ── Sectie 5: Veiligheid en communicatie ──────────────────────── */}
      <SectionTitle>Veiligheid en communicatie</SectionTitle>
      <VhfSection from={from} to={to} />
      <UitwijkSection via={via} />
    </div>
  );
}

// ── Sectie 2: getijpaneel ───────────────────────────────────────────────
function TidePanel({ titel, hw, lw, available, note }: {
  titel: string; hw: TideExtreme | null; lw: TideExtreme | null; available: boolean; note?: string;
}) {
  return (
    <div style={{ background: "rgba(15,17,25,.35)", borderRadius: 10, padding: "12px 16px", boxShadow: `inset 0 0 0 1px ${alpha(COLORS.water, 0.14)}` }}>
      <div style={{ fontSize: 11, color: alpha(COLORS.water, 0.9), fontWeight: 600, marginBottom: 8 }}>{titel}</div>
      {available ? (
        <div style={{ display: "flex", gap: 20 }}>
          <div>
            <div style={{ fontSize: 10, color: "rgba(233,233,237,.4)", textTransform: "uppercase", letterSpacing: ".06em" }}>Eerstvolgend HW</div>
            <div className="kpi" style={{ fontSize: 18, fontWeight: 600, color: COLORS.water, marginTop: 2 }}>{hw ? localHM(tms(hw.t)) : "—"}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: "rgba(233,233,237,.4)", textTransform: "uppercase", letterSpacing: ".06em" }}>Eerstvolgend LW</div>
            <div className="kpi" style={{ fontSize: 18, fontWeight: 600, color: "rgba(233,233,237,.75)", marginTop: 2 }}>{lw ? localHM(tms(lw.t)) : "—"}</div>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "rgba(233,233,237,.4)", lineHeight: 1.4 }}>{note ?? "Geen getijdata."}</div>
      )}
    </div>
  );
}

// ── Sectie 4: havenkaart ────────────────────────────────────────────────
function HavenCard({ rol, haven, gate }: {
  rol: string; haven: RouteHaven; gate: { windows: GateWindow[]; openAtDep: boolean } | null;
}) {
  const h = haven.havenInfo;
  // statusbadge: dynamisch bij de vertrekhaven (gate uit getijcurve), anders statisch
  let statusText: string, statusColor: string;
  if (gate && h?.drempel) {
    statusText = gate.openAtDep ? "Toegankelijk bij vertrek" : "Getijgebonden — dicht bij vertrek";
    statusColor = gate.openAtDep ? COLORS.stroom : "#D85A30";
  } else if (h?.getijgebonden) {
    statusText = "Getijgebonden"; statusColor = "#D85A30";
  } else {
    statusText = "Vrij toegankelijk"; statusColor = COLORS.stroom;
  }
  return (
    <div style={{ background: "rgba(15,17,25,.4)", borderRadius: 12, padding: "14px 16px", boxShadow: "inset 0 0 0 1px rgba(233,233,237,.06)" }}>
      <div style={{ fontSize: 10, color: "rgba(233,233,237,.4)", textTransform: "uppercase", letterSpacing: ".06em" }}>{rol}</div>
      <div style={{ fontSize: 17, fontWeight: 600, color: "#e9e9ed", marginTop: 2 }}>{haven.naam}</div>
      {h?.havenNaam && <div style={{ fontSize: 12, color: "rgba(233,233,237,.5)" }}>{h.havenNaam}</div>}
      <span style={{ display: "inline-block", marginTop: 8, padding: "3px 9px", borderRadius: 999, fontSize: 11, fontWeight: 600, color: statusColor, background: alpha2(statusColor, 0.15), border: `1px solid ${alpha2(statusColor, 0.34)}` }}>{statusText}</span>

      {h && (
        <div style={{ marginTop: 10, fontSize: 12.5 }}>
          {h.drempel && <InfoRow label="Drempel">{napSigned(h.drempel.diepte_m_nap)}<span style={{ color: "rgba(233,233,237,.45)" }}> · {h.drempel.toelichting}</span></InfoRow>}
          {h.vhf.length > 0 && <InfoRow label="VHF">{h.vhf.map((v, i) => <span key={i}>{i > 0 && <span style={{ color: "rgba(233,233,237,.3)" }}> · </span>}<b style={{ fontVariantNumeric: "tabular-nums" }}>{v.kanaal}</b> <span style={{ color: "rgba(233,233,237,.55)" }}>{v.dienst}</span></span>)}</InfoRow>}
          {h.sluis && <InfoRow label="Sluis">{h.sluis.naam}{h.sluis.vhf != null && <span style={{ color: "rgba(233,233,237,.55)" }}> · VHF {h.sluis.vhf}</span>}</InfoRow>}
          {h.getij && <InfoRow label="Getij">verval {h.getij.verval_m} m</InfoRow>}
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 10, padding: "5px 0", borderTop: "1px solid rgba(233,233,237,.06)" }}>
      <div style={{ minWidth: 58, color: "rgba(233,233,237,.45)", flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1, color: "rgba(233,233,237,.8)" }}>{children}</div>
    </div>
  );
}

const m2 = (n: number) => n.toFixed(2).replace(".", ",");
const napSigned = (n: number) => `${n >= 0 ? "+" : "−"}${m2(Math.abs(n))} m NAP`;
// alpha() werkt alleen op de COLORS-hexen; voor de losse koraal-hex een eigen helper.
function alpha2(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// ── Sectie 5: VHF ───────────────────────────────────────────────────────
function VhfSection({ from, to }: { from: RouteHaven; to: RouteHaven }) {
  const latMin = Math.min(from.lat, to.lat), latMax = Math.max(from.lat, to.lat);
  const posten = VHF_VERKEERSPOSTEN.filter((p) => p.latMax >= latMin - 0.15 && p.latMin <= latMax + 0.15);
  return (
    <div style={{ background: "rgba(15,17,25,.35)", borderRadius: 12, padding: "14px 16px", boxShadow: "inset 0 0 0 1px rgba(233,233,237,.06)" }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(233,233,237,.85)", marginBottom: 8 }}>VHF langs de route</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <span style={{ padding: "4px 10px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, color: "#E0794B", background: "rgba(224,121,75,.14)", border: "1px solid rgba(224,121,75,.4)" }}>16 — nood & oproep</span>
        <span style={{ padding: "4px 10px", borderRadius: 8, fontSize: 12.5, color: "rgba(233,233,237,.7)", background: "rgba(15,17,25,.5)", border: "1px solid rgba(233,233,237,.1)" }}>70 — DSC</span>
        {posten.map((p) => (
          <span key={p.naam} style={{ padding: "4px 10px", borderRadius: 8, fontSize: 12.5, color: alpha(COLORS.water, 0.95), background: alpha(COLORS.water, 0.12), border: `1px solid ${alpha(COLORS.water, 0.3)}` }}>
            <b style={{ fontVariantNumeric: "tabular-nums" }}>{p.kanaal}</b> — {p.naam}
          </span>
        ))}
      </div>
      <div style={{ fontSize: 11, color: "rgba(233,233,237,.35)", marginTop: 8 }}>Indicatief — controleer de actuele kanalen (ANWB Wateralmanak).</div>
    </div>
  );
}

// ── Sectie 5: uitwijkhavens ─────────────────────────────────────────────
function UitwijkSection({ via }: { via: ViaHaven[] }) {
  return (
    <div style={{ background: "rgba(15,17,25,.35)", borderRadius: 12, padding: "14px 16px", marginTop: 10, boxShadow: "inset 0 0 0 1px rgba(233,233,237,.06)" }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(233,233,237,.85)", marginBottom: 8 }}>Uitwijkhavens langs de route</div>
      {via.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "rgba(233,233,237,.45)" }}>Geen tussenhavens op deze directe route.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {via.map((v) => {
            const geb = v.haven.havenInfo?.getijgebonden;
            return (
              <div key={v.haven.haven} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                <span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(233,233,237,.45)", minWidth: 62 }}>~{v.nmFromStart.toFixed(1).replace(".", ",")} nm</span>
                <span style={{ flex: 1, color: "#e9e9ed" }}>{v.haven.naam}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: geb ? "#D85A30" : COLORS.stroom }}>{geb ? "getijgebonden" : "vrij"}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
