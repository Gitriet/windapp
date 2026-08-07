# RAPPORT — Vaarplan-pagina (Fase 0)

Alleen gelezen, geen wijzigingen. Bevindingen per punt uit de opdracht.

## 1. Hoe werkt de `page`-state?

In [`app/page.tsx`](app/page.tsx):

```ts
const [page, setPage] = useState<"now" | "departure">("now");
```

- **Waarden**: `"now"` (Nu-view) en `"departure"` (Tocht-planner). Geen derde waarde.
- **Wisselen**: twee nav-links in de header roepen `setPage("now")` / `setPage("departure")` aan (`page.tsx:332-333`). `aria-current` markeert de actieve.
- **Render per waarde** (`page.tsx:363-371`):
  - `"now"` → `<NowView … />`
  - anders → `<DepartureView … />` (met de hele planner-state als props).
- **Locatiepicker** (`page.tsx:341`) is alleen relevant voor Nu; in de planner blijft hij renderen maar met `visibility: hidden` + `pointerEvents: none` zodat de header niet verspringt. **Dit is exact het patroon dat de opdracht voor `"vaarplan"` vraagt.**
- De dropdown-menu van de picker rendert alleen bij `page === "now"` (`page.tsx:348`).

➡️ Uitbreiden naar `"now" | "departure" | "vaarplan"` is klein: type verbreden, een render-tak toevoegen, en de picker-condities aanpassen (nu `=== "now"` checks — die blijven correct voor vaarplan want die is ook niet-"now").

## 2. Data bij een geselecteerd vertrekmoment

### TripStep — bestaat als `SimStep` in [`lib/tripsim.ts`](lib/tripsim.ts:30)

```ts
export type SimStep = {
  tMs: number;   // tijd (ms)
  prog: number;  // nm langs de HELE route
  stw: number;   // kn door het water
  sog: number;   // kn over de grond
  cur: number;   // kn stroom langs de koers (>0 = mee)
  twa: number;   // ware windhoek 0–180
  wSpd: number;  // ware windsnelheid over de grond (kn)
  wDir: number;  // windrichting waaruit (graden)
};
```

**Belangrijk: er is GEEN `lat`/`lon` per stap.** Positie zit alleen als `prog` (nm langs de route). Koers zit niet in de stap, maar is per been `bearing(from,to)` en globaal `routeBearing`. Positienaam moet dus afgeleid worden uit `prog` + de haven-keten (`waypoints` hebben wél lat/lon), of anders de fallback "~X nm gevaren".

### Is de stappen-array al berekend en beschikbaar?

Ja. `selTrip = runSim(depMs)` (`page.tsx:293`) levert een volledige `SimResult` met `steps: SimStep[]`. `runSim` is een gememoïseerde functie (`page.tsx:259-267`) die `simulateTrip(...)` draait met `routeWind`, `waypoints`, `alongPerLeg`, `legDistNm`. Deze wordt al gebruikt voor de trip chart en de detail-tags. **De vaarplan-view heeft dus niks nieuws te rekenen — dezelfde `selTrip` volstaat.**

`SimResult` (`lib/tripsim.ts:41`) bevat verder: `departMs`, `arrMs`, `tripMin`, `tripNcMin`, `effectMin`, `avgSog`, `avgStw`, `kentMs`, `distanceNm`, `unreachable`.

### Kentering-tijd

`selTrip.kentMs` (number | null) — de eerste tekenwissel van de stroom binnen de tocht, lineair geïnterpoleerd (`lib/tripsim.ts:207-215`). Kant en klaar. Voor een tussenrij in de tijdlijn kan ik óf `kentMs` gebruiken, óf zelf per gesampled paar op tekenwissel van `cur` controleren (consistenter met de tabel).

## 3. `SummaryRow`-data in de detail-blok

`SummaryRow` ([`charts.tsx:375`](app/components/charts.tsx:375)) neemt `{ trip: SimResult }` en toont **3** kaarten (niet 6 zoals de comment zegt): Aankomst (`localHM(arrMs)`), Vaartijd (`fmtDur(tripMin)`), Stroomeffect (`±effectMin min`, groen/rood). 

Herbruikbaar: ja, maar de vaarplan-kop wil 4 andere metrics (Vertrek, Aankomst, Vaartijd, Afstand). Ik bouw eigen metric-cards in de kop (afstand komt uit `route`/`distanceNm`, vertrek uit `depMs`). De wind-/stroom-tekst hergebruikt dezelfde afleidingslogica als de `reason`-regel in `DepartureView` (`page.tsx:638-668`) en de helpers `dirLabel16`, `sailPhrase`, `tripWind` uit charts.tsx.

## 4. Getijdata — HW/LW

- `routeTide` (`page.tsx:110`) = `TideData` van de **VERTREKHAVEN** (getijstation `waypoints[0].location_key`), opgehaald bij tochtwissel (`page.tsx:206-210`).
- `TideData.extremes: TideExtreme[]` = `{ kind: "HW"|"LW", t, v }` — **HW/LW zitten al kant-en-klaar in de data**, uit de expected-curve door RWS/de tide-laag bepaald (`lib/types.ts:112-118`). 
- `hwMs` (`page.tsx:295`) filtert al de HW-tijden eruit.
- ➡️ **Geen eigen `findHighLow` nodig** — `extremes` levert de pieken/dalen. Ik pak "eerste HW en LW na vertrek" met een simpele `.find()`.

**Beperking (belangrijk voor punt 3/4)**: alleen de **vertrekhaven**-tide zit in state. De aankomsthaven-tide wordt nergens opgehaald (HavenSelector fetcht zijn eigen tide intern, maar dat lift niet naar page-state). De opdracht zegt "geen extra API-fetches". Dus:
- Vertrekhaven: echte HW/LW + gate-window uit `routeTide`.
- Aankomsthaven: geen getijcurve beschikbaar zonder extra fetch → HW/LW-kolom toont "—" of ik hergebruik dezelfde tide alleen als beide havens hetzelfde station delen. Ik documenteer dit en toon eerlijk wat er is.

## 5. Haveninfo — `fromStation`/`toStation`

`DepartureView` krijgt `fromStation`/`toStation` als `RouteHaven | null` (= `endpoints.van`/`.naar`, `page.tsx:371`). `RouteHaven` (`lib/planner-data.ts:18`) bevat `havenInfo: HavenInfo | null`. Bevestigd: de haveninfo (drempel, sluis, vhf, getij, opmerkingen, `getijgebonden`) zit erin.

**Gate-vensters zitten NIET in `havenInfo`** — die zijn dynamisch. Ze worden **binnen HavenSelector** berekend met `gateWindows(tide, gateDatumFor(key), draft, now, now+24u)` (`HavenSelector.tsx:89`), met een eigen tide-fetch. Dat lift niet naar page-state.
- ➡️ Voor de **vertrekhaven** kan de vaarplan-view de gate-vensters zelf puur berekenen uit de al aanwezige `routeTide` + `gateDatumFor(fromKey)` (geen fetch — `gateWindows` is een pure functie uit [`lib/gates.ts`](lib/gates.ts:96)).
- Voor de **aankomsthaven** ontbreekt de tide → statische badge uit `havenInfo.getijgebonden` ("Getijgebonden" / "Vrij toegankelijk"), geen live venster.

## 6. Routenetwerk — uitwijkhavens langs de route

[`lib/netwerk-path.ts`](lib/netwerk-path.ts): `shortestPath(routes, from, to)` → `ChainedRoute` met:
- `havens: RouteHaven[]` (N+1 in vaarvolgorde),
- `viaNamen: string[]` = **tussenliggende havennamen** (zonder begin/eind, `netwerk-path.ts:81`),
- `legs`, `totalNm`.

Deze `chain` zit al in page-state (`page.tsx:153`). 
- ➡️ **Multi-leg route**: uitwijkhavens = `chain.havens.slice(1, -1)` (de tussenliggende havens). Elk heeft `havenInfo`, en de afstand-vanaf-vertrek volgt uit de cumulatieve `legs[].route.lengte_nm`.
- **Single-leg route**: geen tussenhavens in de keten. Er is **geen** bestaande functie die "havens binnen X nm van de routelijn" geeft. Pragmatische keuze binnen scope: bij single-leg toon ik "geen tussenhavens op deze route" (de nice-to-have geo-zoekactie valt buiten scope).

`chain` wordt niet als prop aan `DepartureView` doorgegeven op dit moment; wel de losse `endpoints`/`route`-meta. Voor de vaarplan-view geef ik de nodige stukken (chain-havens of viaNamen) expliciet mee vanuit `page.tsx`.

## Gevolgen voor de prop-interface (afwijkend van de opdracht)

De opdracht-interface noemt types die niet bestaan; ik map ze op de echte:
- `TripStep[]` → `SimStep[]` (uit `selTrip.steps`).
- `DepartureInfo` → ik geef `depMs: number` + `trip: SimResult` (= de `DepOption`-vorm).
- `RouteInfo route` → bestaat, maar ik geef liever de al-afgeleide velden mee (`routeDistNm`, `routeBearing`, `route.pathNamen`/`viaPassage`) omdat die in `page.tsx` al berekend zijn.
- `tideCurves` → alleen `from` (= `routeTide`) is beschikbaar; `to` ontbreekt zonder extra fetch.
- `gateWindows` → niet in state; de view berekent de vertrek-gate zelf uit `routeTide` (pure `gateWindows()`), of ik reken hem in `page.tsx` en geef hem mee.
- `BoatProfile boat` → `DEFAULT_BOAT` uit `lib/polar`.

Definitieve prop-vorm leg ik vast bij punt 3.

## Samenvatting haalbaarheid

| Sectie | Databron | Status |
|---|---|---|
| Kop (metrics/badges) | `depMs`, `selTrip`, `routeDistNm`, `routeBearing`, `route.pathNamen` | ✅ aanwezig |
| Weer-samenvatting | `selTrip.steps` (wDir/wSpd) | ✅ aanwezig |
| HW/LW vertrek | `routeTide.extremes` | ✅ aanwezig |
| HW/LW aankomst | — | ⚠️ geen data zonder extra fetch |
| Tijdlijn | `selTrip.steps` (gesampled op heel uur) | ✅ aanwezig |
| Positienaam | interpolatie `prog`→keten, of fallback "~X nm gevaren" | ✅ (fallback) |
| Kentering-rij | `selTrip.kentMs` / tekenwissel `cur` | ✅ aanwezig |
| Havenkaarten | `fromStation.havenInfo` / `toStation.havenInfo` | ✅ aanwezig |
| Gate-badge vertrek | `gateWindows(routeTide, …)` puur | ✅ (zelf rekenen) |
| Gate-badge aankomst | statisch uit `havenInfo.getijgebonden` | ⚠️ geen live venster |
| VHF verkeersposten | handmatige `VHF_VERKEERSPOSTEN`-mapping | ✅ nieuw te maken |
| Uitwijkhavens | `chain.havens.slice(1,-1)` (multi-leg) | ✅ multi-leg; single-leg leeg |
