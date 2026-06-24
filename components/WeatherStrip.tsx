"use client";
import type { WeatherSeries } from "@/lib/types";
import { AXIS, xFor, hourTicks } from "@/lib/chartaxis";
import { wxGroup, isThunder, sunEvents, isNight, VIS_LOW, VIS_VERYLOW } from "@/lib/weather";
import WeatherIcon from "./WeatherIcon";

// Weather strip on the SHARED time axis, above the wind chart. Day/night shading
// from sunrise/sunset, precipitation bars scaled on intensity with probability as
// a subtle opacity signal, periodic icons, thunder as a separate flag, and a
// low-visibility marker that only appears under 5 km. Reads calmer than the wind.
const ms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));
const PRECIP_FULL = 4;   // mm/h that fills a bar

export default function WeatherStrip(
  { weather, t0, endMs, range }: { weather: WeatherSeries; t0: number; endMs: number; range: number },
) {
  const { W, PADL, PADR } = AXIS;
  const H = 84, iconY = 11, thunderY = 3, baseY = 64, maxBarH = 28, visY = 74;
  const x = (msv: number) => xFor(msv, t0, endMs);

  const n = weather.time.length;
  const idx: number[] = [];
  for (let i = 0; i < n; i++) { const m = ms(weather.time[i]); if (m >= t0 - 1 && m <= endMs + 1000) idx.push(i); }
  if (!idx.length) return null;
  const xAt = (i: number) => x(ms(weather.time[i]));
  const xNext = (i: number) => (i + 1 < n ? x(ms(weather.time[i + 1])) : x(endMs));

  const ev = sunEvents(weather.sunrise, weather.sunset);
  const hasLowVis = idx.some((i) => { const v = weather.vis[i]; return v != null && v < VIS_LOW; });
  // icons sit on the SAME local-hour grid as the wind/tide axis ticks
  const t0i = ms(weather.time[0]);
  const nearestIdx = (m: number) => { const i = Math.round((m - t0i) / 3600000); return i >= 0 && i < n ? i : null; };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="wstrip" role="img" aria-label="weerstrip">
      {/* day/night shading */}
      {idx.map((i) => (isNight(ms(weather.time[i]), ev)
        ? <rect key={`n${i}`} x={xAt(i)} y={0} width={Math.max(0, xNext(i) - xAt(i)) + 0.5} height={H} fill="rgba(6,10,16,.5)" />
        : null))}

      {/* low-visibility marker — only under 5 km, stronger under 1 km */}
      {hasLowVis && <text x={PADL - 6} y={visY + 3} className="wlbl" textAnchor="end">zicht</text>}
      {idx.map((i) => {
        const v = weather.vis[i];
        if (v == null || v >= VIS_LOW) return null;
        const strong = v < VIS_VERYLOW;
        return <rect key={`v${i}`} x={xAt(i)} y={visY} width={Math.max(0, xNext(i) - xAt(i)) + 0.5} height={3}
                     fill={strong ? "var(--gust)" : "var(--faint)"} opacity={strong ? 0.9 : 0.55} />;
      })}

      {/* precipitation bars: height = intensity, opacity = probability */}
      <line x1={PADL} x2={W - PADR} y1={baseY} y2={baseY} stroke="#16242f" />
      {idx.map((i) => {
        const p = weather.precip[i];
        if (p == null || p <= 0) return null;
        const h = Math.max(2.5, Math.min(1, p / PRECIP_FULL) * maxBarH);   // keep light precip visible
        const prob = weather.pop[i] ?? 0;
        const x0 = xAt(i), w = Math.max(1.5, xNext(i) - xAt(i) - 1);
        return <rect key={`p${i}`} x={x0 + 0.5} y={baseY - h} width={w} height={h}
                     fill="var(--tide)" opacity={0.3 + 0.5 * (prob / 100)} />;
      })}

      {/* thunder flag (separate from the icon) */}
      {idx.map((i) => (isThunder(weather.code[i])
        ? <polyline key={`t${i}`} points={`${xAt(i)},${thunderY} ${xAt(i) - 2.5},${thunderY + 5} ${xAt(i) + 1},${thunderY + 5} ${xAt(i) - 1.5},${thunderY + 10}`}
                    fill="none" stroke="var(--gust)" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
        : null))}

      {/* periodic weather icons, on the shared hour grid */}
      {hourTicks(t0, endMs, range).map((tk, k) => {
        const i = nearestIdx(tk.ms);
        return i == null ? null : (
          <WeatherIcon key={`i${k}`} group={wxGroup(weather.code[i])} size={18} x={xFor(tk.ms, t0, endMs) - 9} y={iconY} className="wstripicon" />
        );
      })}
    </svg>
  );
}
