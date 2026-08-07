// Fase 3: getijpoort uit de eigen diepgang. Client-safe, pure functies.
//
// REFERENTIEVLAKKEN — de kern van dit bestand.
// RWS levert waterstanden in NAP; dat ligt langs de kust ongeveer op het
// middenstandsvlak. Dieptecijfers op de zeekaart zijn gereduceerd tot een LAGER vlak:
// op de Waddenzee en de Noordzee het laagste astronomische tij, sinds 1 januari 2026
// aangeduid als ALAT. De formule is dus
//
//     waterdiepte = kaartdiepte + NAP-waterstand + reductievlakOnderNapM
//
// waarbij de laatste term positief is als het reductievlak ónder NAP ligt. Laat je hem
// weg, dan reken je jezelf op het Wad ongeveer een meter TE WEINIG water toe — de
// veilige kant op, maar het maakt de poort onbruikbaar smal, en het is precies het
// soort stille fout dat iemand later "corrigeert" met een vaste meter. Vandaar dat de
// term in de DATA staat en niet als constante in de code.
//
// Het vlak verschilt per water, niet alleen per station: op het IJsselmeer ligt de
// nullijn dicht bij NAP (in de winter zo'n 20 cm eronder), op de Waddenkaarten veel
// lager. Eén landelijke waarde bestaat niet.
//
// Het reductievlak is GEEN bodem. Lagere standen komen voor — ongeveer twee keer per
// maand minstens 0,25 m eronder, ongeveer eens per jaar minstens 0,50 m; bij
// aanhoudende aflandige wind meer. De marge onder de kiel is er mede voor. Een
// poortvenster is daarom nooit een garantie en wordt in de UI ook niet zo gepresenteerd.
//
// Ontbreekt het reductievlak voor een station, dan is de poort een GAT — expliciet leeg
// met label, nooit een schatting, nooit de stille aanname dat de vlakken samenvallen.
// Er is bewust geen fallback die "meestal wel klopt".
import type { TideData } from "./types";
import type { BoatProfile } from "./polar";
import { havenInfoByKey } from "./haven-info";

// Diepte-referentie voor één doorgang.
//   sillDepthChartM       kaartdiepte over de drempel t.o.v. het reductievlak (m, positief)
//   reductievlakOnderNapM hoeveel het reductievlak ónder NAP ligt (m, positief = lager dan NAP)
//   tideStation           RWS getij-stationcode (referentie; zie haveninfo) — optioneel
// Beide dieptevelden zijn nodig; één van de twee is niet genoeg.
export type GateDatum = { sillDepthChartM: number; reductievlakOnderNapM: number; tideStation?: string };

export type TidalGate = {
  locationKey: string;        // waypoint waarvan de getijcurve komt
  name: string;
  datum: GateDatum | null;    // null = referentievlak onbekend -> gat
};

// Registry van doorgangen met een bekend referentievlak, opgebouwd uit
// havens-info.json: elke haven met zowel een drempel als een getijstation.
//
// TEKEN: de drempel staat in havens-info als NAP-niveau (diepte_m_nap, negatief =
// onder NAP), maar depthOverSillM/gateWindows verwachten sillDepthChartM als POSITIEVE
// kaartdiepte bóven het reductievlak. Met het reductievlak op 0 (de drempel is al
// direct in NAP gegeven, geen ALAT-conversie) is dat exact −diepte_m_nap. Vlissingen:
// diepte_m_nap −3,30 → sillDepthChartM +3,30. Controle via gateWindows met draft 1,95:
// minCm = (1,95 − 3,30 − 0)·100 = −135 → dicht zodra de stand < −1,35 m NAP zakt.
//
// Alleen havens met drempel én rws_getij_code komen erin; drempel-loze of station-loze
// havens leveren nog steeds een gat (geen entry).
function buildGateDatums(): Record<string, GateDatum> {
  const out: Record<string, GateDatum> = {};
  for (const h of Object.values(havenInfoByKey())) {
    if (h.drempel && h.rws_getij_code) {
      out[h.key] = {
        sillDepthChartM: -h.drempel.diepte_m_nap,
        reductievlakOnderNapM: 0,
        tideStation: h.rws_getij_code,
      };
    }
  }
  return out;
}

export const GATE_DATUMS: Record<string, GateDatum> = buildGateDatums();

export function gateDatumFor(locationKey: string): GateDatum | null {
  return GATE_DATUMS[locationKey] ?? null;
}

// Benodigd water onder de kiel: diepgang + gewenste marge.
export function requiredDepthM(boat: BoatProfile): number {
  return boat.draftM + boat.keelClearanceM;
}

// Werkelijke waterdiepte over de drempel bij een waterstand in cm NAP.
// De zeebodem ligt sillDepthChartM ónder het reductievlak; het wateroppervlak ligt
// (napCm/100 + reductievlakOnderNapM) erbóven. Het verschil is de diepte.
export function depthOverSillM(datum: GateDatum, napCm: number): number {
  return datum.sillDepthChartM + napCm / 100 + datum.reductievlakOnderNapM;
}

export type GateWindow = { fromMs: number; toMs: number };

const tms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));

// Aaneengesloten vensters waarin de verwachte stand genoeg water geeft, binnen
// [fromMs,toMs]. Lineair interpolerend zodat de rand op de exacte kruising ligt.
export function gateWindows(
  tide: TideData | null, datum: GateDatum | null, requiredM: number, fromMs: number, toMs: number,
): GateWindow[] {
  if (!tide || !datum || !tide.expected.length) return [];
  // drempelstand in cm NAP waarboven er genoeg water staat
  const minCm = (requiredM - datum.sillDepthChartM - datum.reductievlakOnderNapM) * 100;
  const s = tide.expected.map((p) => ({ m: tms(p.t), v: p.v })).sort((a, b) => a.m - b.m);
  const out: GateWindow[] = [];
  let openFrom: number | null = null;
  const cross = (a: { m: number; v: number }, b: { m: number; v: number }) =>
    a.m + ((minCm - a.v) / (b.v - a.v)) * (b.m - a.m);
  for (let i = 0; i < s.length; i++) {
    const above = s[i].v >= minCm;
    if (above && openFrom === null) openFrom = i === 0 ? s[i].m : cross(s[i - 1], s[i]);
    else if (!above && openFrom !== null) { out.push({ fromMs: openFrom, toMs: cross(s[i - 1], s[i]) }); openFrom = null; }
  }
  if (openFrom !== null) out.push({ fromMs: openFrom, toMs: s[s.length - 1].m });
  return out
    .map((w) => ({ fromMs: Math.max(w.fromMs, fromMs), toMs: Math.min(w.toMs, toMs) }))
    .filter((w) => w.toMs > w.fromMs);
}

export function windowContains(windows: GateWindow[], ms: number): boolean {
  return windows.some((w) => ms >= w.fromMs && ms <= w.toMs);
}

// Verwachte stand (cm NAP) op een tijdstip, lineair op de curve. null buiten bereik.
function levelAt(tide: TideData, ms: number): number | null {
  const s = tide.expected;
  if (!s.length) return null;
  for (let i = 1; i < s.length; i++) {
    const a = tms(s[i - 1].t), b = tms(s[i].t);
    if (ms >= a && ms <= b) {
      const f = b === a ? 0 : (ms - a) / (b - a);
      return s[i - 1].v + (s[i].v - s[i - 1].v) * f;
    }
  }
  return null;
}

export type GateStatus = "gehaald" | "net-aan" | "niet-gehaald" | "onbekend";
export type GateVerdict = {
  windows: GateWindow[];
  passageMs: number | null;
  status: GateStatus;
  marginM: number | null;      // water onder de kiel bovenop de gewenste marge
  requiredM: number;
  reason?: "geen-referentievlak" | "geen-getij" | "geen-passagetijd" | "passage-buiten-getijreeks";
};

// "Net aan" wanneer er wel genoeg water staat, maar minder dan deze extra speling.
export const TIGHT_MARGIN_M = 0.3;

// Beoordeel één poort. `passageMs` komt uit de ETA-integratie (fase 2) en wordt hier
// NIET opnieuw geschat.
export function evaluateGate(
  tide: TideData | null, datum: GateDatum | null, boat: BoatProfile,
  passageMs: number | null, fromMs: number, toMs: number,
): GateVerdict {
  const requiredM = requiredDepthM(boat);
  if (!datum) return { windows: [], passageMs, status: "onbekend", marginM: null, requiredM, reason: "geen-referentievlak" };
  if (!tide || !tide.expected.length) return { windows: [], passageMs, status: "onbekend", marginM: null, requiredM, reason: "geen-getij" };

  const windows = gateWindows(tide, datum, requiredM, fromMs, toMs);
  if (passageMs == null) return { windows, passageMs: null, status: "onbekend", marginM: null, requiredM, reason: "geen-passagetijd" };

  // De passagetijd kan buiten de getijreeks vallen (RWS levert een beperkt venster).
  // Dat is een ander gat dan "geen getijstation" en wordt ook anders benoemd.
  const cm = levelAt(tide, passageMs);
  if (cm == null) return { windows, passageMs, status: "onbekend", marginM: null, requiredM, reason: "passage-buiten-getijreeks" };

  const marginM = depthOverSillM(datum, cm) - requiredM;
  const status: GateStatus = marginM < 0 ? "niet-gehaald" : marginM < TIGHT_MARGIN_M ? "net-aan" : "gehaald";
  return { windows, passageMs, status, marginM, requiredM };
}
