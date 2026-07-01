"use client";
import type { WeatherSeries } from "@/lib/types";
import WeatherIcon from "./WeatherIcon";
import { wxGroup, sunEvents, isNight } from "@/lib/weather";
import { AXIS } from "@/lib/chartaxis";
import { useChartWidth } from "./useChartWidth";

// Slim weather row: sky icon + temperature. A FIXED number of icons at FIXED,
// evenly-spaced slots — the same layout in every view (1-day or 3-day). The slot
// position is not derived from the sample's timestamp, so the icons never drift
// or change count between views; each slot just shows the weather nearest that
// point in the window. Lives at the top of the wind card (NO wind here).
const ms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));
const N = 8;                                   // icons per row, all views

export default function WeatherStrip(
  { weather, t0, endMs }: { weather: WeatherSeries; t0: number; endMs: number },
) {
  const [rowRef, W] = useChartWidth<HTMLDivElement>();
  // indices inside the selected window
  const idx: number[] = [];
  for (let i = 0; i < weather.time.length; i++) {
    const m = ms(weather.time[i]);
    if (m >= t0 - 1 && m <= endMs + 1000) idx.push(i);
  }
  if (!idx.length) return null;

  const sunEv = sunEvents(weather.sunrise, weather.sunset);   // day/night per sample
  const { PADL, PADR } = AXIS;
  // fixed slot centre (fraction of the plot width), never from the timestamp
  const slotFrac = (k: number) => (k + 0.5) / N;
  const leftPct = (k: number) => ((PADL + slotFrac(k) * (W - PADL - PADR)) / W) * 100;
  const nearest = (target: number) => {
    let best = idx[0], bd = Infinity;
    for (const i of idx) { const d = Math.abs(ms(weather.time[i]) - target); if (d < bd) { bd = d; best = i; } }
    return best;
  };

  const slots = Array.from({ length: N }, (_, k) => ({
    k, i: nearest(t0 + slotFrac(k) * (endMs - t0)),
  }));

  return (
    <div className="wxrow" ref={rowRef}>
      {slots.map(({ k, i }) => (
        <div key={k} className="wxi" style={{ left: `${leftPct(k)}%` }}>
          <WeatherIcon group={wxGroup(weather.code[i])} size={20} night={isNight(ms(weather.time[i]), sunEv)} />
          {weather.temp[i] != null && <span className="t">{Math.round(weather.temp[i]!)}°</span>}
        </div>
      ))}
    </div>
  );
}
