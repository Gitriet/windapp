"use client";
// Tidan — drie schermen (ROUTE · WIND & GETIJ · VAARPLAN) in één schil. Data en logica
// leven in app/use-tocht.ts (useTocht, useHaven) en lib/; dit bestand verbindt alleen.
import { useEffect, useState } from "react";
import HavenSelector from "./components/HavenSelector";
import RouteScreen from "./components/RouteScreen";
import WeerGetijScreen from "./components/WeerGetijScreen";
import VaarplanScreen from "./components/VaarplanScreen";
import { useTocht, useHaven } from "./use-tocht";
import { useBoot } from "./use-boot";
import BootPaneel from "./components/BootPaneel";
import StartKiezer from "./components/StartKiezer";
import { useStartHavens } from "./use-start-haven";
import { geldigeStart } from "@/lib/start-haven";
import { useScreenTab, useVertrekUrl } from "./use-app-url";
import { SCREENS, type ScreenId } from "./screens";
import { TopBar, TabBar, RouteKiezer, ScreenPanel } from "./components/Shell";
import { localHM } from "@/lib/tz";
import { windOnderweg, windPerUur } from "@/lib/tocht";

export default function Page() {
  const [boat, setBoat] = useBoot();
  const [bootOpen, setBootOpen] = useState(false);
  const tocht = useTocht(boat);
  const [tab, setTab] = useScreenTab();
  const {
    fromHaven, toHaven, chooseFrom, chooseTo, kiesHavens, keerOm, weerOp, allHavens, naamOf, vanOptions, naarOptions,
    endpoints, routeBearing, routeDistNm,
    routeMeta, viaHavens, chainHavens, routeLijn, routeVarianten, routeIdx, chooseRoute, depMs, setDepMs, depOptions, bestOption, venster, vensters, firstDepMs, selTrip,
    routeTide, routeTideNaar, gustsVoor, routeWaves, vanWeather, etappeLegs, horizonUur, ready, nowMs,
  } = tocht;
  const vanData = useHaven(endpoints?.van ?? null);
  const naarData = useHaven(endpoints?.naar ?? null);
  const err = tocht.err ?? vanData.err ?? naarData.err;
  useVertrekUrl(depMs, setDepMs, depOptions);
  const onderwegGusts = selTrip ? gustsVoor(selTrip) : [];
  const onderweg = selTrip ? windOnderweg(selTrip, onderwegGusts) : null;
  const onderwegUren = selTrip ? windPerUur(selTrip, onderwegGusts, weerOp) : [];   // wind en vlagen onderweg, voor de WEER-hero

  // Startstand: laatst gebruikte havens zolang ze <48u geleden gebruikt zijn, anders het
  // startvenster. Daarna wordt elke havenstand bewaard (ook dat verlengt de termijn).
  const { opgeslagen, bewaar } = useStartHavens();
  const [startFase, setStartFase] = useState<"init" | "vraag" | "klaar">("init");
  useEffect(() => {
    if (startFase !== "init" || opgeslagen === undefined || !allHavens.length) return;
    const s = geldigeStart(opgeslagen, Date.now(), allHavens);
    if (s) kiesHavens(s.van, s.naar);
    setStartFase(s ? "klaar" : "vraag");
  }, [startFase, opgeslagen, allHavens]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (startFase === "klaar" && fromHaven && toHaven) bewaar(fromHaven, toHaven);
  }, [startFase, fromHaven, toHaven, bewaar]);

  // routekiezer: schakelaar VERTREK/AANKOMST boven ROUTE en VAARPLAN (en in de topbalk);
  // elk vlak opent de havenkiezer van die kant
  // Een nieuwe vertrekhaven wacht tot ook de aankomsthaven gekozen is: pas dan wordt de tocht (opnieuw) berekend.
  const [wachtVan, setWachtVan] = useState<string | null>(null);
  const maakRouteChip = (className?: string) => (
    <RouteKiezer className={className} van={wachtVan ? naamOf(wachtVan) : endpoints?.van.naam ?? "…"} naar={endpoints?.naar.naam ?? "…"}
      varianten={routeVarianten} variant={routeIdx} onVariant={chooseRoute} onOmruil={keerOm} onSluit={() => setWachtVan(null)}>
      {(kant, sluit, open) => kant === "van" ? (
        <HavenSelector value={wachtVan ?? fromHaven} options={vanOptions} naamOf={naamOf} onSelect={(h) => { setWachtVan(h); open("naar"); }}
          stationKey={endpoints?.van.key ?? null} bootDiepgang={boat.draftM} />
      ) : (
        <HavenSelector value={toHaven} options={wachtVan ? allHavens.filter((h) => h !== wachtVan) : naarOptions} naamOf={naamOf}
          onSelect={(h) => { if (wachtVan) kiesHavens(wachtVan, h); else chooseTo(h); sluit(); }}
          stationKey={endpoints?.naar.key ?? null} bootDiepgang={boat.draftM} />
      )}
    </RouteKiezer>
  );
  const startVenster = (
    <StartKiezer open={startFase === "vraag"} van={endpoints?.van.naam ?? "…"} naar={endpoints?.naar.naam ?? "…"}
      onKlaar={() => setStartFase("klaar")}>
      {(kant, volgende) => kant === "van" ? (
        <HavenSelector value={fromHaven} options={vanOptions} naamOf={naamOf} onSelect={(h) => { chooseFrom(h); volgende(); }}
          stationKey={endpoints?.van.key ?? null} bootDiepgang={boat.draftM} />
      ) : (
        <HavenSelector value={toHaven} options={naarOptions} naamOf={naamOf} onSelect={chooseTo}
          stationKey={endpoints?.naar.key ?? null} bootDiepgang={boat.draftM} />
      )}
    </StartKiezer>
  );
  const content: Record<ScreenId, React.ReactNode> = {
    route: (
      <>
        {maakRouteChip("chip-route")}
        <RouteScreen
          ready={ready} fout={!!err} nowMs={nowMs} best={bestOption} venster={venster} vensters={vensters} firstDepMs={firstDepMs} horizonUur={horizonUur}
          nuOptie={depOptions[0]?.depMs === firstDepMs ? depOptions[0] : null}
          anyStroom={routeMeta.stroomComplete || routeMeta.stroomPartial} distanceNm={routeDistNm} depMs={depMs} selTrip={selTrip}
          routeBearing={routeBearing} routeTide={routeTide} gustsVoor={gustsVoor} vanWeather={vanWeather}
          onSelect={setDepMs} onOpenVaarplan={() => setTab("vaarplan")} />
      </>
    ),
    weertocht: (
      <>
        <WeerGetijScreen nowMs={nowMs} havens={{ van: endpoints?.van ?? null, naar: endpoints?.naar ?? null }}
          data={{ van: vanData, naar: naarData }} onderweg={onderweg} onderwegUren={onderwegUren}
          trip={selTrip ? { vertrekMs: selTrip.departMs, aankomstMs: selTrip.arrMs } : null} />
      </>
    ),
    vaarplan: (
      <>
        {maakRouteChip("chip-route chip-vaarplan")}
        <VaarplanScreen
          ready={ready} depMs={depMs} trip={selTrip} from={endpoints?.van ?? null} to={endpoints?.naar ?? null}
          distanceNm={routeDistNm} bearingDeg={routeBearing} legs={etappeLegs} gustsVoor={gustsVoor} waves={routeWaves}
          fromTide={routeTide} toTide={routeTideNaar} via={viaHavens} boat={boat}
          anyStroom={routeMeta.stroomComplete || routeMeta.stroomPartial}
          punten={chainHavens} lijn={routeLijn} />
      </>
    ),
  };

  return (
    <div className="shell" data-tab={tab}>
      <TopBar chip={maakRouteChip()} bijgewerkt={nowMs ? localHM(nowMs) : null} onMenu={() => setBootOpen(true)} />
      {startVenster}
      <BootPaneel open={bootOpen} onClose={() => setBootOpen(false)} boat={boat} setBoat={setBoat} />
      {err && <div role="alert" style={{ padding: "var(--sp-6) var(--gutter)", color: "var(--ochre)", fontSize: "var(--fs-label)" }}>Fout bij laden: {err}</div>}
      <main className="shell-screens" style={{ "--schermen": SCREENS.length } as React.CSSProperties}>
        {SCREENS.map((s) => (
          <ScreenPanel key={s.id} label={s.label} active={s.id === tab}>{content[s.id]}</ScreenPanel>
        ))}
      </main>
      <TabBar active={tab} onSelect={setTab} />
    </div>
  );
}
