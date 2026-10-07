"use client";
// Schil: merkbalk, tabbar (mobiel), kiezerchip en skeleton. Alleen vorm — welke
// schermen er zijn en in welke volgorde komt uit app/screens.ts; layout per breedte
// staat in globals.css (.shell-*).
import { useEffect, useRef, useState } from "react";
import { SCREENS, type ScreenId } from "../screens";
import { localDateLong, localHM } from "@/lib/tz";
import { MenuIcon } from "./icons";

// Merkbalk met routechip: op mobiel sticky (chip onder het merk), vanaf 1400px vóór het merk, samen met "bijgewerkt HH:MM".
// Van 768 tot 1400px verborgen (CSS); dan staat de routechip per scherm.
// Actuele datum en tijd, tikt per halve minuut. Start leeg (geen hydration-verschil).
function useKlok(): number | null {
  const [ms, setMs] = useState<number | null>(null);
  useEffect(() => {
    setMs(Date.now());
    const id = setInterval(() => setMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return ms;
}

export function TopBar({ chip, bijgewerkt, onMenu }: { chip?: React.ReactNode; bijgewerkt?: string | null; onMenu?: () => void }) {
  const nu = useKlok();
  // hoogte van de merkbalk als --shell-top-h, zodat een sticky schermkop er direct onder kan staan
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty("--shell-top-h", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <header ref={ref} className="shell-top">
      <span className="shell-brand">TIDAN</span>
      {chip && <div className="shell-top-chip">{chip}</div>}
      {nu && (
        <time className="shell-top-nu" dateTime={new Date(nu).toISOString()}>
          {localDateLong(nu)} <span className="shell-top-klok">{localHM(nu)}</span>
        </time>
      )}
      {bijgewerkt && <span className="shell-top-tijd">bijgewerkt&nbsp;{bijgewerkt}</span>}
      {onMenu && <button type="button" className="shell-menu" aria-label="Bootprofiel" onClick={onMenu}><MenuIcon size={22} /></button>}
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

// Routekiezer: schakelaar met VERTREK en AANKOMST (zelfde vorm als de havenschakelaar op
// WEER & GETIJ); een vlak aantikken opent de havenkiezer van die kant eronder (klik buiten sluit).
export type Kant = "van" | "naar";
export function RouteKiezer({ van, naar, className, varianten, variant = 0, onVariant, children }: {
  van: string; naar: string; className?: string; children: (kant: Kant, sluit: () => void) => React.ReactNode;
  varianten?: { rol: string; naam: string }[]; variant?: number; onVariant?: (i: number) => void;   // routekeuze bij meerdere redelijke routes
}) {
  const [open, setOpen] = useState<Kant | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(null); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div ref={ref} className={`chip-wrap ${className ?? ""}`}>
      <div className="schakelaar">
        {([["van", "VERTREK", van], ["naar", "AANKOMST", naar]] as const).map(([k, rol, naam]) => (
          <button key={k} type="button" className={`schakelaar-stand ${open === k ? "is-filled" : ""}`} aria-expanded={open === k}
            onClick={() => setOpen((o) => (o === k ? null : k))}>
            <span className="schakelaar-rol">{rol}</span>
            <span className="schakelaar-naam">{naam}</span>
          </button>
        ))}
      </div>
      {varianten && varianten.length > 1 && (
        <div className="schakelaar schakelaar-route" style={{ "--kolommen": varianten.length } as React.CSSProperties} role="radiogroup" aria-label="Route">
          {varianten.map((v, i) => (
            <button key={i} type="button" role="radio" aria-checked={i === variant}
              className={`schakelaar-stand ${i === variant ? "is-filled" : ""}`} onClick={() => onVariant?.(i)}>
              <span className="schakelaar-rol">{v.rol}</span>
              <span className="schakelaar-naam">{v.naam}</span>
            </button>
          ))}
        </div>
      )}
      {open && <div className="chip-panel">{children(open, () => setOpen(null))}</div>}
    </div>
  );
}

// Laadstatus: hairline-rijen in --fill-faint met vaste hoogte (geen spinner, geen
// layout-shift — de hoogte hoort bij de rij die straks verschijnt). tekst = melding in de eerste rij.
export function Skeleton({ rows, height, label, tekst }: { rows: number; height: number; label: string; tekst?: string }) {
  return (
    <div className="skeleton" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row" style={{ "--row-h": `${height}px` } as React.CSSProperties}>
          {i === 0 && tekst && (
            <div className="skeleton-melding" role="status">
              <Windroos />
              <span className="skeleton-tekst">{tekst}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// Draaiende windroos voor de laadmelding: 4 lange punten (noord oker), 4 korte diagonalen.
const STER = "M50 8 L56.4 43.6 L92 50 L56.4 56.4 L50 92 L43.6 56.4 L8 50 L43.6 43.6 Z";
function Windroos() {
  return (
    <svg className="windroos" viewBox="0 0 100 100" aria-hidden>
      <circle cx={50} cy={50} r={47} className="windroos-ring" />
      <path d={STER} transform="rotate(45 50 50) translate(20 20) scale(0.6)" className="windroos-kort" />
      <path d={STER} className="windroos-lang" />
      <path d="M50 8 L56.4 43.6 L43.6 43.6 Z" className="windroos-noord" />
      <circle cx={50} cy={50} r={4} className="windroos-naaf" />
    </svg>
  );
}
