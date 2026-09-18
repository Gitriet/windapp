"use client";
// Schil: merkbalk, tabbar (mobiel), kiezerchip en skeleton. Alleen vorm — welke
// schermen er zijn en in welke volgorde komt uit app/screens.ts; layout per breedte
// staat in globals.css (.shell-*).
import { useEffect, useRef, useState } from "react";
import { SCREENS, type ScreenId } from "../screens";

// Merkbalk. Vanaf 1400px ook de (enige) routechip en "bijgewerkt HH:MM"; daaronder zijn
// die twee verborgen (CSS) en staat de routechip per scherm.
export function TopBar({ chip, bijgewerkt }: { chip?: React.ReactNode; bijgewerkt?: string | null }) {
  return (
    <header className="shell-top">
      <span className="shell-brand">TIDAN</span>
      {chip && <div className="shell-top-chip">{chip}</div>}
      {bijgewerkt && <span className="shell-top-tijd">bijgewerkt&nbsp;{bijgewerkt}</span>}
    </header>
  );
}

// Eén scherm/kolom. Vanaf 1400px scrollt elke kolom zelf; data-meer staat aan zolang er
// inhoud onder de zichtbare rand zit (voedt de fade onderaan). Het element blijft
// gemount, dus de scrollpositie per kolom blijft vanzelf behouden.
export function ScreenPanel({ label, active, children }: { label: string; active: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [meer, setMeer] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setMeer(el.scrollHeight - el.scrollTop - el.clientHeight > 1);
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    for (const c of Array.from(el.children)) ro.observe(c);
    const mo = new MutationObserver(check);
    mo.observe(el, { childList: true, subtree: true });
    return () => { el.removeEventListener("scroll", check); ro.disconnect(); mo.disconnect(); };
  }, []);
  return (
    <section ref={ref} className="shell-screen" data-active={active ? "" : undefined} data-meer={meer ? "" : undefined} aria-label={label}>
      <h2 className="shell-screen-title">{label}</h2>
      {children}
    </section>
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
export function PickerChip({ label, className, children }: { label: string; className?: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div ref={ref} className={`chip-wrap ${className ?? ""}`}>
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
