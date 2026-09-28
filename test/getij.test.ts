// Getij-afleidingen (lib/getij.ts): datumbereik, ISO-week en de kromme (gaten blijven gaten, pieken per fase).
import { datumBereik, binnenBereik, stripDagen, krommeSegmenten, krommePieken } from "../lib/getij";
import type { AlongSample } from "../lib/route";

let fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const H = 3_600_000;

console.log("— datumBereik —");
const b = datumBereik([{ first: Date.parse("2026-09-17T18:00:00Z"), last: Date.parse("2026-09-20T03:00:00Z") }, null]);
ok("lokale dagen van de spans", b?.eerste === "2026-09-17" && b?.laatste === "2026-09-20", JSON.stringify(b));
ok("22:30Z = volgende lokale dag", datumBereik([{ first: Date.parse("2026-09-17T22:30:00Z"), last: Date.parse("2026-09-17T22:30:00Z") }])?.eerste === "2026-09-18");
ok("geen spans → null", datumBereik([null]) === null);
ok("binnen/buiten", binnenBereik("2026-09-18", b) && !binnenBereik("2026-09-21", b) && !binnenBereik("2026-09-18", null));

console.log("— dagstrip —");
const st = stripDagen("2026-09-18", "2026-09-18");
ok("vandaag vooraan, 7 dagen", st[0] === "2026-09-18" && st[6] === "2026-09-24" && st.length === 7, st.join(","));
ok("nooit vóór vandaag", stripDagen("2026-09-11", "2026-09-18")[0] === "2026-09-18");
ok("latere start blijft", stripDagen("2026-09-25", "2026-09-18")[0] === "2026-09-25");
ok("over zomertijdgrens (29 mrt 2026)", stripDagen("2026-03-28", "2026-03-28")[2] === "2026-03-30");

console.log("— kromme —");
const t0 = Date.parse("2026-09-18T00:00:00Z");
const s: AlongSample[] = [
  { t: "2026-09-18T00:00:00", alongKn: 0 }, { t: "2026-09-18T01:00:00", alongKn: 1 }, { t: "2026-09-18T02:00:00", alongKn: 0.5 },
  { t: "2026-09-18T03:00:00", alongKn: null },
  { t: "2026-09-18T04:00:00", alongKn: -0.5 }, { t: "2026-09-18T05:00:00", alongKn: -1 }, { t: "2026-09-18T06:00:00", alongKn: -0.2 },
];
const segs = krommeSegmenten(s, t0, t0 + 24 * H);
ok("null breekt de lijn in 2 segmenten", segs.length === 2 && segs[0].length === 3 && segs[1].length === 3);
ok("meestroompiek", krommePieken(segs[0]).map((p) => p.soort).join() === "mee");
ok("tegenstroompiek", krommePieken(segs[1]).map((p) => p.soort).join() === "tegen");

if (fail) { console.error(`\nFAILED (${fail})`); process.exit(1); }
