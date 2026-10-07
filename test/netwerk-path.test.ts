// shortestPath (lib/netwerk-path.ts): routeren via knooppunten (zeegaten) zonder dat die
// als haven meetellen.
import { shortestPath, alternatieveKetens, ketenNaam } from "../lib/netwerk-path";
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

// zonder knooppunt: via haven B
const zonder = shortestPath(net.slice(0, 2), "a", "c")!;
ok("via haven: tussenhaven in viaNamen", zonder.viaNamen.join() === "B");

console.log("— alternatieveKetens —");
const alt = alternatieveKetens(net, "a", "c");
ok("twee redelijke routes, kortste eerst", alt.length === 2 && alt[0].totalNm === 20 && alt[1].totalNm === 23, alt.map((k) => k.totalNm).join());
ok("naam: tussenhaven of direct", ketenNaam(alt[1]) === "via B" && ketenNaam(alt[0]) === "direct", alt.map(ketenNaam).join(" | "));
ok("te lange alternatieven vallen af (factor)", alternatieveKetens(net, "a", "c", { factor: 1.1 }).length === 1);
ok("max beperkt het aantal", alternatieveKetens(net, "a", "c", { max: 1 }).length === 1);
// twee paden met dezelfde havenvolgorde (via twee verschillende knooppunten) tellen als één route
const K2 = punt("k2", 53.16, "knoop");
const dubbel = [...net, route("R5", A, K2, 10), route("R6", C, K2, 11)];
ok("zelfde havenvolgorde via ander knooppunt = één route", alternatieveKetens(dubbel, "a", "c").length === 2);
ok("geen pad → leeg", alternatieveKetens(net, "a", "zzz").length === 0);
const viaTekst = [{ ...route("R7", A, C, 12), via: "buitenom Texel" }, route("R8", A, B, 7), route("R9", B, C, 7)];
ok("naam uit de via-omschrijving van de route", ketenNaam(alternatieveKetens(viaTekst, "a", "c")[0]) === "buitenom Texel");

if (fail) { console.error(`\nFAILED (${fail})`); process.exit(1); }
