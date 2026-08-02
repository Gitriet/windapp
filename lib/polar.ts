// Bootprofiel + polaire tabellen. Client-safe, geen fetches.
//
// De polaire geeft bootsnelheid DOOR HET WATER (kn) op ware windhoek × ware
// windsnelheid, als 100% potentieel — dus vóór `performance`. Door het water is
// hier geen formaliteit: de integratie in lib/passage.ts telt de stroomvector er
// zelf weer bij op. Een GPS-getal (dat al mee-stroom bevat) hier invoeren telt de
// stroom dubbel en laat de ETA structureel te vroeg uitkomen — precies de kant op
// die een getijpoort op papier laat halen die in werkelijkheid net niet gehaald wordt.

export type BoatArchetype = "cruiser-racer" | "toerder" | "platbodem" | "motor";

export type BoatProfile = {
  archetype: BoatArchetype;
  draftM: number;           // diepgang in meter
  keelClearanceM: number;   // gewenste marge onder de kiel
  performance: number;      // 0–1, fractie van het polaire-potentieel
  motorSpeedKn: number;     // vaste snelheid bij motorvaren
};

// Standaardprofiel: Winner 11.20 van de bestaande gebruiker.
export const DEFAULT_BOAT: BoatProfile = {
  archetype: "cruiser-racer",
  draftM: 1.95,
  keelClearanceM: 0.5,
  performance: 0.85,
  motorSpeedKn: 6.0,
};

// `performance` corrigeert UITSLUITEND voor bemanning, aangroei en zeegang.
// Kielvarianten en rigverschillen horen in de tabel zelf, niet in deze factor.

export const TWA_ROWS = [35, 40, 45, 50, 60, 75, 90, 110, 120, 135, 150, 165, 180];
export const TWS_COLS = [4, 6, 8, 10, 12, 16, 20, 25];

// SCHATTING op basis van de rompgegevens van een Winner 11.20 (waterlijn 9,30 m,
// 6,7 t, vinkiel met loden bulb, rompsnelheid ≈ 7,4 kn). Dit is GEEN VPP-uitvoer en
// GEEN meting — niet voor gemeten data aanzien.
//
// Let op de afvlakking rechtsboven: boven 20 kn ware wind daalt de snelheid aan de
// wind weer (reven + toenemende zeegang). Die vorm is bedoeld en mag niet worden
// gladgestreken tot een monotoon stijgende tabel.
//
// De ruime-windwaarden bij 20/25 kn zijn geijkt op gelogde snelheden rond 9 kn met
// wat surf op een achterzee; die 9 staat er als POTENTIEEL en wordt door
// `performance` teruggeschaald naar wat gemiddeld gehaald wordt. Niet verder
// verhogen op basis van kortstondige pieken.
const CRUISER_RACER: number[][] = [
  /* TWA 35 */ [2.2, 3.4, 4.4, 5.0, 5.3, 5.6, 5.6, 5.2],
  /* TWA 40 */ [2.7, 3.9, 4.8, 5.5, 5.8, 6.1, 6.2, 6.0],
  /* TWA 45 */ [3.2, 4.4, 5.2, 5.8, 6.1, 6.4, 6.5, 6.3],
  /* TWA 50 */ [3.6, 4.7, 5.5, 6.0, 6.3, 6.6, 6.7, 6.6],
  /* TWA 60 */ [4.2, 5.3, 6.0, 6.4, 6.7, 7.0, 7.1, 7.0],
  /* TWA 75 */ [4.5, 5.6, 6.3, 6.7, 7.0, 7.3, 7.5, 7.4],
  /* TWA 90 */ [4.6, 5.7, 6.4, 6.9, 7.2, 7.6, 7.9, 7.9],
  /* TWA 110*/ [4.4, 5.6, 6.4, 7.0, 7.4, 7.9, 8.3, 8.4],
  /* TWA 120*/ [4.2, 5.4, 6.2, 6.9, 7.3, 8.1, 8.7, 9.0],
  /* TWA 135*/ [3.8, 5.0, 5.8, 6.5, 7.0, 7.9, 8.7, 9.0],
  /* TWA 150*/ [3.3, 4.4, 5.2, 5.9, 6.4, 7.3, 8.1, 8.5],
  /* TWA 165*/ [2.9, 3.9, 4.7, 5.4, 5.9, 6.6, 7.3, 7.8],
  /* TWA 180*/ [2.6, 3.6, 4.4, 5.0, 5.5, 6.2, 6.8, 7.0],
];

// De overige archetypes zijn GROVERE schattingen, afgeleid van de basis hierboven met
// dezelfde vorm en dezelfde afvlakking: een vlakke snelheidsfactor plus een extra
// straf aan de wind (stompere hoek), die naar ruimere hoeken uitdooft.
//   toerder:    ~10% langzamer, duidelijk stompere hoek aan de wind
//   platbodem:  ~15% langzamer, veel stompere hoek (drift)
function derive(base: number[][], speedFactor: number, tightPenalty: number, tightUntilTwa: number): number[][] {
  return base.map((row, i) => {
    const twa = TWA_ROWS[i];
    // straf loopt lineair van `tightPenalty` bij 35° naar 1.0 bij `tightUntilTwa`
    const t = Math.min(1, Math.max(0, (twa - 35) / (tightUntilTwa - 35)));
    const angleFactor = tightPenalty + (1 - tightPenalty) * t;
    return row.map((v) => Math.round(v * speedFactor * angleFactor * 100) / 100);
  });
}

const TOERDER = derive(CRUISER_RACER, 0.90, 0.88, 60);
const PLATBODEM = derive(CRUISER_RACER, 0.85, 0.55, 75);

const TABLES: Record<Exclude<BoatArchetype, "motor">, number[][]> = {
  "cruiser-racer": CRUISER_RACER,
  toerder: TOERDER,
  platbodem: PLATBODEM,
};

// TWA gespiegeld naar 0–180 (bakboord/stuurboord maakt niet uit).
export function normaliseTwa(twaDeg: number): number {
  const a = ((twaDeg % 360) + 360) % 360;
  return a > 180 ? 360 - a : a;
}

// Positie in een oplopende as: index van de onderbuur + fractie. Buiten de randen
// wordt geklemd (nooit geëxtrapoleerd).
function axisPos(axis: number[], value: number): { i: number; f: number } {
  if (value <= axis[0]) return { i: 0, f: 0 };
  if (value >= axis[axis.length - 1]) return { i: axis.length - 2, f: 1 };
  let i = 0;
  while (i < axis.length - 2 && axis[i + 1] < value) i++;
  return { i, f: (value - axis[i]) / (axis[i + 1] - axis[i]) };
}

// Bootsnelheid door het water (kn), bilineair geïnterpoleerd, daarna × performance.
// Motor heeft geen tabel en levert altijd motorSpeedKn.
export function boatSpeed(profile: BoatProfile, twaDeg: number, twsKn: number): number {
  if (profile.archetype === "motor") return profile.motorSpeedKn;
  const table = TABLES[profile.archetype];
  const a = axisPos(TWA_ROWS, normaliseTwa(twaDeg));
  const w = axisPos(TWS_COLS, twsKn);
  const v00 = table[a.i][w.i], v01 = table[a.i][w.i + 1];
  const v10 = table[a.i + 1][w.i], v11 = table[a.i + 1][w.i + 1];
  const top = v00 + (v01 - v00) * w.f;
  const bot = v10 + (v11 - v10) * w.f;
  return (top + (bot - top) * a.f) * profile.performance;
}

export type VmgPoint = { twaDeg: number; speedKn: number; vmgKn: number };

// Optimum over de hoeken (stap 1°) via boatSpeed. Levert de nogo-hoek resp. de
// gijphoek — NOOIT hardcoderen op 45°/180°.
//
// De zoektocht blijft binnen het domein dat de tabel beschrijft (vanaf de scherpste
// rij). Onder die hoek klemt boatSpeed op de 35°-waarde; zou je daar doorheen zoeken,
// dan levert een onzeilbare 1° een fictieve VMG die elk echt optimum verslaat.
export function bestVmgUpwind(profile: BoatProfile, twsKn: number): VmgPoint {
  let best: VmgPoint = { twaDeg: 90, speedKn: 0, vmgKn: -Infinity };
  for (let twa = TWA_ROWS[0]; twa <= 90; twa++) {
    const speedKn = boatSpeed(profile, twa, twsKn);
    const vmgKn = speedKn * Math.cos((twa * Math.PI) / 180);
    if (vmgKn > best.vmgKn) best = { twaDeg: twa, speedKn, vmgKn };
  }
  return best;
}
export function bestVmgDownwind(profile: BoatProfile, twsKn: number): VmgPoint {
  let best: VmgPoint = { twaDeg: 90, speedKn: 0, vmgKn: -Infinity };
  for (let twa = 90; twa <= 180; twa++) {
    const speedKn = boatSpeed(profile, twa, twsKn);
    const vmgKn = speedKn * -Math.cos((twa * Math.PI) / 180);
    if (vmgKn > best.vmgKn) best = { twaDeg: twa, speedKn, vmgKn };
  }
  return best;
}

// ── Fase 5: export naar de plotter (Garmin .plr) ──────────────────────
// Regelmatige hoekenreeks; onze brontabel gebruikt onregelmatige hoeken en sommige
// apparaten accepteren die niet. Puur hersamplen via boatSpeed — geen nieuwe data.
// (30° ligt onder de scherpste tabelrij van 35° en klemt dus op die waarde.)
export const PLR_ANGLES = [30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180];

// Tabelvorm: windsnelheden in de bovenste rij, windhoeken in de eerste kolom,
// eerste cel leeg, tab-gescheiden.
//
// LET OP: de exacte interne opmaak van .plr staat niet in de openbare Garmin-
// documentatie en is NIET op een plotter geverifieerd. Dit is de gangbare tabelvorm.
// Werkt de import niet, dan zit het probleem in de opmaak en niet in de inhoud.
//
// Geëxporteerd op het TERUGGESCHAALDE niveau (inclusief performance): een plotter die
// streefsnelheden uit het rauwe potentieel toont, houdt de schipper een doel voor dat
// hij structureel niet haalt.
export function toPlr(profile: BoatProfile): string {
  const lines = [["", ...TWS_COLS.map(String)].join("\t")];
  for (const twa of PLR_ANGLES) {
    lines.push([String(twa), ...TWS_COLS.map((tws) => boatSpeed(profile, twa, tws).toFixed(2))].join("\t"));
  }
  return lines.join("\n") + "\n";
}

// Archetype + performance in de bestandsnaam, zodat achteraf traceerbaar is wat er in
// de plotter zit. De plotter zelf verwacht `polar.plr` in Garmin/polars/ — hernoemen
// bij het op de kaart zetten.
export function plrFilename(profile: BoatProfile): string {
  return `polar-${profile.archetype}-p${Math.round(profile.performance * 100)}.plr`;
}
