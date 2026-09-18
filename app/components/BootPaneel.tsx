"use client";
// Bootprofiel: type, prestatie of motorsnelheid, diepgang en marge, plus .plr-export.
// Native <dialog>: focus, Escape en achtergrond regelt de browser.
import { useEffect, useRef } from "react";
import { bestVmgDownwind, bestVmgUpwind, plrFilename, toPlr, type BoatArchetype, type BoatProfile } from "@/lib/polar";
import { requiredDepthM } from "@/lib/gates";
import s from "./BootPaneel.module.css";

const TYPES: { k: BoatArchetype; label: string }[] = [
  { k: "cruiser-racer", label: "CRUISER-RACER" },
  { k: "toerder", label: "TOERDER" },
  { k: "platbodem", label: "PLATBODEM" },
  { k: "motor", label: "MOTOR" },
];

const getal = (n: number, dec: number) => n.toFixed(dec).replace(".", ",");

export default function BootPaneel({ open, onClose, boat, setBoat }: {
  open: boolean; onClose: () => void; boat: BoatProfile; setBoat: (patch: Partial<BoatProfile>) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const exporteer = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([toPlr(boat)], { type: "text/plain" }));
    a.download = plrFilename(boat);
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const motor = boat.archetype === "motor";
  const up = motor ? null : bestVmgUpwind(boat, 12);
  const dn = motor ? null : bestVmgDownwind(boat, 12);

  return (
    <dialog ref={ref} className={s.paneel} aria-label="Bootprofiel" onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={s.kop}>
        <span className={s.titel}>BOOTPROFIEL</span>
        <button type="button" className={s.sluit} aria-label="Sluiten" onClick={onClose}>✕</button>
      </div>

      <div className={s.sectie}>TYPE</div>
      <div className={s.types}>
        {TYPES.map((t) => (
          <button key={t.k} type="button" className={`row ${s.type} ${boat.archetype === t.k ? "is-filled" : ""}`}
            aria-pressed={boat.archetype === t.k} onClick={() => setBoat({ archetype: t.k })}>{t.label}</button>
        ))}
      </div>

      {motor ? (
        <Stepper label="MOTORSNELHEID" waarde={boat.motorSpeedKn} eenheid="kn" stap={0.5} min={2} max={20} dec={1}
          onChange={(v) => setBoat({ motorSpeedKn: v })} />
      ) : (
        <Stepper label="PRESTATIE" waarde={Math.round(boat.performance * 100)} eenheid="%" stap={5} min={40} max={100} dec={0}
          onChange={(v) => setBoat({ performance: v / 100 })} noot="Alleen voor bemanning, aangroei en zeegang." />
      )}
      <Stepper label="DIEPGANG" waarde={boat.draftM} eenheid="m" stap={0.05} min={0.3} max={4} dec={2}
        onChange={(v) => setBoat({ draftM: v })} />
      <Stepper label="MARGE ONDER KIEL" waarde={boat.keelClearanceM} eenheid="m" stap={0.1} min={0} max={2} dec={1}
        onChange={(v) => setBoat({ keelClearanceM: v })} />

      <div className={`row ${s.regel}`}>
        <span className={s.label}>BENODIGD WATER</span>
        <span className={s.waarde}>{getal(requiredDepthM(boat), 2)}&nbsp;m</span>
      </div>
      {up && dn && (
        <>
          <div className={`row ${s.regel}`}>
            <span className={s.label}>HOOGTE BIJ 12&nbsp;KN</span>
            <span className={s.waarde}>{up.twaDeg}°</span>
          </div>
          <div className={`row ${s.regel}`}>
            <span className={s.label}>GIJPHOEK BIJ 12&nbsp;KN</span>
            <span className={s.waarde}>{dn.twaDeg}°</span>
          </div>
        </>
      )}

      <button type="button" className={`row ${s.export}`} onClick={exporteer}>POLAIRE EXPORTEREN (.PLR)</button>
      <div className={s.noot}>
        Polaire is een schatting op basis van de rompgegevens, geen meting. Op de kaart hernoemen
        naar polar.plr in Garmin/polars.
      </div>
    </dialog>
  );
}

function Stepper({ label, waarde, eenheid, stap, min, max, dec, onChange, noot }: {
  label: string; waarde: number; eenheid: string; stap: number; min: number; max: number; dec: number;
  onChange: (v: number) => void; noot?: string;
}) {
  // afronden op de stap, zodat 0,85 − 0,05 niet 0,7999 wordt
  const zet = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(Math.round(v / stap) * stap * 1000) / 1000)));
  return (
    <div className={s.stepper}>
      <div className={`row ${s.regel}`}>
        <span className={s.label}>{label}</span>
        <span className={s.knoppen}>
          <button type="button" className={s.knop} aria-label={`${label} omlaag`} disabled={waarde <= min} onClick={() => zet(waarde - stap)}>−</button>
          <span className={s.waarde}>{getal(waarde, dec)}&nbsp;{eenheid}</span>
          <button type="button" className={s.knop} aria-label={`${label} omhoog`} disabled={waarde >= max} onClick={() => zet(waarde + stap)}>+</button>
        </span>
      </div>
      {noot && <div className={s.noot}>{noot}</div>}
    </div>
  );
}
