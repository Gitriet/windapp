"use client";
import Link from "next/link";

// Tabs are routes; the selected location rides along in ?loc= so switching tabs
// keeps the location (both pages read ?loc= on mount).
// showStroom is false when the active location is a lake (no tidal stream), so the
// Stroom tab never leads to an empty list.
export default function Nav(
  { active, locKey, showStroom = true }:
  { active: "punt" | "week" | "stroom"; locKey: string; showStroom?: boolean },
) {
  const q = locKey ? `?loc=${locKey}` : "";
  return (
    <nav className="tabs">
      <Link href={`/${q}`} className={active === "punt" ? "active" : ""}>Punt</Link>
      <Link href={`/week${q}`} className={active === "week" ? "active" : ""}>7 dagen</Link>
      {showStroom && (
        <Link href={`/stroom${q}`} className={active === "stroom" ? "active" : ""}>Stroom</Link>
      )}
    </nav>
  );
}
