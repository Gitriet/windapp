"use client";
import { useEffect, useMemo } from "react";
import type { Location } from "@/lib/types";

// Gecontroleerde bottom-sheet voor het kiezen van een waypoint. Zelfde area-groepering
// als de oorspronkelijke LocationPicker, maar los aanstuurbaar (open/value/onPick).
const AREA_GROUPS = ["Waddenzee", "Noordzee", "IJsselmeer", "Markermeer", "Amsterdam"];
function groupOf(area: string): string | null {
  return AREA_GROUPS.find((g) => area.includes(g)) ?? null;
}
function sections(locs: Location[]): { group: string; items: Location[] }[] {
  const out = AREA_GROUPS
    .map((group) => ({ group, items: locs.filter((l) => groupOf(l.area) === group).sort((a, b) => a.lon - b.lon) }))
    .filter((s) => s.items.length > 0);
  const rest = locs.filter((l) => groupOf(l.area) === null);
  if (rest.length) out.push({ group: "Overig", items: rest.sort((a, b) => a.lon - b.lon) });
  return out;
}

type Props = {
  open: boolean;
  value?: string;
  locations: Location[];
  exclude?: string[];          // keys al in de route (dim niet, maar markeer)
  title?: string;
  onPick: (key: string) => void;
  onClose: () => void;
};

export default function LocationSheet({ open, value, locations, exclude = [], title = "Kies locatie", onPick, onClose }: Props) {
  const secs = useMemo(() => sections(locations), [locations]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const inRoute = new Set(exclude);
  return (
    <>
      <div className={"detail-overlay" + (open ? " show" : "")} onClick={onClose} />
      <div className={"detail-sheet" + (open ? " show" : "")} role="dialog" aria-modal="true"
           aria-label={title} aria-hidden={!open}>
        <div className="detail-nav">
          <span style={{ fontSize: 15, fontWeight: 600 }}>{title}</span>
          <button className="x" onClick={onClose} aria-label="Sluiten">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="detail-scroll" style={{ gap: 0, paddingTop: 8 }}>
          {secs.map((s) => (
            <div key={s.group}>
              <div className="seclabel" style={{ padding: "14px 0 6px" }}>{s.group}</div>
              {s.items.map((l) => {
                const sel = l.location_key === value;
                const used = inRoute.has(l.location_key) && !sel;
                return (
                  <button key={l.location_key} type="button" tabIndex={open ? 0 : -1}
                          className="wp" style={{ marginBottom: 6, opacity: used ? 0.5 : 1 }}
                          onClick={() => onPick(l.location_key)}>
                    <div className="body">
                      <div className="nm" style={sel ? { color: "var(--water)" } : undefined}>{l.name}</div>
                      <div className="sub">{l.area}</div>
                    </div>
                    {sel && <span className="role" style={{ color: "var(--water)" }}>✓</span>}
                    {used && <span className="role">in route</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
