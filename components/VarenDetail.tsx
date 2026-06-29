"use client";
import { compass } from "@/lib/format";
import { localHM } from "@/lib/tz";
import { smoothPath } from "@/lib/chartaxis";
import {
  poItems, streamItems, zones, twa, poBucket, PO_ANGLE,
  type DayModel, type Verdict,
} from "@/lib/varen";

// Vaarcondities — detail. Eén dag op uurniveau, alle lagen op DEZELFDE tijdas
// (0–24) zodat ze verticaal uitlijnen: wind (kracht = hoogte, oordeel = kleur) +
// vlaaglijn + ijkpunten, drie "op je koers"-stroken (wind / stroom langs / stroom
// dwars) die met de koers meebewegen, en de getijkromme met laag/hoogwater.
// De koers herberekent ALLEEN de "op je koers"-stroken; wind en tij blijven staan.

const W = 760, PADL = 40, PADR = 26, PW = W - PADL - PADR;
const X = (h: number) => PADL + (h / 24) * PW;
const pad2 = (n: number) => (n < 10 ? "0" : "") + n;
const pad3 = (n: number) => ("00" + n).slice(-3);
const COLOR: Record<Verdict, string> = { g: "var(--sail-g)", a: "var(--sail-a)", r: "var(--sail-r)" };

// wind layout
const ARROW_Y = 22, BTOP = 60, SH = 130, BB = BTOP + SH, AXIS_Y = BB + 18;
// op je koers
const KO_HEAD = AXIS_Y + 30, STRIP_H = 22, ROW_PITCH = 42;
const ROW_Y = (i: number) => KO_HEAD + 24 + i * ROW_PITCH;
// getij
const T_HEAD = ROW_Y(3) - 6, T_TOP = T_HEAD + 16, T_H = 60, T_B = T_TOP + T_H;
const H = T_B + 44;

const PO_SHORT: Record<string, string> = {
  "voor de wind": "voor", "ruime wind": "ruim", "halve wind": "half", "aan de wind": "aan",
};
const num1 = (x: number) => x.toFixed(1).replace(".", ",");

function vane(x: number, y: number, fromDeg: number, col: string) {
  return (
    <g transform={`translate(${x},${y}) rotate(${(fromDeg + 180) % 360})`}>
      <path d="M0 6 L0 -6 M-3.5 -1 L0 -6 L3.5 -1" fill="none" stroke={col}
            strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

function SectionHead({ x, y, title, sub }: { x: number; y: number; title: string; sub?: string }) {
  return (
    <>
      <rect x={x} y={y - 10} width={3} height={12} fill="var(--accent)" />
      <text x={x + 11} y={y} className="vh">{title}</text>
      {sub && <text x={x + 11 + title.length * 8.4 + 12} y={y} className="vhsub">{sub}</text>}
    </>
  );
}

export default function VarenDetail(
  { day, course, onCourse, onBack, tideName }:
  { day: DayModel; course: number; onCourse: (delta: number) => void; onBack: () => void; tideName: string | null },
) {
  const hrs = day.hours;
  const hasStream = hrs.some((h) => h.curMag != null);
  const maxAxis = Math.max(15, Math.max(0, ...hrs.map((h) => h.gust)) * 1.15);
  const SY = (v: number) => BB - (Math.min(v, maxAxis) / maxAxis) * SH;

  const best = day.best;
  const winA = best ? best[0] : day.h0;
  const winB = best ? best[1] : day.h0;

  // ijkpunten: 0/6/12/18/24 that fall inside the available span
  const marks = [0, 6, 12, 18, 24].filter((h) => h >= day.h0 && h <= day.h1);
  const at = (h: number) => hrs.reduce((p, c) => (Math.abs(c.h - h) < Math.abs(p.h - h) ? c : p), hrs[0]);

  // wind band quads + lines
  const quads = hrs.slice(0, -1).map((a, i) => {
    const b = hrs[i + 1];
    return (
      <path key={`q${a.h}`} fill={COLOR[a.verdict]}
            d={`M${X(a.h)} ${BB} L${X(a.h)} ${SY(a.speed)} L${X(b.h)} ${SY(b.speed)} L${X(b.h)} ${BB} Z`} />
    );
  });
  const sil = hrs.map((h, i) => `${i ? "L" : "M"}${X(h.h)},${SY(h.speed)}`).join(" ");
  const gust = hrs.map((h, i) => `${i ? "L" : "M"}${X(h.h)},${SY(h.gust)}`).join(" ");

  // op je koers — wind strip
  const poZones = zones(poItems(hrs.map((h) => ({ h: h.h, dir: h.dir })), course));
  // op je koers — stroom strips
  const streamRows = hasStream
    ? (["along", "cross"] as const).map((which) =>
        zones(streamItems(
          hrs.filter((h) => h.curMag != null).map((h) => ({ h: h.h, mag: h.curMag!, toward: h.curToward! })),
          course, which,
        )))
    : null;

  const streamFill = (st: string) =>
    st === "mee" ? "var(--sail-mee)" : st === "tegen" ? "var(--sail-tegen)"
    : st === "slap" ? "transparent" : "var(--sail-side)";
  const streamText = (st: string) => (st === "tegen" ? "#eaf4fb" : st === "slap" ? "var(--faint)" : "#06212e");

  // getij curve (autoscaled)
  const tc = day.tideCurve;
  const ys = tc.map((p) => p.v);
  const ymin = ys.length ? Math.min(...ys) : 0, ymax = ys.length ? Math.max(...ys) : 1;
  const pad = Math.max(8, (ymax - ymin) * 0.16);
  const tY = (v: number) => T_TOP + ((ymax + pad - v) / (ymax - ymin + 2 * pad)) * T_H;

  return (
    <div className="vdetail">
      <button className="cur-back" onClick={onBack}>‹ overzicht</button>

      <div className="vd-head">
        <div className="vd-when"><b>{day.title}</b><span>{day.sub}</span></div>
        <div className="koers">
          <button aria-label="koers −10°" onClick={() => onCourse(-10)}>−</button>
          <span>koers {pad3(course)}°</span>
          <button aria-label="koers +10°" onClick={() => onCourse(10)}>+</button>
        </div>
      </div>

      <div className="vd-hero">
        <span className="vlab">beste raam</span>
        <b>{best ? `${pad2(best[0])}:00 – ${pad2(best[1])}:00` : "geen goed raam"}</b>
        <span className="vd-hero-sub">{best ? "langste aaneengesloten ‘goed’" : "wind of tij te beperkt"}</span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="vsvg" role="img" aria-label={`vaarcondities ${day.title}`}>
        {/* ---- WIND ---- */}
        <SectionHead x={PADL} y={44} title="Wind" sub="richting en kracht" />
        {marks.map((h) => {
          const m = at(h), sx = h === 0 ? X(h) + 12 : h === 24 ? X(h) - 12 : X(h);
          return (
            <g key={`mk${h}`}>
              {vane(sx, ARROW_Y, m.dir, "var(--muted)")}
              <text x={sx} y={ARROW_Y + 22} className="vtick" textAnchor="middle">{compass(m.dir)} {Math.round(m.speed)}</text>
            </g>
          );
        })}
        {/* best-window highlight */}
        {best && (
          <>
            <rect x={X(winA)} y={BTOP - 8} width={X(winB) - X(winA)} height={SH + 12} rx={6} fill="rgba(127,212,232,0.08)" />
            <line x1={X(winA)} y1={BTOP - 8} x2={X(winB)} y2={BTOP - 8} stroke="var(--accent)" strokeWidth={2} opacity={0.9} />
          </>
        )}
        {quads}
        <path d={sil} fill="none" stroke="var(--muted)" strokeWidth={1.3} opacity={0.45} strokeLinejoin="round" />
        <path d={gust} fill="none" stroke="var(--gust)" strokeWidth={1} strokeDasharray="2 3" opacity={0.7} />
        {hrs.length > 0 && <text x={X(hrs[0].h)} y={SY(hrs[0].gust) - 5} className="vtick">vlagen</text>}
        {/* hour axis */}
        {[0, 6, 12, 18, 24].map((h) => (
          <text key={`ax${h}`} x={X(h)} y={AXIS_Y} className="vtick"
                textAnchor={h === 0 ? "start" : h === 24 ? "end" : "middle"}>{pad2(h)}</text>
        ))}

        {/* ---- OP JE KOERS ---- */}
        <SectionHead x={PADL} y={KO_HEAD} title="Op je koers" sub={`koers ${pad3(course)}°`} />

        {/* wind */}
        <text x={PADL} y={ROW_Y(0) - 4} className="vrowlab">wind</text>
        <rect x={PADL} y={ROW_Y(0)} width={PW} height={STRIP_H} rx={6} fill="rgba(255,255,255,0.03)" />
        {poZones.map((z, k) => {
          const x0 = X(z.a), x1 = X(z.b), cx = (x0 + x1) / 2, w = x1 - x0, y = ROW_Y(0);
          return (
            <g key={`po${k}`}>
              {z.a > day.h0 && <line x1={x0} y1={y + 4} x2={x0} y2={y + STRIP_H - 4} stroke="var(--line2)" strokeWidth={1} />}
              {w > 78 ? (
                <>
                  <g transform={`translate(${cx - z.key.length * 3 - 8},${y + STRIP_H / 2}) rotate(${PO_ANGLE[z.key as keyof typeof PO_ANGLE]}) scale(0.8)`}>
                    <path d="M0 5 L0 -5 M-3 -1 L0 -5 L3 -1" fill="none" stroke="var(--muted)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                  </g>
                  <text x={cx + 7} y={y + STRIP_H / 2 + 4} className="vstrip" textAnchor="middle">{z.key}</text>
                </>
              ) : w > 38 ? (
                <text x={cx} y={y + STRIP_H / 2 + 4} className="vstrip" textAnchor="middle">{PO_SHORT[z.key] ?? z.key}</text>
              ) : (
                <g transform={`translate(${cx},${y + STRIP_H / 2}) rotate(${PO_ANGLE[z.key as keyof typeof PO_ANGLE]}) scale(0.75)`}>
                  <path d="M0 5 L0 -5 M-3 -1 L0 -5 L3 -1" fill="none" stroke="var(--muted)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                </g>
              )}
            </g>
          );
        })}

        {/* stroom langs + dwars */}
        {(["stroom langs", "stroom dwars"] as const).map((lab, ri) => {
          const y = ROW_Y(ri + 1);
          if (!streamRows) {
            return (
              <g key={lab}>
                <text x={PADL} y={y - 4} className="vrowlab">{lab}</text>
                <rect x={PADL} y={y} width={PW} height={STRIP_H} rx={6} fill="rgba(255,255,255,0.025)" />
                {ri === 0 && <text x={PADL + PW / 2} y={y + STRIP_H / 2 + 4} className="vstrip" textAnchor="middle">geen stroomdata voor deze locatie</text>}
              </g>
            );
          }
          const which = ri === 0 ? "along" : "cross";
          const zs = streamRows[ri];
          return (
            <g key={lab}>
              <text x={PADL} y={y - 4} className="vrowlab">{lab}</text>
              <rect x={PADL} y={y} width={PW} height={STRIP_H} rx={6} fill="rgba(255,255,255,0.025)" />
              {zs.map((z, k) => {
                const x0 = X(z.a), x1 = X(z.b), w = x1 - x0, cx = (x0 + x1) / 2;
                const isSlap = z.key === "slap";
                const full = which === "along"
                  ? (isSlap ? "slap" : `${z.key} ${num1(z.peak)}`)
                  : (isSlap ? "slap" : `${z.key === "SB" ? "▸" : "◂"} ${z.key} ${num1(z.peak)}`);
                const sym = which === "along" ? (z.key === "mee" ? "+" : "−") : (z.key === "SB" ? "▸" : "◂");
                return (
                  <g key={`s${k}`}>
                    {!isSlap && <rect x={x0 + 1} y={y + 1.5} width={Math.max(0, w - 2)} height={STRIP_H - 3} rx={3} fill={streamFill(z.key)} />}
                    {w > 56
                      ? <text x={cx} y={y + STRIP_H / 2 + 4} className="vstrip" textAnchor="middle" fill={streamText(z.key)}>{full}</text>
                      : w > 16 && !isSlap
                        ? <text x={cx} y={y + STRIP_H / 2 + 4} className="vstrip" textAnchor="middle" fill={streamText(z.key)}>{sym}</text>
                        : null}
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* ---- GETIJ ---- */}
        <SectionHead x={PADL} y={T_HEAD} title="Getij" sub={tideName ?? undefined} />
        {tc.length ? (
          <>
            <path d={smoothPath(tc.map((p) => [X(p.h), tY(p.v)]))} fill="none"
                  stroke={day.hasExpected ? "var(--tide)" : "var(--tide2)"} strokeWidth={1.8} />
            {day.tideMarks.map((t, k) => {
              const mx = X(t.h), my = tY(t.v), dy = t.kind === "HW" ? -9 : 17;
              return (
                <g key={`tm${k}`}>
                  <circle cx={mx} cy={my} r={3} fill="var(--tide)" />
                  <text x={mx} y={my + dy} className="vtick" textAnchor="middle">{t.kind} {localHM(Date.parse(t.t))}</text>
                </g>
              );
            })}
          </>
        ) : (
          <text x={PADL + PW / 2} y={T_TOP + T_H / 2} className="vstrip" textAnchor="middle">geen getij voor deze locatie</text>
        )}
      </svg>

      <div className="vlegend">
        <span><i className="sw" style={{ background: "var(--sail-g)" }} />goed</span>
        <span><i className="sw" style={{ background: "var(--sail-a)" }} />marginaal / tij beperkt</span>
        <span><i className="sw" style={{ background: "var(--sail-r)" }} />te veel wind</span>
      </div>
      <p className="vhint">
        stroom = benadering (voorspeld model, nog niet de echte RWS-stroomdata) · tij-beperking is een voorlopige drempel rond laagwater
      </p>
    </div>
  );
}
