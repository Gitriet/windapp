"use client";
import type { WeatherSeries } from "@/lib/types";
import WeatherIcon from "./WeatherIcon";
import { wxGroup, wxLabel } from "@/lib/weather";
import { localHM, localWeekdayShort } from "@/lib/tz";
import { AXIS, xFor, msForClientX, hourTicks, dayBands } from "@/lib/chartaxis";

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
  { weather, t0, endMs, range, hoverMs, onHover }:
  { weather: WeatherSeries; t0: number; endMs: number; range: number;
    hoverMs: number | null; onHover: (ms: number | null) => void },
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
  // curve sits in 12..40; the bottom strip (40..58) carries the time axis
  const padT = 12, plotB = 40, gh = plotB - padT, H = 58;
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
  const bands = dayBands(t0, endMs);
  const ticks = hourTicks(t0, endMs, range);

  // shared hover: crosshair + nearest-hour temperature readout
  const showHover = hoverMs != null && hoverMs >= t0 && hoverMs <= endMs;
  const hx = showHover ? xFor(hoverMs!, t0, endMs) : 0;
  let hWx: { temp: number; code: number | null } | null = null;
  if (showHover) {
    let best = Infinity, bi = -1;
    for (const i of idx) { const d = Math.abs(ms(weather.time[i]) - hoverMs!); if (d < best) { best = d; bi = i; } }
    if (bi >= 0 && weather.temp[bi] != null) hWx = { temp: weather.temp[bi]!, code: weather.code[bi] };
  }
  const tipPct = Math.max(15, Math.min(85, (hx / W) * 100));
  const onMove = (e: { clientX: number; currentTarget: Element }) =>
    onHover(msForClientX(e.clientX, e.currentTarget.getBoundingClientRect(), t0, endMs));
  const clearHover = () => onHover(null);

  return (
    <div className="wxstrip">
      <div className="chartwrap" onPointerMove={onMove} onPointerDown={onMove}
           onPointerLeave={clearHover} onPointerCancel={clearHover}>
      <div className="wxrow">
        {samples.map((i) => (
          <div key={i} className="wxi" style={{ left: `${(xi(i) / W) * 100}%` }}>
            <WeatherIcon group={wxGroup(weather.code[i])} size={22} />
            {weather.temp[i] != null && <span className="t">{Math.round(weather.temp[i]!)}°</span>}
          </div>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="tempcurve" role="img" aria-label="temperatuur en tijd">
        {multi && bands.bounds.map((b, k) => (
          <line key={`b${k}`} x1={xFor(b, t0, endMs)} y1={0} x2={xFor(b, t0, endMs)} y2={plotB} stroke="#222c38" />
        ))}
        {idx.slice(0, -1).map((i, k) => {
          const a = weather.temp[i], bv = weather.temp[idx[k + 1]];
          if (a == null || bv == null) return null;
          return <line key={`t${i}`} x1={xi(i)} y1={y(a)} x2={xi(idx[k + 1])} y2={y(bv)}
                       stroke={tempColor(a)} strokeWidth={2.4} strokeLinecap="round" />;
        })}
        {/* time axis — hour ticks on a single day, day names in 3-day view */}
        {!multi && ticks.map((tk, k) => tk.label ? (
          <g key={`h${k}`}>
            <line x1={xFor(tk.ms, t0, endMs)} y1={plotB + 2} x2={xFor(tk.ms, t0, endMs)} y2={plotB + 5} stroke="#33485a" />
            <text x={xFor(tk.ms, t0, endMs)} y={plotB + 16} className="xtick">{tk.label}</text>
          </g>
        ) : null)}
        {multi && bands.segs.map((s, k) => (
          <text key={`d${k}`} x={xFor(s.mid, t0, endMs)} y={plotB + 15} className="xtick">{k === 0 ? "nu" : s.label}</text>
        ))}
        {showHover && <line className="crossline" x1={hx} y1={0} x2={hx} y2={plotB} />}
      </svg>
      {showHover && hWx && (
        <div className="tip" style={{ left: `${tipPct}%`, top: "2px" }}>
          <b>{localWeekdayShort(hoverMs!)} {localHM(hoverMs!)}</b>
          <span>{Math.round(hWx.temp)}° · {wxLabel(hWx.code)}</span>
        </div>
      )}
      </div>
    </div>
  );
}
