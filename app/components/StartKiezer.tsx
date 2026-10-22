"use client";
// Startvenster: vertrek- en aankomsthaven kiezen. Verplicht (geen sluitknop, Escape en
// achtergrond doen niets); de lijsten komen van de ouder, dit bestand is alleen vorm.
import { useEffect, useRef, useState } from "react";
import type { Kant } from "./Shell";
import s from "./StartKiezer.module.css";

export default function StartKiezer({ open, van, naar, onKlaar, children }: {
  open: boolean; van: string; naar: string; onKlaar: () => void;
  children: (kant: Kant, volgende: () => void) => React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [kant, setKant] = useState<Kant>("van");
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={s.paneel} aria-label="Havens kiezen" onCancel={(e) => e.preventDefault()}>
      <span className={s.titel}>WAAR VAAR JE?</span>
      <div className="schakelaar">
        {([["van", "VERTREK", van], ["naar", "AANKOMST", naar]] as const).map(([k, rol, naam]) => (
          <button key={k} type="button" className={`schakelaar-stand ${kant === k ? "is-filled" : ""}`}
            aria-pressed={kant === k} onClick={() => setKant(k)}>
            <span className="schakelaar-rol">{rol}</span>
            <span className="schakelaar-naam">{naam}</span>
          </button>
        ))}
      </div>
      <div className={s.lijst}>{children(kant, () => setKant("naar"))}</div>
      <button type="button" className={`row ${s.start}`} onClick={onKlaar}>START</button>
    </dialog>
  );
}
