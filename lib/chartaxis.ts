// Shared horizontal axis for the wind + tide charts. Both use the SAME viewBox
// width and PADL/PADR and the SAME xFor(ms) mapping over [t0, endMs], so a given
// instant lands at the same x in both — that vertical alignment is the point.
export const AXIS = { W: 760, PADL: 40, PADR: 26 };
const DAY = 86_400_000, HOUR = 3_600_000;

export const xFor = (ms: number, t0: number, endMs: number) =>
  AXIS.PADL + ((ms - t0) / (endMs - t0)) * (AXIS.W - AXIS.PADL - AXIS.PADR);

// Hour ticks; density scales with range so labels don't collide:
// 1 day -> every 3h (all labelled); 2 days -> every 6h; 3 days -> every 6h, label every 2nd (12h).
export function hourTicks(t0: number, endMs: number, range: number) {
  const stepH = range === 1 ? 3 : 6;
  const labelEvery = range === 3 ? 2 : 1;
  const start = Math.ceil(t0 / (stepH * HOUR)) * (stepH * HOUR);
  const ticks: { ms: number; label: string | null }[] = [];
  let idx = 0;
  for (let ms = start; ms <= endMs + 1000; ms += stepH * HOUR, idx++) {
    const major = idx % labelEvery === 0;
    const hh = new Date(ms).getUTCHours();
    ticks.push({ ms, label: major ? String(hh).padStart(2, "0") + ":00" : null });
  }
  return ticks;
}

const WD = ["zo", "ma", "di", "wo", "do", "vr", "za"];
// Weekday label centred per calendar day + midnight boundary positions (UTC).
export function dayBands(t0: number, endMs: number) {
  const bounds: number[] = [];
  for (let m = Math.ceil((t0 + 1) / DAY) * DAY; m < endMs; m += DAY) bounds.push(m);
  const segs: { mid: number; label: string }[] = [];
  let s = t0;
  for (const b of [...bounds, endMs]) {
    segs.push({ mid: (s + b) / 2, label: WD[new Date((s + b) / 2).getUTCDay()] });
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
