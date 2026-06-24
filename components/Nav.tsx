"use client";
import Link from "next/link";

// Tabs are routes; the selected location rides along in ?loc= so switching tabs
// keeps the location (both pages read ?loc= on mount).
export default function Nav({ active, locKey }: { active: "punt" | "week"; locKey: string }) {
  const q = locKey ? `?loc=${locKey}` : "";
  return (
    <nav className="tabs">
      <Link href={`/${q}`} className={active === "punt" ? "active" : ""}>Punt</Link>
      <Link href={`/week${q}`} className={active === "week" ? "active" : ""}>7 dagen</Link>
    </nav>
  );
}
