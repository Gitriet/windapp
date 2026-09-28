// Getij-afleidingen (lib/getij.ts): datumbereik, ISO-week en de kromme (gaten blijven gaten, pieken per fase).
import { datumBereik, binnenBereik, stripDagen, krommeSegmenten, krommePieken, krommeKenteringen, krommeBereik } from "../lib/getij";
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
const k = krommeKenteringen([{ ms: 0, v: 1 }, { ms: H, v: -3 }, { ms: 2 * H, v: -1 }, { ms: 3 * H, v: 1 }]);
ok("kenteringen lineair tussen de uren", k.length === 2 && k[0].ms === H / 4 && k[1].ms === 2.5 * H, k.map((m) => m.ms / H).join());
ok("kentering-richting", !k[0].naarMee && k[1].naarMee);
// 28 sep 2026 = CEST (UTC+2): lokale dag = 27 sep 22:00Z t/m 28 sep 22:00Z
const dep = Date.parse("2026-09-28T10:00:00Z");
const kort = krommeBereik(dep, dep + 2 * H);
ok("tocht binnen de dag: 00–24 lokaal", kort.dagweergave && kort.van === Date.parse("2026-09-27T22:00:00Z") && kort.tot === Date.parse("2026-09-28T22:00:00Z"));
const lang = krommeBereik(dep, dep + 21 * H);
ok("lange tocht: vanaf 3 u voor vertrek tot 1 u na aankomst", !lang.dagweergave && lang.van === dep - 3 * H && lang.tot === dep + 22 * H,
  `${(lang.van - dep) / H}..${(lang.tot - dep) / H}`);

if (fail) { console.error(`\nFAILED (${fail})`); process.exit(1); }
