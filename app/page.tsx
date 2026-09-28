"use client";
// Tidan — drie schermen (ROUTE · WEER & GETIJ · VAARPLAN) in één schil. Data en logica
// leven in app/use-tocht.ts (useTocht, useHaven) en lib/; dit bestand verbindt alleen.
import { useState } from "react";
import HavenSelector from "./components/HavenSelector";
import RouteScreen from "./components/RouteScreen";
import WeerGetijScreen from "./components/WeerGetijScreen";
import VaarplanScreen from "./components/VaarplanScreen";
import { useTocht, useHaven } from "./use-tocht";
import { useBoot } from "./use-boot";
import BootPaneel from "./components/BootPaneel";
import { useScreenTab, useVertrekUrl } from "./use-app-url";
import { SCREENS, type ScreenId } from "./screens";
import { TopBar, TabBar, PickerChip, ScreenPanel } from "./components/Shell";
import { localHM } from "@/lib/tz";

export default function Page() {
  const [boat, setBoat] = useBoot();
  const [bootOpen, setBootOpen] = useState(false);
  const tocht = useTocht(boat);
  const [tab, setTab] = useScreenTab();
  const {
    fromHaven, toHaven, chooseFrom, chooseTo, naamOf, vanOptions, naarOptions,
    endpoints, routeBearing, routeDistNm,
    routeMeta, viaHavens, depMs, setDepMs, depOptions, bestOption, vensters, firstDepMs, selTrip,
    routeTide, routeGusts, routeWaves, vanWeather, etappeLegs, ready, nowMs,
  } = tocht;
  const vanData = useHaven(endpoints?.van ?? null);
  const naarData = useHaven(endpoints?.naar ?? null);
  const err = tocht.err ?? vanData.err ?? naarData.err;
  useVertrekUrl(depMs, setDepMs, depOptions);

  // routekiezer: dezelfde chip boven elk scherm; opent de havenkiezers
  const maakRouteChip = (className?: string) => (
    <PickerChip className={className} label={endpoints ? `${endpoints.van.naam} → ${endpoints.naar.naam}` : "…"}>
      {() => (
        <>
          <HavenSelector label="Van" value={fromHaven} options={vanOptions} naamOf={naamOf} onSelect={chooseFrom}
            havenInfo={endpoints?.van.havenInfo ?? null} stationKey={endpoints?.van.key ?? null} bootDiepgang={boat.draftM} />
          <HavenSelector label="Naar" value={toHaven} options={naarOptions} naamOf={naamOf} onSelect={chooseTo}
            havenInfo={endpoints?.naar.havenInfo ?? null} stationKey={endpoints?.naar.key ?? null} bootDiepgang={boat.draftM} />
        </>
      )}
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
    weergetij: (
      <>
        {/* geen routechip: de havenschakelaar staat bovenaan dit scherm */}
        <WeerGetijScreen nowMs={nowMs} havens={{ van: endpoints?.van ?? null, naar: endpoints?.naar ?? null }}
          data={{ van: vanData, naar: naarData }} />
      </>
    ),
    vaarplan: (
      <>
        {maakRouteChip("chip-route")}
        <VaarplanScreen
          ready={ready} depMs={depMs} trip={selTrip} from={endpoints?.van ?? null} to={endpoints?.naar ?? null}
          distanceNm={routeDistNm} bearingDeg={routeBearing} legs={etappeLegs} gusts={routeGusts} waves={routeWaves}
          fromTide={routeTide} via={viaHavens} boat={boat}
          anyStroom={routeMeta.stroomComplete || routeMeta.stroomPartial} legTimelines={routeMeta.legTimelines} />
      </>
    ),
  };

  return (
    <div className="shell">
      <TopBar chip={maakRouteChip()} bijgewerkt={nowMs ? localHM(nowMs) : null} onMenu={() => setBootOpen(true)} />
      <BootPaneel open={bootOpen} onClose={() => setBootOpen(false)} boat={boat} setBoat={setBoat} />
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
