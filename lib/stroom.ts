// Getijstroom-laag (Stroom-tab). PROCEDUREEL VOORSPELD MODEL (astronomisch, HP33-
// stijl) — uitsluitend voor het ontwerp, GEEN meting en nog niet de echte HP33-/
// RWS-stroomdata. Stroom is heen-en-weer: vloed langs één as, eb de tegengestelde.
// Daarom NOOIT kleur=richting (geen dirColor/hue): richting leest alleen uit de
// pijl, en alle stroom krijgt één neutrale kleur. 1-op-1 geport uit stroom-mockup.
import { localHourDecimal } from "./tz";

// de ene neutrale stroomkleur — bewust géén hergebruik van dirColor
export const CUR_COLOR = "#b4c3d1";

const DIRS = ["N", "NO", "O", "ZO", "Z", "ZW", "W", "NW"];
export const dirName = (deg: number) => DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

export const T = 12.42;        // getijperiode in uren (astronomisch)
export const HALF = T / 2;

export type StroomPoint = {
  key: string;       // slug voor selectie
  nm: string;        // naam van het stroompunt
  area: string;      // watergebied (groepskop)
  hw: number;        // HW-referentietijd, uur-van-de-dag
  max: number;       // max stroomsterkte (kn)
  flood: number;     // vloedrichting (graden, waarheen het water stroomt)
  ebb: number;       // ebrichting (graden)
  geo?: "marsdiep";  // alleen Marsdiep heeft (nu) een echte kustlijn
};

// Alleen plekken met echte getijstroom. Geen meren (IJsselmeer/Markermeer/IJmeer).
export const STROOM_GROUPS: { area: string; points: StroomPoint[] }[] = [
  {
    area: "Waddenzee",
    points: [
      { key: "marsdiep", nm: "Marsdiep", area: "Waddenzee", hw: 9.5, max: 2.6, flood: 110, ebb: 295, geo: "marsdiep" },
      { key: "vlie", nm: "Vlie", area: "Waddenzee", hw: 10.2, max: 2.0, flood: 130, ebb: 310 },
      { key: "borndiep", nm: "Borndiep", area: "Waddenzee", hw: 10.9, max: 2.2, flood: 140, ebb: 320 },
    ],
  },
  {
    area: "Noordzeekust",
    points: [
      { key: "ijmuiden", nm: "IJmuiden buitenhaven", area: "Noordzeekust", hw: 8.7, max: 1.3, flood: 35, ebb: 215 },
    ],
  },
];

export const ALL_POINTS: StroomPoint[] = STROOM_GROUPS.flatMap((g) => g.points);
export const findPoint = (key: string) => ALL_POINTS.find((p) => p.key === key) ?? null;

// Welke locatie hoort bij welk getijde-stroompunt — één bronwaarheid (ook gebruikt
// door de /varen-route). Marsdiep is de focus (De Kooy → Den Helder); de rest is
// een geografische benadering. Locaties zonder entry krijgen geen stroompijl.
export const STROOM_BY_LOCATION: Record<string, string> = {
  dekooy: "marsdiep", vlieland: "vlie", hoorn: "borndiep", ijmuiden: "ijmuiden",
};
export const stroomForLocation = (locationKey: string): StroomPoint | null =>
  findPoint(STROOM_BY_LOCATION[locationKey] ?? "");

// een gebied is een meer (geen getijstroom) -> Stroom-tab verbergen
export const isLakeArea = (area: string) => /ijsselmeer|markermeer|ijmeer/i.test(area);

// stroom op tijdstip t (uur-van-de-dag): heen-en-weer rond HW. Na HW valt het
// droog (eb), daarna komt het op (vloed); |sin| over de halve periode geeft de
// sterkte, met slap water (≈0) bij elke kentering.
export type CurState = { speed: number; deg: number; toSlack: number; slackAt: number };
export function currentAt(p: StroomPoint, t: number): CurState {
  const ph = (((t - p.hw) % T) + T) % T;     // 0 = HW
  const ebbing = ph < HALF;                    // na HW -> eb
  const x = ebbing ? ph : ph - HALF;
  const speed = p.max * Math.abs(Math.sin((Math.PI * x) / HALF));
  const deg = ebbing ? p.ebb : p.flood;
  const toSlack = HALF - x;
  return { speed: +speed.toFixed(1), deg, toSlack, slackAt: t + toSlack };
}

// huidige NL-tijd als uur-van-de-dag (decimaal), zomer/winter correct
export const nowHours = () => localHourDecimal(Date.now());

// decimaal uur -> "HH:MM" (NL-klok, want t is al NL-uur-van-de-dag)
export function fmtHours(t: number): string {
  t = ((t % 24) + 24) % 24;
  const h = Math.floor(t);
  const m = Math.round((t - h) * 60);
  return String(h).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
}

// ---------- stroomatlas (detail, fase 2) ----------
// Marsdiep-kustlijn: gemeentegrenzen (larsbouwens/nl-geojson), bbox Zeegat van
// Texel, Douglas-Peucker gesimplificeerd en geprojecteerd in de 358×210 viewBox.
// Land grijs op blauw water — geen groene rand.
export const AW = 358, AH = 210, AMAX = 3.0;
export const ATLAS_THROAT = { x: 152, y: 186 };
export const ATLAS_LAND: number[][][] = [[[254.8,189.3],[259.7,189.4],[257.1,193.0],[259.6,195.4],[258.6,192.8],[264.0,199.4],[259.9,196.7],[259.5,202.9],[264.1,200.9],[288.2,246.8],[284.6,295.4],[271.6,299.4],[261.1,309.1],[224.2,308.5],[206.4,337.9],[191.5,327.5],[187.6,329.5],[188.6,326.3],[172.8,300.2],[180.5,294.8],[182.6,274.4],[167.4,249.5],[162.9,246.9],[154.0,248.7],[158.3,230.5],[167.6,208.5],[172.7,207.4],[199.7,223.7],[222.0,213.5],[233.2,197.0],[253.1,194.5],[254.8,189.3]],[[135.3,226.7],[158.6,229.8],[154.0,248.7],[162.9,246.9],[173.2,256.1],[182.6,274.4],[180.5,294.8],[177.4,298.4],[172.1,298.0],[188.6,326.3],[187.6,329.5],[171.4,333.3],[161.5,322.5],[158.1,343.0],[142.6,347.7],[128.9,322.7],[112.0,306.8],[122.7,278.3],[135.3,226.7]],[[192.2,38.0],[192.8,38.9],[191.2,38.1],[187.3,39.5],[191.0,38.2],[193.1,38.9],[198.9,54.1],[203.3,56.1],[210.5,69.1],[208.0,69.1],[206.3,104.0],[197.2,112.7],[197.2,118.7],[188.1,131.3],[176.8,135.2],[166.9,152.0],[151.1,147.2],[159.6,155.9],[149.5,157.1],[139.3,163.3],[134.4,132.4],[145.0,100.5],[168.0,65.7],[168.9,69.5],[170.6,69.2],[173.3,71.0],[171.1,69.4],[174.2,69.3],[173.4,67.3],[176.4,66.1],[173.8,66.8],[176.6,65.7],[177.7,62.1],[180.6,63.1],[177.3,66.7],[180.8,63.3],[180.3,60.1],[181.5,59.2],[180.2,60.1],[180.8,63.0],[176.5,57.1],[172.7,65.9],[168.1,65.5],[184.3,37.5],[192.2,38.0]],[[163.3,175.8],[159.9,178.4],[164.6,187.2],[161.3,179.0],[167.4,181.5],[168.7,178.4],[165.6,176.8],[170.1,175.9],[166.6,195.6],[174.1,208.2],[167.6,208.5],[158.6,229.8],[135.3,226.7],[139.3,183.0],[143.4,177.0],[163.3,175.8]],[[270.4,-40.3],[281.6,-39.5],[283.3,-35.7],[235.7,-14.0],[237.7,-6.7],[226.2,-2.6],[228.5,-0.6],[219.7,4.4],[220.4,10.3],[212.4,18.0],[199.7,18.1],[192.6,23.1],[195.5,24.1],[190.7,24.3],[190.1,12.9],[244.3,-28.6],[270.4,-40.3]],[[122.6,165.0],[124.8,166.6],[118.3,167.1],[135.4,167.9],[117.8,178.5],[114.5,175.1],[115.4,167.4],[122.6,165.0]],[[266.4,190.5],[261.8,193.9],[265.1,199.4],[264.5,200.7],[265.0,199.3],[260.1,192.5],[307.9,153.5],[266.4,190.5]]];

function pointInPoly(x: number, y: number, poly: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export const onLand = (x: number, y: number) => ATLAS_LAND.some((p) => pointInPoly(x, y, p));

// faseverschuiving over het gebied: de kentering valt niet overal tegelijk maar
// trekt west->oost als een lijn door de atlas
export function phaseLag(p: StroomPoint, x: number): number {
  const ref = p.geo === "marsdiep" ? ATLAS_THROAT.x : AW / 2;
  return ((x - ref) / AW) * 1.7;
}

// stroomveld per cel: Marsdiep trechtert door de gat-mond en waaiert uit in het
// achterliggende water; in de open zee convergeert het naar de mond. Overige
// punten: een gericht veld op de vloed/eb-as met lichte waaier.
export function field(p: StroomPoint, x: number, y: number): { flood: number; ebbDir: number; max: number } {
  if (p.geo === "marsdiep") {
    const dx = x - ATLAS_THROAT.x, dy = (y - ATLAS_THROAT.y) * 0.6, r = Math.hypot(dx, dy) || 1;
    const ux = dx / r, uy = dy / r;
    const vx = (x >= ATLAS_THROAT.x ? ux : -ux) + 0.45, vy = x >= ATLAS_THROAT.x ? uy : -uy;
    const flood = (Math.atan2(vx, -vy) * 180) / Math.PI;
    const rr = Math.hypot(x - ATLAS_THROAT.x, y - ATLAS_THROAT.y) || 1;
    const max = Math.min(AMAX, 0.55 + 6.5 / (rr * 0.18 + 2.3)) * (p.max / 2.7);
    return { flood, ebbDir: (flood + 180) % 360, max };
  }
  const cx = AW / 2, cy = AH / 2, d = Math.hypot(x - cx, y - cy);
  const fan = (x - cx) / 26;
  return { flood: p.flood + fan, ebbDir: p.ebb + fan, max: Math.max(0.6, p.max * (1 - d / 300)) };
}
