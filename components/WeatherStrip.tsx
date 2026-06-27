"use client";
import type { WeatherSeries } from "@/lib/types";
import WeatherIcon from "./WeatherIcon";
import { wxGroup } from "@/lib/weather";
import { AXIS, xFor, dayBands } from "@/lib/chartaxis";

// Sky-only strip between the wind and tide charts: weather icons + temperature
// at ~8 sample moments, with a temperature wave underneath coloured cool→warm.
// NO wind here (that's the chart above). Shares the wind/tide time axis, so the
// icons and wave line up vertically with both charts.
const ms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));

// temp → colour: cool blue (5°) to warm orange (30°). Its own domain, separate
// from the wind colour scale — different strip, so no clash.
function tempColor(t: number): string {
  const r = Math.max(0, Math.min(1, (t - 5) / 25));
  return `hsl(${210 - r * 185} 62% 58%)`;
}

export default function WeatherStrip(
  { weather, t0, endMs, range }:
  { weather: WeatherSeries; t0: number; endMs: number; range: number },
) {
  // indices of the weather series inside the selected window (arrays parallel the
  // wind points by time, so the same x-axis maps both)
  const idx: number[] = [];
  for (let i = 0; i < weather.time.length; i++) {
    const m = ms(weather.time[i]);
    if (m >= t0 - 1 && m <= endMs + 1000) idx.push(i);
  }
  if (!idx.length) return null;

  const { W } = AXIS;
  const H = 50, padT = 12, padB = 8, gh = H - padT - padB;
  const xi = (i: number) => xFor(ms(weather.time[i]), t0, endMs);

  // temperature scale over the window
  const temps = idx.map((i) => weather.temp[i]).filter((v): v is number => v != null);
  const tmin = temps.length ? Math.min(...temps) : 0;
  const tmax = temps.length ? Math.max(...temps) : 1;
  const lo = Math.floor(tmin - 1), hi = Math.ceil(tmax + 1);
  const y = (v: number) => padT + gh - ((v - lo) / Math.max(1, hi - lo)) * gh;

  // ~8 icon samples across the window (≈ every 3h on a single day)
  const step = Math.max(1, Math.round(idx.length / 8));
  const samples: number[] = [];
  for (let k = Math.floor(step / 2); k < idx.length; k += step) samples.push(idx[k]);

  const multi = range > 1;
  const bounds = dayBands(t0, endMs).bounds;

  return (
    <div className="wxstrip">
      <div className="wxrow">
        {samples.map((i) => (
          <div key={i} className="wxi" style={{ left: `${(xi(i) / W) * 100}%` }}>
            <WeatherIcon group={wxGroup(weather.code[i])} size={22} />
            {weather.temp[i] != null && <span className="t">{Math.round(weather.temp[i]!)}°</span>}
          </div>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="tempcurve" role="img" aria-label="temperatuur">
        {multi && bounds.map((b, k) => (
          <line key={`b${k}`} x1={xFor(b, t0, endMs)} y1={0} x2={xFor(b, t0, endMs)} y2={H} stroke="#222c38" />
        ))}
        {idx.slice(0, -1).map((i, k) => {
          const a = weather.temp[i], bv = weather.temp[idx[k + 1]];
          if (a == null || bv == null) return null;
          return <line key={`t${i}`} x1={xi(i)} y1={y(a)} x2={xi(idx[k + 1])} y2={y(bv)}
                       stroke={tempColor(a)} strokeWidth={2.4} strokeLinecap="round" />;
        })}
      </svg>
    </div>
  );
}
