// Datasoort-kleuren (nachtmodus). Eén bron voor de SVG-hexen in de grafieken; de
// class-gebaseerde tags spiegelen deze in globals.css.
//   wind → paars · water → blauw · stroom → teal · snelheid → groen · weer/UI → paars
// Waarschuwingen amber, kentering goud, tegenstroom rood.
// NB: wind deelt bewust het merk-paars (wind is de primaire laag, draagt het merk);
// de "weer"-DATA-tags zijn daarom neutraal gemaakt (globals) i.p.v. paars.
export const COLORS = {
  wind: "#8B7DD6",         // paars — primaire windlaag (= merk-accent)
  water: "#4A90D9",        // blauw
  stroom: "#2BA6A0",       // teal — getijstroom-mee (verhuisd van groen, dat nu snelheid is)
  stroomTegen: "#c07a7a",  // rood — tegenstroom
  weer: "#8B7DD6",         // merk/UI-accent (logo, pins, labels, tocht-venster)
  sog: "#17A878",          // groen — snelheid (de "snelle/goede" kleur, overgenomen van stroom)
  kentering: "#e8b94a",    // goud — kenteringsmoment
  waarschuwing: "#C4832D", // amber — waarschuwingen (vrijgekomen van wind)
} as const;

// rgba() uit een #RRGGBB + alpha (0–1). Alleen voor de zes bovenstaande hexen.
export function alpha(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}
