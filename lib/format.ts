import { localHM, localDateISO, localWeekdayShort } from "./tz";
import { WIND_ERNST } from "./constants";
// Small presentation helpers. Knots is the primary (and only) wind unit.

export function fmtDay(iso: string): string {
  const d = new Date(iso + (iso.endsWith("Z") ? "" : "Z"));
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

// Beaufort-schaal uit windsnelheid in knopen (bovengrens per kracht).
const BFT_MAX_KN = [1, 3, 6, 10, 16, 21, 27, 33, 40, 47, 55, 63];
export function beaufort(kn: number): number {
  for (let b = 0; b < BFT_MAX_KN.length; b++) if (kn <= BFT_MAX_KN[b]) return b;
  return 12;
}

const P16 = ["N", "NNO", "NO", "ONO", "O", "OZO", "ZO", "ZZO", "Z", "ZZW", "ZW", "WZW", "W", "WNW", "NW", "NNW"];
export const dirLabel16 = (d: number) => P16[Math.round((((d % 360) + 360) % 360) / 22.5) % 16];
// Zeilhoek in woorden uit de TWA (0–180). Grenzen exact zoals gevraagd.
export function sailPhrase(twa: number): string {
  const a = Math.abs(twa);
  return a < 45 ? "aan de wind" : a < 90 ? "halve wind" : a < 135 ? "ruime wind" : "voor de wind";
}
// Ernst van wind en/of vlagen volgens de ene windstandaard (WIND_ERNST): de zwaarste van de twee telt.
// Op hele knopen afgerond, zoals getoond: twee uren met "28" in beeld krijgen dezelfde kleur.
export type WindErnst = "rustig" | "let-op" | "hard";
export function windErnst(windKn: number | null, vlaagKn: number | null = null): WindErnst {
  const w = Math.round(windKn ?? 0), g = Math.round(vlaagKn ?? 0);
  if (w >= WIND_ERNST.wind.roodKn || g >= WIND_ERNST.vlaag.roodKn) return "hard";
  if (w >= WIND_ERNST.wind.okerKn || g >= WIND_ERNST.vlaag.okerKn) return "let-op";
  return "rustig";
}
// Chiptekst bij een ernst (Beaufort-namen): krachtig = windkracht 6, hard = windkracht 7+.
export const windErnstChip = (e: WindErnst) => (e === "hard" ? "LET OP · HARDE WIND" : "LET OP · KRACHTIGE WIND");
// Bereik in hele knopen: "15–17", of "16" als begin en eind gelijk afronden.
export function knBereik(waarden: number[]): string {
  const lo = Math.round(Math.min(...waarden)), hi = Math.round(Math.max(...waarden));
  return lo === hi ? `${lo}` : `${lo}\u2013${hi}`;
}
export const vlaagErnstChip = (minKn: number, maxKn: number) => `LET OP · VLAGEN ${knBereik([minKn, maxKn])}\u00A0KN`;
// Windkracht-beschrijving bij het Beaufort-getal (0–12). Presentatielabel, geen databron.
const BFT_LABEL = [
  "stil", "zwak", "zwak", "matig", "matig", "vrij krachtig", "krachtig",
  "hard", "stormachtig", "storm", "zware storm", "zeer zware storm", "orkaan",
];
export const bftLabel = (bft: number) => BFT_LABEL[bft] ?? "";
// Duur: onder 24 uur "48m" / "1u 15m" / "2u" (geen leidende nul); vanaf 24 uur dag/uur
// op het kwartier afgerond: "1d 3u", "1d 3u 15m". Rond eerst de totale minuten af, splits
// dan pas — anders kan min % 60 naar 60 afronden terwijl het uur al is afgekapt.
export function fmtDuurKort(min: number): string {
  let m = Math.round(min);
  if (m >= 24 * 60) m = Math.round(m / 15) * 15;
  const d = Math.floor(m / 1440), u = Math.floor((m % 1440) / 60), r = m % 60;
  return [d && `${d}d`, u && `${u}u`, (r || m === 0) && `${r}m`].filter(Boolean).join(" ");
}

// Aankomsttijd bij een vertrek: "HH:MM", of met dag ervoor als de aankomst op een andere
// lokale kalenderdag valt ("ZO 00:05"). Tijdblok: "14:30 → ZO 00:05". Europe/Amsterdam.
export function aankomstLabel(depMs: number, arrMs: number): string {
  const dag = localDateISO(arrMs) !== localDateISO(depMs) ? `${localWeekdayShort(arrMs).toUpperCase()} ` : "";
  return `${dag}${localHM(arrMs)}`;
}
export function tijdblok(depMs: number, arrMs: number | null): string {
  return `${localHM(depMs)} → ${arrMs != null ? aankomstLabel(depMs, arrMs) : "—"}`;
}

// Getijhoogte in cm met teken: "+115", "−28" (echt minteken, zoals op de rasteras), "0".
export function signedCm(v: number): string {
  const r = Math.round(v);
  return r > 0 ? `+${r}` : r < 0 ? `\u2212${Math.abs(r)}` : "0";
}
