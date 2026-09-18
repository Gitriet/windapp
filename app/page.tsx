"use client";
// Tidan — Nu-view + Tocht-planner. Data en logica leven in app/use-tocht.ts (useTocht,
// useNu) en lib/tocht.ts; dit bestand is alleen presentatie.
import { DEFAULT_BOAT } from "@/lib/polar";
import { localHM, localDateISO } from "@/lib/tz";
import { compass, beaufort, dirLabel16 } from "@/lib/format";
import { COLORS, alpha } from "@/lib/colors";
import type { ForecastResponse, WeekResponse } from "@/lib/planner-data";
import { stroomSpanOf } from "@/lib/tocht";
import { verdict, type Verdict } from "@/lib/verdict";
import HavenSelector from "./components/HavenSelector";
import RouteScreen from "./components/RouteScreen";
import VaarplanView from "./components/VaarplanView";
import type { Location, TideData, TideExtreme } from "@/lib/types";
import { WindCanvas } from "./components/WindCanvas";
import { useIsMobile } from "@/lib/use-is-mobile";
import { useTocht, useNu, isTide } from "./use-tocht";
import { useScreenTab, useVertrekUrl } from "./use-app-url";
import { SCREENS, type ScreenId } from "./screens";
import { TopBar, TabBar, PickerChip, Skeleton } from "./components/Shell";

const H = 3_600_000;
const tms = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));

// windrichting-waaruit → stroomrichting van de deeltjes op het canvas
function canvasDir(dirFrom: number): number {
  const t = ((dirFrom + 180) * Math.PI) / 180;
  return (Math.atan2(-Math.cos(t), Math.sin(t)) * 180) / Math.PI;
}

// Eén dynamische contextzin uit de forecast: trend (bouwt op / neemt af / vrij
// constant, met de doelwaarde ~6u vooruit), draaiing (draait naar … / blijft …) en de
// bron (meting = gekalibreerd, anders model). Onder de tags in de hero.
function windContext(pts: ForecastResponse["points"]): string {
  const p0 = pts[0];
  const t = pts[Math.min(6, pts.length - 1)];
  const d = t.speed_kn - p0.speed_kn;
  const trend = d > 2 ? `bouwt op naar ${Math.round(t.speed_kn)} kn`
    : d < -2 ? `neemt af naar ${Math.round(t.speed_kn)} kn`
    : "vrij constant";
  const turn = Math.abs(((t.dir_deg - p0.dir_deg + 540) % 360) - 180);
  const draai = turn >= 25 ? `draait naar ${dirLabel16(t.dir_deg)}` : `blijft ${dirLabel16(p0.dir_deg)}`;
  const bron = p0.corrected ? "meting" : "model";
  const s = `${trend}, ${draai} · ${bron}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function Page() {
  const tocht = useTocht();
  const nu = useNu();
  const [tab, setTab] = useScreenTab();
  const { locations, locIdx, setLocIdx, loc } = nu;
  const err = tocht.err ?? nu.err;
  const {
    routes, fromHaven, toHaven, chooseFrom, chooseTo, allHavens, naamOf, vanOptions, naarOptions,
    endpoints, routeBearing, routeDistNm,
    routeMeta, viaHavens, depMs, setDepMs, depOptions, bestOption, vensters, firstDepMs, selTrip,
    routeTide, routeTideTo, routeGusts, vanWeather, ready, nowMs,
  } = tocht;
  useVertrekUrl(depMs, setDepMs, depOptions);

  // routekiezer: dezelfde chip boven ROUTE, GETIJDEN en VAARPLAN; opent de havenkiezers
  const routeChip = (
    <PickerChip label={endpoints ? `${endpoints.van.naam} → ${endpoints.naar.naam}` : "…"}>
      {() => (
        <>
          <HavenSelector label="Van" value={fromHaven} options={vanOptions} naamOf={naamOf} onSelect={chooseFrom}
            havenInfo={endpoints?.van.havenInfo ?? null} stationKey={endpoints?.van.key ?? null} bootDiepgang={DEFAULT_BOAT.draftM} />
          <HavenSelector label="Naar" value={toHaven} options={naarOptions} naamOf={naamOf} onSelect={chooseTo}
            havenInfo={endpoints?.naar.havenInfo ?? null} stationKey={endpoints?.naar.key ?? null} bootDiepgang={DEFAULT_BOAT.draftM} />
        </>
      )}
    </PickerChip>
  );
  // locatiekiezer (NU): de bestaande locatielijst
  const locChip = (
    <PickerChip label={loc?.name ?? "…"}>
      {(close) => locations.map((l, i) => (
        <button key={l.location_key} type="button" className="row" aria-current={i === locIdx ? "true" : undefined}
          style={{ padding: "var(--sp-5) var(--sp-6)", textAlign: "left", minHeight: "var(--tap)" }}
          onClick={() => { setLocIdx(i); close(); }}>
          {l.name}
        </button>
      ))}
    </PickerChip>
  );

  const content: Record<ScreenId, React.ReactNode> = {
    route: (
      <>
        {routeChip}
        <RouteScreen
          ready={ready} nowMs={nowMs} best={bestOption} vensters={vensters} firstDepMs={firstDepMs}
          anyStroom={routeMeta.stroomComplete || routeMeta.stroomPartial} depMs={depMs}
          routeBearing={routeBearing} routeTide={routeTide} routeGusts={routeGusts} vanWeather={vanWeather}
          onPick={(ms) => { setDepMs(ms); setTab("vaarplan"); }} />
      </>
    ),
    nu: (
      <>
        {locChip}
        <NowView fc={nu.fc} week={nu.week} tide={nu.tide} loc={loc} nowMs={nowMs} />
      </>
    ),
    getijden: routeChip,
    vaarplan: (
      <>
        {routeChip}
        {selTrip && depMs != null && endpoints ? (
          <VaarplanView
            depMs={depMs} trip={selTrip} from={endpoints.van} to={endpoints.naar}
            distanceNm={routeDistNm} bearingDeg={routeBearing}
            routeLabel={{ pathNamen: routeMeta.pathNamen, viaPassage: routeMeta.viaPassage, legCount: routeMeta.legCount }}
            fromTide={routeTide} toTide={routeTideTo} via={viaHavens} boat={DEFAULT_BOAT}
            stroomSpan={stroomSpanOf(routeMeta.legTimelines)} />
        ) : <VaarplanEmpty />}
      </>
    ),
  };

  return (
    <div className="shell">
      <TopBar />
      {err && <div role="alert" style={{ padding: "var(--sp-6) var(--gutter)", color: "var(--ochre)", fontSize: "var(--fs-rij-sm)" }}>Fout bij laden: {err}</div>}
      <main className="shell-screens">
        {SCREENS.map((s) => (
          <section key={s.id} className="shell-screen" data-active={s.id === tab ? "" : undefined} aria-label={s.label}>
            <h2 className="shell-screen-title">{s.label}</h2>
            {content[s.id]}
          </section>
        ))}
      </main>
      <TabBar active={tab} onSelect={setTab} />
    </div>
  );
}

// ════════════════════ NU-VIEW ════════════════════
function NowView({ fc, week, tide, loc, nowMs }: {
  fc: ForecastResponse | null; week: WeekResponse | null;
  tide: TideData | { tide: null } | null; loc?: Location; nowMs: number;
}) {
  const isMobile = useIsMobile();
  if (!fc || !loc) return <Loading label="wind laden…" />;
  const pts = fc.points;
  if (!pts.length) return <div style={{ padding: 40, color: "rgba(233,233,237,.5)" }}>Geen voorspelling beschikbaar voor {loc.name}.</div>;
  const p0 = pts[0];
  const bft = beaufort(p0.speed_kn);
  const nextHW = isTide(tide) ? (tide.extremes.find((e) => e.kind === "HW" && tms(e.t) >= nowMs) ?? tide.extremes.find((e) => e.kind === "HW")) : null;
  // temp (KNMI-weerlaag) + golf (Marine API) uit de weer-overlay; golf is null op landpunten.
  const temp0 = fc.weather?.temp?.[0] ?? null;
  const wave0 = fc.weather?.wave?.[0] ?? null;

  const chartPts = pts.slice(0, 13);

  return (
    <div className="nowview">
      {isMobile ? <HeroMobile p0={p0} bft={bft} temp={fc.weather?.temp?.[0] ?? null} wave={fc.weather?.wave?.[0] ?? null} /> : (
      <div style={{ display: "flex", alignItems: "center", gap: 24, position: "relative", overflow: "hidden", borderRadius: 12, padding: "10px 20px", background: "linear-gradient(120deg,#191c2b,#12131f)" }}>
        <WindCanvas dir={canvasDir(p0.dir_deg)} />
        <div style={{ position: "relative", flex: 1 }}>
          <div style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: COLORS.weer }}>
            {loc.name} · {new Intl.DateTimeFormat("nl-NL", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" }).format(nowMs)}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4 }}>
            <span className="kpi" style={{ fontSize: 52, lineHeight: 0.9, fontWeight: 600, letterSpacing: "-.03em", color: COLORS.wind }}>{Math.round(p0.speed_kn)}</span>
            <span style={{ fontSize: 18, color: "rgba(233,233,237,.6)" }}>kn</span>
            <span style={{ fontSize: 22, fontWeight: 600, color: "rgba(233,233,237,.85)", marginLeft: 4 }}>{dirLabel16(p0.dir_deg)}</span>
            <span style={{ fontSize: 16, color: "rgba(233,233,237,.5)", fontVariantNumeric: "tabular-nums" }}>{Math.round(p0.dir_deg)}°</span>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <span className="tag tag-wind">bft {bft}</span>
            <span className="tag tag-wind">vlaag {Math.round(p0.gust_kn)}</span>
            {nextHW && <span className="tag tag-water">HW {localHM(tms(nextHW.t))}</span>}
            {temp0 != null && <span className="tag tag-weer">{Math.round(temp0)}°</span>}
            {wave0 != null && <span className="tag tag-water">Golf {wave0.toFixed(1).replace(".", ",")} m</span>}
            <span className="tag tag-weer">{p0.model_label}</span>
          </div>
          <div style={{ fontSize: 13, color: "rgba(233,233,237,.6)", marginTop: 8, fontVariantNumeric: "tabular-nums" }}>{windContext(pts)}</div>
        </div>
        <div style={{ position: "relative", flex: "none" }}>
          <WindRose dir={p0.dir_deg} size={96} />
        </div>
      </div>
      )}

      <div style={{ marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(233,233,237,.85)" }}>Komende 12 uur</span>
          <span style={{ fontSize: 11, color: "rgba(233,233,237,.4)" }}>{loc.name} · wind + richting</span>
        </div>
        <Chart12h points={chartPts} />
      </div>

      <div style={{ marginTop: 26 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(233,233,237,.85)", marginBottom: 8 }}>7-daagse vooruitzichten</div>
        <WeekTable week={week} tide={tide} />
      </div>
    </div>
  );
}

// Windkracht-beschrijving afgeleid van het Beaufort-getal (0–12). Puur een
// presentatielabel — geen databron; het getal komt uit beaufort(speed_kn).
const BFT_LABEL = [
  "stil", "zwak", "zwak", "matig", "matig", "vrij krachtig", "krachtig",
  "hard", "stormachtig", "storm", "zware storm", "zeer zware storm", "orkaan",
];

// Kompasroos (amber, Nu-view): 16-punts richting-anker + graden in het midden, amber
// stip op de rand t.o.v. noord, tick-markering. Gedeeld door de mobiele én desktop-hero
// zodat beide exact dezelfde vorm hebben; alleen de pixelmaat (size) verschilt. viewBox
// blijft 100×100 zodat alle coördinaten schaal-onafhankelijk zijn.
function WindRose({ dir, size }: { dir: number; size: number }) {
  const rad = (dir * Math.PI) / 180, cx = 50 + 40 * Math.sin(rad), cy = 50 - 40 * Math.cos(rad);
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} style={{ flex: "0 0 auto" }}>
      <circle cx={50} cy={50} r={40} fill="none" stroke={alpha(COLORS.wind, 0.3)} strokeWidth={1.5} />
      <g stroke={alpha(COLORS.wind, 0.55)} strokeWidth={2}>
        <line x1={50} y1={10} x2={50} y2={17} /><line x1={50} y1={83} x2={50} y2={90} />
        <line x1={10} y1={50} x2={17} y2={50} /><line x1={83} y1={50} x2={90} y2={50} />
      </g>
      <g stroke={alpha(COLORS.wind, 0.3)} strokeWidth={1.5}>
        <line x1={21.7} y1={21.7} x2={26} y2={26} /><line x1={78.3} y1={21.7} x2={74} y2={26} />
        <line x1={21.7} y1={78.3} x2={26} y2={74} /><line x1={78.3} y1={78.3} x2={74} y2={74} />
      </g>
      <circle cx={cx} cy={cy} r={5.5} fill={COLORS.wind} />
      <text x={50} y={47} textAnchor="middle" dominantBaseline="central" fontSize={22} fontWeight={700} fill="#e9e9ed" className="kpi">{dirLabel16(dir)}</text>
      <text x={50} y={66} textAnchor="middle" fontSize={11} fill="rgba(233,233,237,.5)" className="kpi">{Math.round(dir)}°</text>
    </svg>
  );
}

// Mobiele hero (≤640px): kompas-roos toont de richting (anker), snelheid groot
// ernaast (één keer), drie compacte metrics eronder. Vereenvoudigd t.o.v. desktop
// — geen datumregel, HW-tag, model-tag of trend-zin. Vlaag + temp (uit fc.weather)
// hebben data; golf heeft geen bron → `—`. WindCanvas blijft de achtergrond-
// particles (amber, kleur uit COLORS.wind).
function HeroMobile({ p0, bft, temp, wave }: { p0: ForecastResponse["points"][number]; bft: number; temp: number | null; wave: number | null }) {
  const spd = Math.round(p0.speed_kn);
  const dir = p0.dir_deg;
  // golf + temp komen uit fc.weather; golf uit de Marine API (null voor landpunten).
  const dimVal = "rgba(233,233,237,.35)";
  return (
    <div style={{ position: "relative", overflow: "hidden", borderRadius: 16, padding: "22px 18px 20px", background: alpha(COLORS.wind, 0.05), border: `1px solid ${alpha(COLORS.wind, 0.22)}` }}>
      <WindCanvas dir={canvasDir(dir)} color={COLORS.wind} />
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 18 }}>
        <WindRose dir={dir} size={104} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 44, fontWeight: 700, lineHeight: 1, color: COLORS.wind }} className="kpi">
            {spd}<span style={{ fontSize: 20, fontWeight: 500, color: alpha(COLORS.wind, 0.7), marginLeft: 4 }}>kn</span>
          </div>
          <div style={{ fontSize: 13, color: "rgba(233,233,237,.45)", marginTop: 8 }}>{bft} Bft · {BFT_LABEL[bft]}</div>
        </div>
      </div>
      <div style={{ position: "relative", display: "flex", gap: 8, marginTop: 18 }}>
        <Metric label="Vlaag" value={`${Math.round(p0.gust_kn)} kn`} color={COLORS.wind} />
        <Metric label="Golf" value={wave == null ? "—" : `${wave.toFixed(1)} m`} color={wave == null ? dimVal : "rgba(233,233,237,.85)"} />
        <Metric label="Temp" value={temp == null ? "—" : `${Math.round(temp)}°`} color={temp == null ? dimVal : "rgba(233,233,237,.85)"} />
      </div>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ flex: 1, textAlign: "center", padding: "10px 6px", borderRadius: 10, background: "rgba(255,255,255,.04)" }}>
      <div style={{ fontSize: 10, color: "rgba(233,233,237,.4)", textTransform: "uppercase", letterSpacing: ".4px" }}>{label}</div>
      <div className="kpi" style={{ fontSize: 17, fontWeight: 600, marginTop: 3, color }}>{value}</div>
    </div>
  );
}

function Chart12h({ points }: { points: ForecastResponse["points"] }) {
  // viewBox op ~renderbreedte (1070, zoals de andere charts) i.p.v. 620: anders wordt de
  // hele SVG ~1,8× uitgerekt en renderen de labels/pijlen/linkergutter navenant groter dan
  // de rest van de app. Hgt schaalt mee (zelfde aspect ratio) zodat de chart-footprint en
  // balkbreedte gelijk blijven; alleen de vaste maten (fonts, PL-gutter) krimpen naar px-schaal.
  const W = 1070, Hgt = 380, n = points.length;
  if (n < 2) return <svg width="100%" viewBox={`0 0 ${W} ${Hgt}`} />;
  const PL = 34, PR = 14, PT = 40, PB = 22;
  const x0 = PL, x1 = W - PR, yTop = PT, yBot = Hgt - PB, plotW = x1 - x0, plotH = yBot - yTop;
  const maxGust = Math.max(...points.map((p) => p.gust_kn));
  const maxKn = Math.max(30, Math.ceil(maxGust / 10) * 10);         // vaste schaal 0/10/20/30(+)
  const ticks: number[] = []; for (let v = 0; v <= maxKn; v += 10) ticks.push(v);
  const pitch = plotW / n;                                          // één slot per uur
  const bw = Math.max(3, pitch * 0.62);                             // balkbreedte (sweep-stijl)
  const cx = (i: number) => x0 + (i + 0.5) * pitch;                 // midden van slot i
  const yv = (v: number) => yBot - (v / maxKn) * plotH;
  const labelIdx = [0, 3, 6, 9, 12].filter((i) => i < n);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${Hgt}`} preserveAspectRatio="xMidYMid meet" style={{ display: "block" }}>
      {/* legend: massieve wind-balk + doorschijnende vlaag-cap */}
      <rect x={x0} y={8} width={14} height={8} rx={1.5} fill={COLORS.wind} />
      <text x={x0 + 20} y={15.5} fontSize={11} fill="rgba(233,233,237,.6)">wind</text>
      <rect x={x0 + 68} y={8} width={14} height={8} rx={1.5} fill={COLORS.wind} fillOpacity={0.32} />
      <text x={x0 + 88} y={15.5} fontSize={11} fill="rgba(233,233,237,.6)">vlagen</text>
      {/* y-as: gridlijnen + knopenlabels */}
      {ticks.map((v) => (
        <g key={`y${v}`}>
          <line x1={x0} y1={yv(v)} x2={x1} y2={yv(v)} stroke="rgba(233,233,237,.08)" />
          <text x={x0 - 6} y={yv(v) + 3.5} textAnchor="end" fontSize={10} fill="rgba(233,233,237,.3)" style={{ fontVariantNumeric: "tabular-nums" }}>{v}</text>
        </g>
      ))}
      <text x={x0 - 6} y={yTop - 6} textAnchor="end" fontSize={9} fill="rgba(233,233,237,.35)">kn</text>
      {/* balken: vlaag-cap (doorschijnend, hele hoogte tot de vlaag) met de massieve
          wind-balk ervoor — het zichtbare doorschijnende stuk is de vlaag-marge. */}
      {points.map((p, i) => {
        const bx = cx(i) - bw / 2;
        const isNow = i === 0;
        return (
          <g key={i}>
            <rect x={bx} y={yv(p.gust_kn)} width={bw} height={yBot - yv(p.gust_kn)} rx={1.5} fill={COLORS.wind} fillOpacity={0.32} />
            <rect x={bx} y={yv(p.speed_kn)} width={bw} height={yBot - yv(p.speed_kn)} fill={COLORS.wind} fillOpacity={isNow ? 1 : 0.82} />
          </g>
        );
      })}
      {/* richting-pijltjes direct boven elke balk (boven de vlaag-top) — wijzen naar
          vanwaar de wind komt (noordenwind = pijl omhoog), zelfde conventie als de 7-daagse. */}
      {points.map((p, i) => (
        <g key={`arr${i}`} transform={`translate(${cx(i)} ${yv(p.gust_kn) - 8})`}>
          <path d="M10 3 L14 16 L10 13 L6 16 Z" fill={COLORS.wind} fillOpacity={0.8} transform={`rotate(${p.dir_deg}) scale(0.85) translate(-10 -10)`} />
        </g>
      ))}
      {/* x-as tijdlabels */}
      {labelIdx.map((i) => (
        <text key={`x${i}`} x={cx(i)} y={Hgt - 6} textAnchor="middle" fontSize={10} fill="rgba(233,233,237,.4)" style={{ fontVariantNumeric: "tabular-nums" }}>{i === 0 ? "Nu" : localHM(tms(points[i].time))}</text>
      ))}
    </svg>
  );
}

// Zeilrating uit de dag-winddata (max wind uit het bereik + vlaag), volgorde bepaalt
// de grens: eerst zwaar (Let op), dan fris, dan licht, anders goed.
const VERDICT_TAG: Record<Verdict, { ratingLabel: string; tagClass: string }> = {
  letop: { ratingLabel: "Let op", tagClass: "tag tag-danger" },
  fris: { ratingLabel: "Fris", tagClass: "tag tag-outline" },
  licht: { ratingLabel: "Licht", tagClass: "tag tag-neutral" },
  goed: { ratingLabel: "Goed", tagClass: "tag tag-good" },
};
function rateDay(speedMax: number | null, gust: number | null): { ratingLabel: string; tagClass: string } {
  const v = verdict(speedMax, gust);
  return v ? VERDICT_TAG[v] : { ratingLabel: "—", tagClass: "tag tag-neutral" };
}

function WeekTable({ week, tide }: { week: WeekResponse | null; tide: TideData | { tide: null } | null }) {
  const isMobile = useIsMobile();
  if (!week) return <Loading label="7-daagse laden…" />;
  const hwByDay = new Map<string, TideExtreme>();
  const lwByDay = new Map<string, TideExtreme>();
  if (isTide(tide)) {
    for (const e of tide.extremes) {
      const d = localDateISO(tms(e.t));
      if (e.kind === "HW" && !hwByDay.has(d)) hwByDay.set(d, e);
      if (e.kind === "LW" && !lwByDay.has(d)) lwByDay.set(d, e);
    }
  }
  const wd = (date: string) => new Intl.DateTimeFormat("nl-NL", { weekday: "short", day: "numeric", timeZone: "Europe/Amsterdam" }).format(new Date(date + "T12:00:00Z"));

  // Mobiel (≤640px): de 7-koloms tabel past niet op 375px, dus per dag een kaart.
  // Zelfde data als de desktop-tabel; Golf valt weg (heeft geen databron). Elke
  // metric is zelf-gelabeld (vlaag/pijl/H·L), dus geen scheidingstekens nodig.
  if (isMobile) return (
    <div>
      {week.days.map((d) => {
        const { ratingLabel, tagClass } = rateDay(d.speedMax, d.gust);
        const hw = hwByDay.get(d.date), lw = lwByDay.get(d.date);
        const windRange = d.windMin != null && d.speedMax != null
          ? `${Math.round(d.windMin)}–${Math.round(d.speedMax)}`
          : d.speedMax != null ? `${Math.round(d.speedMax)}` : "—";
        return (
          <div key={d.date} style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 12, padding: "10px 14px", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: "#e9e9ed" }}>{wd(d.date)}</span>
              <span className={tagClass}>{ratingLabel}</span>
            </div>
            {/* alle metrics op één regel: kn · vlaag · richting · water (H/L). Vaste
                kolommen zodat de eerste drie over alle kaarten uitlijnen; het water
                staat rechts (1fr, rechts uitgelijnd) zodat het nooit tegen de richting
                botst. Compacte tekst zodat het op 375px past. */}
            <div style={{ display: "grid", gridTemplateColumns: "auto auto auto 1fr", alignItems: "center", gap: 8, marginTop: 7, fontSize: 12, color: "rgba(233,233,237,.6)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
              <span><span style={{ color: COLORS.wind, fontWeight: 600 }}>{windRange}</span> kn</span>
              <span>vlaag <span style={{ color: COLORS.wind }}>{d.gust != null ? Math.round(d.gust) : "—"}</span></span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                {d.dir != null && <svg width={13} height={13} viewBox="0 0 20 20" style={{ transform: `rotate(${d.dir}deg)` }}><path d="M10 3 L14 16 L10 13 L6 16 Z" fill={COLORS.wind} /></svg>}
                {d.dir != null ? compass(d.dir) : "—"}
              </span>
              <span style={{ textAlign: "right", color: "rgba(233,233,237,.5)" }}>
                {hw ? <><span style={{ color: COLORS.water }}>H</span>{localHM(tms(hw.t))}</> : "—"}
                {lw && <> <span style={{ color: "rgba(233,233,237,.35)" }}>L</span>{localHM(tms(lw.t))}</>}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <table className="table" style={{ fontSize: 13 }}>
      <thead><tr><th>Dag</th><th>Wind</th><th>Vlaag</th><th>Richt.</th><th>Golf</th><th>Getij</th><th /></tr></thead>
      <tbody>
        {week.days.map((d) => {
          // rating uit de winddata van deze rij: max wind uit het bereik + de vlaag
          const { ratingLabel, tagClass } = rateDay(d.speedMax, d.gust);
          const hw = hwByDay.get(d.date), lw = lwByDay.get(d.date);
          return (
            <tr key={d.date}>
              <td style={{ fontWeight: 600, color: "#e9e9ed" }}>{wd(d.date)}</td>
              <td className="kpi">{d.windMin != null && d.speedMax != null ? `${Math.round(d.windMin)}–${Math.round(d.speedMax)}` : d.speedMax != null ? Math.round(d.speedMax) : "—"}</td>
              <td className="kpi" style={{ color: COLORS.wind }}>{d.gust != null ? Math.round(d.gust) : "—"}</td>
              <td>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {d.dir != null && <svg width={14} height={14} viewBox="0 0 20 20" style={{ transform: `rotate(${d.dir}deg)` }}><path d="M10 3 L14 16 L10 13 L6 16 Z" fill={COLORS.wind} /></svg>}
                  <span className="kpi">{d.dir != null ? compass(d.dir) : "—"}</span>
                </span>
              </td>
              <td className="kpi" style={{ color: d.wave != null ? "rgba(233,233,237,.6)" : "rgba(233,233,237,.35)" }}>{d.wave != null ? `${d.wave.toFixed(1).replace(".", ",")} m` : "—"}</td>
              <td className="kpi" style={{ fontSize: 12, color: "rgba(233,233,237,.6)" }}>
                {hw ? <><span style={{ color: COLORS.water }}>H</span>{localHM(tms(hw.t))} </> : "—"}
                {lw && <><span style={{ color: "rgba(233,233,237,.35)" }}>L</span>{localHM(tms(lw.t))}</>}
              </td>
              <td><span className={tagClass}>{ratingLabel}</span></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}


// Passage-strip: verticale rijen (geen h-scroll) uit het tripsim-verloop. Hergebruikt
// sampleHourly + positionName uit VaarplanView; kentering als gele scheiding; ontbrekende
// stroom (buiten het dekkingsvenster) → '—', nooit een verzonnen 0.
// Vaarplan zonder geselecteerd vertrek (bv. herladen op deze tab): leeg met hint.
function VaarplanEmpty() {
  return (
    <div style={{ padding: "20px var(--view-pad-x) 34px" }}>
      <div style={{ fontSize: 14, color: "rgba(233,233,237,.5)" }}>
        Geen vertrekmoment geselecteerd. Kies eerst een vertrek in de Tocht-planner.
      </div>
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return <Skeleton rows={3} height={56} label={label} />;
}
