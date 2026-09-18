"use client";
// Tidan — vier schermen (ROUTE · NU · GETIJDEN · VAARPLAN) in één schil. Data en logica
// leven in app/use-tocht.ts (useTocht, useNu) en lib/; dit bestand verbindt alleen.
import { DEFAULT_BOAT } from "@/lib/polar";
import HavenSelector from "./components/HavenSelector";
import RouteScreen from "./components/RouteScreen";
import NuScreen from "./components/NuScreen";
import GetijdenScreen from "./components/GetijdenScreen";
import VaarplanScreen from "./components/VaarplanScreen";
import { useTocht, useNu } from "./use-tocht";
import { useScreenTab, useVertrekUrl } from "./use-app-url";
import { SCREENS, type ScreenId } from "./screens";
import { TopBar, TabBar, PickerChip, ScreenPanel } from "./components/Shell";
import { localHM } from "@/lib/tz";

export default function Page() {
  const tocht = useTocht();
  const nu = useNu();
  const [tab, setTab] = useScreenTab();
  const { locations, locIdx, setLocIdx, loc } = nu;
  const err = tocht.err ?? nu.err;
  const {
    fromHaven, toHaven, chooseFrom, chooseTo, naamOf, vanOptions, naarOptions,
    endpoints, routeBearing, routeDistNm,
    routeMeta, viaHavens, depMs, setDepMs, depOptions, bestOption, vensters, firstDepMs, selTrip,
    routeTide, routeGusts, vanWeather, dagBereik, etappeLegs, waypoints, alongPerLeg, legDistNm, ready, nowMs,
  } = tocht;
  useVertrekUrl(depMs, setDepMs, depOptions);

  // routekiezer: dezelfde chip boven ROUTE, GETIJDEN en VAARPLAN; opent de havenkiezers
  const maakRouteChip = (className?: string) => (
    <PickerChip className={className} label={endpoints ? `${endpoints.van.naam} → ${endpoints.naar.naam}` : "…"}>
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
        {maakRouteChip("chip-route")}
        <RouteScreen
          ready={ready} nowMs={nowMs} best={bestOption} vensters={vensters} firstDepMs={firstDepMs}
          anyStroom={routeMeta.stroomComplete || routeMeta.stroomPartial} depMs={depMs} selTrip={selTrip}
          routeBearing={routeBearing} routeTide={routeTide} routeGusts={routeGusts} vanWeather={vanWeather}
          onSelect={setDepMs} onOpenVaarplan={() => setTab("vaarplan")} />
      </>
    ),
    nu: (
      <>
        {locChip}
        <NuScreen fc={nu.fc} week={nu.week} tide={nu.tide} loc={loc} nowMs={nowMs} dagen={{ mobiel: 4, desktop: 7 }} />
      </>
    ),
    getijden: (
      <>
        {maakRouteChip("chip-route")}
        <GetijdenScreen
          ready={ready} nowMs={nowMs} bereik={dagBereik}
          titel={routeMeta.viaPassage ? `via ${routeMeta.viaPassage}` : routeMeta.pathNamen.join(" → ")}
          anyStroom={routeMeta.stroomComplete || routeMeta.stroomPartial} legTimelines={routeMeta.legTimelines}
          waypoints={waypoints} alongPerLeg={alongPerLeg} legDistNm={legDistNm} routeTide={routeTide} />
      </>
    ),
    vaarplan: (
      <>
        {maakRouteChip("chip-route")}
        <VaarplanScreen
          ready={ready} depMs={depMs} trip={selTrip} from={endpoints?.van ?? null} to={endpoints?.naar ?? null}
          distanceNm={routeDistNm} bearingDeg={routeBearing} legs={etappeLegs} gusts={routeGusts}
          fromTide={routeTide} via={viaHavens} boat={DEFAULT_BOAT} boatNaam="Winner 11.20"
          anyStroom={routeMeta.stroomComplete || routeMeta.stroomPartial} />
      </>
    ),
  };

  return (
    <div className="shell">
      <TopBar chip={maakRouteChip()} bijgewerkt={nowMs ? localHM(nowMs) : null} />
      {err && <div role="alert" style={{ padding: "var(--sp-6) var(--gutter)", color: "var(--ochre)", fontSize: "var(--fs-label)" }}>Fout bij laden: {err}</div>}
      <main className="shell-screens">
        {SCREENS.map((s) => (
          <ScreenPanel key={s.id} label={s.label} active={s.id === tab}>{content[s.id]}</ScreenPanel>
        ))}
      </main>
      <TabBar active={tab} onSelect={setTab} />
    </div>
  );
}
