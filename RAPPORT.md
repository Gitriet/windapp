# Strip-rapport Windapp — van app naar schone datalaag

**Scope:** `windapp/` (de Next.js-app). De analyse-/artefactpijplijn in de repo-root
(`build_serving.py`, `run_*.py`, `getij_verschillen.py`, `outputs/`, `cache/`, `data/`)
valt buiten deze opdracht en wordt alleen genoemd waar `windapp/` ervan afhangt.

**Opdracht:** onderzoeksrapport, er is **niets** gewijzigd aan de code.

---

## 0. Aannames (expliciet)

1. **De datalaag én de volledige HTTP-API blijven werkend en ongewijzigd.** Alle routes
   onder `app/api/**` blijven bestaan en moeten vóór en na elke stripstap dezelfde
   response geven op dezelfde parameters (uitgangspunt uit de opdracht).
2. **"Verwerken" hoort bij de datalaag.** De pure rekenlagen (getijpoort, ETA-integratie,
   polaire, venster-/zekerheidsclassificatie, getij-interpolatie) reken ik tot "data
   verwerken", ook al worden ze vandaag alléén client-side aangeroepen. Ze bevatten de
   verborgen datalogica uit sectie 4 en blijven behouden. Zie **Open vraag 1** — dit is
   de enige plek waar "datalaag" ruimer is dan "de huidige HTTP-API".
3. **Byte-voor-byte identiek** is voor de live endpoints (`forecast`, `tide`, `week`,
   `stroom`, `route-stroom`) alleen toetsbaar tegen een bevroren bovenstroom + vaste klok,
   omdat ze live data en `Date.now()` gebruiken. De praktische garantie is tweeledig en
   staat in **sectie 6 → API-CONTRACT** en de verificatie per stap.
4. De app draait op Next.js 14 App Router; route-handlers (`app/api/**/route.ts`) draaien
   zonder dat er één React-pagina hoeft te bestaan. Een root-`layout.tsx` is alleen nodig
   zodra er nog pagina's zijn.
5. "UI weg" = presentatie (pagina's, componenten, styling, fonts, kaart-rendering,
   SVG-meters, prototypes). De React-*state* (route/boot in `localStorage`) reken ik tot UI.

---

## 1. Inventaris

Classificatie: **DATA** · **UI** · **GEMENGD** · **INFRA** · **DOOD**.
Regels = `wc -l`. Alleen versiebeheerde bron; `node_modules/`, `.next/`, `*.tsbuildinfo`
overgeslagen.

### app/ — API-routes (server)

| Bestand | Regels | Klasse | Toelichting |
|---|--:|---|---|
| `app/api/forecast/[key]/route.ts` | 14 | **DATA** (INFRA-schil) | → `buildSeries` |
| `app/api/locations/route.ts` | 8 | **DATA** | → `getLocations` |
| `app/api/tide/[key]/route.ts` | 14 | **DATA** | → `buildTide` |
| `app/api/week/[key]/route.ts` | 14 | **DATA** | → `buildWeek` |
| `app/api/stroom/route.ts` | 28 | **DATA** | → `buildStroom`, param-validatie |
| `app/api/route-stroom/route.ts` | 125 | **DATA** | grid-sampling, along-route projectie, pijlen/vectoren |

### app/ — pagina's + shell (client)

| Bestand | Regels | Klasse | Toelichting |
|---|--:|---|---|
| `app/layout.tsx` | 34 | **UI** | fonts, `globals.css`, leaflet-css, `RouteProvider` |
| `app/page.tsx` | 192 | **GEMENGD** | Tocht-scherm; roept `routeDistanceNm`/`requiredDepthM` voor weergave |
| `app/vensters/page.tsx` | 279 | **GEMENGD** | vensteropbouw + stroom-kentering-interpolatie in de component |
| `app/nu/page.tsx` | 167 | **GEMENGD** | nearest-hour, zicht-drempels, sparkline-schaling |
| `app/kaart/page.tsx` | 125 | **GEMENGD** | uur-scrubber, ETA-assemblage |
| `app/globals.css` | 392 | **UI** | design-tokens + alle styling |

### components/route/ (client)

| Bestand | Regels | Klasse | Toelichting |
|---|--:|---|---|
| `components/route/RouteProvider.tsx` | 133 | **GEMENGD** | state-mgmt + fetch `/api/locations` + `localStorage` |
| `components/route/hooks.ts` | 90 | **GEMENGD** | alle client-fetch (`useForecast`/`useTide`/…) + vorm naar `PassageWind`/`PassageCurrent` |
| `components/route/LocationDetailSheet.tsx` | 268 | **GEMENGD** | getijpoort-verdict + wind-/getijgrafiek met ingebakken horizon-drempels |
| `components/route/MapView.tsx` | 122 | **GEMENGD** | Leaflet-rendering + pijl-bearing/magnitude uit u/v |
| `components/route/BoatSheet.tsx` | 126 | **GEMENGD** | bootprofiel-UI + VMG-preview + `.plr`-download |
| `components/route/LocationSheet.tsx` | 79 | **GEMENGD** | picker-UI + area-groepering/sortering |
| `components/route/RouteHeader.tsx` | 39 | **GEMENGD** | header-UI + `fmtDate` + re-export `certaintyLabel` |
| `components/route/Eta.tsx` | 23 | **UI** | toont ETA + `passageOrigin`-regel |
| `components/route/Compass.tsx` | 28 | **UI** | kompasroos SVG |
| `components/route/TabBar.tsx` | 32 | **UI** | tabnavigatie |

### components/ — overig

| Bestand | Regels | Klasse | Toelichting |
|---|--:|---|---|
| `components/LocationPicker.tsx` | 86 | **DOOD** | nergens geïmporteerd; vervangen door `route/LocationSheet` |
| `components/useChartWidth.ts` | 21 | **DOOD** | nergens geïmporteerd |
| `components/instrument/WeekStrip.tsx` | 21 | **DOOD** | oude instrumentweergave; geen enkele pagina importeert `instrument/*` |
| `components/instrument/GetijStrip.tsx` | 41 | **DOOD** | idem |
| `components/instrument/Glyph.tsx` | 35 | **DOOD** | alleen door dode `WeekStrip` |
| `components/instrument/Kompas.tsx` | 50 | **DOOD** | idem (≠ `route/Compass`) |
| `components/instrument/Led.tsx` | 52 | **DOOD** | idem |
| `components/instrument/VBar.tsx` | 80 | **DOOD** | idem |
| `components/instrument/WindDagStrip.tsx` | 33 | **DOOD** | idem |

> Bewijs dood: `grep` op imports laat zien dat geen enkele pagina/component `instrument/`,
> `LocationPicker` of `useChartWidth` importeert. Zie [windapp-punt-light-redesign] /
> [windapp-route-app] — de instrument-view is bewust vervangen.

### lib/ (kern) — zie sectie 2 voor detail

| Bestand | Regels | Klasse | Consument |
|---|--:|---|---|
| `lib/serving.ts` | 274 | **DATA** | API forecast/week/locations/route-stroom |
| `lib/openmeteo.ts` | 104 | **DATA** | serving, smoke |
| `lib/correction.ts` | 83 | **DATA** | serving, tests, smoke |
| `lib/constants.ts` | 41 | **DATA** | serving, openmeteo |
| `lib/leads.ts` | 8 | **DATA** | serving, tests |
| `lib/borrowed.ts` | 41 | **DATA** | serving |
| `lib/db.ts` | 23 | **DATA/INFRA** | serving, tide, stroom |
| `lib/tide.ts` | 192 | **DATA** | API tide |
| `lib/stroom.ts` | 88 | **DATA** | API stroom/route-stroom |
| `lib/types.ts` | 123 | **DATA** | overal (types) |
| `lib/route.ts` | 122 | **DATA** | API route-stroom + alle client-schermen |
| `lib/gates.ts` | 149 | **DATA** | client + type-keten vanaf `route.ts` |
| `lib/passage.ts` | 237 | **DATA** | client (ETA-integratie) |
| `lib/polar.ts` | 173 | **DATA** | client + type-keten vanaf `gates.ts` |
| `lib/instrument.ts` | 94 | **GEMENGD** | `pointAtMs`/`tideNow` live; `glyphOf`/`weatherAt`/`tideDay` alleen door dode componenten |
| `lib/tz.ts` | 91 | **DATA** (presentatie-tz) | client-schermen |
| `lib/format.ts` | 17 | **GEMENGD** | `compass`/`beaufort` = classificatie; alleen client |
| `lib/weather.ts` | 54 | **DOOD (effectief)** | alleen door `lib/instrument.ts` → alleen door dode componenten |

### ingest/ — Python stroom-pijplijn (server/cron)

| Bestand | Regels | Klasse | Toelichting |
|---|--:|---|---|
| `ingest/stroom.py` | 298 | **DATA** | Matroos-fetch + NetCDF-parse → `StroomField` |
| `ingest/stroom_db.py` | 318 | **DATA/INFRA** | Neon-schema + idempotent wegschrijven + latest-wins read |
| `ingest/stroom_cron.py` | 110 | **DATA/INFRA** | uurlijkse verversing, retentie, hindcast |
| `ingest/tiles.py` | 147 | **DATA** | tegelgenerator + regio-config |
| `ingest/__init__.py` | 2 | **INFRA** | package-marker |
| `ingest/requirements.txt` | 6 | **INFRA** | py-deps |

### scripts/ · sql/ · test/ · infra

| Bestand | Regels | Klasse | Toelichting |
|---|--:|---|---|
| `scripts/seed.mjs` | 102 | **DATA/INFRA** | seedt Neon uit `../../outputs/` artefacten |
| `scripts/smoke.ts` | 42 | **DATA/INFRA** | live fetch→correct→band sanity |
| `sql/schema.sql` | 69 | **DATA/INFRA** | tabellen (locations, serving, bias_*, caches, routes) |
| `test/correction.test.ts` | 33 | **INFRA (test)** | dekt `correction`+`leads` |
| `test/gust.test.ts` | 36 | **INFRA (test)** | dekt `correctGust` |
| `test/gates.test.ts` | 107 | **INFRA (test)** | dekt `gates` |
| `test/passage.test.ts` | 153 | **INFRA (test)** | dekt `passage` |
| `test/polar.test.ts` | 90 | **INFRA (test)** | dekt `polar` |
| `test/plr.test.ts` | 54 | **INFRA (test)** | dekt `.plr`-export |
| `.github/workflows/stroom-ingest.yml` | — | **INFRA** | uurlijkse cron voor `stroom_cron` |
| `package.json` / `tsconfig.json` / `next.config.mjs` / `.env.example` | — | **INFRA** | build/config |
| `docs/instrument-prototype.html` | 263 | **DOOD/UI** | statisch design-prototype |
| `docs/redesign-prototype.html` | 254 | **DOOD/UI** | statisch design-prototype |
| `README.md` | 88 | **INFRA (doc)** | projectdoc |

---

## 2. Datalaag in detail (bron → output)

### Externe bronnen

| Bron | Aangeroepen in | Endpoint / params |
|---|---|---|
| **Open-Meteo forecast** | `lib/openmeteo.ts` | `GET api.open-meteo.com/v1/forecast` — `hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m` (+ weer voor `knmi_seamless`), `models=<id>`, `wind_speed_unit=kn`, `timezone=UTC`, `forecast_days=4`; week: `daily=…`, `timezone=Europe/Amsterdam`, `forecast_days=7`, `models=best_match` |
| **RWS WaterWebservices** | `lib/tide.ts` | `POST ddapi20-waterwebservices.rijkswaterstaat.nl/…/OphalenWaarnemingen` — `WATHTE`/`NAP`, ProcesType `verwachting`+`astronomisch` |
| **RWS Matroos** | `ingest/stroom.py` | `kustwacht.php` / `get_matroos.php` / `get_anal_times.php`, source `dcsm7_harmonie_bf_f2w` |
| **Neon Postgres** | `lib/db.ts`, `ingest/stroom_db.py` | via `DATABASE_URL` |

### Afhankelijkheidsketen per API-endpoint

```
/api/locations
  └─ serving.getLocations ─ db(sql: locations) + borrowed.SYNTHETIC_LOCATIONS

/api/forecast/[key]
  └─ serving.buildSeries
       ├─ db(sql: locations, serving, bias_speed, bias_gust, forecast_cache)
       ├─ openmeteo.fetchModel ─ Open-Meteo (7 core-modellen + knmi_seamless)
       ├─ correction.correctSpeed / correctGust
       ├─ leads.hoursToLead
       ├─ borrowed.{BORROWED_WIND,UNCORRECTED_WIND,SYNTHETIC_LOCATIONS}
       └─ constants.{CORE_MODEL_IDS,TTL_MINUTES,WEATHER_MODEL}
     → { location, points: CorrectedPoint[], weather: WeatherSeries }

/api/week/[key]
  └─ serving.buildWeek ─ openmeteo.fetchWeek ─ Open-Meteo daily+hourly
     → { location, days: WeekDay[] }

/api/tide/[key]
  └─ tide.buildTide
       ├─ RWS (verwachting + astronomisch), Promise.allSettled
       ├─ db(tide_astro_cache: self-provisioning, best-effort)
       └─ extrema + dedupeExtrema (HW/LW)
     → TideData | { tide:null }

/api/stroom            (box,from,to)
  └─ stroom.buildStroom ─ db(stroom_box_grid, stroom_veld⋈stroom_run, latest-wins)
       └─ halfToFloat/decodeF16Field/decodeF32 (byte-decode)
     → StroomData (u/v-grid m/s, NaN→null)

/api/route-stroom      (keys,from,to[,at][,vectors])
  ├─ serving.getLocations           (waypoint-coördinaten)
  ├─ stroom.buildStroom              (box-selectie op route-midden)
  └─ route.{bearing,midpoint,projectAlongRoute,pointAlongRoute,KN_PER_MS}
     → { available, box, bearing, series[], arrows?, vectors?, mid, route }
```

### Belangrijkste transformaties (server, in de API-response)

- **Bias-correctie** (`correction.ts`): cel = (richtingssector × seizoen × windband) →
  fijnste gevulde offset; `speed = max(0, fc − offset)`. Gust idem, gevloerd op de
  gecorrigeerde gemiddelde wind. ECMWF zonder gusttabel → mediaan van de core-modellen.
- **Spreidingsband** (`serving.pointAt`): min/max gecorrigeerde snelheid over `CORE_MODEL_IDS`.
- **Lead-toewijzing** (`leads.hoursToLead`): uur-vooruit → lead 1/2/3; `>72u` = `beyond`.
- **Getij-extrema** (`tide.ts`): hellingteken-extrema, dedup ≥3u, `verwachting`→`astronomisch`
  aan elkaar geplakt, wind-setup meegerekend.
- **Stroom-decode** (`stroom.ts`): bytea → float32 (assen) / float16 (velden), NaN→null,
  latest-wins per `valid_time`.
- **Along-route** (`route-stroom`): u/v op naaste natte cel (spiraalzoek), projectie op
  route-bearing (kn), optioneel grof pijlenveld + vectorenveld voor de ETA-integratie.

### Uitgevende types (`lib/types.ts`)

`Location`, `BiasModel`, `RawSeries`, `WeatherSeries`, `WeekDay`, `CorrectedPoint`,
`StroomGrid`/`StroomSlice`/`StroomData`, `TidePoint`/`TideExtreme`/`TideData`.

---

## 3. Verwevenheid (GEMENGD — wat losgetrokken moet worden)

De schermen mengen drie dingen: **datatoegang** (fetch-hooks), **afleiding**
(rekenwerk op de API-data) en **presentatie** (SVG/DOM). De afleiding zit deels in `lib/`
(al netjes), deels *in de component* — dat laatste is wat eruit moet als je ooit alleen de
datalaag wilt overhouden.

**`components/route/hooks.ts` (GEMENGD → DATA-glue).** Dit is de complete client-fetchlaag.
`useForecast/useTide/useForecasts/usePassageData/useRouteStroom` zijn `fetch` + React-state.
`usePassageData` (r. 68–83) vormt bovendien de API-response om naar `PassageWind`/`PassageCurrent`.
De *URL's en de vorm* zijn data; de `useEffect`/`useState`-verpakking is UI-runtime. Bij een
strip verdwijnt de React-verpakking; de endpoints en response-shapes blijven (dat is de API).

**`components/route/RouteProvider.tsx` (GEMENGD).** Data: `fetch("/api/locations")` +
key-opschoning (r. 65–83), waypoint-resolutie (r. 91–95). UI/state: `localStorage`
(trip/recent/boat), context. Losgetrokken: de default-route/boot-constanten wonen al in
`lib/route.ts`/`lib/polar.ts`; de rest is client-state.

**`app/vensters/page.tsx` (GEMENGD).** Verstopte datalogica in de component:
- worst-case wind over de waypoints per uur (r. 60–67) + 90-min nearest-hour-tolerantie (r. 63);
- `stroomSegments()` (r. 262–279): kentering (slack) via lineaire nul-kruising-interpolatie;
- `VStroom` (r. 221–230): max mee/tegen + `tegenFrac`.
  Presentatie: de `.slot`/`.agenda`/SVG-balken.

**`app/nu/page.tsx` (GEMENGD).** Datalogica: `visAt` nearest-hour (r. 19–24), stroom-bij-doeltijd
reduce (r. 46–49), **zicht-classificatie** `≥10 goed / ≥4 matig / anders slecht` (r. 116–119),
`Sparkline` schaling + 22 kn-drempel (r. 143, 148). Rest is presentatie.

**`app/kaart/page.tsx` (GEMENGD).** Datalogica: nearest-hour-tot-nu index (r. 34–42),
ETA-assemblage per waypoint (r. 64–77). Rest: Leaflet + scrubber-UI.

**`components/route/LocationDetailSheet.tsx` (GEMENGD).** Datalogica: 48u-venster-filter
(r. 31–33), zwaarste spreiding 24–48u → zekerheidsbanner (r. 36–40), getijpoort-verdict
via `evaluateGate` (r. 44–47). **Ingebakken horizon-drempels** in de grafiek: zone-grenzen
`x=161/241` = 24u/36u, 22 kn-lijn (r. 114, 128, 131–132), zonelabels (r. 78, 141–148).
Rest: SVG.

**`components/route/MapView.tsx` (GEMENGD).** Datalogica: pijl-bearing `atan2(u,v)` +
magnitude-normalisatie (r. 107–111). Rest: Leaflet-rendering (pure UI).

**`app/page.tsx` / `RouteHeader.tsx` / `LocationSheet.tsx` (GEMENGD, licht).**
`routeDistanceNm`/`requiredDepthM` voor labels; `fmtDate`; area-groepering+sortering.
Grotendeels presentatie met een paar lib-aanroepen.

---

## 4. Verborgen datalogica (behouden — met bestand:regel)

Logica die als data telt maar in UI-code (of in een lib die alleen door UI wordt gebruikt)
zit. **Reeds in `lib/` (behouden, geen actie):**

- `lib/route.ts:34` `VENSTER` drempels + `classifyVenster` (r. 39–43), `combineVenster`
  (r. 48–52), `certaintyLabel` (r. 58–62), geo (`bearing`/`haversineKm`/`projectAlongRoute`/
  `pointAlongRoute`).
- `lib/gates.ts` — referentievlak-model (`depthOverSillM` r. 65–67), `gateWindows` lineaire
  kruising (r. 75–95), `TIGHT_MARGIN_M`=0.3 (r. 126), status-drempels (r. 147), `levelAt`
  interpolatie (r. 102–113).
- `lib/passage.ts` — ETA-integratie: `STEP_MIN`/`MIN_SOG_KN`/`MAX_PASSAGE_HOURS` (r. 15–17),
  wind/stroom-vectorinterpolatie (r. 68–115), wind-over-water & VMG-keuze (r. 178–206).
- `lib/polar.ts` — polaire tabellen + bilineaire interpolatie (`boatSpeed` r. 105–115),
  `bestVmgUpwind/Downwind` (r. 125–142), `.plr`-hersampling (r. 160–166).
- `lib/correction.ts` — `WIND_BANDS`/`BAND_LABELS`/`MONTH_SEASON` (r. 7–12), `dirSector`/
  `speedBand`/`lookupOffset`.
- `lib/constants.ts` — `WARN` (r. 34–36), `WINDBAR_RED_KN`=22 (r. 41), model-id-sets.
- `lib/tide.ts:97` `MIN_EXTREMA_SPACING_MS`, `extrema`/`dedupeExtrema`.
- `lib/instrument.ts` — `glyphOf` weercode-drempels (r. 11–19), `weatherAt`/`pointAtMs`
  nearest-hour (r. 22–42), `tideNow` interpolatie + kentering-keuze (r. 51–78), `tideDay` (r. 83–94).
- `lib/weather.ts` — `wxGroup` WMO-drempels (r. 8–20), `VIS_LOW`/`VIS_VERYLOW` (r. 37–38),
  `sunEvents`/`isNight` (r. 42–54).
- `lib/format.ts` — `beaufort` (r. 13–17), `compass` (r. 2–5).
- `lib/tz.ts` — DST-correcte Amsterdam-tz-berekeningen (heel bestand).

**Nog in de component (moet eruit als je het wilt bewaren — zie sectie 3):**

- `app/nu/page.tsx:116–119` — **zicht-classificatie** (goed/matig/slecht). Enige echte
  classificatie die nog niet in `lib/` staat.
- `app/vensters/page.tsx:262–279` — kentering-interpolatie (`stroomSegments`); r. 221–230 —
  max mee/tegen.
- `app/vensters/page.tsx:60–67` / `app/kaart/page.tsx:34–42` / `LocationDetailSheet.tsx:31–40`
  — nearest-hour + worst-case-aggregatie + spreiding-over-horizon.
- `components/route/MapView.tsx:107–111` — stroom-pijl bearing/magnitude uit u/v.
- `LocationDetailSheet.tsx:114,128,131–132` — 22 kn-drempel en 24u/36u-horizongrenzen als
  vaste SVG-x-posities (classificatiegrenzen vermomd als layout).

> Deze zijn vandaag **niet** onderdeel van een API-response — ze draaien client-side op de
> API-data. Zie **Open vraag 1** voor of ze behouden moeten worden.

---

## 5. Dependencies (`package.json`)

| Dependency | Klasse | Na strip |
|---|---|---|
| `@neondatabase/serverless` | DATA (Neon-driver) | **behouden** |
| `next` | INFRA (host van de API-routes) | **behouden** |
| `leaflet` | UI (kaart) | **verwijderen** |
| `react` | UI (alleen door pagina's/componenten) | verwijderen zodra er geen pagina's zijn* |
| `react-dom` | UI | verwijderen zodra er geen pagina's zijn* |
| **dev** `@types/leaflet` | UI | **verwijderen** |
| **dev** `@types/react` | UI | verwijderen met react* |
| **dev** `@types/react-dom` | UI | verwijderen met react* |
| **dev** `@types/node` | INFRA | **behouden** |
| **dev** `tsx` | INFRA (seed/smoke/tests) | **behouden** |
| **dev** `typescript` | INFRA | **behouden** |

\* Next 14 verwacht `react`/`react-dom` als peer bij het bouwen. Met alleen route-handlers
compileert en draait de API zonder React-*pagina's*, maar Next kan de packages nog als peer
willen zien. **Aanbeveling:** verwijder react-deps pas in de laatste stap en verifieer
`next build` + alle endpoints; rol terug als Next klaagt (**Open vraag 3**).

Python (`ingest/requirements.txt`: requests, numpy, xarray, netCDF4, psycopg) — allemaal DATA,
**ongewijzigd behouden**.

---

## 6. Eindvoorstel

### BLIJFT (intact, ongewijzigd)

**Server-datalaag + API (byte-identiek-garantie):**
`app/api/**` (alle 6 routes) · `lib/serving.ts` · `lib/openmeteo.ts` · `lib/correction.ts` ·
`lib/constants.ts` · `lib/leads.ts` · `lib/borrowed.ts` · `lib/db.ts` · `lib/tide.ts` ·
`lib/stroom.ts` · `lib/route.ts` · `lib/types.ts`.

**Verwerkingslaag (pure functies, door de tests gedekt — zie Open vraag 1):**
`lib/gates.ts` · `lib/passage.ts` · `lib/polar.ts` · `lib/tz.ts` · `lib/format.ts` ·
`lib/weather.ts` · en de reken-exports van `lib/instrument.ts`.
*(Noot: `route-stroom` importeert `lib/route.ts`, dat een **type-only** keten heeft naar
`gates.ts`→`polar.ts`. Die twee moeten dus sowieso als bron blijven bestaan, anders faalt de
typecheck van de API.)*

**Ingestie + infra:** `ingest/**` · `scripts/seed.mjs` · `scripts/smoke.ts` · `sql/schema.sql` ·
`test/**` · `.github/workflows/stroom-ingest.yml` · `package.json`/`tsconfig.json`/
`next.config.mjs`/`.env.example` · `README.md`.

### EXTRACTIE (datalogica eruit halen vóór het scherm verdwijnt)

Alleen nodig als je de logica uit sectie 4-onderdeel-2 wilt bewaren:

| Uit | Wat | Naar |
|---|---|---|
| `app/nu/page.tsx:116–119` | zicht-classificatie (goed/matig/slecht) | nieuw `lib/visibility.ts` of `lib/weather.ts` |
| `app/vensters/page.tsx:262–279, 221–230` | kentering-interpolatie + max mee/tegen | `lib/route.ts` (naast `projectAlongRoute`) |
| `app/vensters:60–67`, `app/kaart:34–42`, `DetailSheet:31–40` | nearest-hour + worst-case + spreiding-over-horizon | `lib/instrument.ts` (bij `pointAtMs`) |
| `MapView.tsx:107–111` | pijl-bearing/magnitude uit u/v | `lib/route.ts` |
| `DetailSheet:114,128,131–132` | 22 kn + 24u/36u-grenzen als getallen | `lib/constants.ts` |

### WEG (verdwijnt volledig)

`app/layout.tsx` · `app/globals.css` · `app/page.tsx` · `app/nu/` · `app/vensters/` ·
`app/kaart/` · **alle** `components/**` (route/, instrument/, `LocationPicker.tsx`,
`useChartWidth.ts`) · `docs/instrument-prototype.html` · `docs/redesign-prototype.html`.

Direct-dood, kan als eerste weg zonder enige afweging: `components/instrument/*`,
`components/LocationPicker.tsx`, `components/useChartWidth.ts`, en (effectief) `lib/weather.ts`
+ de `glyphOf`/`weatherAt`/`tideDay`-exports van `lib/instrument.ts`.

### Voorgestelde mappenstructuur na de strip

```
windapp/
├─ app/
│  └─ api/                     # 6 route-handlers, ONGEWIJZIGD
│     ├─ forecast/[key]/route.ts
│     ├─ locations/route.ts
│     ├─ tide/[key]/route.ts
│     ├─ week/[key]/route.ts
│     ├─ stroom/route.ts
│     └─ route-stroom/route.ts
├─ lib/                        # server-datalaag + pure verwerkingslaag
├─ ingest/                     # Python Matroos→Neon
├─ scripts/                    # seed + smoke
├─ sql/schema.sql
├─ test/                       # unit-tests (vangnet)
├─ .github/workflows/stroom-ingest.yml
├─ package.json · tsconfig.json · next.config.mjs · .env.example · README.md
```

Weg: heel `app/*` behalve `app/api/`, heel `components/`, heel `docs/`.

### Volgorde van uitvoering (elke stap apart testbaar)

Elke stap eindigt met dezelfde **API-verificatie** (zie API-CONTRACT hieronder): de
response-genererende bestanden (`app/api/**` + de server-libs) hebben `git diff == leeg`, en
een live spot-check op elk endpoint geeft dezelfde shape/waarden als de vastgelegde baseline.

**Stap 0 — Baseline vastleggen.**
`npm run build` + `npm test` groen. Leg de baseline vast (zie API-CONTRACT). Snapshot
`app/api/**` en de server-libs (hash).
*Verificatie:* build+tests groen; baseline-bestanden opgeslagen.

**Stap 1 — Dode code weg (nulrisico).**
Verwijder `components/instrument/*`, `components/LocationPicker.tsx`,
`components/useChartWidth.ts`, `docs/*`.
*Verificatie:* `npm run build` + `npm test` groen; endpoints identiek aan baseline; `git diff`
op `app/api/**`+server-libs is leeg.

**Stap 2 — (optioneel) EXTRACTIE.**
Alleen als Open vraag 1 = "behouden": verplaats de logica uit de EXTRACTIE-tabel naar `lib/`.
*Verificatie:* nieuwe/aangepaste `lib/`-functies met unit-test; `npm test` groen; endpoints
nog steeds identiek (deze logica raakt geen API-route).

**Stap 3 — UI-schermen + shell weg.**
Verwijder `app/page.tsx`, `app/nu/`, `app/vensters/`, `app/kaart/`, `app/layout.tsx`,
`app/globals.css`, heel `components/route/`.
*Verificatie:* `next build` compileert alleen `app/api/**`; alle 6 endpoints byte-identiek aan
baseline; `git diff` server-set leeg. Controleer dat er geen root-layout meer nodig is (geen
pagina's meer).

**Stap 4 — Verweesde verwerkings-libs opruimen/behouden.**
Beslis per Open vraag 1. Bij "weg": verwijder `lib/instrument.ts`, `lib/format.ts`,
`lib/tz.ts`, `lib/weather.ts` **en** de bijbehorende tests — maar check eerst de type-keten
`route.ts→gates.ts→polar.ts` (die drie blijven sowieso). Bij "behouden": laten staan; ze zijn
al puur en door de tests gedekt.
*Verificatie:* `npm test` groen; `next build` groen; endpoints identiek.

**Stap 5 — Dependencies snoeien.**
Verwijder `leaflet` + `@types/leaflet`; daarna `react`/`react-dom`/`@types/react*` (los, met
terugrol-optie).
*Verificatie:* `npm install` schoon; `next build` groen; alle endpoints identiek; `npm test`
groen. Rol react-deps terug als Next erom vraagt (Open vraag 3).

---

## API-CONTRACT (referentie tijdens het strippen)

De strip raakt **geen** van deze bestanden; daarom is de sterkste verificatie *structureel*
(`git diff` op de response-set is leeg) plus een *live spot-check*. Byte-identiek is exact
haalbaar voor `/api/locations` (puur DB) en voor de rest alleen tegen een bevroren bovenstroom
+ vaste klok (zie Aanname 3). Aanbevolen baseline: `for e in <endpoints>; do curl -s "$e" >
baseline/<e>.json; done`, en na elke stap opnieuw en `diff` binnen dezelfde minuut / met dezelfde
`forecast_cache`.

Alle routes: `export const dynamic = "force-dynamic"`. Fouten: `{ error: string }` met
status 400/404/500.

### `GET /api/locations`
**Params:** geen.
**Response:** `Location[]` gesorteerd op `name` (NL). Voorbeeld-element:
```json
{ "location_key":"dekooy","name":"De Kooy","station":"De Kooy","area":"Waddenzee (Marsdiep)","lat":52.92,"lon":4.78 }
```
*(Deterministisch: puur uit Neon + `SYNTHETIC_LOCATIONS`. Ideale byte-identiek-toets.)*

### `GET /api/forecast/{key}`
**Params:** pad `key` (location_key). 404 `{"error":"unknown location"}` bij onbekend.
**Response:** `{ location: Location, points: CorrectedPoint[], weather: WeatherSeries }`.
```json
{
  "location": { "location_key":"dekooy", "name":"De Kooy", "station":"…","area":"…","lat":52.92,"lon":4.78 },
  "points": [
    { "time":"2026-08-02T12:00","lead":1,"model_id":"knmi_harmonie_arome_netherlands",
      "model_label":"HARMONIE NL","speed_kn":14.2,"dir_deg":225,"gust_kn":19.8,
      "band_low_kn":12.9,"band_high_kn":16.1,"corrected":true }
  ],
  "weather": { "time":["…"],"code":[3],"temp":[18.4],"cloud":[75],"precip":[0],
               "pop":[10],"vis":[24140],"pressure":[1014.2],"sunrise":["…"],"sunset":["…"] }
}
```
Punten `>72u` vooruit dragen `"beyond": true`. *(Live + `Date.now()`-afhankelijk.)*

### `GET /api/week/{key}`
**Params:** pad `key`. 404 bij onbekend.
**Response:** `{ location: Location, days: WeekDay[] }` (7 dagen, NL-lokaal, ongecorrigeerd).
```json
{ "location": { "location_key":"dekooy", "…":"…" },
  "days": [ { "date":"2026-08-02","code":3,"pop":20,"dir":230,"speedMax":18.0,
              "gust":24.5,"windMin":6.1,"windMean":12.7,"tmax":20.1,"tmin":13.4 } ] }
```

### `GET /api/tide/{key}`
**Params:** pad `key`. Niet-Wad/onbekend station → `{"tide":null}` (status 200).
**Response:** `TideData`.
```json
{ "code":"denhelder.marsdiep","name":"Den Helder (Marsdiep)",
  "expected":[{"t":"2026-08-02T12:00:00.000Z","v":54}],
  "astro":[{"t":"2026-08-02T12:00:00.000Z","v":49}],
  "extremes":[{"kind":"HW","t":"2026-08-02T14:20:00.000Z","v":78}],
  "expectedMissing":false,"astroStale":false }
```
Veerkracht-vlaggen: `unavailable` (RWS down, geen cache), `expectedMissing`, `astroStale`.

### `GET /api/stroom?box={box}&from={iso}&to={iso}`
**Params:** `box`, `from`, `to` (ISO) — alle verplicht. 400 bij ontbreken/ongeldige ISO;
404 `{"error":"onbekende box '…'"}`.
**Response:** `StroomData`.
```json
{ "box":"marsdiep","source":"dcsm7_harmonie_bf_f2w","units":"m/s","model_unvalidated":true,
  "analysis_time":"2026-08-02T09:00:00.000Z",
  "grid":{ "nx":.., "ny":.., "lat":[..],"lon":[..],"bbox":[lonMin,latMin,lonMax,latMax] },
  "times":[ { "valid_time":"…","analysis_time":"…","u":[0.31,null,…],"v":[-0.12,null,…] } ] }
```
Buiten de horizon: `"times": []` (expliciet leeg). Droge cel: `null`, nooit `0`.

### `GET /api/route-stroom?keys={a,b,…}&from={iso}&to={iso}[&at={iso}][&vectors={n}]`
**Params:** `keys` (≥2, komma-gescheiden), `from`, `to` verplicht; `at` (pijlenveld),
`vectors` (n sample-punten, max 33). 400 bij <2 keys/ontbrekende from/to.
**Response (geen dekking):** `{ "available":false, "reason":"…", "bearing"?:number }`.
**Response (dekking):**
```json
{ "available":true,"box":"marsdiep","bearing":41.2,"model_unvalidated":true,
  "analysis_time":"…",
  "series":[ {"t":"…","alongKn":0.83,"magKn":1.14} ],
  "arrows":[ {"lat":..,"lon":..,"u":..,"v":..} ],
  "vectors":{ "points":[{"f":0,"lat":..,"lon":..}], "times":["…"],
              "u":[[0.3,null]], "v":[[-0.1,null]] },
  "mid":{"lat":..,"lon":..}, "route":[[lat,lon],[lat,lon]] }
```
`alongKn` >0 mee / <0 tegen; gaten blijven `null`.

---

## OPEN VRAGEN

1. **Reikt "de datalaag" tot de client-side verwerkingslaag?** De HTTP-API hangt alleen af
   van de server-libs. `gates`/`passage`/`polar`/`instrument`/`format`/`tz`/`weather` +
   de venster-/zekerheids-/kentering-logica draaien vandaag **client-side** op de API-data en
   zitten in geen enkele response. Sectie 4 en de opdracht ("verwerken") zeggen: behouden. Maar
   als "datalaag" strikt = "de huidige HTTP-API", dan mogen deze mét de UI weg (m.u.v. de
   type-keten `route→gates→polar` die de API-typecheck nodig heeft). **Behouden (aanbevolen) of
   weg?** Dit bepaalt stap 2 en 4.

2. **Wil je de verborgen datalogica uit de componenten (EXTRACTIE-tabel, o.a. de
   zicht-classificatie in `nu`) redden vóór de schermen sneuvelen, of accepteren dat ze met de
   UI verdwijnen?** Alleen relevant als het antwoord op vraag 1 "behouden" is.

3. **Mogen `react`/`react-dom` uiteindelijk uit `package.json`?** Next 14 kan ze als peer
   willen zien, ook zonder pagina's. Voorstel: als laatste stap proberen, met terugrol.

4. **Waar moet `RAPPORT.md` staan?** Nu geplaatst in de repo-root
   (`Weermodellen/RAPPORT.md`); de app zelf zit in `windapp/`. Verplaatsen naar
   `windapp/RAPPORT.md` als dat logischer is.

5. **Blijft de Neon `routes`-tabel (`sql/schema.sql:63`) relevant?** Hij wordt nergens in de
   app gelezen/geschreven (routes leven in `localStorage` via `RouteProvider`). Nu ongemoeid
   gelaten; mogelijk dode kolom in het schema.

> **Beslissingen (definitief, uitvoeringsopdracht):** 1 → behouden (verwerkingslaag is
> kernlogica, geen UI). 2 → ja, verborgen datalogica wordt vóór de schermen gered (Stap 2
> verplicht). 3 → `react`/`react-dom` als allerlaatste stap, aparte commit, terugrol als
> `next build` klaagt. 4 → `RAPPORT.md` verhuisd naar `windapp/RAPPORT.md`. 5 → `routes`-tabel
> blijft ongemoeid; zie "Bekende dode restanten".

## Bekende dode restanten

Restanten die na de strip in het schema/de repo achterblijven en bewust **niet** worden
aangeraakt (buiten de scope van deze opdracht), maar hier vastgelegd zodat ze bekend zijn:

- **`routes`-tabel — `sql/schema.sql:63`.** `CREATE TABLE IF NOT EXISTS routes (...)`, bedoeld
  voor opgeslagen routes ("Optional in v1"). Geverifieerd: nergens in `app/`, `lib/`,
  `scripts/`, `ingest/` wordt deze tabel gelezen of geschreven — routes leven volledig in
  `localStorage` via `RouteProvider`. De tabel blijft ongemoeid in het schema.

---

## Uitvoering

De strip is uitgevoerd als een keten van aparte, afzonderlijk terugrolbare commits op
`main` (repo: `windapp/`). Vertrekpunt: de werkboom bevatte de volledige route-app deels
**ongecommit** (o.a. de `route-stroom`-endpoint en de behouden libs `gates`/`passage`/
`polar`/`route` waren untracked). Daarom is eerst één **pre-strip baseline** vastgelegd,
zodat de per-stap-verificatie (`git diff` op de response-set = leeg) betekenis kreeg.

| Stap | Commit | Wat | Verificatie |
|---|---|---|---|
| baseline | `6042dc2` | hele werkboom als schoon startpunt vastgelegd | — |
| 0 | `40a2574` | RAPPORT verplaatst; `baseline/` (API-dumps, params, hashes); `scripts/snapshot-core.ts` | build+9 tests groen; snapshot 3× byte-identiek |
| 1 | `24c654e` | dode code weg: `components/instrument/*`, `LocationPicker`, `useChartWidth`, `docs/*` | build+tests groen; `app/api`+`lib` byte-identiek; snapshot identiek |
| 2 | `1c39ef7` | verborgen datalogica → `lib/` (weather/route/instrument/constants), + 3 unit-tests | build+9 tests groen; libs **puur additief** (109 insert, 0 delete); endpoints identieke shape; `locations` byte-identiek; snapshot identiek |
| 3 | `bb4de6f` | UI-schermen + shell + `components/route/` weg; `app/` = alleen `app/api/**` | build compileert alleen de 6 routes; geen root-layout nodig; 6 endpoints ok; snapshot identiek |
| 4 | `e42d1a0` | typecheck-schoon zonder UI (lege milestone) | `tsc --noEmit` schoon; `lib/` bevat geen React/DOM/`@/components`/`use client` |
| 5a | `115baf5` | `leaflet` + `@types/leaflet` verwijderd | build groen; 6 endpoints ok; `locations` byte-identiek; snapshot identiek |
| 5b | *(teruggerold)* | `react`/`react-dom`/`@types/react*` verwijderen | **niet doorgevoerd — zie hieronder** |

### Uitkomst Stap 5b — react/react-dom NIET verwijderd (teruggerold)

Conform beslissing 3 ("terugrol als `next build` klaagt") is deelstap 5b **teruggerold**.
`react`/`react-dom` blijken **niet schoon verwijderbaar**:

- `next@14.2.15` declareert `react` en `react-dom` als **`peerDependencies`** (`^18.2.0`).
  Na `npm uninstall` bleven beide dan ook in `node_modules` staan (18.3.1); de build slaagt
  alleen *omdat* ze daar nog fysiek aanwezig zijn. Ze uit `package.json` halen is een fictie.
- Tijdens `next build` **her-installeerde Next zelf `@types/react`** — en bumpte het naar
  **v19.2.18**, waarmee het `package.json` ongevraagd herschreef (weg van de gepinde `18.3.5`).

Dat is precies het "Next heeft de peers nodig"-geval. `package.json`/`package-lock.json` zijn
teruggezet naar de 5a-staat en `npm install` heeft `node_modules` daarmee verzoend. Daarna
opnieuw geverifieerd: werkboom == `115baf5`, `next build` groen, `tsc --noEmit` schoon, alle
9 tests groen, `core-snapshot` identiek, 6 endpoints http=200, `locations` byte-identiek.
**De react-packages blijven staan.** Een echte verwijdering vereist eerst afscheid van de
Next-runtime voor de API (bv. de route-handlers naar een niet-React-host verplaatsen) — buiten
de scope van deze strip.

### Afwijkingen van het plan

1. **Extra baseline-commit vooraf.** Het plan ging uit van een schone werkboom; die was er niet
   (grote delen ongecommit). Toestemming gevraagd en gekregen; `6042dc2` toegevoegd vóór Stap 0.
2. **Stroom-dump niet als blob gecommit.** `GET /api/stroom` levert een ~19 MB dense u/v-grid,
   inherent niet-reproduceerbaar (live). De blob blijft op schijf (`baseline/.gitignore`);
   gecommit is een fingerprint `baseline/api/stroom.meta.json` (bbox, nx/ny, times, sha256).
3. **`npm test` dekt maar één bestand.** Het script draait alleen `correction.test.ts`; alle 9
   testbestanden zijn per stap expliciet gedraaid (`npx tsx test/*.test.ts`).
4. **Verificatie-nuance.** Byte-identiek is alleen exact toetsbaar voor `/api/locations` (puur
   Neon). De andere vijf hangen aan live bovenstroom; daar is getoetst op onveranderde
   servercode (`git diff` = leeg) + gelijke response-shape + http=200. Waarde-drift tussen dumps
   is bovenstroom, geen codegevolg.
5. **`x(36)` i.p.v. `241`.** Bij het benoemen van de 36u-grens (Stap 2e) werd de handmatig
   afgeronde SVG-positie `241` vervangen door `x(CERT_HORIZON_ONZEKER_H)` = 241,5 — een verschil
   van 0,5 px in een scherm dat in Stap 3 tóch verdween.

### Eindstructuur (getrackt, exclusief `baseline/`-vangnet en gitignored artefacten)

```
windapp/
├─ app/api/                         # 6 route-handlers — ONGEWIJZIGD t.o.v. baseline
│  ├─ forecast/[key]/route.ts   ├─ tide/[key]/route.ts    ├─ stroom/route.ts
│  ├─ locations/route.ts        ├─ week/[key]/route.ts     └─ route-stroom/route.ts
├─ lib/                             # server-datalaag + pure verwerkingslaag (19 bestanden)
│  ├─ serving · openmeteo · correction · constants · leads · borrowed · db · tide · stroom · route · types   (voedt de API)
│  └─ gates · passage · polar · instrument · weather · format · tz                                            (verwerkingslaag, decision 1)
├─ ingest/                          # Python Matroos→Neon: __init__ · stroom · stroom_db · stroom_cron · tiles · requirements.txt
├─ scripts/                         # seed.mjs · smoke.ts · snapshot-core.ts (reproduceerbare reken-kern-snapshot)
├─ test/                            # 9 unit-tests (correction, gust, gates, passage, polar, plr, weather, route-derive, instrument-derive)
├─ sql/schema.sql
├─ baseline/                        # verificatie-vangnet: API-dumps, params, core-snapshot, server-hashes
├─ .github/workflows/stroom-ingest.yml
└─ package.json · package-lock.json · tsconfig.json · next.config.mjs · .env.example · .gitattributes · .gitignore · README.md · RAPPORT.md
```

Verdwenen t.o.v. de baseline: heel `app/` behalve `app/api/`, heel `components/`, heel `docs/`.

### Eindstand `package.json`

```json
{
  "name": "windapp",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "seed": "node scripts/seed.mjs",
    "typecheck": "tsc --noEmit",
    "test": "tsx test/correction.test.ts",
    "smoke": "tsx scripts/smoke.ts"
  },
  "dependencies": {
    "@neondatabase/serverless": "^0.10.4",
    "next": "14.2.15",
    "react": "18.3.1",
    "react-dom": "18.3.1"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/react": "18.3.5",
    "@types/react-dom": "18.3.0",
    "tsx": "^4.19.1",
    "typescript": "^5.5.4"
  }
}
```

> `leaflet`/`@types/leaflet` zijn weg (5a). `react`/`react-dom`/`@types/react*` staan er nog:
> Next heeft ze als peer nodig (5b teruggerold). Verder alleen datalaag- en infra-packages.
