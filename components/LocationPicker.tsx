"use client";
import { useEffect, useMemo, useState } from "react";
import type { Location } from "@/lib/types";

// Canonical area blocks, in display order — water vaargebieden first, then land
// (Amsterdam). Stations are placed by matching these names against their area
// string, so grouping stays data-driven. Combined labels resolve to the first
// match in this order.
const AREA_GROUPS = ["Markermeer", "IJsselmeer", "Waddenzee", "Noordzee", "Amsterdam"];

function groupOf(area: string): string | null {
  return AREA_GROUPS.find((g) => area.includes(g)) ?? null;
}
// Within a block: west -> east by longitude; Noordzee puts the coast before open water.
function ordered(group: string, items: Location[]): Location[] {
  return items.slice().sort((a, b) => {
    if (group === "Noordzee") {
      const ra = a.area.toLowerCase().includes("open") ? 1 : 0;
      const rb = b.area.toLowerCase().includes("open") ? 1 : 0;
      if (ra !== rb) return ra - rb;
    }
    return a.lon - b.lon;
  });
}
function groupLocations(locs: Location[]): { group: string; items: Location[] }[] {
  const sections = AREA_GROUPS
    .map((group) => ({ group, items: ordered(group, locs.filter((l) => groupOf(l.area) === group)) }))
    .filter((s) => s.items.length > 0);
  const rest = locs.filter((l) => groupOf(l.area) === null);
  if (rest.length) sections.push({ group: "Overig", items: rest.slice().sort((a, b) => a.lon - b.lon) });
  return sections;
}

type Props = { locations: Location[]; value: string; onChange: (key: string) => void };

// Compact pill that opens a bottom sheet (mobile-first). The sheet stays mounted
// and slides via the `show` class so it animates in and out.
export default function LocationPicker({ locations, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const sections = useMemo(() => groupLocations(locations), [locations]);
  const selected = locations.find((l) => l.location_key === value);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function pick(k: string) { onChange(k); setOpen(false); }

  return (
    <>
      <button type="button" className="locpill" onClick={() => setOpen(true)}
              aria-haspopup="dialog" aria-expanded={open}
              aria-label={`Locatie: ${selected ? selected.name : "—"}`}>
        <span className="lp-dot" />
        <span className="lp-nm">{selected ? selected.name : "—"}</span>
        {selected && <span className="lp-ar">{selected.area}</span>}
        <svg className="lp-chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 4.5 L6 8 L9.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.4"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div className={"sheet-overlay" + (open ? " show" : "")} onClick={() => setOpen(false)} />
      <div className={"sheet" + (open ? " show" : "")} role="dialog" aria-modal="true"
           aria-label="Kies locatie" aria-hidden={!open}>
        <div className="grabber" />
        {sections.map((s) => (
          <div key={s.group}>
            <div className="sheet-group">{s.group}</div>
            {s.items.map((l) => (
              <button type="button" key={l.location_key} tabIndex={open ? 0 : -1}
                      className={"sheet-item" + (l.location_key === value ? " sel" : "")}
                      onClick={() => pick(l.location_key)}>
                <span className="nm">{l.name}</span>
                <span className="ar">{l.area}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
