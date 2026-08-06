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
  havens: RouteHaven[];  // N+1 havens in vaarvolgorde (van leg0 … naar laatste leg)
  namen: string[];       // havennamen in volgorde
  viaNamen: string[];    // tussenliggende havennamen (zonder begin/eind)
  totalNm: number;       // som van lengte_nm per been
};

// Kortste pad (Dijkstra, gewicht = lengte_nm). null = geen pad (haven onbekend of
// niet verbonden). fromHaven === toHaven → null (geen tocht).
export function shortestPath(routes: RouteInfo[], fromHaven: string, toHaven: string): ChainedRoute | null {
  if (!fromHaven || !toHaven || fromHaven === toHaven || !routes.length) return null;

  // gewogen adjacency: per buur het goedkoopste segment (RouteInfo) + de haven-metadata
  const nb = new Map<string, Map<string, { nm: number; route: RouteInfo }>>();
  const havenOf = new Map<string, RouteHaven>();
  const link = (a: RouteHaven, b: RouteHaven, route: RouteInfo) => {
    havenOf.set(a.haven, a);
    if (!nb.has(a.haven)) nb.set(a.haven, new Map());
    const cur = nb.get(a.haven)!.get(b.haven);
    if (!cur || route.lengte_nm < cur.nm) nb.get(a.haven)!.set(b.haven, { nm: route.lengte_nm, route });
  };
  for (const r of routes) { link(r.van, r.naar, r); link(r.naar, r.van, r); }
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
    namen: havens.map((h) => h.naam),
    viaNamen: havens.slice(1, -1).map((h) => h.naam),
    totalNm: legs.reduce((s, l) => s + l.route.lengte_nm, 0),
  };
}
