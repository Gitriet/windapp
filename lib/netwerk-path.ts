// Kortste pad door het havennetwerk (client-side, Optie B). De 21 routes in
// netwerk_routes zijn buurverbindingen; een tocht tussen niet-aangrenzende havens is
// een keten van zulke segmenten. Dijkstra op `lengte_nm` levert het goedkoopste pad;
// per been wordt de vaarrichting (en dus de mogelijke omkering t.o.v. de opslag)
// bepaald. De volledige gewogen graaf zit al in de /api/routes-respons, dus dit raakt
// geen enkele API of de database.
import { bearing } from "./route";
import type { RouteInfo, RouteHaven } from "./planner-data";

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
      const nd = best + e.nm;
      if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); pending.add(v); }
    }
  }
  if (!dist.has(toHaven)) return null;

  // pad reconstrueren (haven-slugs, van → naar)
  const slugs: string[] = [toHaven];
  for (let c = toHaven; c !== fromHaven;) { const p = prev.get(c); if (p == null) return null; slugs.unshift(p); c = p; }

  return maakKeten(slugs, nb, havenOf);
}

// Redelijke alternatieven voor dezelfde tocht (bijv. buitenom Texel of binnendoor via Oudeschild):
// alle enkelvoudige paden hooguit `factor` × de kortste, waarbij paden met dezelfde havenvolgorde
// (zonder knooppunten) als één route tellen (de kortste). Kortste eerst; maximaal `max`.
// Het zoeken is begrensd: een pad wordt alleen verlengd als het via de kortste rest nog binnen de grens blijft.
export function alternatieveKetens(routes: RouteInfo[], fromHaven: string, toHaven: string, opts: { factor?: number; max?: number } = {}): ChainedRoute[] {
  const { factor = 1.5, max = 3 } = opts;
  const kortste = shortestPath(routes, fromHaven, toHaven);
  if (!kortste) return [];
  const { nb, havenOf } = bouwGraaf(routes);
  const grens = kortste.totalNm * factor + 1e-9;

  // afstand van elke haven tot het doel (Dijkstra; de graaf is symmetrisch) als ondergrens
  const rest = new Map<string, number>([[toHaven, 0]]);
  const open = new Set<string>([toHaven]);
  while (open.size) {
    let u = "", d = Infinity;
    for (const h of open) { const x = rest.get(h)!; if (x < d) { d = x; u = h; } }
    open.delete(u);
    for (const [v, e] of nb.get(u) ?? []) {
      if (d + e.nm < (rest.get(v) ?? Infinity)) { rest.set(v, d + e.nm); open.add(v); }
    }
  }

  const perHavens = new Map<string, { slugs: string[]; nm: number }>();
  let bezocht = 0;
  const pad = [fromHaven];
  const zoek = (u: string, nm: number) => {
    if (++bezocht > 50_000) return;   // vangnet voor grote netwerken
    if (u === toHaven) {
      const sig = pad.filter((h) => havenOf.get(h)!.soort !== "knoop").join(">");
      const bij = perHavens.get(sig);
      if (!bij || nm < bij.nm) perHavens.set(sig, { slugs: [...pad], nm });
      return;
    }
    for (const [v, e] of nb.get(u) ?? []) {
      if (pad.includes(v) || nm + e.nm + (rest.get(v) ?? Infinity) > grens) continue;
      pad.push(v); zoek(v, nm + e.nm); pad.pop();
    }
  };
  zoek(fromHaven, 0);
  return [...perHavens.values()].sort((a, b) => a.nm - b.nm).slice(0, max).map((p) => maakKeten(p.slugs, nb, havenOf));
}

// Korte naam voor de routekeuze: "via Oudeschild" bij tussenhavens, anders de omschrijving van
// de route zelf ("buitenom Texel", "binnendoor via Inschot"), anders "direct".
export function ketenNaam(k: ChainedRoute): string {
  if (k.viaNamen.length) return `via ${k.viaNamen.join(" · ")}`;
  const vias = k.legs.map((l) => l.route.via).filter((v): v is string => !!v);
  return vias.find((v) => /buitenom|binnendoor/i.test(v)) ?? vias[0] ?? "direct";
}
