"use client";
import type { CorrectedPoint, TideData, WeatherSeries } from "@/lib/types";
import { localHM, localWeekdayShort, localHourDecimal } from "@/lib/tz";
import { compass } from "@/lib/format";
import { dirColor, sailBand } from "@/lib/sailing";
import { hourTicks, dayBands, smoothPath } from "@/lib/chartaxis";
import { sunEvents, isNight } from "@/lib/weather";
import { currentAt, type StroomPoint } from "@/lib/stroom";
import { useElementSize } from "./useElementSize";

// Desktop meteogram: ONE svg on a shared time axis that fills the panel and
// redraws on resize. Wind on top (speed / dashed gust / spread band / dotted
// pressure on its own right axis), the vaarbaarheidsband in the middle, and the
// tide below (expected + astro, HW/LW labels, stroom vanes). Night shading and the
// magenta now-line run through both. Wind/tide split ≈ 56/44. Keeps the live
// features from the mobile charts: shared hover, sun markers, the beyond-72h veil
// and the stroom (vloed/eb) vanes.
const ms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));
const msT = (iso: string) => Date.parse(iso);          // tide isos already carry Z
const HOUR = 3_600_000;
const rad = (d: number) => (d * Math.PI) / 180;
const vpt = (cx: number, cy: number, r: number, deg: number) =>
  [cx + r * Math.sin(rad(deg)), cy - r * Math.cos(rad(deg))] as const;
const PMIN = 1014, PMAX = 1028;                         // fixed pressure axis (hPa)
const bandCol = { ok: "var(--good)", krap: "var(--amber)", storm: "var(--danger)" } as const;

function levelAt(series: { t: string; v: number }[], m: number): number {
  if (!series.length) return 0;
  if (m <= msT(series[0].t)) return series[0].v;
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1], b = series[i], ta = msT(a.t), tb = msT(b.t);
    if (m >= ta && m <= tb) { const f = (m - ta) / Math.max(1, tb - ta); return a.v + f * (b.v - a.v); }
  }
  return series[series.length - 1].v;
}

export default function Meteogram(
  { points, weather, tide, stream, t0, endMs, range, hoverMs, onHover }:
  { points: CorrectedPoint[]; weather?: WeatherSeries; tide?: TideData | null;
    stream?: StroomPoint | null; t0: number; endMs: number; range: number;
    hoverMs: number | null; onHover: (ms: number | null) => void },
) {
  const [boxRef, W, H] = useElementSize<HTMLDivElement>();
  const pts = points.filter((p) => { const m = ms(p.time); return m >= t0 - 1 && m <= endMs + 1000; });
  if (!pts.length || W < 60 || H < 120) return <div className="chartbox" ref={boxRef} />;
  const n = pts.length;
  const multi = range > 1;

  // tide series inside the window (land stations / future gaps have none → the
  // wind block then fills the full height)
  const withinT = (iso: string) => { const m = msT(iso); return m >= t0 - 1 && m <= endMs + 1000; };
  const exp = tide ? tide.expected.filter((p) => withinT(p.t)) : [];
  const ast = tide ? tide.astro.filter((p) => withinT(p.t)) : [];
  const ext = tide ? tide.extremes.filter((e) => withinT(e.t)) : [];
  const hasTide = exp.length > 0 || ast.length > 0;
  const hasStream = !!stream;

  // vertical layout — wind / band / tide, filling the measured height
  const L = 48, R = 58, T = 40, xaxisH = 28, bandH = 13, gap = 16;
  const inner = H - T - xaxisH;
  const windH = hasTide
    ? Math.max(70, Math.round((inner - bandH - 2 * gap) * 0.56))
    : inner - bandH - gap;
  const bandY = T + windH + gap;
  const tideT = bandY + bandH + gap + (hasStream ? 16 : 2);
  const tideBottom = H - xaxisH;
  const tideH = Math.max(46, tideBottom - tideT);
  const plotBottom = hasTide ? tideT + tideH : bandY + bandH;
  const axisY = plotBottom + 6;
  const iw = W - L - R;
  const X = (m: number) => L + ((m - t0) / (endMs - t0)) * iw;

  // wind y-scale (kn) + fixed pressure axis
  const maxY = Math.max(10, ...pts.map((p) => Math.max(p.gust_kn || 0, p.band_high_kn))) * 1.1;
  const wy = (v: number) => T + windH - (v / maxY) * windH;
  const pClamp = (v: number) => Math.max(PMIN, Math.min(PMAX, v));
  const py = (v: number) => T + windH - ((pClamp(v) - PMIN) / (PMAX - PMIN)) * windH;
  const x = (p: CorrectedPoint) => X(ms(p.time));

  const speedPath = pts.map((p, i) => `${i ? "L" : "M"}${x(p)},${wy(p.speed_kn)}`).join(" ");
  const gustPath = pts.map((p, i) => `${i ? "L" : "M"}${x(p)},${wy(p.gust_kn)}`).join(" ");
  const bandPath =
    pts.map((p, i) => `${i ? "L" : "M"}${x(p)},${wy(p.band_high_kn)}`).join(" ") + " " +
    pts.slice().reverse().map((p) => `L${x(p)},${wy(p.band_low_kn)}`).join(" ") + " Z";

  const pp = weather
    ? weather.pressure.map((hPa, i) => ({ m: ms(weather.time[i]), hPa }))
        .filter((d) => d.hPa != null && d.m >= t0 - 1 && d.m <= endMs + 1000) as { m: number; hPa: number }[]
    : [];
  const pressPath = pp.length > 1 ? pp.map((d, i) => `${i ? "L" : "M"}${X(d.m)},${py(d.hPa)}`).join(" ") : "";

  const yticks: number[] = [];
  for (let v = 10; v < maxY; v += 10) yticks.push(v);
  const bands = dayBands(t0, endMs);
  const ticks = hourTicks(t0, endMs, range);
  const vaneStep = Math.max(1, Math.round(n / 8));

  // vaarbaarheidsband — merge consecutive same-class hours into contiguous segments
  type Seg = { a: number; b: number; cls: "ok" | "krap" | "storm"; label: string };
  const segs: Seg[] = [];
  for (const p of pts) {
    const m = ms(p.time), { cls, label } = sailBand(p.gust_kn);
    const prev = segs[segs.length - 1];
    if (prev && prev.cls === cls) prev.b = m; else segs.push({ a: m, b: m, cls, label });
  }
  if (segs.length) { segs[0].a = t0; segs[segs.length - 1].b = endMs; }
  for (let i = 0; i < segs.length - 1; i++) segs[i].b = segs[i + 1].a;

  // night shading + moon label (spans both blocks), sun-time markers on a single day
  const sunEv = weather ? sunEvents(weather.sunrise, weather.sunset) : [];
  const nightSegs: [number, number][] = [];
  if (sunEv.length) {
    let cur = t0, night = isNight(t0, sunEv);
    for (const e of sunEv) {
      if (e.ms <= t0 || e.ms >= endMs) continue;
      if (night) nightSegs.push([cur, e.ms]);
      cur = e.ms; night = !e.rise;
    }
    if (night) nightSegs.push([cur, endMs]);
  }
  const sunMarks = sunEv.filter((e) => e.ms > t0 && e.ms < endMs).map((e) => ({ x: X(e.ms), rise: e.rise, ms: e.ms }));

  // beyond the 72h corrected horizon — veil the wind block + divider
  const firstBeyond = pts.find((p) => p.beyond);
  const horizonMs = firstBeyond ? ms(firstBeyond.time) : null;
  const showBeyond = horizonMs != null && horizonMs > t0 && horizonMs < endMs;
  const gapX = showBeyond ? X(horizonMs!) : 0;

  // now-line (only when the live moment falls inside the window)
  const nowMs = ms(pts[0].time);
  const showNow = nowMs >= t0 && nowMs <= endMs + 1000;

  // tide block scaling
  let ty = (_v: number) => tideT + tideH / 2;
  let tgrid: number[] = [];
  if (hasTide) {
    const ys = [...exp, ...ast].map((p) => p.v);
    let tmin = Math.min(...ys), tmax = Math.max(...ys);
    const pad = Math.max(8, (tmax - tmin) * 0.16); tmin -= pad; tmax += pad;
    ty = (v: number) => tideT + ((tmax - v) / (tmax - tmin)) * tideH;
    for (let v = -150; v <= 150; v += 50) if (v >= tmin - 5 && v <= tmax + 5) tgrid.push(v);
  }
  const tx = (iso: string) => X(msT(iso));

  // HW/LW label de-collision (per side)
  const LABEL_GAP = 40;
  const showLabel = new Set<number>();
  let lastHW = -1e9, lastLW = -1e9;
  ext.forEach((e, k) => {
    const cx = tx(e.t);
    if (e.kind === "HW") { if (cx - lastHW >= LABEL_GAP) { showLabel.add(k); lastHW = cx; } }
    else { if (cx - lastLW >= LABEL_GAP) { showLabel.add(k); lastLW = cx; } }
  });

  // stroom vanes (vloed/eb) above the tide plot — neutral phase colours, never hue
  const floodish = (deg: number) => hasStream && Math.abs(((deg - stream!.flood + 540) % 360) - 180) < 1;
  const vanes = hasStream
    ? Array.from({ length: 8 }, (_, i) => {
        const m = t0 + ((endMs - t0) * (i + 0.5)) / 8;
        const c = currentAt(stream!, localHourDecimal(m));
        return { x: X(m), toward: c.deg, speed: c.speed, flood: floodish(c.deg) };
      })
    : [];

  // shared hover: crosshair through both blocks + a combined readout
  const showHover = hoverMs != null && hoverMs >= t0 && hoverMs <= endMs;
  const hx = showHover ? X(hoverMs!) : 0;
  let hp: CorrectedPoint | null = null;
  if (showHover) { let best = Infinity; for (const p of pts) { const d = Math.abs(ms(p.time) - hoverMs!); if (d < best) { best = d; hp = p; } } }
  const hLevel = showHover && hasTide ? levelAt(exp.length ? exp : ast, hoverMs!) : null;
  const tipPct = Math.max(12, Math.min(88, (hx / W) * 100));
  const onMove = (e: { clientX: number; currentTarget: Element }) => {
    const r = e.currentTarget.getBoundingClientRect();
    const raw = t0 + ((e.clientX - r.left) / Math.max(1, r.width)) * (endMs - t0);
    onHover(Math.max(t0, Math.min(endMs, Math.round(raw / HOUR) * HOUR)));
  };
  const clearHover = () => onHover(null);

  return (
    <div className="chartbox" ref={boxRef} onPointerMove={onMove} onPointerDown={onMove}
         onPointerLeave={clearHover} onPointerCancel={clearHover}>
    <svg viewBox={`0 0 ${W} ${H}`} className="meteo" role="img" aria-label="meteogram wind en getij">
      {/* night shading through both blocks + moon label */}
      {nightSegs.map(([a, b], k) => (
        <g key={`ns${k}`}>
          <rect x={X(a)} y={T} width={Math.max(0, X(b) - X(a))} height={plotBottom - T} fill="var(--water)" opacity={0.8} />
          {k === 0 && !multi && (
            <text x={X(a) + 6} y={T + 14} className="mnight">☾ {localHM(a)} – {localHM(b)}</text>
          )}
        </g>
      ))}
      {/* day separators (multi-day) */}
      {multi && bands.bounds.map((b, k) => (
        <line key={`db${k}`} x1={X(b)} y1={T} x2={X(b)} y2={plotBottom} stroke="var(--rule)" />
      ))}

      {/* ── wind block ── */}
      {yticks.map((v, k) => (
        <g key={`wy${k}`}>
          <line x1={L} x2={W - R} y1={wy(v)} y2={wy(v)} className="mgrid" />
          <text x={L - 8} y={wy(v) + 4} className="mytick" textAnchor="end">{v}</text>
        </g>
      ))}
      {[PMIN, (PMIN + PMAX) / 2, PMAX].map((v, k) => (
        <text key={`pr${k}`} x={W - R + 8} y={py(v) + 4} className="mytick" fill="var(--pressure)">{v}</text>
      ))}
      <path d={bandPath} fill="var(--spread)" opacity={0.5} />
      {pressPath && <path d={pressPath} fill="none" stroke="var(--pressure)" strokeWidth={2} strokeDasharray="2 5" strokeLinecap="round" />}
      <path d={gustPath} fill="none" stroke="var(--gust)" strokeWidth={1.6} strokeDasharray="6 5" opacity={0.9} />
      <path d={speedPath} fill="none" stroke="var(--wind)" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
      {/* vanes on top — pointing where the wind comes FROM */}
      {pts.map((p, i) => {
        if (i % vaneStep !== 0) return null;
        const col = dirColor(p.dir_deg), cy = T - 20;
        const [txp, typ] = vpt(x(p), cy, 10, p.dir_deg);
        const [bx, by] = vpt(x(p), cy, 9, p.dir_deg + 180);
        const [l1x, l1y] = vpt(txp, typ, 7, p.dir_deg + 158);
        const [l2x, l2y] = vpt(txp, typ, 7, p.dir_deg - 158);
        return (
          <g key={`v${i}`} opacity={p.beyond ? 0.5 : 1}>
            <line x1={bx} y1={by} x2={txp} y2={typ} stroke={col} strokeWidth={2} strokeLinecap="round" />
            <polygon points={`${txp},${typ} ${l1x},${l1y} ${l2x},${l2y}`} fill={col} />
          </g>
        );
      })}

      {/* ── vaarbaarheidsband ── */}
      {segs.map((s, k) => {
        const sx = X(s.a), sw = Math.max(0, X(s.b) - X(s.a));
        return (
          <g key={`bd${k}`}>
            <rect x={sx} y={bandY} width={sw} height={bandH} rx={3} fill={bandCol[s.cls]} />
            {sw > 64 && <text x={sx + sw / 2} y={bandY + bandH - 3} className="mband" textAnchor="middle">{s.label}</text>}
          </g>
        );
      })}

      {/* ── tide block ── */}
      {tgrid.map((v, k) => (
        <g key={`tg${k}`}>
          <line x1={L} x2={W - R} y1={ty(v)} y2={ty(v)} stroke={v === 0 ? "var(--ink-3)" : "var(--rule)"} strokeDasharray={v === 0 ? "3 4" : undefined} />
          <text x={L - 8} y={ty(v) + 4} className="mytick" textAnchor="end">{v}</text>
        </g>
      ))}
      {vanes.map((v, k) => (v.speed < 0.15 ? (
        <circle key={`sv${k}`} cx={v.x} cy={tideT - 12} r={2} fill="var(--cur)" />
      ) : (
        <g key={`sv${k}`} transform={`translate(${v.x},${tideT - 12}) rotate(${v.toward.toFixed(0)})`}>
          <path d="M0 6 L0 -6 M-3 -2 L0 -6 L3 -2" fill="none" stroke={v.flood ? "var(--flood)" : "var(--ebb)"} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )))}
      {hasTide && <path d={smoothPath(ast.map((p) => [tx(p.t), ty(p.v)]))} fill="none" stroke="var(--tide2)" strokeWidth={1.6} strokeDasharray="5 5" opacity={0.9} />}
      {hasTide && <path d={smoothPath(exp.map((p) => [tx(p.t), ty(p.v)]))} fill="none" stroke="var(--tide)" strokeWidth={2.6} strokeLinecap="round" />}
      {ext.map((e, k) => {
        const cx = tx(e.t), cy = ty(e.v), col = e.kind === "HW" ? "var(--hw)" : "var(--lw)";
        return (
          <g key={`e${k}`}>
            <circle cx={cx} cy={cy} r={3.6} fill={col} />
            {range === 1 && showLabel.has(k) && (
              <text x={cx} y={cy + (e.kind === "HW" ? -9 : 17)} className="mextr" fill="var(--ink)" textAnchor="middle">
                {e.kind} {localHM(msT(e.t))}
              </text>
            )}
          </g>
        );
      })}

      {/* x-axis: hours on a single day, day names on the 3-day overview */}
      {!multi && ticks.map((tk, k) => (
        <g key={`h${k}`}>
          <line x1={X(tk.ms)} y1={axisY} x2={X(tk.ms)} y2={axisY + (tk.label ? 5 : 3)} stroke="var(--ink-3)" />
          {tk.label && <text x={X(tk.ms)} y={axisY + 15} className="mxtick">{tk.label}</text>}
        </g>
      ))}
      {multi && bands.segs.map((s, k) => (
        <text key={`dl${k}`} x={X(s.mid)} y={axisY + 13} className="mxtick">{k === 0 ? "nu" : s.label}</text>
      ))}

      {/* sun-time markers on a single day */}
      {!multi && sunMarks.map((s, k) => (
        <line key={`sm${k}`} x1={s.x} y1={T} x2={s.x} y2={plotBottom} stroke="var(--amber)" strokeWidth={1} strokeDasharray="2 3" opacity={0.35} />
      ))}

      {/* beyond-72h veil + divider over the wind block */}
      {showBeyond && (
        <g>
          <rect x={gapX} y={T - 24} width={Math.max(0, X(endMs) - gapX)} height={windH + 24} fill="var(--paper)" opacity={0.5} />
          <line x1={gapX} y1={T - 24} x2={gapX} y2={plotBottom} stroke="var(--ink-3)" strokeDasharray="2 3" />
        </g>
      )}

      {/* now-line through both blocks */}
      {showNow && (
        <g>
          <line x1={X(nowMs)} y1={T - 24} x2={X(nowMs)} y2={plotBottom} stroke="var(--magenta)" strokeWidth={2} />
          <text x={X(nowMs) + 3} y={T - 26} className="mnow">nu</text>
        </g>
      )}
      {showHover && <line className="mcross" x1={hx} y1={T - 24} x2={hx} y2={plotBottom} />}
    </svg>
    {showHover && hp && (
      <div className="tip" style={{ left: `${tipPct}%` }}>
        <span className="tt">{localWeekdayShort(hoverMs!)} {localHM(hoverMs!)}</span>
        <b>{hp.speed_kn} kn · {compass(hp.dir_deg)} {hp.dir_deg}°</b>
        <b>vlaag {Math.round(hp.gust_kn)} kn</b>
        {hLevel != null && <b>getij {Math.round(hLevel)} cm</b>}
      </div>
    )}
    </div>
  );
}
