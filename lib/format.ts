// Small presentation helpers. Knots is the primary (and only) wind unit.
const COMPASS = ["N", "NO", "O", "ZO", "Z", "ZW", "W", "NW"];
export function compass(deg: number): string {
  return COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

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
// Rond eerst de totale minuten af, splits dan pas — anders kan Math.round(min % 60)
// naar 60 afronden terwijl het uur al is afgekapt (1859,6 min → "30u60" i.p.v. "31u00").
export const fmtDur = (min: number) => { const m = Math.round(min); return `${Math.floor(m / 60)}u${String(m % 60).padStart(2, "0")}`; };
// Zeilhoek in woorden uit de TWA (0–180). Grenzen exact zoals gevraagd.
export function sailPhrase(twa: number): string {
  const a = Math.abs(twa);
  return a < 45 ? "aan de wind" : a < 90 ? "halve wind" : a < 135 ? "ruime wind" : "voor de wind";
}
// Windkracht-beschrijving bij het Beaufort-getal (0–12). Presentatielabel, geen databron.
const BFT_LABEL = [
  "stil", "zwak", "zwak", "matig", "matig", "vrij krachtig", "krachtig",
  "hard", "stormachtig", "storm", "zware storm", "zeer zware storm", "orkaan",
];
export const bftLabel = (bft: number) => BFT_LABEL[bft] ?? "";
// Duur als "1U 02M" (VAARPLAN-KPI); afronden vóór splitsen, zoals fmtDur.
export const fmtDuurKort = (min: number) => { const m = Math.round(min); return `${Math.floor(m / 60)}U ${String(m % 60).padStart(2, "0")}M`; };
