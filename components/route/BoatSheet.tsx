"use client";
import { useEffect } from "react";
import { useRoute } from "./RouteProvider";
import {
  bestVmgUpwind, bestVmgDownwind, toPlr, plrFilename,
  type BoatArchetype,
} from "@/lib/polar";
import { requiredDepthM } from "@/lib/gates";

const ARCHETYPES: { k: BoatArchetype; label: string }[] = [
  { k: "cruiser-racer", label: "Cruiser-racer" },
  { k: "toerder", label: "Toerder" },
  { k: "platbodem", label: "Platbodem" },
  { k: "motor", label: "Motor" },
];

// Bootprofiel: archetype, diepgang, marge en performance. Hangt aan de routekiezer,
// geen eigen tabblad.
export default function BoatSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { boat, setBoat } = useRoute();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const download = () => {
    const blob = new Blob([toPlr(boat)], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = plrFilename(boat);
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const up = boat.archetype === "motor" ? null : bestVmgUpwind(boat, 12);
  const dn = boat.archetype === "motor" ? null : bestVmgDownwind(boat, 12);

  return (
    <>
      <div className={"detail-overlay" + (open ? " show" : "")} onClick={onClose} />
      <div className={"detail-sheet" + (open ? " show" : "")} role="dialog" aria-modal="true"
           aria-label="Bootprofiel" aria-hidden={!open}>
        <div className="detail-nav">
          <span style={{ fontSize: 15, fontWeight: 600 }}>Bootprofiel</span>
          <button className="x" onClick={onClose} aria-label="Sluiten">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="detail-scroll">
          <div>
            <div className="seclabel" style={{ marginBottom: 8 }}>Archetype</div>
            <div className="chips">
              {ARCHETYPES.map((a) => (
                <button key={a.k} className={"chip tap" + (boat.archetype === a.k ? " on" : "")}
                        onClick={() => setBoat({ archetype: a.k })}>{a.label}</button>
              ))}
            </div>
          </div>

          {boat.archetype === "motor" ? (
            <NumField label="Motorsnelheid" unit="kn" value={boat.motorSpeedKn} step={0.5} min={2} max={20}
                      onChange={(v) => setBoat({ motorSpeedKn: v })} />
          ) : (
            <NumField label="Performance" unit="× potentieel" value={boat.performance} step={0.05} min={0.4} max={1}
                      onChange={(v) => setBoat({ performance: v })}
                      note="Alleen voor bemanning, aangroei en zeegang." />
          )}

          <div className="metrics">
            <NumField label="Diepgang" unit="m" value={boat.draftM} step={0.05} min={0.3} max={4}
                      onChange={(v) => setBoat({ draftM: v })} compact />
            <NumField label="Marge onder kiel" unit="m" value={boat.keelClearanceM} step={0.1} min={0} max={2}
                      onChange={(v) => setBoat({ keelClearanceM: v })} compact />
          </div>

          <div className="certbar">
            <div className="k">Benodigd water</div>
            <span className="pill betrouwbaar">{requiredDepthM(boat).toFixed(2)} m</span>
          </div>

          {up && dn && (
            <div className="certbar">
              <div className="k">Bij 12 kn wind</div>
              <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--t2)" }}>
                nogo {up.twaDeg}° · gijp {dn.twaDeg}°
              </span>
            </div>
          )}

          <button className="cta ghost tap" onClick={download}>Polaire exporteren (.plr)</button>
          <div className="source">
            Polaire = schatting op basis van de rompgegevens, geen VPP-uitvoer en geen meting.
            Export bevat de teruggeschaalde waarden (inclusief performance).<br />
            Het .plr-formaat is nog niet op een plotter geverifieerd — hernoem naar
            <span className="mono"> polar.plr</span> in <span className="mono">Garmin/polars/</span> op de kaart.
          </div>
        </div>
      </div>
    </>
  );
}

function NumField({ label, unit, value, step, min, max, onChange, note, compact }: {
  label: string; unit: string; value: number; step: number; min: number; max: number;
  onChange: (v: number) => void; note?: string; compact?: boolean;
}) {
  // afronden op de stap én op 3 decimalen, zodat 0.85 − 0.05 niet 0.7999999 wordt
  const clamp = (v: number) =>
    Math.min(max, Math.max(min, Math.round((Math.round(v / step) * step) * 1000) / 1000));
  return (
    <div className={compact ? "metric" : "numfield"}>
      <div className="k">{label}</div>
      <div className="numrow">
        <button className="numbtn tap" onClick={() => onChange(clamp(value - step))} aria-label={`${label} omlaag`}>−</button>
        <div className="numval">{step < 0.1 ? value.toFixed(2) : value.toFixed(step < 1 ? 2 : 1)}<em>{unit}</em></div>
        <button className="numbtn tap" onClick={() => onChange(clamp(value + step))} aria-label={`${label} omhoog`}>+</button>
      </div>
      {note && <div className="numnote">{note}</div>}
    </div>
  );
}
