"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Location } from "@/lib/types";

// Canonical area blocks, in display order. Each station is placed by matching
// these names against its (free-text) area string — so grouping stays data-driven
// and a new station falls into the right block from its area alone. Combined
// labels (e.g. "IJsselmeer/Markermeer") resolve to the first match in this order.
const AREA_GROUPS = ["Markermeer", "IJsselmeer", "Waddenzee", "Noordzee"];

function groupOf(area: string): string | null {
  return AREA_GROUPS.find((g) => area.includes(g)) ?? null;
}

// Within a block: west -> east by longitude. Noordzee additionally puts the
// coast before open water, following the kust/open-water split from the analysis.
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

export default function LocationPicker({ locations, value, onChange }: Props) {
  const baseId = useId();
  const sections = useMemo(() => groupLocations(locations), [locations]);
  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const selectedIndex = Math.max(0, flat.findIndex((l) => l.location_key === value));
  const selected = flat[selectedIndex];

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(selectedIndex);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const optId = (i: number) => `${baseId}-opt-${i}`;

  function openMenu() {
    setActive(selectedIndex);
    setOpen(true);
  }
  function close(focusBtn = true) {
    setOpen(false);
    if (focusBtn) btnRef.current?.focus();
  }
  function pick(i: number) {
    const l = flat[i];
    if (l) onChange(l.location_key);
    close();
  }

  // focus the listbox + reveal the active option whenever the menu opens or moves
  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    document.getElementById(optId(active))?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  // close on outside pointer
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  function onBtnKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openMenu();
    }
  }
  function onListKey(e: React.KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); setActive((i) => Math.min(flat.length - 1, i + 1)); break;
      case "ArrowUp": e.preventDefault(); setActive((i) => Math.max(0, i - 1)); break;
      case "Home": e.preventDefault(); setActive(0); break;
      case "End": e.preventDefault(); setActive(flat.length - 1); break;
      case "Enter":
      case " ": e.preventDefault(); pick(active); break;
      case "Escape": e.preventDefault(); close(); break;
      case "Tab": setOpen(false); break;
    }
  }

  let counter = -1;   // running flat index across all rendered sections
  return (
    <div className={"lp" + (open ? " open" : "")} ref={rootRef}>
      <button
        type="button" ref={btnRef} className="lp-btn"
        aria-haspopup="listbox" aria-expanded={open}
        aria-label={`Gekalibreerde locatie: ${selected ? selected.name : "—"}`}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onBtnKey}
      >
        <span className="lp-lab">
          <span className="lp-name">{selected ? selected.name : "—"}</span>
          {selected && <span className="lp-area"> — {selected.area}</span>}
        </span>
        <svg className="lp-cur" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 4.5 L6 8 L9.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          className="lp-menu" role="listbox" tabIndex={-1} ref={listRef}
          aria-label="Gekalibreerde locatie" aria-activedescendant={optId(active)}
          onKeyDown={onListKey}
        >
          {sections.map((s) => {
            const headId = `${baseId}-h-${s.group}`;
            return (
              <div className="lp-group" role="group" aria-labelledby={headId} key={s.group}>
                <div className="lp-ghead" id={headId}>{s.group}</div>
                {s.items.map((l) => {
                  counter += 1;
                  const i = counter;
                  const sel = l.location_key === value;
                  return (
                    <div
                      key={l.location_key} id={optId(i)} role="option" aria-selected={sel}
                      className={"lp-opt" + (sel ? " sel" : "") + (i === active ? " active" : "")}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(i)}
                    >
                      <span className="lp-oname">{l.name}</span>
                      <span className="lp-oarea">{l.area}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
