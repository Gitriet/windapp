// Overzicht van alle tochten waarbij de routeplanner een tussenhaven kiest, voor het beoordelen van het netwerk
// (omwegen, havens als doorvoerpunt). Gebruik: npx tsx scripts/tussenstops.ts [http://localhost:3000]
import { shortestPath } from "../lib/netwerk-path";
import type { RouteHaven, RouteInfo } from "../lib/planner-data";

const base = process.argv[2] ?? "http://localhost:3000";
async function main() {
const routes: RouteInfo[] = ((await (await fetch(`${base}/api/routes`)).json()) as { routes: RouteInfo[] }).routes;
const havens = new Map<string, RouteHaven>();
for (const r of routes) { havens.set(r.van.haven, r.van); havens.set(r.naar.haven, r.naar); }
const echt = [...havens.values()].filter((h) => h.soort !== "knoop").map((h) => h.haven).sort();
let n = 0;
for (const a of echt) for (const b of echt) {
  if (a >= b) continue;
  const k = shortestPath(routes, a, b);
  if (!k) { console.log(`GEEN PAD ${a} → ${b}`); continue; }
  if (k.viaNamen.length) { n++; console.log(`${a} → ${b}: ${k.totalNm.toFixed(1)} nm via ${k.viaNamen.join(" · ")}`); }
}
console.log(`\n${n} van ${(echt.length * (echt.length - 1)) / 2} tochten met tussenstop`);
}
main();
