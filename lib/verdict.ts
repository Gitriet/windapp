import { windErnst } from "./format";

// Zeilverdict per dag/uur uit wind (kn) + vlaag (kn). Enige bron voor het verdict-label
// én de staafkleur op kracht. Volgorde bepaalt de grens: eerst zwaar (hard en Let op, de
// windstandaard WIND_ERNST via windErnst() — dezelfde grenzen als de LET OP-chip), dan fris, dan licht, anders goed.
export type Verdict = "goed" | "fris" | "licht" | "letop" | "hard";

export const VERDICT_FRIS_KN = 16;
export const VERDICT_FRIS_GUST = 25;
export const VERDICT_LICHT_KN = 6;

export function verdict(speedKn: number | null, gustKn: number | null): Verdict | null {
  if (speedKn == null) return null;
  const w = speedKn, g = gustKn ?? 0;
  const ernst = windErnst(w, g);
  if (ernst === "hard") return "hard";
  if (ernst === "let-op") return "letop";
  if (w >= VERDICT_FRIS_KN || g >= VERDICT_FRIS_GUST) return "fris";
  if (w < VERDICT_LICHT_KN) return "licht";
  return "goed";
}
