"use client";
// Schil: merkbalk, tabbar (mobiel), kiezerchip en skeleton. Alleen vorm — welke
// schermen er zijn en in welke volgorde komt uit app/screens.ts; layout per breedte
// staat in globals.css (.shell-*).
import { useEffect, useRef, useState } from "react";
import { SCREENS, type ScreenId } from "../screens";

export function TopBar() {
  return (
    <header className="shell-top">
      <span className="shell-brand">TIDAN</span>
    </header>
  );
}

export function TabBar({ active, onSelect }: { active: ScreenId; onSelect: (t: ScreenId) => void }) {
  return (
    <nav className="shell-tabbar" aria-label="Schermen">
      {SCREENS.map((s) => (
        <button key={s.id} type="button" className="shell-tab" aria-current={s.id === active ? "page" : undefined}
          onClick={() => onSelect(s.id)}>
          <span className="shell-tab-dot" aria-hidden />
          {s.label}
        </button>
      ))}
    </nav>
  );
}

// Volle-breedte kiezerchip; klik opent een paneel eronder (klik buiten sluit).
export function PickerChip({ label, children }: { label: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div ref={ref} className="chip-wrap">
      <button type="button" className="chip-picker" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label}
      </button>
      {open && <div className="chip-panel">{children(() => setOpen(false))}</div>}
    </div>
  );
}

// Laadstatus: hairline-rijen in --fill-faint met vaste hoogte (geen spinner, geen
// layout-shift — de hoogte hoort bij de rij die straks verschijnt).
export function Skeleton({ rows, height, label }: { rows: number; height: number; label: string }) {
  return (
    <div className="skeleton" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row" style={{ "--row-h": `${height}px` } as React.CSSProperties} />
      ))}
    </div>
  );
}
