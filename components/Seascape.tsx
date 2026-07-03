"use client";
import type { CorrectedPoint, TideData, WeatherSeries } from "@/lib/types";
import { localHM, localWeekdayShort, localHourDecimal } from "@/lib/tz";
import { compass } from "@/lib/format";
import { sailBand } from "@/lib/sailing";
import { smoothPath, hourTicks, dayBands } from "@/lib/chartaxis";
import { sunEvents, isNight } from "@/lib/weather";
import { currentAt, type StroomPoint } from "@/lib/stroom";
import { useElementSize } from "./useElementSize";

// The "doorsnede van de dag": lucht boven de horizon, zee eronder — one shared
// time axis. Sky = paper→sky gradient + a smooth dusk gradient over the night
// hours, with wind (bezier) / gusts (dashed) / spread (mist) / pressure (dotted,
// no axis). Horizon = vaarbaarheidslint. Sea = the tide as a filled water body
// (depth gradient), white surface line, astro ghost line, white NAP-0 + HW/LW.
// mode: "full" (desktop, both) | "sky" | "sea" (mobile, split). Keeps the live
// features: shared hover, stroom vloed/eb vanes, and the beyond-72h veil.
const ms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));
const msT = (iso: string) => Date.parse(iso);
const rad = (d: number) => (d * Math.PI) / 180;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

type Mode = "full" | "sky" | "sea";

export default function Seascape(
  { points, weather, tide, stream, t0, endMs, range, hoverMs, onHover, mode }:
  { points: CorrectedPoint[]; weather?: WeatherSeries; tide?: TideData | null;
    stream?: StroomPoint | null; t0: number; endMs: number; range: number;
    hoverMs: number | null; onHover: (ms: number | null) => void; mode: Mode },
) {
  const [boxRef, W, H] = useElementSize<HTMLDivElement>();
  const pts = points.filter((p) => { const m = ms(p.time); return m >= t0 - 1 && m <= endMs + 1000; });
  const withinT = (iso: string) => { const m = msT(iso); return m >= t0 - 1 && m <= endMs + 1000; };
  const exp = tide ? tide.expected.filter((p) => withinT(p.t)) : [];
  const ast = tide ? tide.astro.filter((p) => withinT(p.t)) : [];
  const ext = tide ? tide.extremes.filter((e) => withinT(e.t)) : [];
  const hasTide = exp.length > 0 || ast.length > 0;
  if (!pts.length || W < 50 || H < 80) return <div className="chartbox" ref={boxRef} />;
  const n = pts.length;
  const uid = mode;

  // ── layout per mode ──
  const L = 2, R = 2, iw = W - L - R;
  const axisH = mode === "full" ? 34 : 32;
  const T = mode === "full" ? 8 : 6;
  const showSky = mode !== "sea";
  const showSea = mode === "sea" || (mode === "full" && hasTide);
  const inner = H - T - axisH;
  const skyH = mode === "sea" ? 0
    : mode === "sky" ? inner
    : showSea ? Math.round(inner * 0.60) : inner;      // full: 60/40, or all if no tide
  const horY = T + skyH;
  const seaT = mode === "sea" ? T : horY;
  const seaH = mode === "sea" ? inner : showSea ? H - axisH - seaT : 0;
  const spanTop = showSky ? T : seaT;
  const spanBottom = showSea ? seaT + seaH : horY;
  const axisY = H - (mode === "full" ? 8 : 6);

  const X = (m: number) => L + ((m - t0) / (endMs - t0)) * iw;
  const xp = (p: CorrectedPoint) => X(ms(p.time));
  const xt = (iso: string) => X(msT(iso));
  const frac = (m: number) => clamp((X(m) - L) / iw, 0, 1);

  const ticks = hourTicks(t0, endMs, range);
  const bands = dayBands(t0, endMs);
  const multi = range > 1;
  const sunEv = weather ? sunEvents(weather.sunrise, weather.sunset) : [];

  // ── sky scales ──
  const ymax = Math.max(40, Math.ceil(Math.max(...pts.map((p) => Math.max(p.gust_kn || 0, p.band_high_kn))) / 10) * 10);
  const Y = (v: number) => T + skyH * (1 - v / ymax);
  const yvals: number[] = [];
  for (let v = 10; v <= ymax; v += 10) yvals.push(v);

  // pressure: subtle trend on a fixed 14-hPa window centred on the mean (no axis)
  const pv = weather
    ? weather.pressure.map((h, i) => ({ m: ms(weather.time[i]), h }))
        .filter((d) => d.h != null && d.m >= t0 - 1 && d.m <= endMs + 1000) as { m: number; h: number }[]
    : [];
  let pressPath = "";
  if (pv.length > 1) {
    const mean = pv.reduce((s, d) => s + d.h, 0) / pv.length, pmin = mean - 7, pmax = mean + 7;
    const YP = (v: number) => T + skyH * (1 - (clamp(v, pmin, pmax) - pmin) / (pmax - pmin));
    pressPath = smoothPath(pv.map((d) => [X(d.m), YP(d.h)]));
  }

  const speedPath = smoothPath(pts.map((p) => [xp(p), Y(p.speed_kn)]));
  const gustPath = smoothPath(pts.map((p) => [xp(p), Y(p.gust_kn)]));
  const mistPath = smoothPath(pts.map((p) => [xp(p), Y(p.band_high_kn)]))
    + pts.slice().reverse().map((p) => `L${xp(p).toFixed(1)},${Y(p.band_low_kn).toFixed(1)}`).join("") + "Z";

  // dusk gradient stops from the sun events inside the window
  const DAY = 0.08, NIGHT = 0.26;
  const duskStops: [number, number][] = [];
  if (sunEv.length && showSky) {
    const raw: [number, number][] = [[0, isNight(t0, sunEv) ? NIGHT : DAY]];
    for (const e of sunEv) {
      if (e.ms <= t0 || e.ms >= endMs) continue;
      const fe = frac(e.ms);
      if (e.rise) raw.push([Math.max(0, fe - 0.03), NIGHT], [fe + 0.02, 0.03], [Math.min(1, fe + 0.08), DAY]);
      else raw.push([Math.max(0, fe - 0.03), DAY], [fe + 0.03, 0.16], [Math.min(1, fe + 0.09), NIGHT]);
    }
    raw.push([1, isNight(endMs, sunEv) ? NIGHT : DAY]);
    raw.sort((a, b) => a[0] - b[0]);
    let last = -1;
    for (const [o, op] of raw) { const off = Math.max(last + 1e-4, Math.min(1, o)); duskStops.push([off, op]); last = off; }
  }

  // wind arrows in the sky
  const arrowStep = mode === "sky" ? 6 : Math.max(1, Math.round(n / 8));
  const arrows = showSky ? pts.filter((_, i) => i % arrowStep === 0).map((p) => {
    const cx = xp(p), cy = T + 20, a = rad(p.dir_deg + 90), dx = Math.cos(a) * 9, dy = Math.sin(a) * 9;
    return { cx, cy, dx, dy, a, beyond: p.beyond };
  }) : [];

  // ── vaarbaarheidslint segments (green / amber) ──
  type Seg = { a: number; b: number; ok: boolean; label: string };
  const segs: Seg[] = [];
  for (const p of pts) {
    const m = ms(p.time), sb = sailBand(p.gust_kn), ok = sb.cls === "ok";
    const prev = segs[segs.length - 1];
    if (prev && prev.ok === ok) prev.b = m; else segs.push({ a: m, b: m, ok, label: sb.label });
  }
  if (segs.length) { segs[0].a = t0; segs[segs.length - 1].b = endMs; }
  for (let i = 0; i < segs.length - 1; i++) segs[i].b = segs[i + 1].a;

  // ── sea scales ──
  let YT = (_v: number) => seaT + seaH / 2;
  const seaGrid: number[] = [];
  if (showSea && hasTide) {
    const ys = [...exp, ...ast].map((p) => p.v);
    let tmin = Math.min(0, ...ys), tmax = Math.max(0, ...ys);
    const pad = Math.max(10, (tmax - tmin) * 0.14); tmin -= pad; tmax += pad;
    YT = (v: number) => seaT + seaH * (1 - (v - tmin) / (tmax - tmin));
    for (const v of [-100, 0, 100]) if (v >= tmin + 4 && v <= tmax - 4) seaGrid.push(v);
  }
  const top = exp.length ? exp.map((p) => [xt(p.t), YT(p.v)] as [number, number]) : [];
  const astroPts = ast.map((p) => [xt(p.t), YT(p.v)] as [number, number]);
  const waterFill = top.length
    ? smoothPath(top) + `L${(L + iw).toFixed(1)},${(seaT + seaH).toFixed(1)}L${L},${(seaT + seaH).toFixed(1)}Z` : "";

  // stroom (vloed/eb) — neutral white arrows just under the horizon; dot at slack
  const stroomVanes = showSea && stream
    ? Array.from({ length: 8 }, (_, i) => {
        const m = t0 + ((endMs - t0) * (i + 0.5)) / 8, c = currentAt(stream, localHourDecimal(m));
        return { x: X(m), toward: c.deg, slack: c.speed < 0.15 };
      })
    : [];

  // ── now-line + beyond-72h veil ──
  const nowMs = ms(pts[0].time);
  const showNow = nowMs >= t0 && nowMs <= endMs + 1000;
  const firstBeyond = pts.find((p) => p.beyond);
  const horizonMs = firstBeyond ? ms(firstBeyond.time) : null;
  const showBeyond = horizonMs != null && horizonMs > t0 && horizonMs < endMs;
  const gapX = showBeyond ? X(horizonMs!) : 0;

  // ── shared hover ──
  const showHover = hoverMs != null && hoverMs >= t0 && hoverMs <= endMs;
  const hx = showHover ? X(hoverMs!) : 0;
  let hp: CorrectedPoint | null = null;
  if (showHover) { let best = Infinity; for (const p of pts) { const d = Math.abs(ms(p.time) - hoverMs!); if (d < best) { best = d; hp = p; } } }
  let hLevel: number | null = null;
  if (showHover && hasTide) {
    const s = exp.length ? exp : ast;
    hLevel = s[0].v;
    for (let i = 1; i < s.length; i++) {
      const a = msT(s[i - 1].t), b = msT(s[i].t);
      if (hoverMs! >= a && hoverMs! <= b) { const f = (hoverMs! - a) / Math.max(1, b - a); hLevel = s[i - 1].v + f * (s[i].v - s[i - 1].v); break; }
      hLevel = s[i].v;
    }
  }
  // keep a centred label fully inside the plane: clamp its centre by the label's
  // estimated half-width so it can never spill past either viewBox edge
  const fit = (cx: number, text: string, charW = 7.4, pad = 5) => {
    const hw = Math.min((iw - 2 * pad) / 2, (text.length * charW) / 2);
    return clamp(cx, L + pad + hw, L + iw - pad - hw);
  };
  const tipPct = Math.max(11, Math.min(89, (hx / W) * 100));
  const HOUR = 3_600_000;
  const onMove = (e: { clientX: number; currentTarget: Element }) => {
    const r = e.currentTarget.getBoundingClientRect();
    const raw = t0 + ((e.clientX - r.left) / Math.max(1, r.width)) * (endMs - t0);
    onHover(clamp(Math.round(raw / HOUR) * HOUR, t0, endMs));
  };
  const clear = () => onHover(null);

  return (
    <div className="chartbox" ref={boxRef} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={clear} onPointerCancel={clear}>
    <svg viewBox={`0 0 ${W} ${H}`} className="seascape" role="img" aria-label="doorsnede wind en getij">
      <defs>
        <linearGradient id={`sky-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--paper)" /><stop offset="0.42" stopColor="var(--sky-hi)" /><stop offset="1" stopColor="var(--sky-lo)" />
        </linearGradient>
        <linearGradient id={`dusk-${uid}`} x1="0" y1="0" x2="1" y2="0">
          {duskStops.map(([o, op], k) => <stop key={k} offset={o} stopColor="var(--dusk)" stopOpacity={op} />)}
        </linearGradient>
        <linearGradient id={`water-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--sea-1)" /><stop offset="0.45" stopColor="var(--sea-2)" /><stop offset="1" stopColor="var(--sea-3)" />
        </linearGradient>
      </defs>

      {/* ── sky ── */}
      {showSky && <rect x={L} y={T} width={iw} height={skyH} fill={`url(#sky-${uid})`} />}
      {showSky && duskStops.length > 0 && <rect x={L} y={T} width={iw} height={skyH} fill={`url(#dusk-${uid})`} />}
      {showSky && ticks.map((tk, k) => (
        <line key={`sl${k}`} x1={X(tk.ms)} y1={T} x2={X(tk.ms)} y2={T + skyH} stroke="var(--ink)" strokeOpacity={0.05} />
      ))}
      {showSky && yvals.map((v, k) => (
        <g key={`yv${k}`}>
          <line x1={L} y1={Y(v)} x2={L + iw} y2={Y(v)} stroke="var(--ink)" strokeOpacity={0.05} />
          {v < ymax && <text x={L + 8} y={Y(v) - 5} className="sty" fill="var(--ink-3)">{v}</text>}
        </g>
      ))}
      {showSky && !multi && sunEv.filter((e) => e.ms > t0 && e.ms < endMs).map((e, k) => (
        <text key={`su${k}`} x={X(e.ms) + (e.rise ? 0 : 4)} y={T + Math.min(skyH - 12, Math.round(skyH * 0.68))}
              className="sty" fill="var(--ink-2)" textAnchor={e.rise ? "middle" : "start"}>
          {(e.rise ? "☀ " : "☾ ") + localHM(e.ms)}
        </text>
      ))}
      {showSky && <path d={mistPath} fill="var(--spread)" opacity={0.08} />}
      {showSky && pressPath && <path d={pressPath} fill="none" stroke="var(--pressure)" strokeWidth={2} strokeDasharray="1.5 5" strokeLinecap="round" />}
      {showSky && <path d={gustPath} fill="none" stroke="var(--gust)" strokeWidth={2} strokeDasharray="7 5" />}
      {showSky && <path d={speedPath} fill="none" stroke="var(--wind)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />}
      {arrows.map((ar, k) => (
        <g key={`ar${k}`} stroke="var(--ink-2)" strokeWidth={2} strokeLinecap="round" opacity={ar.beyond ? 0.4 : 0.85}>
          <line x1={ar.cx - ar.dx} y1={ar.cy - ar.dy} x2={ar.cx + ar.dx} y2={ar.cy + ar.dy} />
          <line x1={ar.cx + ar.dx} y1={ar.cy + ar.dy} x2={ar.cx + ar.dx - Math.cos(ar.a - 0.5) * 7} y2={ar.cy + ar.dy - Math.sin(ar.a - 0.5) * 7} />
          <line x1={ar.cx + ar.dx} y1={ar.cy + ar.dy} x2={ar.cx + ar.dx - Math.cos(ar.a + 0.5) * 7} y2={ar.cy + ar.dy - Math.sin(ar.a + 0.5) * 7} />
        </g>
      ))}

      {/* ── horizon: vaarbaarheidslint (labels only in full/desktop) ── */}
      {showSky && segs.map((s, k) => {
        const sx = X(s.a), sw = Math.max(0, X(s.b) - X(s.a)), col = s.ok ? "var(--green)" : "var(--amber)";
        return (
          <g key={`seg${k}`}>
            <line x1={sx} y1={horY} x2={sx + sw} y2={horY} stroke={col} strokeWidth={5} />
            {mode === "full" && sw > 90 && (
              <text x={fit(sx + sw / 2, s.label, 8.2)} y={horY - 9} className="stlint" fill={col} textAnchor="middle">{s.label}</text>
            )}
          </g>
        );
      })}

      {/* ── sea ── */}
      {showSea && <rect x={L} y={seaT} width={iw} height={seaH} fill="var(--sea-3)" opacity={0.05} />}
      {showSea && ticks.map((tk, k) => (
        <line key={`sel${k}`} x1={X(tk.ms)} y1={seaT} x2={X(tk.ms)} y2={seaT + seaH} stroke="var(--ink)" strokeOpacity={0.05} />
      ))}
      {waterFill && <path d={waterFill} fill={`url(#water-${uid})`} />}
      {top.length > 0 && <path d={smoothPath(top)} fill="none" stroke="#fff" strokeWidth={1.6} opacity={0.9} />}
      {astroPts.length > 0 && <path d={smoothPath(astroPts)} fill="none" stroke="#fff" strokeWidth={1.4} strokeDasharray="4 5" opacity={0.55} />}
      {showSea && hasTide && (
        <g>
          <line x1={L} y1={YT(0)} x2={L + iw} y2={YT(0)} stroke="#fff" strokeWidth={1} strokeDasharray="2 5" opacity={0.5} />
          <text x={L + 8} y={YT(0) - 5} className="sty" fill="#fff" opacity={0.85}>0</text>
          {seaGrid.filter((v) => v !== 0).map((v, k) => (
            <text key={`sg${k}`} x={L + 8} y={YT(v) - 5} className="sty" fill="#fff" opacity={0.6}>{v > 0 ? `+${v}` : v}</text>
          ))}
        </g>
      )}
      {stroomVanes.map((v, k) => (v.slack ? (
        <circle key={`sv${k}`} cx={v.x} cy={seaT + 12} r={2} fill="#fff" opacity={0.8} />
      ) : (
        <g key={`sv${k}`} transform={`translate(${v.x},${seaT + 12}) rotate(${v.toward.toFixed(0)})`} opacity={0.85}>
          <path d="M0 6 L0 -6 M-3 -2 L0 -6 L3 -2" fill="none" stroke="#fff" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )))}
      {showSea && range === 1 && ext.map((e, k) => {
        const cx = xt(e.t), cy = YT(e.v), lab = `${e.kind} ${localHM(msT(e.t))}`;
        return (
          <g key={`ex${k}`}>
            <circle cx={cx} cy={cy} r={4} fill="#fff" stroke="var(--sea-3)" strokeWidth={2} />
            <text x={fit(cx, lab, 8.2)} y={cy - 12} className="stext" fill={e.v > 0 ? "var(--ink)" : "#fff"} textAnchor="middle">{lab}</text>
          </g>
        );
      })}

      {/* ── x-axis ── */}
      {!multi && ticks.filter((tk) => tk.label).map((tk, k) => {
        const fx = (X(tk.ms) - L) / iw, anchor = fx < 0.03 ? "start" : fx > 0.97 ? "end" : "middle";
        return <text key={`xa${k}`} x={X(tk.ms)} y={axisY} className="stx" textAnchor={anchor as "start" | "middle" | "end"}>{tk.label}</text>;
      })}
      {multi && bands.segs.map((s, k) => (
        <text key={`db${k}`} x={X(s.mid)} y={axisY} className="stx" textAnchor="middle">{k === 0 ? "nu" : s.label}</text>
      ))}

      {/* ── beyond-72h veil ── */}
      {showBeyond && (
        <g>
          {showSky && <rect x={gapX} y={T} width={Math.max(0, X(endMs) - gapX)} height={skyH} fill="var(--paper)" opacity={0.5} />}
          {showSea && <rect x={gapX} y={seaT} width={Math.max(0, X(endMs) - gapX)} height={seaH} fill="#fff" opacity={0.14} />}
          <line x1={gapX} y1={spanTop} x2={gapX} y2={spanBottom} stroke="var(--ink-3)" strokeDasharray="2 3" />
        </g>
      )}

      {/* ── now-line ── */}
      {showNow && (
        <g>
          <line x1={X(nowMs) + 1} y1={spanTop} x2={X(nowMs) + 1} y2={spanBottom} stroke="var(--magenta)" strokeWidth={2.5} />
          <text x={X(nowMs) + 9} y={spanTop + 38} className="stnow">nu</text>
        </g>
      )}

      {/* ── hover crosshair ── */}
      {showHover && showSky && <line className="stcross" x1={hx} y1={T} x2={hx} y2={horY} />}
      {showHover && showSea && <line className="stcross sea" x1={hx} y1={seaT} x2={hx} y2={seaT + seaH} />}
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
