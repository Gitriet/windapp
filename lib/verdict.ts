// Zeilverdict per dag/uur uit wind (kn) + vlaag (kn). Enige bron voor het verdict-label
// én de staafkleur op kracht. Volgorde bepaalt de grens: eerst zwaar (Let op), dan
// fris, dan licht, anders goed. (Waarschuwingen lopen apart via WARN.hardWind.)
export type Verdict = "goed" | "fris" | "licht" | "letop";

export const VERDICT_LETOP_KN = 25;
export const VERDICT_LETOP_GUST = 35;
export const VERDICT_FRIS_KN = 16;
export const VERDICT_FRIS_GUST = 25;
export const VERDICT_LICHT_KN = 6;

export function verdict(speedKn: number | null, gustKn: number | null): Verdict | null {
  if (speedKn == null) return null;
  const w = speedKn, g = gustKn ?? 0;
  if (w > VERDICT_LETOP_KN || g > VERDICT_LETOP_GUST) return "letop";
  if (w >= VERDICT_FRIS_KN || g >= VERDICT_FRIS_GUST) return "fris";
  if (w < VERDICT_LICHT_KN) return "licht";
  return "goed";
}
