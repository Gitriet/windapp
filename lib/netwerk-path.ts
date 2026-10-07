// Kortste pad door het havennetwerk (client-side, Optie B). De 21 routes in
// netwerk_routes zijn buurverbindingen; een tocht tussen niet-aangrenzende havens is
// een keten van zulke segmenten. Dijkstra op `lengte_nm` levert het goedkoopste pad;
// per been wordt de vaarrichting (en dus de mogelijke omkering t.o.v. de opslag)
// bepaald. De volledige gewogen graaf zit al in de /api/routes-respons, dus dit raakt
// geen enkele API of de database.
import { bearing } from "./route";
import type { RouteInfo, RouteHaven } from "./planner-data";
import { ALTERNATIEVEN, type Alternatief } from "./alternatieven";

export type RouteLeg = {
  route: RouteInfo;      // het gebruikte segment (edge)
  van: RouteHaven;       // begin in VAARrichting
  naar: RouteHaven;      // eind in VAARrichting
  reversed: boolean;     // true = tegen de opslagrichting in gevaren
  bearingDeg: number;    // van→naar peiling (havencoördinaten)
  label: string;         // "Den Helder → Vlieland"
};

export type ChainedRoute = {
  legs: RouteLeg[];
  havens: RouteHaven[];  // N+1 punten in vaarvolgorde (havens én knooppunten)
  namen: string[];       // havennamen in volgorde (zonder knooppunten)
  viaNamen: string[];    // tussenliggende havennamen (zonder begin/eind, zonder knooppunten)
  totalNm: number;       // som van lengte_nm per been
  naam?: string;         // vaste naam bij een handmatig alternatief (lib/alternatieven.ts)
};

type Buren = Map<string, Map<string, { nm: number; route: RouteInfo }>>;

// gewogen adjacency: per buur het goedkoopste segment (RouteInfo) + de haven-metadata
function bouwGraaf(routes: RouteInfo[]): { nb: Buren; havenOf: Map<string, RouteHaven> } {
  const nb: Buren = new Map();
  const havenOf = new Map<string, RouteHaven>();
  const link = (a: RouteHaven, b: RouteHaven, route: RouteInfo) => {
    havenOf.set(a.haven, a);
    if (!nb.has(a.haven)) nb.set(a.haven, new Map());
    const cur = nb.get(a.haven)!.get(b.haven);
    if (!cur || route.lengte_nm < cur.nm) nb.get(a.haven)!.set(b.haven, { nm: route.lengte_nm, route });
  };
  for (const r of routes) { link(r.van, r.naar, r); link(r.naar, r.van, r); }
  return { nb, havenOf };
}

// haven-slugs (van → naar) → keten met legs, namen en lengte
function maakKeten(slugs: string[], nb: Buren, havenOf: Map<string, RouteHaven>): ChainedRoute {
  const havens = slugs.map((s) => havenOf.get(s)!);
  const legs: RouteLeg[] = [];
  for (let i = 1; i < slugs.length; i++) {
    const a = havens[i - 1], b = havens[i];
    const route = nb.get(a.haven)!.get(b.haven)!.route;
    legs.push({
      route, van: a, naar: b,
      reversed: route.van.haven !== a.haven,     // opgeslagen als b→a? dan omgekeerd gevaren
      bearingDeg: bearing(a, b),
      label: `${a.naam} → ${b.naam}`,
    });
  }
  return {
    legs, havens,
    namen: havens.filter((h) => h.soort !== "knoop").map((h) => h.naam),
    viaNamen: havens.slice(1, -1).filter((h) => h.soort !== "knoop").map((h) => h.naam),
    totalNm: legs.reduce((s, l) => s + l.route.lengte_nm, 0),
  };
}

// Kortste pad (Dijkstra, gewicht = lengte_nm). null = geen pad (haven onbekend of
// niet verbonden). fromHaven === toHaven → null (geen tocht).
// Een tussenhaven (geen knooppunt, niet het doel) kost HAVEN_STRAF extra bij de keuze van het pad: doorgaand
// verkeer neemt liever het knooppunt (kruispunt) dan een haven in te varen, ook als dat iets langer is.
// totalNm blijft de echte lengte.
export const HAVEN_STRAF_NM = 1;
export function shortestPath(routes: RouteInfo[], fromHaven: string, toHaven: string): ChainedRoute | null {
  if (!fromHaven || !toHaven || fromHaven === toHaven || !routes.length) return null;

  const { nb, havenOf } = bouwGraaf(routes);
  if (!havenOf.has(fromHaven) || !havenOf.has(toHaven)) return null;

  // Dijkstra
  const dist = new Map<string, number>([[fromHaven, 0]]);
  const prev = new Map<string, string>();
  const done = new Set<string>();
  const pending = new Set<string>([fromHaven]);
  while (pending.size) {
    let u = "", best = Infinity;
    for (const h of pending) { const d = dist.get(h) ?? Infinity; if (d < best) { best = d; u = h; } }
    pending.delete(u); done.add(u);
    if (u === toHaven) break;
    for (const [v, e] of nb.get(u) ?? []) {
      if (done.has(v)) continue;
      const nd = best + e.nm + (v !== toHaven && havenOf.get(v)?.soort !== "knoop" ? HAVEN_STRAF_NM : 0);
      if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); pending.add(v); }
    }
  }
  if (!dist.has(toHaven)) return null;

  // pad reconstrueren (haven-slugs, van → naar)
  const slugs: string[] = [toHaven];
  for (let c = toHaven; c !== fromHaven;) { const p = prev.get(c); if (p == null) return null; slugs.unshift(p); c = p; }

  return maakKeten(slugs, nb, havenOf);
}

// De kortste keten, gevolgd door de handmatig vastgelegde alternatieven (lib/alternatieven.ts) voor dezelfde
// tocht, kortste eerst. Een alternatief telt alleen als de begin- en eindhaven kloppen (ook omgekeerd) en elk
// paar havens een bestaand segment is; een alternatief gelijk aan de kortste keten valt weg. Een alternatief met
// `vervangKortste` komt in plaats van de kortste keten (en staat dan vooraan).
export function alternatieveKetens(routes: RouteInfo[], fromHaven: string, toHaven: string, alternatieven: Alternatief[] = ALTERNATIEVEN): ChainedRoute[] {
  const kortste = shortestPath(routes, fromHaven, toHaven);
  if (!kortste) return [];
  const { nb, havenOf } = bouwGraaf(routes);
  const eigen = kortste.havens.map((h) => h.haven).join(">");
  const alt: ChainedRoute[] = [];
  let standaard: ChainedRoute | null = null;
  for (const a of alternatieven) {
    const slugs = a.havens[0] === fromHaven && a.havens[a.havens.length - 1] === toHaven ? a.havens
      : a.havens[0] === toHaven && a.havens[a.havens.length - 1] === fromHaven ? [...a.havens].reverse() : null;
    if (!slugs || slugs.join(">") === eigen) continue;
    if (slugs.some((h) => !havenOf.has(h)) || slugs.slice(1).some((h, i) => !nb.get(slugs[i])?.has(h))) continue;
    const k = { ...maakKeten(slugs, nb, havenOf), naam: a.naam };
    if (a.vervangKortste && !standaard) standaard = k; else alt.push(k);
  }
  return [standaard ?? kortste, ...alt.sort((x, y) => x.totalNm - y.totalNm)];
}

// Korte naam voor de routekeuze: de vaste naam van een alternatief, anders het soort water ("buitenom" /
// "binnendoor") uit de route-omschrijving met de havens onderweg ("binnendoor via Oudeschild"); bij een
// directe route de omschrijving van de route zelf ("buitenom Texel"), anders "direct".
export function ketenNaam(k: ChainedRoute): string {
  if (k.naam) return k.naam;
  const vias = k.legs.map((l) => l.route.via).filter((v): v is string => !!v);
  const omschrijving = vias.find((v) => /buitenom|binnendoor/i.test(v));
  const soort = omschrijving?.match(/buitenom|binnendoor/i)?.[0].toLowerCase();
  const via = k.viaNamen.length > 2 ? `${k.viaNamen[0]} … ${k.viaNamen[k.viaNamen.length - 1]}` : k.viaNamen.join(" · ");
  if (via) return `${soort ? `${soort} ` : ""}via ${via}`;
  return omschrijving ?? "direct";
}
