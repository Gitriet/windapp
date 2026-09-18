"use client";
// Tidan — vier schermen (ROUTE · NU · GETIJDEN · VAARPLAN) in één schil. Data en logica
// leven in app/use-tocht.ts (useTocht, useNu) en lib/; dit bestand verbindt alleen.
import { DEFAULT_BOAT } from "@/lib/polar";
import { stroomSpanOf } from "@/lib/tocht";
import HavenSelector from "./components/HavenSelector";
import RouteScreen from "./components/RouteScreen";
import NuScreen from "./components/NuScreen";
import VaarplanView from "./components/VaarplanView";
import { useTocht, useNu } from "./use-tocht";
import { useScreenTab, useVertrekUrl } from "./use-app-url";
import { SCREENS, type ScreenId } from "./screens";
import { TopBar, TabBar, PickerChip } from "./components/Shell";

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
        <button key={l.location_key} type="button" className="row chip-option" aria-current={i === locIdx ? "true" : undefined}
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
        <NuScreen fc={nu.fc} week={nu.week} tide={nu.tide} loc={loc} nowMs={nowMs} dagen={{ mobiel: 4, desktop: 7 }} />
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

function VaarplanEmpty() {
  return (
    <div style={{ padding: "20px var(--view-pad-x) 34px" }}>
      <div style={{ fontSize: 14, color: "rgba(233,233,237,.5)" }}>
        Geen vertrekmoment geselecteerd. Kies eerst een vertrek in de Tocht-planner.
      </div>
    </div>
  );
}
