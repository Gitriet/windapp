// Verticale schaalbalk als SVG (port van docs/instrument-prototype.html: bar()).
// Twee smaken: WindSchaal (links, rode vulling = wind, amber lijn = vlaag) en
// GetijSchaal (rechts, water-segmenten, stijg/daal-pijl op de vulhoogte). Segmenten
// lichten op tot de waarde; de vlaag staat als losse amber lijn+waarde erover.
const VW = 96, VH = 274, Y_TOP = 48, Y_BOT = 262;
const H = Y_BOT - Y_TOP;

type Tick = { v: number; label: string };
export type VBarProps = {
  side: "left" | "right";
  title: string;
  min: number; max: number; value: number;
  seg: string;              // opgelicht segment
  mark?: string;            // markersegment + pijl
  glow: string;             // drop-shadow kleur
  ticks?: Tick[];
  cap?: boolean;            // driehoekje boven de balk (wind)
  gust?: number;            // vlaag: dunne amber lijn + waarde over de balk (wind)
  rising?: boolean;         // stijg/daal-pijl op de vulhoogte (getij)
  fallingArrow?: boolean;   // pijl omlaag i.p.v. omhoog
};

export default function VBar(cfg: VBarProps) {
  const left = cfg.side === "left", barW = 24;
  const barX = left ? VW - 6 - barW : 6;
  const numX = left ? barX - 7 : barX + barW + 7;
  const anchor = left ? "end" : "start";

  const n = 28, gap = 2, segH = (H - (n - 1) * gap) / n;
  const r = Math.max(0, Math.min(1, (cfg.value - cfg.min) / (cfg.max - cfg.min)));
  const lit = Math.max(1, Math.round(r * n));

  const rects: JSX.Element[] = [];
  for (let i = 0; i < n; i++) {
    const y = Y_BOT - (i + 1) * segH - i * gap, on = i < lit, marker = i === lit - 1;
    let fill = on ? cfg.seg : "#243038";
    if (marker && cfg.mark) fill = cfg.mark;
    rects.push(
      <rect key={i} x={barX} y={y} width={barW} height={segH} rx={2} fill={fill}
            style={on ? { filter: `drop-shadow(0 0 3px ${cfg.glow})` } : undefined} />,
    );
  }

  const ax = barX + barW / 2;
  const fillY = Y_BOT - r * H;

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} style={{ display: "block", width: "100%", height: "auto" }}
         aria-label={cfg.title} role="img">
      <text x={VW / 2} y={20} textAnchor="middle" className="barTitle">{cfg.title}</text>
      {rects}
      {(cfg.ticks ?? []).map((t) => {
        const y = Y_BOT - ((t.v - cfg.min) / (cfg.max - cfg.min)) * H;
        return <text key={t.v} x={numX} y={y + 4} textAnchor={anchor} className="barNum">{t.label}</text>;
      })}
      {cfg.cap && (
        <path d={`M${ax},${Y_TOP - 10} L${ax - 5},${Y_TOP - 2} L${ax + 5},${Y_TOP - 2} Z`}
              fill={cfg.mark ?? cfg.seg} style={{ filter: `drop-shadow(0 0 3px ${cfg.glow})` }} />
      )}
      {cfg.gust != null && (() => {
        const gy = Y_BOT - Math.max(0, Math.min(1, (cfg.gust! - cfg.min) / (cfg.max - cfg.min))) * H;
        return (
          <g style={{ filter: "drop-shadow(0 0 3px rgba(229,149,47,.55))" }}>
            <line x1={barX - 3} y1={gy} x2={barX + barW + 3} y2={gy}
                  stroke="var(--gust)" strokeWidth={2} strokeLinecap="round" />
            <text x={numX} y={gy + 4} textAnchor={anchor} className="barGust">{Math.round(cfg.gust!)}</text>
          </g>
        );
      })()}
      {cfg.rising && !cfg.fallingArrow && (
        <path d={`M${ax},${fillY - 16} L${ax - 5},${fillY - 8} L${ax + 5},${fillY - 8} Z`}
              fill={cfg.mark} style={{ filter: `drop-shadow(0 0 4px ${cfg.glow})` }} />
      )}
      {cfg.rising && cfg.fallingArrow && (
        <path d={`M${ax},${fillY + 16} L${ax - 5},${fillY + 8} L${ax + 5},${fillY + 8} Z`}
              fill={cfg.mark} style={{ filter: `drop-shadow(0 0 4px ${cfg.glow})` }} />
      )}
    </svg>
  );
}
