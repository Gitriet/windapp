// shortestPath (lib/netwerk-path.ts): routeren via knooppunten (zeegaten) zonder dat die
// als haven meetellen.
import { shortestPath, alternatieveKetens, ketenNaam } from "../lib/netwerk-path";
import { ALTERNATIEVEN } from "../lib/alternatieven";
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

// tussenhaven vs knooppunt: A→C via haven B = 20 NM, via knooppunt K = 20,6 NM → het knooppunt wint
const net0 = [route("R5", A, B, 10), route("R6", B, C, 10), route("R7", A, K, 10.3), route("R8", K, C, 10.3)];
const kz = shortestPath(net0, "a", "c")!;
ok("liever knooppunt dan tussenhaven (straf 1 NM)", kz.havens.map((h) => h.haven).join() === "a,k,c" && Math.abs(kz.totalNm - 20.6) < 1e-9, `${kz.havens.map((h) => h.haven)} ${kz.totalNm}`);
ok("tussenhaven blijft mogelijk als het knooppunt veel langer is", shortestPath([route("R5", A, B, 10), route("R6", B, C, 10), route("R7", A, K, 12), route("R8", K, C, 12)], "a", "c")!.viaNamen.join() === "B");
ok("doel zelf telt niet als tussenhaven", shortestPath([route("R9", A, B, 5)], "a", "b")!.totalNm === 5);

console.log("— alternatieveKetens (handmatige lijst) —");
const met = (id: string, van: RouteHaven, naar: RouteHaven, nm: number, via: string | null): RouteInfo => ({ ...route(id, van, naar, nm), via });
const D = punt("d", 53.12);
// A→C: kortste via knooppunt K (20 nm); via haven B (23 nm) en via D (22 nm) zijn alleen alternatief als ze in de lijst staan
const net2 = [met("T10", A, K, 10, "buitenom"), met("T11", C, K, 10, "buitenom"), met("T12", A, B, 8, "binnendoor via X"), met("T13", B, C, 15, "binnendoor"), met("T14", A, D, 10, null), met("T15", D, C, 12, null)];
const lijst = [{ naam: "binnendoor via B", havens: ["a", "b", "c"] }];
const alt = alternatieveKetens(net2, "a", "c", lijst);
ok("kortste eerst, dan het alternatief uit de lijst", alt.length === 2 && alt[0].totalNm === 20 && alt[1].totalNm === 23, alt.map((k) => k.totalNm).join());
ok("alternatief heeft de vaste naam", ketenNaam(alt[1]) === "binnendoor via B");
ok("zonder lijst geen alternatieven (ook niet via D)", alternatieveKetens(net2, "a", "c", []).length === 1);
const omgekeerd = alternatieveKetens(net2, "c", "a", lijst);
ok("omgekeerde richting werkt ook", omgekeerd.length === 2 && omgekeerd[1].havens.map((h) => h.haven).join() === "c,b,a" && omgekeerd[1].totalNm === 23);
ok("ander eindpunt = geen alternatief", alternatieveKetens(net2, "a", "d", lijst).length === 1);
ok("alternatief met een niet-bestaand segment wordt overgeslagen", alternatieveKetens(net2, "a", "c", [{ naam: "x", havens: ["a", "c"] }]).length === 1);
ok("alternatief gelijk aan de kortste keten valt weg", alternatieveKetens(net2, "a", "c", [{ naam: "x", havens: ["a", "k", "c"] }]).length === 1);
const vervang = alternatieveKetens(net2, "a", "c", [{ naam: "via D", havens: ["a", "d", "c"], vervangKortste: true }]);
ok("vervangKortste: standaard in plaats van de kortste", vervang.length === 1 && vervang[0].totalNm === 22 && ketenNaam(vervang[0]) === "via D", vervang.map((k) => k.totalNm).join());
ok("geen pad → leeg", alternatieveKetens(net2, "a", "zzz", lijst).length === 0);
// naam zonder vaste naam: soort water + haven onderweg, of de omschrijving van de route
const net5 = [met("T30", A, C, 10, "buitenom Texel"), met("T31", A, B, 4, "binnendoor via Inschot"), met("T32", B, C, 5, null)];
ok("directe route heet naar zijn omschrijving", ketenNaam(shortestPath(net5.slice(0, 1), "a", "c")!) === "buitenom Texel");
ok("route via een haven: soort + haven", ketenNaam(shortestPath(net5.slice(1), "a", "c")!) === "binnendoor via B");
ok("zonder omschrijving: via de haven", ketenNaam(shortestPath([met("T33", A, B, 4, null), met("T34", B, C, 5, null)], "a", "c")!) === "via B");

console.log("— lib/alternatieven.ts —");
ok("lijst begint en eindigt bij echte havens", ALTERNATIEVEN.every((a) => a.havens.length >= 3 && a.naam.length > 0));

if (fail) { console.error(`\nFAILED (${fail})`); process.exit(1); }
