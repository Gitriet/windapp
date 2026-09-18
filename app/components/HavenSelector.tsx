"use client";
// Havenselector met dynamische toegangsstatus. Vervangt de losse RouteHavenPicker +
// HavenInfoCard: de haveninfo woont nu ín de selector. Dichtgeklapt toont hij een
// statusbadge onder de havennaam; "info ▾" klapt het detail (tijdbalk + gegevens) open.
//
// Toegangsvensters: voor een drempelhaven met getijstation halen we de getijcurve op
// (via de dichtstbijzijnde stationkey — dat is wat /api/tide accepteert) en draaien we
// gateWindows() uit lib/gates.ts met de eigen diepgang. Geen drempel → geen fetch.
import { useEffect, useMemo, useState } from "react";
import { localHM } from "@/lib/tz";
import type { HavenInfo } from "@/lib/haven-info";
import type { TideData } from "@/lib/types";
import { fetchTide } from "@/lib/planner-data";
import { gateWindows, gateDatumFor, windowContains, type GateWindow } from "@/lib/gates";
import st from "./HavenSelector.module.css";
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
  const [detail, setDetail] = useState(false);     // detail-paneel

  const [tide, setTide] = useState<TideData | null>(null);
  const [tideLoading, setTideLoading] = useState(false);

  const hasDrempel = !!havenInfo?.drempel;
  const datum = useMemo(() => gateDatumFor(value), [value]);
  const canGate = hasDrempel && !!datum && !!stationKey;

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
    <div className={st.wrap}>
      <label className={st.veld}>
        <span className={st.label}>{label}</span>
        <select className={st.select} value={value} onChange={(e) => onSelect(e.target.value)}>
          {[value, ...options.filter((h) => h !== value)].sort((a, b) => naamOf(a).localeCompare(naamOf(b), "nl")).map((h) => (
            <option key={h} value={h}>{naamOf(h)}</option>
          ))}
        </select>
      </label>

      {/* statusbadge + info-toggle, direct onder de havennaam */}
      {havenInfo && (
        <div className={st.statusRij}>
          <span className={st.badge} data-tone={badge.tone}>{badge.text}</span>
          <button type="button" className={st.info} aria-expanded={detail} onClick={() => setDetail((d) => !d)}>
            info {detail ? "▴" : "▾"}
          </button>
        </div>
      )}

      {havenInfo && detail && (
        <div className={st.detail}>
          {(status.kind === "open" || status.kind === "dicht") && <TijdBalk windows={status.windows} />}
          <Detail havenInfo={havenInfo} bootDiepgang={bootDiepgang} />
        </div>
      )}
    </div>
  );
}

function badgeFor(s: Status): { text: string; tone: "goed" | "let-op" | "neutraal" } {
  switch (s.kind) {
    case "vrij": return { text: "Vrij toegankelijk", tone: "goed" };
    case "getijgebonden": return { text: "Getijgebonden", tone: "let-op" };
    case "loading": return { text: "Laden…", tone: "neutraal" };
    case "open": return { text: `Toegankelijk, nog ${duur(s.ms)}`, tone: "goed" };
    case "dicht": return {
      text: s.ms != null ? `Niet toegankelijk, over ${duur(s.ms)} open` : "Niet toegankelijk (24u dicht)",
      tone: "let-op",
    };
  }
}

// 24u-balk vanaf nu: groen = open, oker = dicht. Vijf tijdlabels op 0/6/12/18/24u.
function TijdBalk({ windows }: { windows: GateWindow[] }) {
  const now = Date.now();
  const pct = (ms: number) => Math.max(0, Math.min(100, ((ms - now) / DAY) * 100));
  return (
    <div className={st.balkWrap}>
      <div className={st.balk}>
        {windows.map((w, i) => (
          <div key={i} className={st.balkOpen} style={{ left: `${pct(w.fromMs)}%`, width: `${pct(w.toMs) - pct(w.fromMs)}%` }} />
        ))}
      </div>
      <div className={st.balkAs}>
        {[0, 1, 2, 3, 4].map((k) => <span key={k}>{localHM(now + (k * DAY) / 4)}</span>)}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={st.row}>
      <div className={st.rowLabel}>{label}</div>
      <div className={st.rowWaarde}>{children}</div>
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
          {benodigdNap != null && <span className={st.dim}> · met {m2(bootDiepgang)} m diepgang min. {napSigned(benodigdNap)} nodig</span>}
          <div className={st.noot}>{h.drempel.toelichting}</div>
        </Row>
      )}
      <Row label="VHF">
        {h.vhf.map((v, i) => (
          <span key={i}>
            {i > 0 && <span className={st.dim}> · </span>}
            <span className={st.num}>{v.kanaal}</span>{" "}
            <span className={st.dim}>{v.dienst}</span>
          </span>
        ))}
      </Row>
      {h.sluis && (
        <Row label="Sluis">
          {h.sluis.naam}
          {h.sluis.vhf != null && <span className={st.dim}> · VHF {h.sluis.vhf}</span>}
          <div className={st.noot}>{h.sluis.bediening}</div>
        </Row>
      )}
      {h.getij && (
        <Row label="Getij">
          verval {h.getij.verval_m} m
          <div className={st.noot}>{h.getij.opmerking}</div>
        </Row>
      )}
      {h.opmerkingen && <div className={st.opmerking}>{h.opmerkingen}</div>}
    </div>
  );
}
