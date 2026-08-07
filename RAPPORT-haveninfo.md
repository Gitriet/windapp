# RAPPORT — Haveninfo (Fase 0)

Alleen gelezen, geen wijzigingen. Vier punten zoals gevraagd.

## 1. Havenselectie-flow in `page.tsx`

De havenselectie zit in de **Tocht-planner** (`page === "departure"`), niet in de Nu-view.

**State (in `Page()`):**
- `fromHaven: string` / `toHaven: string` — de gekozen vertrek- en aankomsthaven, als haven-**key** (bijv. `"den-helder"`). Gezet met `useState("")`, geïnitialiseerd na mount uit de default route R09 (`app/page.tsx:101-102`, `:132`).
- `routes: RouteInfo[]` — alle bekende havenroutes, opgehaald via `fetchRoutes()` uit `/api/routes` (`:100`, `:124`).

**Afgeleide waarden (useMemo):**
- `havenMap: Map<string, RouteHaven>` — alle havens (uit de route-uiteinden `r.van` / `r.naar`), gededupliceerd op key (`:142-146`).
- `allHavens: string[]` — de keys, op naam gesorteerd (`:147-150`).
- `chain` = kortste pad (Dijkstra op `lengte_nm`) tussen `fromHaven` en `toHaven` (`:155`).

**Component:** de selectie-UI is `RouteHavenPicker` (`app/page.tsx:544`), een custom dropdown (géén native `<select>`), tweemaal gerenderd binnen `DepartureView` — "Van" en "Naar" (`:715`, `:717`). De keuze loopt via `chooseFrom` / `chooseTo` (`:182-190`), die bij een botsing (Van == Naar) de tocht omdraaien.

**Doorgifte:** `DepartureView` krijgt `routes, fromHaven, toHaven, chooseFrom, chooseTo, allHavens, fromStation, toStation` als props (`:365-366`, signature `:622-631`). `fromStation` / `toStation` zijn de `RouteHaven`-objecten van de gekozen havens (bevatten `haven`, `naam`, `lat`, `lon` + dichtstbijzijnd weerstation). **Dit is het natuurlijke aanhechtpunt voor de haveninfo-kaart.**

## 2. `havens.json` en de netwerk-pipeline

**`data/routes/havens.json`** — array van 20 objecten, per haven:
- `id` (slug, bijv. `"vlissingen"`), `naam` (bijv. `"Vlissingen"`), `sluis` (boolean).

Meer velden zitten er niet in. De 20 keys (= exact de route-eindpunten uit `routes-R01-R21.geojson`, dus exact wat in `netwerk_havens` terechtkomt):

```
breskens, cadzand-bad, delfzijl, den-helder, den-oever, eemshaven,
harlingen, ijmuiden, kornwerderzand, lauwersoog, nes-ameland, oudeschild,
roompotsluis, scheveningen, schiermonnikoog, stellendam, terneuzen,
vlieland, vlissingen, west-terschelling
```

**Laadketen:**
1. `ingest/netwerk.py` leest `havens.json` + `routes-R01-R21.geojson`, valideert dat elke route-van/naar in `havens.json` zit, en berekent per haven-slug een canoniek punt (gemiddelde van de route-eindpunten). Schrijft idempotent (upsert, geen TRUNCATE) naar Neon-tabel **`netwerk_havens(id, naam, lat, lon, sluis)`** (`netwerk.py:45-51`, `:208-217`).
2. **`/api/routes`** (`app/api/routes/route.ts`) joint `netwerk_routes` met `netwerk_havens` (2×, voor van + naar), voegt per haven-uiteinde het dichtstbijzijnde weerstation toe (`getLocations()` + haversine), en dedupliceert op ongeordend haven-paar (kortste route wint). Response: `{ routes: RouteInfo[] }` — géén losse havenlijst; havens zitten genest als `route.van` / `route.naar`.
3. Client: `fetchRoutes()` in `lib/planner-data.ts:33` → typing `RouteInfo` / `RouteHaven` (`:17-24`).

**Gevolg voor punt 2:** er is geen apart "haven-object" in de response — de haveninfo moet worden gemerged op de genest `van`/`naar` (`RouteHaven`), niet op een top-level havenlijst.

## 3. `lib/gates.ts`

- **`GATE_DATUMS: Record<string, GateDatum>`** is momenteel **leeg** (`{}`). Bewust: zolang voor geen station zowel kaartdiepte over de drempel áls het reductievlak t.o.v. NAP bekend is, levert elke poort een "gat".
- **`GateDatum = { sillDepthChartM; reductievlakOnderNapM }`** — let op: dit is een **ander referentiemodel** dan `havens-info.json`:
  - gates.ts: `sillDepthChartM` = kaartdiepte over de drempel t.o.v. het reductievlak (positief), plus `reductievlakOnderNapM` (hoeveel het reductievlak ónder NAP ligt).
  - haveninfo (deze opdracht): `drempel.diepte_m_nap` = drempeldiepte direct t.o.v. NAP (negatief = onder NAP).
  - De brug tussen beide (`GATE_DATUMS` vullen uit haveninfo) is expliciet een **vervolgstap**, niet deze opdracht.
- **`depthOverSillM(datum, napCm)`** = `datum.sillDepthChartM + napCm/100 + datum.reductievlakOnderNapM` — werkelijke waterdiepte over de drempel bij een NAP-stand.
- **`requiredDepthM(boat)`** = `boat.draftM + boat.keelClearanceM`.
- Verder: `gateWindows()`, `evaluateGate()`, `GateVerdict` (status `gehaald` / `net-aan` / `niet-gehaald` / `onbekend`).

**Scope:** deze opdracht raakt `gates.ts` niet aan. De HavenInfoCard rekent zelfstandig met `drempel.diepte_m_nap` + `bootDiepgang` (zie ⚠️ onder punt 4).

## 4. `BoatProfile` in de Tocht-planner-context

- **`BoatProfile`** (`lib/polar.ts:12-19`): `{ archetype, draftM, keelClearanceM, performance, motorSpeedKn }`. `draftM` = diepgang (m), `keelClearanceM` = gewenste kielspeling (m).
- **`DEFAULT_BOAT`** (`lib/polar.ts:21`): de Winner 11.20 met `draftM: 1.95`, `keelClearanceM: 0.5`.
- In `page.tsx` wordt **alleen `DEFAULT_BOAT`** gebruikt (import `:8`, gebruik in de sim `:265` en in de badge `:738`). Er is (nog) geen instelbare boot-state; de diepgang is de constante `DEFAULT_BOAT.draftM`.
- **Conclusie:** de UI kan bij de diepgang via `DEFAULT_BOAT.draftM` (1,95 m). De `HavenInfoCard` krijgt `bootDiepgang` als prop en `DepartureView` levert `DEFAULT_BOAT.draftM` aan. Kielspeling (`keelClearanceM`) is beschikbaar maar valt buiten de opdracht-berekening (die noemt alleen diepgang).

---

## ⚠️ Ambiguïteit in de benodigde-waterstand-berekening (punt 3)

De opdracht geeft twee formules die van teken verschillen:
- Mockup-tekst: `benodigde waterstand = drempel_diepte + boot_diepgang` → met `-3,30 + 1,95 = -1,35 m NAP`.
- Succescriterium: `−drempel_diepte_m_nap − bootDiepgang` → `3,30 - 1,95 = +1,35`.

Fysisch correct voor "minimaal benodigde waterstand t.o.v. NAP" is **`diepte_m_nap + bootDiepgang = -1,35 m NAP`** (bij een drempel op -3,30 NAP en 1,95 m diepgang kan het water tot 1,35 m ónder NAP zakken en nog net passeren). Het succescriterium (`+1,35`) is de negatie daarvan en komt overeen met "speling t.o.v. NAP=0", niet met "benodigde waterstand". Dit is voor de gebruiker afgestemd vóór het bouwen van punt 3.
