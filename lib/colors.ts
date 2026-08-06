// Datasoort-kleuren (nachtmodus). Eén bron voor de SVG-hexen in de grafieken; de
// class-gebaseerde tags spiegelen deze in globals.css.
//   wind   → amber   · water → blauw · stroom → zeegroen · weer/UI → violet
// SOG-lijn blijft wit, kentering blijft geel, stroom-tegen blijft rood.
export const COLORS = {
  wind: "#C4832D",
  water: "#4A90D9",
  stroom: "#17A878",
  stroomTegen: "#c07a7a",
  weer: "#8B7DD6",
  sog: "#e9e9ed",
  kentering: "#e8b94a",
} as const;

// rgba() uit een #RRGGBB + alpha (0–1). Alleen voor de zes bovenstaande hexen.
export function alpha(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}
