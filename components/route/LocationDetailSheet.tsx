"use client";
import { useEffect, useMemo } from "react";
import type { Location } from "@/lib/types";
import { useForecast, useTide } from "./hooks";
import { useRoute } from "./RouteProvider";
import { certaintyLabel, MS_HOUR, type Certainty } from "@/lib/route";
import { evaluateGate, gateDatumFor, requiredDepthM, type GateVerdict } from "@/lib/gates";
import { localHM } from "@/lib/tz";

const ms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));

// Scherm 05 als bottom-sheet: 48u wind + zekerheidszonering + getijpoort + getijcurve
// voor één waypoint. Alles uit de echte forecast/tide van dat punt.
export default function LocationDetailSheet({ location, passageMs, onClose }: {
  location: Location | null; passageMs?: number | null; onClose: () => void;
}) {
  const open = !!location;
  const key = location?.location_key ?? null;
  const { data: fc } = useForecast(key);
  const tide = useTide(key);
  const { boat } = useRoute();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const now = fc?.points[0] ? ms(fc.points[0].time) : Date.now();
  const win = useMemo(() => (fc ? fc.points.filter((p) => {
    const h = (ms(p.time) - now) / MS_HOUR; return h >= -0.5 && h <= 48;
  }) : []), [fc, now]);

  // zekerheidsbanner: zwaarste spreiding in het 24–48u venster
  const banner: { cert: Certainty; spread: number } = useMemo(() => {
    let spread = 0;
    for (const p of win) { const h = (ms(p.time) - now) / MS_HOUR; if (h >= 20) spread = Math.max(spread, p.band_high_kn - p.band_low_kn); }
    return { cert: certaintyLabel(spread, 30), spread };
  }, [win, now]);

  // Getijpoort uit de eigen diepgang. De passagetijd komt uit de ETA-integratie en
  // wordt hier NIET opnieuw geschat. Zonder referentievlak blijft dit een gat.
  const verdict: GateVerdict = useMemo(
    () => evaluateGate(tide, key ? gateDatumFor(key) : null, boat, passageMs ?? null, now, now + 48 * MS_HOUR),
    [tide, key, boat, passageMs, now],
  );
  const poorts = verdict.windows;

  return (
    <>
      <div className={"detail-overlay" + (open ? " show" : "")} onClick={onClose} />
      <div className={"detail-sheet" + (open ? " show" : "")} role="dialog" aria-modal="true"
           aria-label={location?.name ?? "Locatie"} aria-hidden={!open}>
        <div className="detail-nav">
          <button className="back" onClick={onClose}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15,18 9,12 15,6" /></svg>
            Terug
          </button>
          <button className="x" onClick={onClose} aria-label="Sluiten">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="detail-scroll">
          {location && (<>
            <div>
              <h3>{location.name}</h3>
              <div className="locsub">{location.area}</div>
            </div>

            <div className={`warnbanner ${banner.cert}`}>
              <svg className="ico" width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8,2 L14,13.5 L2,13.5 Z" stroke={bannerColor(banner.cert)} strokeWidth="1.4" strokeLinejoin="round" />
                <line x1="8" y1="6.5" x2="8" y2="10" stroke={bannerColor(banner.cert)} strokeWidth="1.4" strokeLinecap="round" />
                <circle cx="8" cy="12" r=".9" fill={bannerColor(banner.cert)} />
              </svg>
              <div>
                <div className="tt">{banner.cert} · {banner.cert === "betrouwbaar" ? "0–24u horizon" : banner.cert === "wisselend" ? "24–36u horizon" : "36–48u horizon"}</div>
                <div className="ss">modelspanning {banner.spread.toFixed(1)} kn</div>
              </div>
            </div>

            {win.length >= 2 ? <WindChart win={win} now={now} poorts={poorts} /> : <div className="status load">Laden…</div>}

            <GateCard verdict={verdict} tideName={tide?.name} locationName={location.name} />

            {tide && tide.expected.length > 2 && <TideCurve tide={tide} now={now} poorts={poorts} />}

            <div className="source">
              ECMWF IFS · KNMI HARMONIE 2 km — bias-gecorrigeerd<br />
              Getij: RWS verwachting + windopzet · stroom: DCSM (model, ongevalideerd)
            </div>
          </>)}
        </div>
      </div>
    </>
  );
}

function bannerColor(c: Certainty) { return c === "betrouwbaar" ? "var(--go)" : c === "wisselend" ? "var(--tight)" : "var(--t2)"; }

// 48u windgrafiek met zekerheidszones, spreidingsband, wind- + vlagenlijn, poortbalk
function WindChart({ win, now, poorts }: { win: { time: string; speed_kn: number; gust_kn: number; band_low_kn: number; band_high_kn: number }[]; now: number; poorts: { fromMs: number; toMs: number }[] }) {
  const W = 322, HT = 155;
  const maxKn = Math.max(28, ...win.map((p) => p.gust_kn)) * 1.05;
  const x = (h: number) => (h / 48) * W;
  const y = (kn: number) => HT * (1 - kn / maxKn);
  const hOf = (p: { time: string }) => (ms(p.time) - now) / MS_HOUR;
  const line = (sel: (p: typeof win[number]) => number) => win.map((p, i) => `${i ? "L" : "M"}${x(hOf(p)).toFixed(1)},${y(sel(p)).toFixed(1)}`).join(" ");
  const bandPath = [
    ...win.map((p, i) => `${i ? "L" : "M"}${x(hOf(p)).toFixed(1)},${y(p.band_high_kn).toFixed(1)}`),
    ...win.slice().reverse().map((p) => `L${x(hOf(p)).toFixed(1)},${y(p.band_low_kn).toFixed(1)}`), "Z",
  ].join(" ");
  const yThresh = y(22);
  const clampH = (m: number) => Math.max(0, Math.min(48, (m - now) / MS_HOUR));
  return (
    <div className="chartcard">
      <div className="head">
        <div className="k">Wind 48u · kn</div>
        <div className="legend">
          <div className="lg"><i style={{ background: "var(--t1)" }} /><span>wind</span></div>
          <div className="lg"><i style={{ background: "var(--gust)", opacity: .8 }} /><span>vlagen</span></div>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} 185`} style={{ height: 185, overflow: "visible" }}>
        <rect x="0" y="0" width="161" height={HT} fill="#0A1E10" />
        <rect x="161" y="0" width="80" height={HT} fill="#1E1507" />
        <rect x="241" y="0" width="81" height={HT} fill="#0D1525" />
        <line x1="0" y1={yThresh} x2={W} y2={yThresh} stroke="var(--bd)" strokeWidth="1" strokeDasharray="3 4" />
        <text x="-2" y={yThresh + 3} textAnchor="end" fontSize="8" fill="var(--tight)">22</text>
        <line x1="161" y1="0" x2="161" y2={HT} stroke="var(--bd2)" strokeWidth="1" strokeDasharray="2 4" />
        <line x1="241" y1="0" x2="241" y2={HT} stroke="var(--bd2)" strokeWidth="1" strokeDasharray="2 4" />
        <path d={bandPath} fill="var(--t1)" fillOpacity="0.055" />
        <path d={line((p) => p.gust_kn)} fill="none" stroke="var(--gust)" strokeWidth="1.6" strokeDasharray="5 3" opacity="0.75" />
        <path d={line((p) => p.speed_kn)} fill="none" stroke="var(--t1)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        {poorts.map((p, i) => (
          <rect key={i} x={x(clampH(p.fromMs))} y="148" width={Math.max(2, x(clampH(p.toMs)) - x(clampH(p.fromMs)))} height="6" rx="2" fill="var(--go)" fillOpacity="0.7" />
        ))}
        <line x1="0" y1="0" x2="0" y2={HT} stroke="var(--no)" strokeWidth="1.5" strokeDasharray="4 2" />
        <circle cx="0" cy={y(win[0].speed_kn)} r="3.5" fill="var(--no)" />
        <text x="80" y="172" textAnchor="middle" fontSize="9" fill="var(--go)">betrouwbaar</text>
        <text x="201" y="172" textAnchor="middle" fontSize="9" fill="var(--tight)">wisselend</text>
        <text x="281" y="172" textAnchor="middle" fontSize="9" fill="var(--t3)">onzeker</text>
        <text x="0" y="183" fontSize="8" fill="var(--t3)">nu</text>
        <text x="80" y="183" textAnchor="middle" fontSize="8" fill="var(--t3)">+12u</text>
        <text x="161" y="183" textAnchor="middle" fontSize="8" fill="var(--t2)">+24u</text>
        <text x="241" y="183" textAnchor="middle" fontSize="8" fill="var(--tight)">+36u</text>
        <text x={W} y="183" textAnchor="end" fontSize="8" fill="var(--t3)">+48u</text>
      </svg>
    </div>
  );
}

// Getijpoort: interval, de eigen drempel en de marge — of een expliciet gat wanneer
// het referentievlak ontbreekt. Nooit een schatting om het gat te vullen.
function GateCard({ verdict, tideName, locationName }: {
  verdict: GateVerdict; tideName?: string; locationName: string;
}) {
  const ico = (c: string) => (
    <svg className="ico" width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="7.5" stroke={c} strokeWidth="1.5" />
      <polyline points="9,5 9,9 12.5,11" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  if (verdict.reason === "geen-referentievlak") {
    return (
      <div className="poortcard closed">
        {ico("var(--t2)")}
        <div>
          <div className="tt">Getijpoort — geen referentievlak bekend</div>
          <div className="note">
            Voor {locationName} ontbreken de kaartdiepte over de drempel en het
            reductievlak (ALAT) t.o.v. NAP. Zonder beide is de poort niet te berekenen;
            er wordt hier bewust niets geschat.<br />
            Eigen drempel: <b>{verdict.requiredM.toFixed(2)} m</b> nodig.
          </div>
        </div>
      </div>
    );
  }
  if (verdict.reason === "geen-getij") {
    return (
      <div className="poortcard closed">
        {ico("var(--t2)")}
        <div>
          <div className="tt">Geen getijgegevens</div>
          <div className="note">Dit punt heeft geen gekoppeld getijstation.</div>
        </div>
      </div>
    );
  }
  if (verdict.reason === "passage-buiten-getijreeks") {
    return (
      <div className="poortcard closed">
        {ico("var(--t2)")}
        <div>
          <div className="tt">Getijpoort — passagetijd buiten de getijreeks</div>
          <div className="note">
            {verdict.passageMs != null && <>Passage {localHM(verdict.passageMs)} valt buiten de verwachting
              die voor {tideName ?? "dit station"} beschikbaar is.<br /></>}
            Er wordt niet doorgetrokken om het gat te vullen.<br />
            Eigen drempel: <b>{verdict.requiredM.toFixed(2)} m</b> nodig.
          </div>
        </div>
      </div>
    );
  }

  const open = verdict.status === "gehaald" || verdict.status === "net-aan";
  const col = verdict.status === "gehaald" ? "var(--go)"
    : verdict.status === "net-aan" ? "var(--tight)"
    : verdict.status === "niet-gehaald" ? "var(--no)" : "var(--t2)";
  const next = verdict.windows.find((w) => w.toMs > Date.now()) ?? verdict.windows[0];
  return (
    <div className={"poortcard" + (open ? "" : " closed")}>
      {ico(col)}
      <div>
        <div className="gate-line">
          <span className="tt" style={{ color: col }}>Getijpoort</span>
          <span className={`pill ${verdict.status}`}>{verdict.status}</span>
        </div>
        {next && <div className="win">{localHM(next.fromMs)} – {localHM(next.toMs)}</div>}
        <div className="note">
          Nodig <b>{verdict.requiredM.toFixed(2)} m</b> (diepgang + marge)
          {verdict.marginM != null && <> · marge <b>{verdict.marginM >= 0 ? "+" : ""}{verdict.marginM.toFixed(2)} m</b></>}
          {verdict.passageMs != null && <> · passage {localHM(verdict.passageMs)}</>}
          <br />{tideName} · verwachting incl. windopzet
          {verdict.reason === "geen-passagetijd" && <> · geen passagetijd bekend</>}
          {/* het reductievlak is geen bodem: ~2×/maand komt de stand er 0,25 m onder,
              ~1×/jaar 0,50 m. Een venster is dus nooit een garantie. */}
          <br /><span className="caveat">Reductievlak is geen bodem — bij aflandige wind staat er minder. Geen garantie.</span>
        </div>
      </div>
    </div>
  );
}

function TideCurve({ tide, now, poorts }: { tide: { expected: { t: string; v: number }[]; extremes: { kind: string; t: string; v: number }[] }; now: number; poorts: { fromMs: number; toMs: number }[] }) {
  const W = 322, H = 68, PAD = 8;
  const start = now - 2 * MS_HOUR, end = now + 22 * MS_HOUR;
  const pts = tide.expected.map((p) => ({ m: ms(p.t), v: p.v })).filter((p) => p.m >= start && p.m <= end);
  if (pts.length < 2) return null;
  const lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
  const x = (m: number) => ((m - start) / (end - start)) * W;
  const y = (v: number) => PAD + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - 2 * PAD - 6);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.m).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const ext = tide.extremes.map((e) => ({ ...e, m: ms(e.t) })).filter((e) => e.m >= start && e.m <= end);
  return (
    <div className="tidecard">
      <div className="k">Getij · komende 24u</div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ height: 68, overflow: "visible" }}>
        <path d={`${path} L${x(pts[pts.length - 1].m)},${H} L${x(pts[0].m)},${H} Z`} fill="var(--water)" fillOpacity="0.12" />
        <path d={path} fill="none" stroke="var(--water)" strokeWidth="1.8" strokeLinecap="round" />
        {ext.map((e, i) => (
          <g key={i}>
            <circle cx={x(e.m)} cy={y(e.v)} r="3" fill="var(--water)" fillOpacity={e.kind === "HW" ? 1 : 0.6} />
            {e.kind === "HW" && <text x={x(e.m)} y={y(e.v) - 5} textAnchor="middle" fontSize="8" fill="var(--water)">HW {localHM(e.m)}</text>}
          </g>
        ))}
        {poorts.filter((p) => p.toMs >= start && p.fromMs <= end).map((p, i) => (
          <rect key={i} x={x(Math.max(start, p.fromMs))} y={H - 6} width={Math.max(2, x(Math.min(end, p.toMs)) - x(Math.max(start, p.fromMs)))} height="5" rx="2" fill="var(--go)" fillOpacity="0.7" />
        ))}
        <line x1={x(now)} y1="0" x2={x(now)} y2={H} stroke="var(--no)" strokeWidth="1.2" strokeDasharray="3 2" opacity="0.8" />
      </svg>
    </div>
  );
}
