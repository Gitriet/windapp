"use client";
// Geanimeerde wind-achtergrond (particle flow), geport uit het DCLogic-prototype naar
// een zelfstandig React-component. Richting = waarheen de deeltjes stromen (graden op
// het canvas); voed die vanuit de windrichting-waarheen.
import { useEffect, useRef } from "react";

export function WindCanvas({
  dir = -25, color = "#8f83c9", speed = 1.3, alpha = 0.38, width = 1.1, fade = 0.12,
}: { dir?: number; color?: string; speed?: number; alpha?: number; width?: number; fade?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let raf = 0, stopped = false;
    const start = () => {
      if (canvas.clientWidth < 4) { raf = requestAnimationFrame(start); return; }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = canvas.clientWidth, H = canvas.clientHeight;
      canvas.width = W * dpr; canvas.height = H * dpr; ctx.scale(dpr, dpr);
      const ang = (dir * Math.PI) / 180, vx = Math.cos(ang), vy = Math.sin(ang);
      const N = Math.max(40, Math.round((W * H) / 2400));
      const P = Array.from({ length: N }, () => ({ x: Math.random() * W, y: Math.random() * H, l: Math.random() * 120 }));
      ctx.fillStyle = "#0f1119"; ctx.fillRect(0, 0, W, H);
      const step = () => {
        if (stopped) return;
        ctx.globalAlpha = fade; ctx.fillStyle = "#0f1119"; ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
        for (const p of P) {
          const g = 1 + Math.sin((p.y + p.x) * 0.008) * 0.35;
          const nx = p.x + vx * speed * g, ny = p.y + vy * speed * g;
          ctx.moveTo(p.x, p.y); ctx.lineTo(nx, ny);
          p.x = nx; p.y = ny; p.l--;
          if (p.x < 0 || p.x > W || p.y < 0 || p.y > H || p.l < 0) {
            p.x = Math.random() * W; p.y = Math.random() * H; p.l = Math.random() * 120 + 40;
          }
        }
        ctx.stroke();
        raf = requestAnimationFrame(step);
      };
      step();
    };
    start();
    return () => { stopped = true; cancelAnimationFrame(raf); };
  }, [dir, color, speed, alpha, width, fade]);
  return <canvas ref={ref} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />;
}
