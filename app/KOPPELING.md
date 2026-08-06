# Ontwerp → data: koppeling Tocht-planner

De design-handoff (`design_handoff_tocht_planner/`) was een losstaand prototype met
**synthetische** data (formules voor wind, stroom en getij). Deze pagina bouwt datzelfde
ontwerp na in de bestaande Next.js-app, gevoed door de **echte** API's en libs.

## Nieuwe/gewijzigde bestanden

| Bestand | Rol |
|---|---|
| `app/layout.tsx`, `app/globals.css` | Root-layout + design-tokens/utility-classes uit de handoff (de private "nocturne"-stylesheet is nagemaakt). |
| `app/page.tsx` | Client-orchestratie: state (page/locIdx/depDay/depRange/depMs), data-fetch, Nu-view + Tocht-planner. |
| `app/components/charts.tsx` | SVG's uit het prototype geport naar TSX, gevoed door echte data: `CurrentTimeline`, `TripChart`, `SummaryRow`, `DepartureCards`, `WindBarbs`, `Compass`. |
| `app/components/WindCanvas.tsx` | Particle-wind-achtergrond. |
| `lib/planner-data.ts` | Fetch-helpers + transforms (API-shape → sim-input). |
| `lib/tripsim.ts` | ETA-simulatie mét stap-uitvoer, op de echte `polar.ts` + `route.ts`. |

## Veld-voor-veld: prototype → echte bron

| Prototype (synthetisch) | Echte bron | Transform |
|---|---|---|
| `_wind()` diurnaal model | `GET /api/forecast/{dekooy,texel}` → `points[]` | `toWindSamples()` → `WindSample[]` per waypoint; vector-interpolatie in `tripsim.ts` |
| `_curr()` cosinus (M2) | `GET /api/route-stroom?routes=R09` → `u/v` per samplepunt | `projectAlongRoute(u,v,koers)` gemiddeld over de punten → `alongKn` per uur |
| vaste `hwBase` HW-reeks | `GET /api/tide/texel` → `extremes[]` (kind HW) | HW-tijden als gouden markers in de stroomtijdlijn |
| inline `_sim()` (kopie van passage.ts) | `lib/polar.ts` (`boatSpeed`/`bestVmg*`) + `lib/route.ts` (`bearing`) | `simulateTrip()` — zelfde 5-min integratie + wind-over-water-aftrek als `passage.ts`, maar registreert elke stap voor de grafiek |
| Scheveningen→IJmuiden, 23,8 nm/022° | De Kooy→Texel, uit `/api/locations` + samplepunt-geometrie | afstand via `haversine`, koers via `bearing()` → **4,6 nm / 031°** |
| 7-daagse hardcoded tabel | `GET /api/week/texel` → `days[]` | rating via `classifyVenster()`; getij H/L uit tide-extremes per lokale dag |

## Waarom De Kooy → Texel (en niet Scheveningen → IJmuiden)

Het ontwerp koos een tocht die niet in de data zit. De **enige** route waar alle drie de
lagen met echte data oplichten is de Marsdiep-oversteek: beide zijn gekalibreerde
windstations én Wad-getijpunten, en het is de enige netwerkroute (`R09`) met
stroom-forecast. `DEFAULT_ROUTE_KEYS = ["dekooy","texel"]` stond hiervoor al klaar in
`lib/route.ts`.

## Bewuste, eerlijke gaps (getoond als `—`, niet verzonnen)

1. **Golfhoogte** — geen databron in de app. 7-daagse "Golf"-kolom toont `—`.
   Vervolg: Open-Meteo *marine* (`wave_height`) toevoegen aan de weer-overlay.
2. **Watertemperatuur** — niet opgehaald; de hero-tag is vervangen door de modelnaam.
3. **Route vast op R09** — andere routes hebben (nog) geen stroom-forecast geïngest
   (zie `windapp/ingest/netwerk.py`). Een multi-route-planner vereist stroom-ingestie
   voor meer routes + een routekiezer.
4. **Stroom-horizon ~52 u, ~67% niet-null** (droge cellen in de bbox). Vertrekken voorbij
   de horizon (Morgen/Overmorgen, latere uren) simuleren met `cur=0` — de sim valt stil
   terug, nog zónder zekerheidsvlag. Vervolg: `certaintyLabel()` uit `route.ts` koppelen.

## Aanbevolen consolidatie

`lib/tripsim.ts` dupliceert de integratie van `lib/passage.ts` alleen om de tussenstappen
(SOG/STW/stroom/wind per 5 min) naar buiten te brengen die de grafiek nodig heeft.
Netter is `computePassage()` een optionele `recordSteps`-modus geven en `tripsim.ts` laten
vervallen — één waarheid voor de vaartijd-natuurkunde.

## Locatiepicker

Stuurt de **Nu-view** (16 echte locaties uit `/api/locations`). De Tocht-planner toont de
vaste Marsdiep-route, los van de picker — omdat daar de stroomdata ligt.
