"use client";
import { compass } from "@/lib/format";
import { localHM } from "@/lib/tz";
import type { DayModel, Verdict } from "@/lib/varen";

// Vaarcondities — overzicht. Vier dagkaarten met een vaarbaarheidsband (00–24),
// draai-indicatie (begin/eindrichting + kn-bandbreedte), getijmerken (laag/hoog)
// en het beste raam in woorden. Tik een kaart → detail. Visuele taal uit het
// prototype, gerenderd met de app-tokens (CSS-variabelen, geen Space Grotesk).

const BW = 360, PL = 8, PR = 8, TRACK = BW - PL - PR;
const X = (h: number) => PL + (h / 24) * TRACK;
const pad2 = (n: number) => (n < 10 ? "0" : "") + n;
const COLOR: Record<Verdict, string> = { g: "var(--sail-g)", a: "var(--sail-a)", r: "var(--sail-r)" };

// little vane pointing to where the wind comes FROM
function Vane({ deg, dim }: { deg: number; dim?: boolean }) {
  const col = dim ? "var(--faint)" : "var(--muted)";
  return (
    <svg viewBox="0 0 16 16" width={15} height={15} aria-hidden="true">
      <g transform={`translate(8,8) rotate(${(deg + 180) % 360})`}>
        <path d="M0 5 L0 -5 M-3 -1 L0 -5 L3 -1" fill="none" stroke={col}
              strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

export default function VarenOverview(
  { days, onPick }: { days: DayModel[]; onPick: (idx: number) => void },
) {
  if (!days.length) return <p className="muted">Geen vaardata.</p>;
  return (
    <div className="vsec">
      <div className="section-label">Kies een dag</div>
      {days.map((d) => {
        const best = d.best ? `${pad2(d.best[0])}:00 – ${pad2(d.best[1])}:00` : "geen goed raam";
        return (
          <button key={d.idx} className="vcard" onClick={() => onPick(d.idx)}>
            <div className="vcard-top">
              <div className="vcard-when"><b>{d.title}</b><span>{d.sub}</span></div>
              <div className="vcard-wind">
                <Vane deg={d.dirStart} dim />
                <Vane deg={d.dirEnd} />
                <span className="vcard-comp">{compass(d.dirStart)}–{compass(d.dirEnd)}</span>
                <span className="vcard-kn">{d.loKn}–{d.hiKn} kn</span>
              </div>
            </div>

            <svg viewBox={`0 0 ${BW} 42`} className="vband" role="img"
                 aria-label={`vaarbaarheid ${d.title}`}>
              {/* track background for the empty (no-data) part of today */}
              <rect x={PL} y={6} width={TRACK} height={12} rx={3} fill="var(--panel2)" />
              {d.hours.map((hr) => (
                <rect key={hr.h} x={X(hr.h)} y={6} width={TRACK / 24 + 0.5} height={12}
                      fill={COLOR[hr.verdict]} />
              ))}
              {/* now marker */}
              {d.isToday && d.nowH != null && d.nowH >= 0 && d.nowH <= 24 && (
                <>
                  <line x1={X(d.nowH)} y1={2} x2={X(d.nowH)} y2={22} stroke="var(--text)" strokeWidth={1.5} />
                  <text x={X(d.nowH) + 4} y={6} fill="var(--muted)" fontSize={9}>nu</text>
                </>
              )}
              {/* tide marks: laag = driehoek omhoog, hoog = omlaag */}
              {d.tideMarks.map((t, k) => {
                const x = X(t.h), y = 28;
                return t.kind === "LW"
                  ? <path key={k} d={`M${x} ${y} l-3.5 -5 l7 0 z`} fill="var(--tide)" />
                  : <path key={k} d={`M${x} ${y} l-3.5 5 l7 0 z`} fill="var(--tide2)" />;
              })}
              {/* hour axis */}
              {[0, 6, 12, 18, 24].map((h) => (
                <text key={h} x={X(h)} y={40} fill="var(--faint)" fontSize={9}
                      textAnchor={h === 0 ? "start" : h === 24 ? "end" : "middle"}>{pad2(h)}</text>
              ))}
            </svg>

            <div className="vcard-best">
              <span className="vlab">beste raam</span>
              <b>{best}</b>
              <span className="vchev">›</span>
            </div>
          </button>
        );
      })}
      <p className="vhint">
        kleur = vaarbaarheid · getijmerken: ▲ laag, ▼ hoog water · tik een dag voor het uurdetail
      </p>
    </div>
  );
}
