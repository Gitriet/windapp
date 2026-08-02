// Fase 1: polaire. Bewijst de drie acceptatiecriteria — exacte tabelpunten,
// interpolatie/klemmen, en de VMG-hoeken die uit de tabel moeten volgen.
import {
  boatSpeed, bestVmgUpwind, bestVmgDownwind, normaliseTwa,
  DEFAULT_BOAT, TWA_ROWS, TWS_COLS, type BoatProfile,
} from "../lib/polar";

let fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

const P: BoatProfile = { ...DEFAULT_BOAT, performance: 1 };
const P85: BoatProfile = { ...DEFAULT_BOAT, performance: 0.85 };

console.log("— exacte tabelpunten (× performance) —");
// De brontabel voor cruiser-racer, zoals in de opdracht.
const EXPECT: Record<string, number> = {
  "35|4": 2.2, "35|25": 5.2, "90|12": 7.2, "120|20": 8.7, "135|25": 9.0, "180|4": 2.6,
};
for (const [k, v] of Object.entries(EXPECT)) {
  const [twa, tws] = k.split("|").map(Number);
  ok(`boatSpeed(${twa}°, ${tws}kn) = ${v}`, near(boatSpeed(P, twa, tws), v),
    `got ${boatSpeed(P, twa, tws)}`);
  ok(`  × performance 0.85`, near(boatSpeed(P85, twa, tws), v * 0.85),
    `got ${boatSpeed(P85, twa, tws)}`);
}

console.log("\n— interpolatie ligt tussen de buren —");
{
  const lo = boatSpeed(P, 90, 12), hi = boatSpeed(P, 90, 16);          // 7.2 en 7.6
  const mid = boatSpeed(P, 90, 14);
  ok("TWS-interpolatie tussen buren", mid > Math.min(lo, hi) && mid < Math.max(lo, hi),
    `${lo} < ${mid} < ${hi}`);
  ok("TWS-interpolatie exact halverwege", near(mid, (lo + hi) / 2, 1e-9), `${mid}`);

  const a = boatSpeed(P, 110, 10), b = boatSpeed(P, 120, 10);          // 7.0 en 6.9
  const m = boatSpeed(P, 115, 10);
  ok("TWA-interpolatie tussen buren", m < Math.max(a, b) && m > Math.min(a, b), `${a} / ${m} / ${b}`);
}

console.log("\n— klemmen buiten de tabelranden (nooit extrapoleren) —");
{
  const minTwa = TWA_ROWS[0], maxTwa = TWA_ROWS[TWA_ROWS.length - 1];
  const minTws = TWS_COLS[0], maxTws = TWS_COLS[TWS_COLS.length - 1];
  ok("TWS onder de rand klemt", near(boatSpeed(P, 90, 1), boatSpeed(P, 90, minTws)));
  ok("TWS boven de rand klemt", near(boatSpeed(P, 90, 60), boatSpeed(P, 90, maxTws)));
  ok("TWA onder de rand klemt", near(boatSpeed(P, 10, 12), boatSpeed(P, minTwa, 12)));
  ok("TWA op 180 is de laatste rij", near(boatSpeed(P, 180, 12), boatSpeed(P, maxTwa, 12)));
  ok("TWA spiegelt naar 0–180", near(boatSpeed(P, 250, 12), boatSpeed(P, normaliseTwa(250), 12)),
    `250° -> ${normaliseTwa(250)}°`);
  ok("TWA -60 spiegelt naar 60", near(boatSpeed(P, -60, 12), boatSpeed(P, 60, 12)));
}

console.log("\n— VMG-hoeken volgen uit de tabel (niet hardgecodeerd) —");
{
  const u4 = bestVmgUpwind(P, 4);
  const u10 = bestVmgUpwind(P, 10);
  const u16 = bestVmgUpwind(P, 16);
  console.log(`     upwind  4kn -> ${u4.twaDeg}° (${u4.speedKn.toFixed(2)} kn, vmg ${u4.vmgKn.toFixed(2)})`);
  console.log(`     upwind 10kn -> ${u10.twaDeg}° (${u10.speedKn.toFixed(2)} kn, vmg ${u10.vmgKn.toFixed(2)})`);
  console.log(`     upwind 16kn -> ${u16.twaDeg}° (${u16.speedKn.toFixed(2)} kn, vmg ${u16.vmgKn.toFixed(2)})`);
  ok("ruimere hoek bij weinig wind (4 kn ≈ 50°)", u4.twaDeg >= 47 && u4.twaDeg <= 53, `${u4.twaDeg}°`);
  ok("scherper vanaf 10 kn (≈ 40°)", u10.twaDeg >= 37 && u10.twaDeg <= 43, `${u10.twaDeg}°`);
  ok("4 kn ruimer dan 10 kn", u4.twaDeg > u10.twaDeg, `${u4.twaDeg}° > ${u10.twaDeg}°`);

  const d12 = bestVmgDownwind(P, 12);
  console.log(`     downwind 12kn -> ${d12.twaDeg}° (${d12.speedKn.toFixed(2)} kn, vmg ${d12.vmgKn.toFixed(2)})`);
  ok("gijphoek niet op 180 vastgezet", d12.twaDeg > 90 && d12.twaDeg < 180, `${d12.twaDeg}°`);
}

console.log("\n— archetypes: stompere hoek, lagere snelheid —");
{
  const toerder: BoatProfile = { ...P, archetype: "toerder" };
  const platbodem: BoatProfile = { ...P, archetype: "platbodem" };
  const motor: BoatProfile = { ...P, archetype: "motor", motorSpeedKn: 6 };
  ok("toerder langzamer dan cruiser-racer", boatSpeed(toerder, 90, 12) < boatSpeed(P, 90, 12));
  ok("platbodem langzamer dan toerder", boatSpeed(platbodem, 90, 12) < boatSpeed(toerder, 90, 12));
  const uc = bestVmgUpwind(P, 12).twaDeg, ut = bestVmgUpwind(toerder, 12).twaDeg,
        up = bestVmgUpwind(platbodem, 12).twaDeg;
  console.log(`     nogo 12kn: cruiser ${uc}° · toerder ${ut}° · platbodem ${up}°`);
  ok("toerder stomper aan de wind", ut >= uc, `${ut}° ≥ ${uc}°`);
  ok("platbodem duidelijk stomper", up > ut, `${up}° > ${ut}°`);
  ok("motor negeert de tabel", near(boatSpeed(motor, 35, 4), 6) && near(boatSpeed(motor, 180, 25), 6));
}

if (fail) { console.error(`\nFAILED (${fail})`); process.exit(1); }
console.log("\nALL OK");
