// Stap 2b/2d: stroom-langs-route-afleidingen, geëxtraheerd uit app/vensters/page.tsx
// (stroomExtremes, stroomKentering) en components/route/MapView.tsx (currentArrow)
// naar lib/route.ts. Synthetische reeksen zodat elke uitkomst exact narekenbaar is.
import { stroomExtremes, stroomKentering, currentArrow, type AlongSample } from "../lib/route";

let fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

const T0 = Date.parse("2026-08-02T12:00:00Z");
const H = 3600_000;
const iso = (h: number) => new Date(T0 + h * H).toISOString();
// alongKn: -2, -1, 1, 3 op t0..t3 (tekenwissel tussen t1 en t2)
const series: AlongSample[] = [
  { t: iso(0), alongKn: -2 }, { t: iso(1), alongKn: -1 },
  { t: iso(2), alongKn: 1 }, { t: iso(3), alongKn: 3 },
];

console.log("— stroomExtremes: max mee/tegen + tegenfractie —");
{
  const e = stroomExtremes(series, T0, T0 + 3 * H)!;
  ok("maxTegen = 2", near(e.maxTegen, 2), `${e.maxTegen}`);
  ok("maxMee = 3", near(e.maxMee, 3), `${e.maxMee}`);
  ok("tegenFrac = 0.5", near(e.tegenFrac, 0.5), `${e.tegenFrac}`);
  ok("< 2 samples -> null", stroomExtremes([series[0]], T0, T0 + 3 * H) === null);
  ok("undefined -> null", stroomExtremes(undefined, T0, T0 + 3 * H) === null);
}

console.log("\n— stroomKentering: lineair geïnterpoleerd omslagpunt —");
{
  const k = stroomKentering(series, T0, T0 + 3 * H)!;
  ok("start loopt tegen", k.leftTegen === true);
  // -1 -> 1 tussen t1 en t2: f = 1/2, dus kentering op t1 + 0.5h = T0 + 1.5h
  ok("kentering op T0 + 1.5u", k.kenteringMs != null && near(k.kenteringMs, T0 + 1.5 * H),
    `${k.kenteringMs != null ? (k.kenteringMs - T0) / H : "null"}u`);
  ok("fracLeft = 0.5", near(k.fracLeft, 0.5), `${k.fracLeft}`);
  // zonder tekenwissel: geen kentering, fracLeft = 1
  const mono: AlongSample[] = [{ t: iso(0), alongKn: 1 }, { t: iso(1), alongKn: 2 }];
  const km = stroomKentering(mono, T0, T0 + 3 * H)!;
  ok("geen omslag -> kenteringMs null, fracLeft 1", km.kenteringMs === null && near(km.fracLeft, 1));
}

console.log("\n— currentArrow: magnitude + peiling waarheen de stroom loopt —");
{
  ok("u=0,v=2 -> mag 2, noord (0°)", (() => { const a = currentArrow(0, 2); return near(a.mag, 2) && near(a.bearingDeg, 0); })());
  ok("u=1,v=0 -> oost (90°)", near(currentArrow(1, 0).bearingDeg, 90));
  ok("u=-1,v=0 -> west (-90°)", near(currentArrow(-1, 0).bearingDeg, -90));
  ok("u=3,v=4 -> mag 5", near(currentArrow(3, 4).mag, 5));
}

if (fail) { console.error(`\nFAILED (${fail})`); process.exit(1); }
console.log("\nALL OK");
