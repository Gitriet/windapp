"use client";
import type { TideData, TidePoint } from "@/lib/types";
import { AXIS, xFor, msForClientX, hourTicks, dayBands, smoothPath } from "@/lib/chartaxis";
import { localHM, localWeekdayShort, localHourDecimal } from "@/lib/tz";
import { currentAt, type StroomPoint } from "@/lib/stroom";
import { useChartWidth } from "./useChartWidth";

// Tide block: the expected water level (incl. wind setup) as the bright line, the
// astronomical as a dimmed dashed line beneath it — the gap between them IS the
// visible wind setup. Zero line at NAP, values in cm NAP. HW points red / LW green
// with the time (Europe/Amsterdam). Same shared x-axis as the wind chart, so they
// line up vertically.
const ms = (iso: string) => Date.parse(iso);

// linear-interpolated level at an instant, for the hover readout
function levelAt(series: TidePoint[], m: number): number {
  if (m <= ms(series[0].t)) return series[0].v;
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1], b = series[i], ta = ms(a.t), tb = ms(b.t);
    if (m >= ta && m <= tb) { const f = (m - ta) / Math.max(1, tb - ta); return a.v + f * (b.v - a.v); }
  }
  return series[series.length - 1].v;
}

export default function TideChart(
  { data, t0, endMs, range, hoverMs, onHover, stream }:
  { data: TideData; t0: number; endMs: number; range: number;
    hoverMs: number | null; onHover: (ms: number | null) => void;
    stream?: StroomPoint | null },
) {
  const [wrapRef, W] = useChartWidth<HTMLDivElement>();
  const within = (iso: string) => { const m = ms(iso); return m >= t0 - 1 && m <= endMs + 1000; };
  const exp = data.expected.filter((p) => within(p.t));
  const ast = data.astro.filter((p) => within(p.t));
  const ext = data.extremes.filter((e) => within(e.t));
  if (!exp.length && !ast.length) return <p className="muted">Geen getijdata.</p>;

  const { PADL, PADR } = AXIS;
  const xf = (m: number) => xFor(m, t0, endMs, W);
  // a stroom point adds a top row of current-direction vanes (vloed/eb), so make
  // room above the plot for it; without one, keep the original compact layout.
  const hasStream = !!stream;
  const vaneY = 13;
  // more gap below the stroom vanes so the top cm number and HW label have room
  const plotT = hasStream ? 48 : 24, plotH = 150, plotB = plotT + plotH;
  const axisY = plotB + 6, H = axisY + 18;

  // ~8 current-direction samples across the window. Neutral colour only — direction
  // reads from the arrow, never from hue (procedural model, see lib/stroom.ts).
  // flood vs ebb is read from the bearing currentAt returns (it equals the point's
  // flood or ebb axis). Two colours for the two phases — NOT a compass hue.
  const floodish = (deg: number) => Math.abs(((deg - stream!.flood + 540) % 360) - 180) < 1;
  const vanes = hasStream
    ? Array.from({ length: 8 }, (_, i) => {
        const m = t0 + ((endMs - t0) * (i + 0.5)) / 8;
        const c = currentAt(stream!, localHourDecimal(m));
        return { x: xf(m), toward: c.deg, speed: c.speed, flood: floodish(c.deg) };
      })
    : [];

  const ys = [...exp, ...ast].map((p) => p.v);
  let ymin = Math.min(...ys), ymax = Math.max(...ys);
  const pad = Math.max(8, (ymax - ymin) * 0.16);
  ymin -= pad; ymax += pad;
  const y = (v: number) => plotT + ((ymax - v) / (ymax - ymin)) * plotH;
  const x = (iso: string) => xf(ms(iso));

  const bands = dayBands(t0, endMs);
  const ticks = hourTicks(t0, endMs, range);

  // which HW/LW labels to draw: skip one if it sits too close in x to the previous
  // label on the same side (HW above / LW below), so the times never overlap.
  const LABEL_GAP = 34;
  const showLabel = new Set<number>();
  let lastHW = -1e9, lastLW = -1e9;
  ext.forEach((e, k) => {
    const cx = x(e.t);
    if (e.kind === "HW") { if (cx - lastHW >= LABEL_GAP) { showLabel.add(k); lastHW = cx; } }
    else { if (cx - lastLW >= LABEL_GAP) { showLabel.add(k); lastLW = cx; } }
  });
  const grid: number[] = [];
  for (let v = -150; v <= 150; v += 50) if (v >= ymin - 5 && v <= ymax + 5) grid.push(v);

  // shared hover: crosshair + the interpolated water level at that instant
  const hSeries = exp.length ? exp : ast;
  const showHover = hoverMs != null && hoverMs >= t0 && hoverMs <= endMs && hSeries.length > 0;
  const hx = showHover ? xf(hoverMs!) : 0;
  const hLevel = showHover ? levelAt(hSeries, hoverMs!) : null;
  const tipPct = Math.max(15, Math.min(85, (hx / W) * 100));
  const onMove = (e: { clientX: number; currentTarget: Element }) =>
    onHover(msForClientX(e.clientX, e.currentTarget.getBoundingClientRect(), t0, endMs, W));
  const clearHover = () => onHover(null);

  return (
    <div className="chartwrap" ref={wrapRef} onPointerMove={onMove} onPointerDown={onMove}
         onPointerLeave={clearHover} onPointerCancel={clearHover}>
    <svg viewBox={`0 0 ${W} ${H}`} className="tchart" role="img" aria-label="getijvoorspelling">
      {range > 1 && bands.bounds.map((b, k) => (
        <line key={`db${k}`} x1={xf(b)} y1={plotT} x2={xf(b)} y2={plotB} stroke="#1b2a36" />
      ))}
      {grid.map((v, k) => (
        <g key={`g${k}`}>
          <line x1={PADL} x2={W - PADR} y1={y(v)} y2={y(v)}
                stroke={v === 0 ? "#33485a" : "#16242f"} strokeDasharray={v === 0 ? "4 4" : undefined} />
          <text x={PADL - 6} y={y(v) + 3} className="ytick">{v}</text>
        </g>
      ))}

      {/* stroomrichting (vloed/eb) — neutrale pijl wijst waar het water heen stroomt;
          een stip = kentering (slap water). Voorspeld model, geen echte RWS-stroom. */}
      {vanes.map((v, k) => (v.speed < 0.15 ? (
        <circle key={`sv${k}`} cx={v.x} cy={vaneY} r={2} fill="var(--cur)" />
      ) : (
        <g key={`sv${k}`} transform={`translate(${v.x},${vaneY}) rotate(${v.toward.toFixed(0)})`}>
          <path d="M0 6 L0 -6 M-3 -2 L0 -6 L3 -2" fill="none"
                stroke={v.flood ? "var(--flood)" : "var(--ebb)"}
                strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )))}

      <path d={smoothPath(ast.map((p) => [x(p.t), y(p.v)]))} className="tideastro" />
      <path d={smoothPath(exp.map((p) => [x(p.t), y(p.v)]))} className="tideexp" />

      {ext.map((e, k) => {
        const cx = x(e.t), cy = y(e.v), col = e.kind === "HW" ? "var(--hw)" : "var(--lw)";
        return (
          <g key={`e${k}`}>
            <circle cx={cx} cy={cy} r={3.4} fill={col} stroke="#0d141b" strokeWidth={1.3} />
            {/* HW/LW time labels only on a single day, and only when there's room
                (close-together extremes drop their label to avoid overlap) */}
            {range === 1 && showLabel.has(k) && (
              <text x={cx} y={cy + (e.kind === "HW" ? -8 : 15)} fontSize={10}
                    fill={col} textAnchor="middle">{localHM(ms(e.t))}</text>
            )}
          </g>
        );
      })}

      {/* axis: hour ticks on a single day, day names across the 3-day overview */}
      {range === 1 && ticks.map((tk, k) => (
        <g key={`h${k}`}>
          <line x1={xf(tk.ms)} y1={axisY} x2={xf(tk.ms)} y2={axisY + (tk.label ? 5 : 3)} stroke="#33485a" />
          {tk.label && <text x={xf(tk.ms)} y={axisY + 15} className="xtick">{tk.label}</text>}
        </g>
      ))}
      {range > 1 && bands.segs.map((s, k) => (
        <text key={`dl${k}`} x={xf(s.mid)} y={axisY + 13} className="xtick">{k === 0 ? "nu" : s.label}</text>
      ))}
      {showHover && <line className="crossline" x1={hx} y1={plotT} x2={hx} y2={plotB} />}
    </svg>
    {showHover && hLevel != null && (
      <div className="tip" style={{ left: `${tipPct}%`, top: "2px" }}>
        <b>{localWeekdayShort(hoverMs!)} {localHM(hoverMs!)}</b>
        <span>{Math.round(hLevel)} cm NAP</span>
      </div>
    )}
    </div>
  );
}
