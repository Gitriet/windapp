// shortestPath + etappeGroepen (lib/netwerk-path.ts): routeren via knooppunten (zeegaten)
// zonder dat die als haven of etappegrens meetellen.
import { etappeGroepen, shortestPath } from "../lib/netwerk-path";
import type { RouteHaven, RouteInfo } from "../lib/planner-data";

let fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const punt = (haven: string, lat: number, soort: "haven" | "knoop" = "haven") =>
  ({ haven, naam: haven.toUpperCase(), lat, lon: 5, soort, key: haven, stationNaam: "", stationKm: 0, havenInfo: null }) as RouteHaven;
const A = punt("a", 53), B = punt("b", 53.1), C = punt("c", 53.2), K = punt("k", 53.15, "knoop");
const route = (id: string, van: RouteHaven, naar: RouteHaven, nm: number): RouteInfo =>
  ({ id, via: null, lengte_nm: nm, stroom: true, van, naar });

// A→C: via haven B = 8 + 15 = 23 NM, via knooppunt K = 10 + 10 = 20 NM
const net = [route("R1", A, B, 8), route("R2", B, C, 15), route("R3", A, K, 10), route("R4", C, K, 10)];
const pad = shortestPath(net, "a", "c")!;
ok("kortste pad loopt via het knooppunt", pad.totalNm === 20 && pad.havens.map((h) => h.haven).join() === "a,k,c",
  pad.havens.map((h) => h.haven).join());
ok("knooppunt telt niet als haven in namen/viaNamen", pad.namen.join() === "A,C" && pad.viaNamen.length === 0,
  `${pad.namen} | ${pad.viaNamen}`);
ok("tweede been omgekeerd gevaren (opgeslagen als C→K)", pad.legs[1].reversed);
ok("legs via knooppunt vormen één etappe", JSON.stringify(etappeGroepen(pad.havens)) === "[[0,1]]",
  JSON.stringify(etappeGroepen(pad.havens)));

// zonder knooppunt: via haven B, twee etappes
const zonder = shortestPath(net.slice(0, 2), "a", "c")!;
ok("via haven: tussenhaven in viaNamen", zonder.viaNamen.join() === "B");
ok("via haven: elke leg een eigen etappe", JSON.stringify(etappeGroepen(zonder.havens)) === "[[0],[1]]");

if (fail) { console.error(`\nFAILED (${fail})`); process.exit(1); }
