// Shared horizontal axis for the wind + tide charts. Both use the SAME viewBox
// width and PADL/PADR and the SAME xFor(ms) mapping over [t0, endMs], so a given
// instant lands at the same x in both — that vertical alignment is the point.
// Labels and day boundaries are in Europe/Amsterdam local time (see lib/tz); the
// x-mapping stays pure epoch-ms, so the two charts remain aligned.
import { localHM, localWeekdayShort, localMidnight, dayMidnights } from "./tz";

export const AXIS = { W: 760, PADL: 40, PADR: 26 };
const HOUR = 3_600_000;

// The charts pass their measured viewBox width `w` (responsive); it defaults to
// AXIS.W so any non-measuring caller keeps the old behaviour. PADL/PADR stay fixed
// pixels, so margins are constant while the plot stretches with the screen.
export const xFor = (ms: number, t0: number, endMs: number, w: number = AXIS.W) =>
  AXIS.PADL + ((ms - t0) / (endMs - t0)) * (w - AXIS.PADL - AXIS.PADR);

// Inverse of xFor: a viewBox x back to epoch ms.
export const msForX = (vbX: number, t0: number, endMs: number, w: number = AXIS.W) =>
  t0 + ((vbX - AXIS.PADL) / (w - AXIS.PADL - AXIS.PADR)) * (endMs - t0);

// A pointer's clientX over a full-width chart (rect = the chart wrapper box) back
// to epoch ms, SNAPPED to the whole hour (the hourly wind/weather grid) and
// clamped to the window. Shared by all charts so one hover lines up everywhere.
export function msForClientX(clientX: number, rect: DOMRect, t0: number, endMs: number, w: number = AXIS.W) {
  const fx = (clientX - rect.left) / Math.max(1, rect.width);
  const raw = msForX(fx * w, t0, endMs, w);
  const snapped = Math.round(raw / HOUR) * HOUR;
  return Math.max(t0, Math.min(endMs, snapped));
}

// Hour ticks aligned to LOCAL midnight so labels land on 00/06/12/18 local;
// density scales with range so labels don't collide:
// 1 day -> every 3h (all labelled); 2 days -> every 6h; 3 days -> every 6h, label every 2nd (12h).
export function hourTicks(t0: number, endMs: number, range: number, w: number = AXIS.W) {
  const stepH = range === 1 ? 3 : 6;
  // on a narrow chart the labels would collide at true font size, so label every
  // 2nd tick (6h) below ~430px; the wider it gets, the denser the labels.
  const labelEvery = range === 3 ? 2 : (w < 430 ? 2 : 1);
  const step = stepH * HOUR, m0 = localMidnight(t0);
  const ticks: { ms: number; label: string | null }[] = [];
  let k = Math.ceil((t0 - m0) / step);
  for (let ms = m0 + k * step; ms <= endMs + 1000; k++, ms = m0 + k * step) {
    const major = ((k % labelEvery) + labelEvery) % labelEvery === 0;
    ticks.push({ ms, label: major ? localHM(ms) : null });
  }
  return ticks;
}

// Weekday label centred per LOCAL calendar day + local-midnight boundary positions.
export function dayBands(t0: number, endMs: number) {
  const bounds = dayMidnights(t0, endMs);
  const segs: { mid: number; label: string }[] = [];
  let s = t0;
  for (const b of [...bounds, endMs]) {
    segs.push({ mid: (s + b) / 2, label: localWeekdayShort((s + b) / 2) });
    s = b;
  }
  return { bounds, segs };
}

// Catmull-Rom -> cubic bezier through points already in pixel space.
export function smoothPath(pts: [number, number][]): string {
  if (!pts.length) return "";
  if (pts.length < 3) return "M" + pts.map((p) => p.join(",")).join(" L ");
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}
