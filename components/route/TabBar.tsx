"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Tocht", match: (p: string) => p === "/",
    icon: (<><line x1="6" y1="21" x2="6" y2="5" /><polyline points="6,5 18,9 6,13" /></>) },
  { href: "/vensters", label: "Vensters", match: (p: string) => p.startsWith("/vensters"),
    icon: (<><rect x="4" y="7" width="16" height="13" rx="2" /><line x1="4" y1="11" x2="20" y2="11" /><line x1="8" y1="7" x2="8" y2="5" /><line x1="16" y1="7" x2="16" y2="5" /></>) },
  { href: "/nu", label: "Nu", match: (p: string) => p.startsWith("/nu"),
    icon: (<><circle cx="12" cy="12" r="9" /><polyline points="12,8 12,12 15,14" strokeLinecap="round" strokeLinejoin="round" /></>) },
  { href: "/kaart", label: "Kaart", match: (p: string) => p.startsWith("/kaart"),
    icon: (<><polygon points="3,7 9,4 15,7 21,4 21,17 15,20 9,17 3,20" /><line x1="9" y1="4" x2="9" y2="17" /><line x1="15" y1="7" x2="15" y2="20" /></>) },
];

export default function TabBar() {
  const path = usePathname();
  return (
    <nav className="tabbar">
      {TABS.map((t) => {
        const on = t.match(path);
        return (
          <Link key={t.href} href={t.href} className={on ? "on" : ""}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{t.icon}</svg>
            <span>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
