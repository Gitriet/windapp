"use client";
import { useEffect, useMemo, useRef } from "react";
import { MAP, project } from "@/lib/mapproj";
import { dirColor, relAngle, sail } from "@/lib/sailing";
import { compass } from "@/lib/format";
import type { MapData } from "@/lib/types";

// Alpha helper (the mockup pitfall): build rgba/`/ a)` colours via a function —
// never by appending a hex suffix to an hsl() string (invalid -> stalls the loop).
function withA(col: string, a: number): string {
  if (col[0] === "#") {
    const n = parseInt(col.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  return col.replace(")", ` / ${a})`);
}

// Water labels placed by lon/lat (projected with the same formula as the coast).
const WATER = [
  { t: "NOORDZEE", lon: 3.55, lat: 53.0, s: 13 },
  { t: "WADDENZEE", lon: 5.25, lat: 53.47, s: 11 },
  { t: "IJSSELMEER", lon: 5.42, lat: 52.75, s: 11 },
  { t: "MARKERMEER", lon: 5.07, lat: 52.54, s: 10 },
];

type Props = { data: MapData; course: number | null; hour: number; onPick: (key: string) => void };

export default function WindMap({ data, course, hour, onPick }: Props) {
  const cvRef = useRef<HTMLCanvasElement>(null);
  const stations = useMemo(() =>
    data.stations.map((s) => ({ ...s, ...project(s.lon, s.lat) })), [data]);

  const courseRef = useRef(course); courseRef.current = course;
  const hourRef = useRef(hour); hourRef.current = hour;
  const stRef = useRef(stations); stRef.current = stations;
  const particles = useRef<{ s: number; age: number }[]>([]);
  const onPickRef = useRef(onPick); onPickRef.current = onPick;

  // (re)build comet particles when the hour or the data changes
  useEffect(() => {
    const P: { s: number; age: number }[] = [];
    stRef.current.forEach((s, si) => {
      const n = 2 + Math.round((s.spd[hour] ?? 4) / 7);
      for (let i = 0; i < n; i++) P.push({ s: si, age: i / n + Math.random() * 0.05 });
    });
    particles.current = P;
  }, [hour, data]);

  useEffect(() => {
    const cv = cvRef.current!;
    const ctx = cv.getContext("2d")!;
    const VW = MAP.W, VH = MAP.H;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let scale = 1, raf = 0;
    const cssRoot = getComputedStyle(document.documentElement);
    const fMono = cssRoot.getPropertyValue("--font-mono").trim() || "monospace";
    const fBody = cssRoot.getPropertyValue("--font-body").trim() || "sans-serif";

    const mapPath = new Path2D();
    for (const d of MAP.paths) mapPath.addPath(new Path2D(d));

    function resize() {
      const cw = cv.clientWidth || VW;
      scale = cw / VW;
      cv.width = Math.round(cw * dpr);
      cv.height = Math.round(VH * scale * dpr);
    }
    const ro = new ResizeObserver(resize); ro.observe(cv);
    resize();

    function frame() {
      const course = courseRef.current, hour = hourRef.current, sts = stRef.current;
      ctx.save(); ctx.scale(scale * dpr, scale * dpr);

      // sea + subtle sheen + single land fill (so inland water shows as gaps)
      ctx.fillStyle = "#0a141d"; ctx.fillRect(0, 0, VW, VH);
      const g = ctx.createLinearGradient(0, 0, VW, VH);
      g.addColorStop(0, "rgba(20,40,55,.22)"); g.addColorStop(1, "rgba(8,16,24,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);
      ctx.fillStyle = "#172530"; ctx.fill(mapPath);

      // water labels
      WATER.forEach((l) => {
        const p = project(l.lon, l.lat);
        ctx.font = `600 ${l.s}px ${fMono}`;
        ctx.fillStyle = "rgba(120,150,170,.28)"; ctx.textAlign = "center";
        ctx.fillText(l.t.split("").join(" "), p.x, p.y);
      });

      sts.forEach((s, si) => {
        const sdir = s.dir[hour] ?? 0, sspd = s.spd[hour] ?? 4;
        const col = course === null ? dirColor(sdir) : sail(relAngle(sdir, course)).color;
        const flow = (sdir + 180) * Math.PI / 180;           // downwind (where it blows TO)
        const vx = Math.sin(flow), vy = -Math.cos(flow);
        const ux = Math.sin(sdir * Math.PI / 180), uy = -Math.cos(sdir * Math.PI / 180);
        const strength = Math.max(0.15, Math.min(1, (sspd - 3) / 22));
        const reach = 14 + strength * 22;

        ctx.strokeStyle = col; ctx.globalAlpha = 0.2; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(s.x + ux * reach * 0.7, s.y + uy * reach * 0.7);
        ctx.lineTo(s.x + vx * reach, s.y + vy * reach);
        ctx.stroke(); ctx.globalAlpha = 1;

        particles.current.forEach((p) => {
          if (p.s !== si) return;
          p.age += 0.0016 + strength * 0.0026;
          if (p.age > 1) p.age -= 1;
          const env = Math.sin(p.age * Math.PI), d = p.age * reach;
          const segs = 6, segLen = reach * 0.16;
          for (let k = 0; k < segs; k++) {
            const t1 = d - k * segLen, t2 = d - (k + 1) * segLen;
            if (t2 < 0) break;
            ctx.strokeStyle = col; ctx.globalAlpha = env * (1 - k / segs) * 0.9;
            ctx.lineWidth = 2 * (1 - k / segs) + 0.4; ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(s.x + vx * t1, s.y + vy * t1); ctx.lineTo(s.x + vx * t2, s.y + vy * t2);
            ctx.stroke();
          }
          ctx.globalAlpha = env; ctx.fillStyle = col;
          ctx.beginPath(); ctx.arc(s.x + vx * d, s.y + vy * d, 2, 0, Math.PI * 2); ctx.fill();
        });
        ctx.globalAlpha = 1;

        const rg = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, 8);
        rg.addColorStop(0, withA(col, 0.3)); rg.addColorStop(1, withA(col, 0));
        ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(s.x, s.y, 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#0a141d"; ctx.beginPath(); ctx.arc(s.x, s.y, 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(s.x, s.y, 3.2, 0, Math.PI * 2); ctx.stroke();

        const left = s.x > VW * 0.8;
        ctx.textAlign = left ? "right" : "left";
        const lx = s.x + (left ? -8 : 8);
        ctx.font = `500 9.5px ${fBody}`; ctx.fillStyle = "#c2cdd7";
        ctx.fillText(s.name, lx, s.y + 0.5);
        ctx.font = `500 8.5px ${fMono}`; ctx.fillStyle = col;
        ctx.fillText(course === null ? compass(sdir) : sail(relAngle(sdir, course)).label, lx, s.y + 10);
      });

      ctx.restore();
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    function click(e: MouseEvent) {
      const r = cv.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width * VW, py = (e.clientY - r.top) / r.height * VH;
      let best = -1, bd = 18 * 18;
      stRef.current.forEach((s, i) => {
        const dx = s.x - px, dy = s.y - py, dd = dx * dx + dy * dy;
        if (dd < bd) { bd = dd; best = i; }
      });
      if (best >= 0) onPickRef.current(stRef.current[best].location_key);
    }
    cv.addEventListener("click", click);

    return () => { cancelAnimationFrame(raf); ro.disconnect(); cv.removeEventListener("click", click); };
  }, []);

  return <canvas ref={cvRef} style={{ display: "block", width: "100%", height: "auto", cursor: "pointer" }} />;
}
