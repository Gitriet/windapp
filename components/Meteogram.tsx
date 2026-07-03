"use client";
import type { CorrectedPoint, TideData, WeatherSeries } from "@/lib/types";
import { localHM, localWeekdayShort, localHourDecimal } from "@/lib/tz";
import { compass } from "@/lib/format";
import { sailBand } from "@/lib/sailing";
import { smoothPath, hourTicks, dayBands } from "@/lib/chartaxis";
import { sunEvents } from "@/lib/weather";
import { currentAt, type StroomPoint } from "@/lib/stroom";

// Meteogram (redesign, docs/redesign-prototype.html) rendered against the real
// data layer. One shared renderView(layout) draws two fixed-viewBox SVGs — a wide
// desktop one and a ~1:1 mobile one — toggled by CSS at 900px. Stacked bands on a
// shared time axis: wind (spread area + wind line + dashed gusts + dotted pressure
// on its own scale) up top, the vaarbaarheids-as as a coloured spine in the
// middle, the tide as a filled body below. Now-marker + sun events + shared hover.
const ms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));
const msT = (iso: string) => Date.parse(iso);
const rad = (d: number) => (d * Math.PI) / 180;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// vaarbaarheid: sailBand's three classes -> spine colour + label
const NAVCOL = { go: "var(--green)", tight: "var(--amber)", no: "var(--no)" } as const;
const NAVFULL = { go: "Vaarbaar", tight: "Krap · vlagen > 25 kn", no: "Niet vaarbaar" } as const;
const NAVSHORT = { go: "Vaarbaar", tight: "Krap", no: "Niet" } as const;
type Nav = keyof typeof NAVCOL;
const navOf = (gust: number): Nav => { const c = sailBand(gust).cls; return c === "ok" ? "go" : c === "krap" ? "tight" : "no"; };

type Layout = {
  id: string; w: number; h: number; padl: number; padr: number;
  windTop: number; windBot: number; navY: number; tideTop: number; tideBot: number;
  axisY: number; arrowGap: number; arrowN: number; compact: boolean;
};

const DESK: Layout = { id: "d", w: 1200, h: 470, padl: 46, padr: 18, windTop: 64, windBot: 210, navY: 246, tideTop: 280, tideBot: 422, axisY: 452, arrowGap: 30, arrowN: 8, compact: false };
const MOB: Layout = { id: "m", w: 400, h: 560, padl: 32, padr: 14, windTop: 56, windBot: 230, navY: 270, tideTop: 308, tideBot: 508, axisY: 540, arrowGap: 26, arrowN: 4, compact: true };

export default function Meteogram(
  { points, weather, tide, stream, t0, endMs, range, hoverMs, onHover }:
  { points: CorrectedPoint[]; weather?: WeatherSeries; tide?: TideData | null;
    stream?: StroomPoint | null; t0: number; endMs: number; range: number;
    hoverMs: number | null; onHover: (ms: number | null) => void },
) {
  const pts = points.filter((p) => { const m = ms(p.time); return m >= t0 - 1 && m <= endMs + 1000; });
  const withinT = (iso: string) => { const m = msT(iso); return m >= t0 - 1 && m <= endMs + 1000; };
  const exp = tide ? tide.expected.filter((p) => withinT(p.t)) : [];
  const ast = tide ? tide.astro.filter((p) => withinT(p.t)) : [];
  const ext = tide ? tide.extremes.filter((e) => withinT(e.t)) : [];
  const hasTide = exp.length > 0 || ast.length > 0;
  if (!pts.length) return null;
  const n = pts.length;

  // ── shared scales (layout-independent) ──
  const ymax = Math.max(30, Math.ceil(Math.max(...pts.map((p) => Math.max(p.gust_kn || 0, p.band_high_kn))) / 10) * 10);
  const yvals: number[] = []; for (let v = 0; v <= ymax; v += 10) yvals.push(v);

  const pv = weather
    ? weather.pressure.map((h, i) => ({ m: ms(weather.time[i]), h }))
        .filter((d) => d.h != null && d.m >= t0 - 1 && d.m <= endMs + 1000) as { m: number; h: number }[]
    : [];
  const pmean = pv.length ? pv.reduce((s, d) => s + d.h, 0) / pv.length : 1015;
  const pmin = pmean - 7, pmax = pmean + 7;

  const sunEv = (weather && range === 1 ? sunEvents(weather.sunrise, weather.sunset) : [])
    .filter((e) => e.ms > t0 && e.ms < endMs);

  // vaarbaarheids-segmenten (merge consecutive equal classes, span the full window)
  type Seg = { a: number; b: number; nav: Nav };
  const segs: Seg[] = [];
  for (const p of pts) {
    const m = ms(p.time), nv = navOf(p.gust_kn), prev = segs[segs.length - 1];
    if (prev && prev.nav === nv) prev.b = m; else segs.push({ a: m, b: m, nav: nv });
  }
  if (segs.length) { segs[0].a = t0; segs[segs.length - 1].b = endMs; for (let i = 0; i < segs.length - 1; i++) segs[i].b = segs[i + 1].a; }

  const nowMs = ms(pts[0].time);
  const firstBeyond = pts.find((p) => p.beyond);
  const horizonMs = firstBeyond ? ms(firstBeyond.time) : null;
  const showBeyond = horizonMs != null && horizonMs > t0 && horizonMs < endMs;

  const ticks = hourTicks(t0, endMs, range);
  const bands = dayBands(t0, endMs);
  const multi = range > 1;

  // hover → nearest point + interpolated tide level (shared across both views)
  const showHover = hoverMs != null && hoverMs >= t0 && hoverMs <= endMs;
  let hp: CorrectedPoint | null = null;
  if (showHover) { let best = Infinity; for (const p of pts) { const d = Math.abs(ms(p.time) - hoverMs!); if (d < best) { best = d; hp = p; } } }
  let hLevel: number | null = null;
  if (showHover && hasTide) {
    const s = exp.length ? exp : ast; hLevel = s[0].v;
    for (let i = 1; i < s.length; i++) {
      const a = msT(s[i - 1].t), b = msT(s[i].t);
      if (hoverMs! >= a && hoverMs! <= b) { const f = (hoverMs! - a) / Math.max(1, b - a); hLevel = s[i - 1].v + f * (s[i].v - s[i - 1].v); break; }
      hLevel = s[i].v;
    }
  }
  const hoverFrac = showHover ? clamp((hoverMs! - t0) / (endMs - t0), 0, 1) : 0;

  // ── the shared draw function: one layout → the full SVG contents ──
  function renderView(o: Layout) {
    const iw = o.w - o.padl - o.padr;
    const X = (m: number) => o.padl + ((m - t0) / (endMs - t0)) * iw;
    const xp = (p: CorrectedPoint) => X(ms(p.time));
    const xt = (iso: string) => X(msT(iso));
    const showSea = hasTide;
    const windBot = showSea ? o.windBot : o.axisY - 46;
    const navY = showSea ? o.navY : o.axisY - 22;
    const WY = (kn: number) => o.windTop + (windBot - o.windTop) * (1 - kn / ymax);
    const PY = (v: number) => o.windTop + (windBot - o.windTop) * (1 - ((clamp(v, pmin, pmax) - pmin) / (pmax - pmin)) * 0.55 - 0.05);

    // sea scale
    let YT = (_v: number) => o.tideTop; const seaGrid: number[] = [];
    if (showSea) {
      const ys = [...exp, ...ast].map((p) => p.v);
      let tmin = Math.min(0, ...ys), tmax = Math.max(0, ...ys);
      const pad = Math.max(10, (tmax - tmin) * 0.14); tmin -= pad; tmax += pad;
      YT = (v: number) => o.tideTop + (o.tideBot - o.tideTop) * (1 - (v - tmin) / (tmax - tmin));
      for (const v of [-100, 0, 100]) if (v >= tmin + 6 && v <= tmax - 6) seaGrid.push(v);
    }

    const spreadPath = smoothPath(pts.map((p) => [xp(p), WY(p.band_high_kn)]))
      + pts.slice().reverse().map((p) => `L${xp(p).toFixed(1)},${WY(p.band_low_kn).toFixed(1)}`).join("") + "Z";
    const pressPath = pv.length > 1 ? smoothPath(pv.map((d) => [X(d.m), PY(d.h)])) : "";
    const gustPath = smoothPath(pts.map((p) => [xp(p), WY(p.gust_kn)]));
    const windPath = smoothPath(pts.map((p) => [xp(p), WY(p.speed_kn)]));

    // direction arrows above the wind band, skipping the now column
    const step = Math.max(1, Math.round(n / o.arrowN));
    const arrows = pts.filter((_, i) => i % step === 0)
      .filter((p) => Math.abs(ms(p.time) - nowMs) > (endMs - t0) / (2 * o.arrowN))
      .map((p) => { const cx = xp(p), cy = o.windTop - o.arrowGap, a = rad(p.dir_deg + 90); return { cx, cy, dx: Math.cos(a) * 9, dy: Math.sin(a) * 9, a, beyond: p.beyond }; });

    // tide body + stroom vanes
    const top = exp.length ? exp.map((p) => [xt(p.t), YT(p.v)] as [number, number]) : [];
    const astroPts = ast.map((p) => [xt(p.t), YT(p.v)] as [number, number]);
    const waterFill = top.length ? smoothPath(top) + `L${X(endMs).toFixed(1)},${o.tideBot}L${X(t0).toFixed(1)},${o.tideBot}Z` : "";
    const vanes = showSea && stream
      ? Array.from({ length: o.compact ? 5 : 8 }, (_, i) => {
          const m = t0 + ((endMs - t0) * (i + 0.5)) / (o.compact ? 5 : 8), c = currentAt(stream, localHourDecimal(m));
          return { x: X(m), toward: c.deg, slack: c.speed < 0.15 };
        })
      : [];

    // clamp a centred label so it can't spill past the plot edges
    const fit = (cx: number, text: string, charW = 7.2, pad = 4) => {
      const hw = Math.min((iw - 2 * pad) / 2, (text.length * charW) / 2);
      return clamp(cx, o.padl + pad + hw, o.padl + iw - pad - hw);
    };
    const showNow = nowMs >= t0 && nowMs <= endMs + 1000;
    const gapX = showBeyond ? X(horizonMs!) : 0;

    return (
      <>
        <defs>
          <linearGradient id={`tide-${o.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--sea-1)" /><stop offset="0.45" stopColor="var(--sea-2)" /><stop offset="1" stopColor="var(--sea-3)" />
          </linearGradient>
        </defs>

        {/* ── wind grid + y-axis (kn) ── */}
        {yvals.map((v) => (
          <g key={`y${v}`}>
            <line className="mg-grid" x1={o.padl} y1={WY(v)} x2={o.w - o.padr} y2={WY(v)} opacity={v === 0 ? 1 : 0.55} />
            <text className="mg-axnum" textAnchor="end" x={o.padl - 8} y={WY(v) + 3.5}>{v}</text>
          </g>
        ))}

        {/* ── wind band ── */}
        <path d={spreadPath} className="mg-spread" />
        {pressPath && <path d={pressPath} className="mg-pres" />}
        <path d={gustPath} className="mg-gust" />
        <path d={windPath} className="mg-wind" />
        {arrows.map((ar, k) => (
          <g key={`ar${k}`} className="mg-arrow" opacity={ar.beyond ? 0.4 : 0.9}>
            <line x1={ar.cx - ar.dx} y1={ar.cy - ar.dy} x2={ar.cx + ar.dx} y2={ar.cy + ar.dy} />
            <line x1={ar.cx + ar.dx} y1={ar.cy + ar.dy} x2={ar.cx + ar.dx - Math.cos(ar.a - 0.5) * 6} y2={ar.cy + ar.dy - Math.sin(ar.a - 0.5) * 6} />
            <line x1={ar.cx + ar.dx} y1={ar.cy + ar.dy} x2={ar.cx + ar.dx - Math.cos(ar.a + 0.5) * 6} y2={ar.cy + ar.dy - Math.sin(ar.a + 0.5) * 6} />
          </g>
        ))}

        {/* ── vaarbaarheids-as (ruggengraat) ── */}
        {segs.map((s, k) => {
          const sx = X(s.a), sw = Math.max(0, X(s.b) - X(s.a)), col = NAVCOL[s.nav];
          const label = (o.compact ? NAVSHORT : NAVFULL)[s.nav];
          return (
            <g key={`nv${k}`}>
              <line x1={sx} y1={navY} x2={sx + sw} y2={navY} stroke={col} strokeWidth={o.compact ? 4 : 5} strokeLinecap="butt" />
              {sw > (o.compact ? 34 : 64) && <text className="mg-navlbl" textAnchor="middle" x={fit(sx + sw / 2, label, o.compact ? 6.4 : 7.4)} y={navY - 9} fill={col}>{label}</text>}
            </g>
          );
        })}

        {/* ── tide body ── */}
        {showSea && (
          <>
            {waterFill && <path d={waterFill} fill={`url(#tide-${o.id})`} />}
            {top.length > 0 && <path d={smoothPath(top)} className="mg-tideline" />}
            {astroPts.length > 0 && <path d={smoothPath(astroPts)} className="mg-tideastro" />}
            {seaGrid.map((v) => (
              <g key={`sg${v}`}>
                <line x1={o.padl} y1={YT(v)} x2={o.w - o.padr} y2={YT(v)} stroke="#fff" strokeWidth={1} strokeDasharray="2 5" opacity={v === 0 ? 0.5 : 0.3} />
                <text className="mg-axnum" x={o.padl + 6} y={YT(v) - 4} fill="#fff" opacity={0.8}>{v > 0 ? `+${v}` : v}</text>
              </g>
            ))}
            {vanes.map((v, k) => (v.slack ? (
              <circle key={`vn${k}`} cx={v.x} cy={o.tideTop + 13} r={2} fill="#fff" opacity={0.8} />
            ) : (
              <g key={`vn${k}`} transform={`translate(${v.x},${o.tideTop + 13}) rotate(${v.toward.toFixed(0)})`} opacity={0.85}>
                <path d="M0 6 L0 -6 M-3 -2 L0 -6 L3 -2" fill="none" stroke="#fff" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
              </g>
            )))}
            {range === 1 && ext.map((e, k) => {
              const cx = xt(e.t), cy = YT(e.v), lab = `${e.kind} ${localHM(msT(e.t))}`;
              return (
                <g key={`ex${k}`}>
                  <circle className="mg-event" cx={cx} cy={cy} r={3.5} />
                  <text className="mg-evlbl" textAnchor="middle" x={fit(cx, lab, 7.4)} y={cy - 10} fill={e.v > 0 ? "var(--ink)" : "#fff"}>{lab}</text>
                </g>
              );
            })}
          </>
        )}

        {/* ── beyond-72h veil ── */}
        {showBeyond && (
          <>
            <rect x={gapX} y={o.windTop} width={Math.max(0, X(endMs) - gapX)} height={(showSea ? o.tideBot : windBot) - o.windTop} fill="var(--paper)" opacity={0.42} />
            <line x1={gapX} y1={o.windTop} x2={gapX} y2={showSea ? o.tideBot : windBot} stroke="var(--ink-3)" strokeDasharray="2 3" />
          </>
        )}

        {/* ── sun events on the time axis ── */}
        {sunEv.map((e, k) => (
          <text key={`su${k}`} className="mg-sun" textAnchor="middle" x={clamp(X(e.ms), o.padl + 14, o.w - o.padr - 14)} y={o.axisY - (showSea ? 16 : 0)}>
            {(e.rise ? "☀ " : "☾ ") + localHM(e.ms)}
          </text>
        ))}

        {/* ── x-axis (compact single-day view labels every 6h) ── */}
        {!multi && ticks.filter((tk) => tk.label).filter((_, i) => !o.compact || i % 2 === 0).map((tk, k) => {
          const fx = (X(tk.ms) - o.padl) / iw, anchor = fx < 0.02 ? "start" : fx > 0.98 ? "end" : "middle";
          return <text key={`xa${k}`} className="mg-axtime" x={X(tk.ms)} y={o.axisY} textAnchor={anchor as "start" | "middle" | "end"}>{tk.label}</text>;
        })}
        {multi && bands.segs.map((s, k) => (
          <text key={`db${k}`} className="mg-axtime" x={X(s.mid)} y={o.axisY} textAnchor="middle">{k === 0 ? "nu" : s.label}</text>
        ))}

        {/* ── now-marker: full-height magenta line + dot on the nav spine ── */}
        {showNow && (
          <g>
            <line className="mg-nowline" x1={X(nowMs)} y1={o.windTop - o.arrowGap - 4} x2={X(nowMs)} y2={o.axisY - 16} />
            <circle className="mg-nowdot" cx={X(nowMs)} cy={navY} r={4} />
            <text className="mg-nowtag" x={X(nowMs) + 7} y={o.windTop - o.arrowGap - 6}>nu</text>
          </g>
        )}

        {/* ── hover crosshair ── */}
        {showHover && <line className="mg-cross" x1={X(hoverMs!)} y1={o.windTop - 4} x2={X(hoverMs!)} y2={showSea ? o.tideBot : windBot} />}
      </>
    );
  }

  const HOUR = 3_600_000;
  const onMove = (e: { clientX: number; currentTarget: Element }) => {
    const r = e.currentTarget.getBoundingClientRect();
    const raw = t0 + ((e.clientX - r.left) / Math.max(1, r.width)) * (endMs - t0);
    onHover(clamp(Math.round(raw / HOUR) * HOUR, t0, endMs));
  };
  const clear = () => onHover(null);

  const tip = showHover && hp ? (
    <div className="tip" style={{ left: `${clamp(hoverFrac * 100, 8, 92)}%` }}>
      <span className="tt">{localWeekdayShort(hoverMs!)} {localHM(hoverMs!)}</span>
      <b>{hp.speed_kn} kn · {compass(hp.dir_deg)} {hp.dir_deg}°</b>
      <b>vlaag {Math.round(hp.gust_kn)} kn</b>
      {hLevel != null && <b>getij {Math.round(hLevel)} cm</b>}
    </div>
  ) : null;

  return (
    <div className="mg">
      <div className="mg-view desk chartbox" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={clear} onPointerCancel={clear}>
        <svg viewBox={`0 0 ${DESK.w} ${DESK.h}`} className="meteogram" preserveAspectRatio="xMidYMid meet" role="img" aria-label="meteogram wind, vaarbaarheid en getij">
          {renderView(DESK)}
        </svg>
        {tip}
      </div>
      <div className="mg-view mob chartbox" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={clear} onPointerCancel={clear}>
        <svg viewBox={`0 0 ${MOB.w} ${MOB.h}`} className="meteogram" preserveAspectRatio="xMidYMid meet" role="img" aria-label="meteogram wind, vaarbaarheid en getij">
          {renderView(MOB)}
        </svg>
        {tip}
      </div>
    </div>
  );
}
