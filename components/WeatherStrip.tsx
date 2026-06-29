"use client";
import type { WeatherSeries } from "@/lib/types";
import WeatherIcon from "./WeatherIcon";
import { wxGroup, sunEvents, isNight } from "@/lib/weather";
import { xFor } from "@/lib/chartaxis";
import { useChartWidth } from "./useChartWidth";

// Slim weather row: sky icon + temperature at ~8 sample moments, positioned on the
// shared wind/tide time axis so every icon sits above its hour. Lives at the top of
// the wind card — no temperature line and no own axis, the wind chart below carries
// those. (NO wind here.)
const ms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));

export default function WeatherStrip(
  { weather, t0, endMs }: { weather: WeatherSeries; t0: number; endMs: number },
) {
  const [rowRef, W] = useChartWidth<HTMLDivElement>();
  // indices inside the selected window (arrays parallel the wind points by time)
  const idx: number[] = [];
  for (let i = 0; i < weather.time.length; i++) {
    const m = ms(weather.time[i]);
    if (m >= t0 - 1 && m <= endMs + 1000) idx.push(i);
  }
  if (!idx.length) return null;

  const xi = (i: number) => xFor(ms(weather.time[i]), t0, endMs, W);
  const sunEv = sunEvents(weather.sunrise, weather.sunset);   // day/night per sample

  // ~8 icon samples across the window (≈ every 3h on a single day)
  const step = Math.max(1, Math.round(idx.length / 8));
  const samples: number[] = [];
  for (let k = Math.floor(step / 2); k < idx.length; k += step) samples.push(idx[k]);

  return (
    <div className="wxrow" ref={rowRef}>
      {samples.map((i) => (
        <div key={i} className="wxi" style={{ left: `${(xi(i) / W) * 100}%` }}>
          <WeatherIcon group={wxGroup(weather.code[i])} size={20} night={isNight(ms(weather.time[i]), sunEv)} />
          {weather.temp[i] != null && <span className="t">{Math.round(weather.temp[i]!)}°</span>}
        </div>
      ))}
    </div>
  );
}
