// GETIJDEN-afleidingen (lib/getij.ts): datumbereik, ISO-week, stroom-ranking zonder wind
// en de kromme (gaten blijven gaten, pieken per fase).
import { datumBereik, binnenBereik, stripDagen, rankOpStroom, krommeSegmenten, krommePieken, RANKING_STW_KN } from "../lib/getij";
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

console.log("— rankOpStroom —");
// sinusvormige stroom (periode 12u, 1 kn) langs één leg van ~5 nm, de hele dag gedekt
const t0 = Date.parse("2026-09-18T00:00:00Z");
const along: AlongSample[] = Array.from({ length: 40 }, (_, i) => ({
  t: new Date(t0 - 4 * H + i * H).toISOString().slice(0, 19), alongKn: Math.sin((2 * Math.PI * (i - 4)) / 12),
}));
const wp = [{ location_key: "a", lat: 53.0, lon: 4.7 }, { location_key: "b", lat: 53.08, lon: 4.7 }];
const r = rankOpStroom({ dag: "2026-09-18", waypoints: wp, along: [along], legDistNm: [5] });
ok("beste gevonden", r.beste != null && r.gedekt);
ok("dag zonder data → niet gedekt", !rankOpStroom({ dag: "2026-09-25", waypoints: wp, along: [along], legDistNm: [5] }).gedekt);
ok("beste vertrekt met meestroom", (r.beste?.result.steps[0].cur ?? -1) > 0, String(r.beste?.result.steps[0].cur));
ok("beste is snelste", [r.beste!, ...r.overige].every((o) => o.result.tripMin >= r.beste!.result.tripMin));
ok("vensters ≥4u uit elkaar", [r.beste!, ...r.overige].every((o, i, a) => a.every((p, j) => i === j || Math.abs(o.depMs - p.depMs) >= 4 * H)));
ok("alleen vertrekken waarbij de stroom helpt", [r.beste!, ...r.overige].every((o) => o.result.effectMin < 0));
ok("STW vast (wind speelt geen rol)", Math.abs(r.beste!.result.avgStw - RANKING_STW_KN) < 1e-9);
ok("alle vertrekken op de gekozen dag", [r.beste!, ...r.overige].every((o) => new Date(o.depMs + 2 * H).toISOString().startsWith("2026-09-18")));

console.log("— kromme —");
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
