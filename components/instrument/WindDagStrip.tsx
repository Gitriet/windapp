// Winddagverloop (port van docs/instrument-prototype.html): nu + 7 stappen van 3 uur.
// Per kolom: tijd, richtingpijl (wijst mee met de wind, from-richting +180°), groot
// knopengetal, klein amber vlaaggetal (alleen als het zinnig boven de wind ligt),
// kleine gedempte temp. De nu-kolom is subtiel lichter, zonder kleuraccent.
export type WindStep = { label: string; k: number; g: number | null; t: number | null; dir: number; now?: boolean };

function Arrow({ dir }: { dir: number }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 15, height: 15 }} aria-hidden="true">
      <g transform={`rotate(${dir + 180} 12 12)`}>
        <line x1={12} y1={5} x2={12} y2={19} stroke="var(--label)" strokeWidth={1.6} strokeLinecap="round" />
        <path d="M8,9 L12,5 L16,9" fill="none" stroke="var(--label)" strokeWidth={1.6}
              strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

export default function WindDagStrip({ steps }: { steps: WindStep[] }) {
  return (
    <div className="week">
      {steps.map((d, i) => (
        <div key={i} className={"wd" + (d.now ? " now" : "")}>
          <div className="day">{d.label}</div>
          <div className="arr"><Arrow dir={d.dir} /></div>
          <div className="wk-big">{d.k}<em>kn</em></div>
          <div className="wk-gust">{d.g != null ? d.g : " "}</div>
          <div className="t-dim">{d.t != null ? `${d.t}°` : "—"}</div>
        </div>
      ))}
    </div>
  );
}
