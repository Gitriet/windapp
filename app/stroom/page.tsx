"use client";
import { useEffect, useState } from "react";
import Nav from "@/components/Nav";
import StroomAtlas from "@/components/StroomAtlas";
import StroomFlow from "@/components/StroomFlow";
import {
  STROOM_GROUPS, findPoint, currentAt, dirName, fmtHours, nowHours,
  CUR_COLOR, type StroomPoint,
} from "@/lib/stroom";

// Stroom-tab: lijst van getijde-stroompunten, tik door naar het detail (atlas +
// verloop). Stroom = heen-en-weer; richting leest ALLEEN uit de pijl, alles in
// één neutrale kleur (CUR_COLOR), nooit kleur=richting. Model = voorspeld (HP33).

// richtingpijl in de ene neutrale kleur; wijst naar waar het water heen stroomt
function CurArrow({ deg, size = 26 }: { deg: number; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <g transform={`rotate(${deg} 12 12)`}>
        <path d="M12 4 L12 20 M7 9 L12 4 L17 9" fill="none" stroke={CUR_COLOR}
              strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

// sterkteverloop -6..+6u rond nu, in dezelfde neutrale kleur + witte nu-stip
function Spark({ p, now }: { p: StroomPoint; now: number }) {
  const W = 72, H = 20, n = 25;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = now - 6 + (i / (n - 1)) * 12;
    pts.push([(i / (n - 1)) * W, H - 2 - (currentAt(p, t).speed / p.max) * (H - 4)]);
  }
  const nx = W / 2, ny = H - 2 - (currentAt(p, now).speed / p.max) * (H - 4);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="cspark">
      {pts.slice(0, -1).map(([x1, y1], i) => (
        <line key={i} x1={x1} y1={y1} x2={pts[i + 1][0]} y2={pts[i + 1][1]}
              stroke={CUR_COLOR} strokeWidth={1.6} strokeLinecap="round" />
      ))}
      <circle cx={nx} cy={ny} r={2.2} fill="#fff" />
    </svg>
  );
}

export default function Stroom() {
  const [locKey, setLocKey] = useState("");
  const [now, setNow] = useState<number | null>(null);
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => {
    setNow(nowHours());
    setLocKey(new URLSearchParams(window.location.search).get("loc") ?? "");
  }, []);

  const p = sel ? findPoint(sel) : null;

  return (
    <>
      <header className="top">
        <h1>Windvoorspelling</h1>
        <Nav active="stroom" locKey={locKey} />
      </header>

      {now == null ? (
        <div className="panel muted">Laden…</div>
      ) : p ? (
        // ---------- detail (atlas + verloop volgen in fase 2/3) ----------
        <StroomDetail p={p} now={now} onBack={() => setSel(null)} />
      ) : (
        // ---------- lijst ----------
        <>
          {STROOM_GROUPS.map((g) => (
            <div key={g.area} className="cur-group">
              <div className="section-label">{g.area}</div>
              {g.points.map((pt) => {
                const c = currentAt(pt, now);
                return (
                  <button key={pt.key} className="srow" onClick={() => setSel(pt.key)}>
                    <span className="srow-ar"><CurArrow deg={c.deg} /></span>
                    <span className="srow-mid">
                      <span className="srow-nm">{pt.nm}</span>
                      <span className="srow-meta">{dirName(c.deg)} · kentering {fmtHours(c.slackAt)}</span>
                    </span>
                    <span className="srow-spd">
                      <span><b>{c.speed.toFixed(1)}</b> kn</span>
                      <Spark p={pt} now={now} />
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
          <p className="cur-hint">
            stroom = voorspeld (astronomisch, HP33) · pijl wijst de stroomrichting uit · tik een punt voor kaart en verloop
          </p>
        </>
      )}
    </>
  );
}

// detail-skelet (fase 1): kop + actuele waarde. Atlas (fase 2) en verloop (fase 3)
// komen hieronder.
function StroomDetail({ p, now, onBack }: { p: StroomPoint; now: number; onBack: () => void }) {
  const c = currentAt(p, now);
  return (
    <>
      <button className="cur-back" onClick={onBack}>‹ terug</button>
      <div className="cur-dhead">
        <span className="cur-dnm">{p.nm}</span>
        <span className="cur-darea">{p.area}</span>
      </div>
      <div className="cur-nowline">
        <CurArrow deg={c.deg} size={20} />
        <b>{c.speed.toFixed(1)} kn</b>
        <span>{dirName(c.deg)} {Math.round(c.deg)}° · kentering {fmtHours(c.slackAt)}</span>
      </div>
      <StroomAtlas p={p} now={now} />
      <StroomFlow p={p} now={now} />
    </>
  );
}
