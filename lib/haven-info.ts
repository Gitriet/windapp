// Statische haveninfo per haven (drempel, sluis, VHF, getij, opmerkingen). Client-safe.
// De `key` matcht exact netwerk_havens.id (zie data/havens-info.json). Puur data +
// een loader; de koppeling drempel → getijpoort (gates.ts) is een vervolgstap.
import raw from "@/data/havens-info.json";

export type HavenDrempel = {
  diepte_m_nap: number;        // drempeldiepte t.o.v. NAP (negatief = onder NAP)
  referentie: "NAP";
  toelichting: string;
};

export type HavenSluis = {
  naam: string;
  vhf: number | null;
  bediening: string;
  drempeldiepte_buiten_m_nap: number | null;
  drempeldiepte_binnen_m_nap: number | null;
};

export type HavenVhf = { kanaal: number; dienst: string };

export type HavenGetij = { verval_m: string; opmerking: string };

export type HavenInfo = {
  key: string;                 // = netwerk_havens.id
  havenNaam: string;           // specifieke jachthaven/ligplaats
  getijgebonden: boolean;      // toegang geblokkeerd bij laagwater (drempel/wad)
  drempel: HavenDrempel | null;
  sluis: HavenSluis | null;
  vhf: HavenVhf[];
  getij: HavenGetij | null;
  rws_getij_code: string | null;
  opmerkingen: string;
};

// Alle havens uit data/havens-info.json.
export function loadHavenInfo(): HavenInfo[] {
  return raw as HavenInfo[];
}

// Snelle key → HavenInfo lookup (voor de merge in /api/routes).
export function havenInfoByKey(): Record<string, HavenInfo> {
  const m: Record<string, HavenInfo> = {};
  for (const h of loadHavenInfo()) m[h.key] = h;
  return m;
}
