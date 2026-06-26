"use client";
import type { TideData, TidePoint } from "@/lib/types";
import { AXIS, xFor, hourTicks, dayBands, smoothPath } from "@/lib/chartaxis";
import { localHM } from "@/lib/tz";

// Tide block: the expected water level (incl. wind setup) as the bright line, the
// astronomical as a dimmed dashed line beneath it — the gap between them IS the
// visible wind setup. Zero line at NAP, values in cm NAP. HW points red / LW green
// with the time (Europe/Amsterdam). Same shared x-axis as the wind chart, so they
// line up vertically.
const ms = (iso: string) => Date.parse(iso);

export default function TideChart(
  { data, t0, endMs, range }: { data: TideData; t0: number; endMs: number; range: number },
) {
  const within = (iso: string) => { const m = ms(iso); return m >= t0 - 1 && m <= endMs + 1000; };
  const exp = data.expected.filter((p) => within(p.t));
  const ast = data.astro.filter((p) => within(p.t));
  const ext = data.extremes.filter((e) => within(e.t));
  if (!exp.length && !ast.length) return <p className="muted">Geen getijdata.</p>;

  const { W, PADL, PADR } = AXIS;
  const plotT = 24, plotH = 150, plotB = plotT + plotH;
  const axisY = plotB + 6, H = axisY + 18;

  const ys = [...exp, ...ast].map((p) => p.v);
  let ymin = Math.min(...ys), ymax = Math.max(...ys);
  const pad = Math.max(8, (ymax - ymin) * 0.16);
  ymin -= pad; ymax += pad;
  const y = (v: number) => plotT + ((ymax - v) / (ymax - ymin)) * plotH;
  const x = (iso: string) => xFor(ms(iso), t0, endMs);

  const bands = dayBands(t0, endMs);
  const ticks = hourTicks(t0, endMs, range);
  const grid: number[] = [];
  for (let v = -150; v <= 150; v += 50) if (v >= ymin - 5 && v <= ymax + 5) grid.push(v);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="tchart" role="img" aria-label="getijvoorspelling">
      {range > 1 && bands.bounds.map((b, k) => (
        <line key={`db${k}`} x1={xFor(b, t0, endMs)} y1={plotT} x2={xFor(b, t0, endMs)} y2={plotB} stroke="#1b2a36" />
      ))}
      {grid.map((v, k) => (
        <g key={`g${k}`}>
          <line x1={PADL} x2={W - PADR} y1={y(v)} y2={y(v)}
                stroke={v === 0 ? "#33485a" : "#16242f"} strokeDasharray={v === 0 ? "4 4" : undefined} />
          <text x={PADL - 6} y={y(v) + 3} className="ytick">{v}</text>
        </g>
      ))}

      <path d={smoothPath(ast.map((p) => [x(p.t), y(p.v)]))} className="tideastro" />
      <path d={smoothPath(exp.map((p) => [x(p.t), y(p.v)]))} className="tideexp" />

      {ext.map((e, k) => {
        const cx = x(e.t), cy = y(e.v), col = e.kind === "HW" ? "var(--hw)" : "var(--lw)";
        return (
          <g key={`e${k}`}>
            <circle cx={cx} cy={cy} r={3.4} fill={col} stroke="#0d141b" strokeWidth={1.3} />
            {/* HW/LW time labels only on a single day — too dense across 3 days */}
            {range === 1 && (
              <text x={cx} y={cy + (e.kind === "HW" ? -8 : 15)} fontSize={10}
                    fill={col} textAnchor="middle">{localHM(ms(e.t))}</text>
            )}
          </g>
        );
      })}

      {/* axis: hour ticks on a single day, day names across the 3-day overview */}
      {range === 1 && ticks.map((tk, k) => (
        <g key={`h${k}`}>
          <line x1={xFor(tk.ms, t0, endMs)} y1={axisY} x2={xFor(tk.ms, t0, endMs)} y2={axisY + (tk.label ? 5 : 3)} stroke="#33485a" />
          {tk.label && <text x={xFor(tk.ms, t0, endMs)} y={axisY + 15} className="xtick">{tk.label}</text>}
        </g>
      ))}
      {range > 1 && bands.segs.map((s, k) => (
        <text key={`dl${k}`} x={xFor(s.mid, t0, endMs)} y={axisY + 13} className="xtick">{k === 0 ? "nu" : s.label}</text>
      ))}
    </svg>
  );
}
