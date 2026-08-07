"use client";
// Havenselector met dynamische toegangsstatus. Vervangt de losse RouteHavenPicker +
// HavenInfoCard: de haveninfo woont nu ín de selector. Dichtgeklapt toont hij een
// statusbadge onder de havennaam; "info ▾" klapt het detail (tijdbalk + gegevens) open.
//
// Toegangsvensters: voor een drempelhaven met getijstation halen we de getijcurve op
// (via de dichtstbijzijnde stationkey — dat is wat /api/tide accepteert) en draaien we
// gateWindows() uit lib/gates.ts met de eigen diepgang. Geen drempel → geen fetch.
import { useEffect, useMemo, useRef, useState } from "react";
import { COLORS, alpha } from "@/lib/colors";
import { localHM } from "@/lib/tz";
import type { HavenInfo } from "@/lib/haven-info";
import type { TideData } from "@/lib/types";
import { fetchTide } from "@/lib/planner-data";
import { gateWindows, gateDatumFor, windowContains, type GateWindow } from "@/lib/gates";

const KORAAL = "#D85A30";
const DAY = 24 * 3600000;

const m2 = (n: number) => n.toFixed(2).replace(".", ",");
const napSigned = (n: number) => `${n >= 0 ? "+" : "−"}${m2(Math.abs(n))} m NAP`;
const isTide = (t: TideData | { tide: null } | null): t is TideData => !!t && "expected" in t;

// "nog X" / "over X" — uren, of minuten onder het uur.
function duur(ms: number): string {
  const h = ms / 3600000;
  if (h >= 1) return `${Math.round(h)} u`;
  return `${Math.max(1, Math.round(ms / 60000))} min`;
}

type Status =
  | { kind: "vrij" }                                   // geen drempel
  | { kind: "getijgebonden" }                          // drempel, maar geen bruikbare getijcurve
  | { kind: "loading" }                                // getij wordt opgehaald
  | { kind: "open"; ms: number; windows: GateWindow[] }   // nu toegankelijk, sluit over ms
  | { kind: "dicht"; ms: number | null; windows: GateWindow[] }; // dicht; opent over ms (null = niet binnen 24u)

interface HavenSelectorProps {
  label: string;
  value: string;                    // haven-key
  options: string[];
  naamOf: (h: string) => string;
  onSelect: (h: string) => void;
  havenInfo: HavenInfo | null;
  stationKey: string | null;        // dichtstbijzijnd station (voor /api/tide)
  bootDiepgang: number;             // uit BoatProfile, in meters
}

export default function HavenSelector({
  label, value, options, naamOf, onSelect, havenInfo, stationKey, bootDiepgang,
}: HavenSelectorProps) {
  const [open, setOpen] = useState(false);         // dropdown
  const [detail, setDetail] = useState(false);     // detail-paneel
  const ref = useRef<HTMLDivElement>(null);

  const [tide, setTide] = useState<TideData | null>(null);
  const [tideLoading, setTideLoading] = useState(false);

  const hasDrempel = !!havenInfo?.drempel;
  const datum = useMemo(() => gateDatumFor(value), [value]);
  const canGate = hasDrempel && !!datum && !!stationKey;

  // klik buiten sluit de dropdown
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // getij ophalen — alleen bij drempelhavens met station + referentievlak
  useEffect(() => {
    if (!canGate || !stationKey) { setTide(null); setTideLoading(false); return; }
    let cancelled = false;
    setTideLoading(true);
    fetchTide(stationKey)
      .then((d) => { if (!cancelled) { setTide(isTide(d) ? d : null); setTideLoading(false); } })
      .catch(() => { if (!cancelled) { setTide(null); setTideLoading(false); } });
    return () => { cancelled = true; };
  }, [canGate, stationKey]);

  // status + 24u-vensters afleiden
  const status: Status = useMemo(() => {
    if (!hasDrempel) return { kind: "vrij" };
    if (!canGate) return { kind: "getijgebonden" };
    if (tideLoading) return { kind: "loading" };
    if (!tide || !tide.expected.length) return { kind: "getijgebonden" };
    const now = Date.now();
    const windows = gateWindows(tide, datum, bootDiepgang, now, now + DAY);
    if (windowContains(windows, now)) {
      const cur = windows.find((w) => now >= w.fromMs && now <= w.toMs)!;
      return { kind: "open", ms: cur.toMs - now, windows };
    }
    const next = windows.find((w) => w.fromMs > now);
    return { kind: "dicht", ms: next ? next.fromMs - now : null, windows };
  }, [hasDrempel, canGate, tideLoading, tide, datum, bootDiepgang]);

  const badge = badgeFor(status);

  return (
    <div ref={ref} style={{ position: "relative", minWidth: 230, maxWidth: 320 }}>
      <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: ".08em", color: "rgba(233,233,237,.4)", marginBottom: 3 }}>{label}</div>

      {/* dropdown-trigger: havennaam + chevron */}
      <div onClick={() => setOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", padding: "7px 12px", borderRadius: 8, background: alpha(COLORS.weer, 0.08), border: `1px solid ${alpha(COLORS.weer, 0.18)}` }}>
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={COLORS.weer} strokeWidth={2} strokeLinecap="round"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" /><circle cx={12} cy={9} r={2.5} /></svg>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{naamOf(value)}</span>
        <svg width={10} height={10} viewBox="0 0 10 10" fill="none" stroke="rgba(233,233,237,.4)" strokeWidth={1.5}><path d="M2.5 4 L5 6.5 L7.5 4" /></svg>
      </div>

      {open && (
        <div style={{ position: "absolute", left: 0, top: 60, zIndex: 20, background: "#1e2035", borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,.5), 0 0 0 1px rgba(233,233,237,.1)", padding: 8, minWidth: 220, maxHeight: 340, overflowY: "auto" }}>
          {options.map((h) => (
            <div key={h} onClick={() => { onSelect(h); setOpen(false); }} style={{ padding: "9px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ flex: 1 }}>{naamOf(h)}</span>
              {h === value && <svg width={14} height={14} viewBox="0 0 20 20" fill={COLORS.weer}><path d="M8.5 14.2 L4 9.7 l1.4-1.4 3.1 3.1 6.1-6.1 1.4 1.4z" /></svg>}
            </div>
          ))}
        </div>
      )}

      {/* statusbadge + info-toggle, direct onder de havennaam */}
      {havenInfo && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 999, background: alpha(badge.color, 0.16), border: `1px solid ${alpha(badge.color, 0.34)}`, fontSize: 10.5, fontWeight: 600, color: badge.color, whiteSpace: "nowrap" }}>
            {badge.warn && (
              <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke={badge.color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1={12} y1={9} x2={12} y2={13} /><line x1={12} y1={17} x2={12.01} y2={17} />
              </svg>
            )}
            {badge.text}
          </span>
          <span onClick={() => setDetail((d) => !d)} style={{ fontSize: 11, color: "rgba(233,233,237,.5)", cursor: "pointer", userSelect: "none" }}>
            info {detail ? "▴" : "▾"}
          </span>
        </div>
      )}

      {/* detail — klapt binnen de kaart open (max-height transition, geen overlay) */}
      {havenInfo && (
        <div style={{ maxHeight: detail ? 640 : 0, opacity: detail ? 1 : 0, overflow: "hidden", transition: "max-height .26s ease, opacity .2s ease" }}>
          <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: alpha(COLORS.water, 0.05), border: `1px solid ${alpha(COLORS.water, 0.14)}` }}>
            {(status.kind === "open" || status.kind === "dicht") && (
              <TijdBalk windows={status.windows} />
            )}
            <Detail havenInfo={havenInfo} bootDiepgang={bootDiepgang} />
          </div>
        </div>
      )}
    </div>
  );
}

function badgeFor(s: Status): { text: string; color: string; warn: boolean } {
  switch (s.kind) {
    case "vrij": return { text: "Vrij toegankelijk", color: COLORS.stroom, warn: false };
    case "getijgebonden": return { text: "Getijgebonden", color: KORAAL, warn: true };
    case "loading": return { text: "Laden…", color: "rgba(233,233,237,.5)", warn: false };
    case "open": return { text: `Toegankelijk, nog ${duur(s.ms)}`, color: COLORS.stroom, warn: false };
    case "dicht": return {
      text: s.ms != null ? `Niet toegankelijk, over ${duur(s.ms)} open` : "Niet toegankelijk (24u dicht)",
      color: KORAAL, warn: true,
    };
  }
}

// 24u-balk vanaf nu: groen = open, koraal = dicht. Vijf tijdlabels op 0/6/12/18/24u.
function TijdBalk({ windows }: { windows: GateWindow[] }) {
  const now = Date.now();
  const pct = (ms: number) => Math.max(0, Math.min(100, ((ms - now) / DAY) * 100));
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ position: "relative", height: 10, borderRadius: 5, overflow: "hidden", background: alpha(KORAAL, 0.45) }}>
        {windows.map((w, i) => (
          <div key={i} style={{ position: "absolute", top: 0, bottom: 0, left: `${pct(w.fromMs)}%`, width: `${pct(w.toMs) - pct(w.fromMs)}%`, background: COLORS.stroom }} />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontSize: 9, color: "rgba(233,233,237,.4)", fontVariantNumeric: "tabular-nums" }}>
        {[0, 1, 2, 3, 4].map((k) => <span key={k}>{localHM(now + (k * DAY) / 4)}</span>)}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 10, padding: "6px 0", borderTop: `1px solid ${alpha(COLORS.sog, 0.06)}`, fontSize: 12.5 }}>
      <div style={{ minWidth: 62, color: "rgba(233,233,237,.45)", flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1, color: "rgba(233,233,237,.85)" }}>{children}</div>
    </div>
  );
}

// Detail-inhoud: null-velden worden overgeslagen (geen lege rijen).
function Detail({ havenInfo: h, bootDiepgang }: { havenInfo: HavenInfo; bootDiepgang: number }) {
  const benodigdNap = h.drempel ? h.drempel.diepte_m_nap + bootDiepgang : null;
  return (
    <div>
      {h.drempel && (
        <Row label="Drempel">
          {napSigned(h.drempel.diepte_m_nap)}
          {benodigdNap != null && <span style={{ color: "rgba(233,233,237,.5)" }}> · met {m2(bootDiepgang)} m diepgang min. {napSigned(benodigdNap)} nodig</span>}
          <div style={{ color: "rgba(233,233,237,.5)", fontSize: 11.5, marginTop: 1 }}>{h.drempel.toelichting}</div>
        </Row>
      )}
      <Row label="VHF">
        {h.vhf.map((v, i) => (
          <span key={i}>
            {i > 0 && <span style={{ color: "rgba(233,233,237,.3)" }}> · </span>}
            <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{v.kanaal}</span>{" "}
            <span style={{ color: "rgba(233,233,237,.55)" }}>{v.dienst}</span>
          </span>
        ))}
      </Row>
      {h.sluis && (
        <Row label="Sluis">
          {h.sluis.naam}
          {h.sluis.vhf != null && <span style={{ color: "rgba(233,233,237,.55)" }}> · VHF {h.sluis.vhf}</span>}
          <div style={{ color: "rgba(233,233,237,.5)", fontSize: 11.5, marginTop: 1 }}>{h.sluis.bediening}</div>
        </Row>
      )}
      {h.getij && (
        <Row label="Getij">
          verval {h.getij.verval_m} m
          <div style={{ color: "rgba(233,233,237,.5)", fontSize: 11.5, marginTop: 1 }}>{h.getij.opmerking}</div>
        </Row>
      )}
      {h.opmerkingen && (
        <div style={{ display: "flex", gap: 7, marginTop: 9, paddingTop: 9, borderTop: `1px solid ${alpha(COLORS.sog, 0.06)}` }}>
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="rgba(233,233,237,.4)" strokeWidth={2} strokeLinecap="round" style={{ marginTop: 1, flexShrink: 0 }}>
            <circle cx={12} cy={12} r={10} /><line x1={12} y1={16} x2={12} y2={12} /><line x1={12} y1={8} x2={12.01} y2={8} />
          </svg>
          <div style={{ fontSize: 11.5, color: "rgba(233,233,237,.55)", lineHeight: 1.5 }}>{h.opmerkingen}</div>
        </div>
      )}
    </div>
  );
}
