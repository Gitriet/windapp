// Fase 3: getijpoort uit de eigen diepgang. Bewijst dat een ontbrekend
// referentievlak een gat oplevert (geen getal), en dat de drempel meebeweegt met
// de diepgang.
import {
  evaluateGate, gateWindows, depthOverSillM, requiredDepthM, gateDatumFor,
  GATE_DATUMS, type GateDatum,
} from "../lib/gates";
import { DEFAULT_BOAT, type BoatProfile } from "../lib/polar";
import type { TideData } from "../lib/types";

let fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const T0 = Date.parse("2026-07-24T00:00:00Z");
const HOUR = 3600_000;

// Sinusoïdaal getij: ±100 cm NAP, periode 12.42 u, HW rond 06:13.
function tide(): TideData {
  const expected = Array.from({ length: 24 * 4 + 1 }, (_, i) => {
    const ms = T0 + i * 15 * 60_000;
    const h = i / 4;
    return { t: new Date(ms).toISOString(), v: -Math.cos((h / 12.42) * 2 * Math.PI) * 100 };
  });
  return { code: "test", name: "Test", expected, astro: [], extremes: [] };
}
const TIDE = tide();
const BOAT: BoatProfile = { ...DEFAULT_BOAT };            // 1.95 + 0.5 = 2.45 m
const DATUM: GateDatum = { sillDepthChartM: 1.6, reductievlakOnderNapM: 1.0 };
const DAY_END = T0 + 24 * HOUR;

console.log("— benodigd water —");
ok("diepgang + marge = 2.45 m", Math.abs(requiredDepthM(BOAT) - 2.45) < 1e-9, `${requiredDepthM(BOAT)}`);

console.log("\n— referentievlak ontbreekt = gat, nooit een getal —");
{
  const v = evaluateGate(TIDE, null, BOAT, T0 + 6 * HOUR, T0, DAY_END);
  ok("status onbekend", v.status === "onbekend");
  ok("geen vensters", v.windows.length === 0);
  ok("geen marge-getal", v.marginM === null);
  ok("reden benoemd", v.reason === "geen-referentievlak", String(v.reason));
  // registry wordt sinds de haveninfo-koppeling gevuld uit havens-info.json: elke haven
  // met drempel + getijstation. Vlissingen (drempel −3,30 m NAP) is de enige concrete.
  ok("registry bevat Vlissingen", GATE_DATUMS.vlissingen != null);
  ok("Vlissingen sillDepthChartM = +3,30 (tekencorrectie van −3,30 NAP)", GATE_DATUMS.vlissingen?.sillDepthChartM === 3.3);
  ok("Vlissingen reductievlak 0", GATE_DATUMS.vlissingen?.reductievlakOnderNapM === 0);
  ok("gateDatumFor levert null voor haven zonder drempel", gateDatumFor("texel") === null);
  ok("gateWindows zonder datum levert niets", gateWindows(TIDE, null, 2.45, T0, DAY_END).length === 0);

  // succescriterium: boot 1,95 m past bij Vlissingen precies tot −1,35 m NAP.
  const vl = GATE_DATUMS.vlissingen!;
  ok("Vlissingen: bij −1,35 m NAP is de beschikbare diepte gelijk aan de diepgang 1,95 m",
    Math.abs(depthOverSillM(vl, -135) - 1.95) < 1e-9);
  ok("Vlissingen: net onder −1,35 m NAP past de boot niet meer", depthOverSillM(vl, -136) < 1.95);
  ok("Vlissingen: net boven −1,35 m NAP past de boot wel", depthOverSillM(vl, -134) > 1.95);
}

console.log("\n— diepte over de drempel telt beide vlakken mee —");
{
  // bij NAP +0 cm: 1.6 m kaartdiepte + 0 + 1.0 m (reductievlak onder NAP) = 2.6 m water
  ok("NAP 0 -> 2.6 m", Math.abs(depthOverSillM(DATUM, 0) - 2.6) < 1e-9, `${depthOverSillM(DATUM, 0)}`);
  ok("NAP +100 -> 3.6 m", Math.abs(depthOverSillM(DATUM, 100) - 3.6) < 1e-9);
  // TEKEN: het reductievlak ligt ónder NAP, dus wie de term weglaat rekent zichzelf
  // TE WEINIG water toe (de veilige kant op, maar de poort wordt onbruikbaar smal).
  const naief = DATUM.sillDepthChartM + 0 / 100;
  ok("weglaten scheelt een meter", Math.abs(depthOverSillM(DATUM, 0) - naief - 1.0) < 1e-9);
  ok("weglaten geeft TE WEINIG water, niet te veel", naief < depthOverSillM(DATUM, 0),
    `naïef ${naief.toFixed(2)} m < werkelijk ${depthOverSillM(DATUM, 0).toFixed(2)} m`);
  // en het vlak is geen landelijke constante: op het IJsselmeer ligt de nullijn dicht
  // bij NAP, dus dezelfde kaartdiepte levert daar een heel andere waterdiepte op
  const ijssel: GateDatum = { sillDepthChartM: 1.6, reductievlakOnderNapM: 0.2 };
  ok("ander water = ander vlak", Math.abs(depthOverSillM(ijssel, 0) - 1.8) < 1e-9,
    `${depthOverSillM(ijssel, 0).toFixed(2)} m`);
}

console.log("\n— meer diepgang = smaller venster —");
{
  const w245 = gateWindows(TIDE, DATUM, requiredDepthM(BOAT), T0, DAY_END);
  const deep: BoatProfile = { ...BOAT, draftM: BOAT.draftM + 0.5 };      // 2.95 m nodig
  const w295 = gateWindows(TIDE, DATUM, requiredDepthM(deep), T0, DAY_END);
  const span = (w: { fromMs: number; toMs: number }[]) => w.reduce((s, x) => s + (x.toMs - x.fromMs), 0) / HOUR;
  console.log(`     2.45 m nodig -> ${span(w245).toFixed(2)} u open · 2.95 m nodig -> ${span(w295).toFixed(2)} u open`);
  ok("beide leveren vensters", w245.length > 0 && w295.length > 0);
  ok("halve meter meer diepgang maakt het venster smaller", span(w295) < span(w245),
    `${span(w295).toFixed(2)} < ${span(w245).toFixed(2)}`);
}

console.log("\n— status en marge rond de passagetijd —");
{
  // HW ligt rond 06:13; rond LW (00:00) staat er te weinig water
  const hw = evaluateGate(TIDE, DATUM, BOAT, T0 + 6.2 * HOUR, T0, DAY_END);
  const lw = evaluateGate(TIDE, DATUM, BOAT, T0, T0, DAY_END);
  console.log(`     bij HW: ${hw.status} (marge ${hw.marginM?.toFixed(2)} m) · ` +
    `bij LW: ${lw.status} (marge ${lw.marginM?.toFixed(2)} m)`);
  ok("bij HW gehaald", hw.status === "gehaald");
  ok("bij HW positieve marge", (hw.marginM ?? -1) > 0);
  ok("bij LW niet gehaald", lw.status === "niet-gehaald");
  ok("bij LW negatieve marge", (lw.marginM ?? 1) < 0);

  // net-aan: bij HW (+100 cm) is de diepte sill + 1.0 + 1.0; met 2.45 m nodig geeft
  // een drempel van 0.60 m een marge van 0.15 m — net wel water, onder TIGHT_MARGIN_M
  const krap: GateDatum = { sillDepthChartM: 0.6, reductievlakOnderNapM: 1.0 };
  const na = evaluateGate(TIDE, krap, BOAT, T0 + 6.2 * HOUR, T0, DAY_END);
  console.log(`     krappe drempel bij HW: ${na.status} (marge ${na.marginM?.toFixed(2)} m)`);
  ok("net-aan wordt herkend", na.status === "net-aan", `${na.status} @ ${na.marginM?.toFixed(2)} m`);
}

console.log("\n— zonder passagetijd geen oordeel (fase 2 levert hem, niet fase 3) —");
{
  const v = evaluateGate(TIDE, DATUM, BOAT, null, T0, DAY_END);
  ok("status onbekend", v.status === "onbekend" && v.reason === "geen-passagetijd");
  ok("vensters wel berekend", v.windows.length > 0);
}

if (fail) { console.error(`\nFAILED (${fail})`); process.exit(1); }
console.log("\nALL OK");
