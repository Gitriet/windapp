# Windward (Tidan)

Bias-gecorrigeerde wind-, getij- en getijstroomvoorspelling voor zeilers in de
Nederlandse kustwateren (Noordzeekust, Waddenzee, IJsselmeer/Markermeer,
Zeeuwse Delta). Twee delen: een **offline Python-analyse** in de root die per
meetstation leert hoeveel elk weermodel afwijkt, en een **Next.js-webapp**
(`windapp/`, in de code "Tidan") die die correcties live toepast en een
tocht-planner met vensters, stroom en getijpoort biedt.

> Repo-let op: de **root** (`/Weermodellen`) is de analyse en is **geen** git-repo.
> De git-repo zit in **`windapp/`** (dat is wat naar Vercel deployt).

## Stack

- **Frontend:** Next.js 14.2.15 (App Router, client-components), React 18.3.1,
  TypeScript. Geen SWR/react-query — kale `fetch`. Deploy op **Vercel** (root =
  `windapp/`; geen `vercel.json`, lege `next.config.mjs`).
- **Database:** **Neon Postgres** (`@neondatabase/serverless`, HTTP-driver).
- **Objectopslag:** **Cloudflare R2** (S3-compatibel via `@aws-sdk/client-s3`
  in de app, `boto3` in de ingest) voor getijstroom-grids (parquet) + arrow-JSON.
- **Pipeline:** Python 3.11 (`pandas`, `numpy`, `pyarrow`, `requests`, `psycopg`),
  gedraaid door **GitHub Actions** (uurlijks) en handmatig lokaal.
- **Analyse (offline):** het `wm/`-pakket in de root + de `run_*.py`-scripts.

## Architectuur

Drie datastromen komen samen in de app:

1. **Wind (offline → seed → live).** `wm/` fit per station×model×lead een
   snelheids- en vlaagbias uit historische KNMI-metingen vs. Open-Meteo-archief.
   `build_serving.py`/`finalize_artifacts.py` schrijven `outputs/app_serving.csv`,
   `outputs/app_locations.csv` en `outputs/artifacts/bias_*.json`. `scripts/seed.mjs`
   laadt die in Neon (`locations`, `serving`, `bias_speed`, `bias_gust`). **Live**
   haalt `/api/forecast/[key]` de reguliere Open-Meteo-forecast op, `lib/serving.ts`
   past de bias toe (`lib/correction.ts`), en cachet in `forecast_cache` (TTL).
2. **Getijstroom (uurlijkse cron → R2 + Neon).** `ingest/stroom_cron.py` leest
   RWS Matroos (DCSM7/HARMONIE) → forecast-grids naar R2 (parquet) + hindcast +
   samplepunt-reeksen (`u/v`) naar Neon (`stroom_punt_forecast`). De app leest
   stroom langs een route via `/api/route-stroom` en het kaart-arrowveld via
   `/api/stroom` (uit R2).
3. **Getij (live RWS + cache).** `lib/tide.ts` haalt astronomisch + verwacht
   getij bij RWS WaterWebservices, cachet astronomisch in `tide_astro_cache`
   (blijft geldig bij RWS-uitval). Alleen voor Wad-/getijpunten.

De app rekent geen weermodellen opnieuw — hij past kant-en-klare correctie-artefacten
toe. Herijking = artefacten in `outputs/` vervangen en opnieuw seeden; geen rebuild.

## Databronnen

| Bron | Levert | Waar | Beperkingen |
|---|---|---|---|
| **KNMI EDR API** | Gevalideerde uurlijkse wind (landstations) | `wm/knmi.py` (offline) | EDR-scoped key; DD/FF/FX |
| **KNMI CDN decade-ZIP** | Noordzee-platformwind (K13-A, Vlakte v.d. Raan) | `wm/knmi.py` | per decade-ZIP |
| **Open-Meteo Previous Runs** | Vaste-lead archief-forecasts (fit) | `wm/openmeteo.py` | HARMONIE NL & ICON D2 = **day1-only** |
| **Open-Meteo reguliere forecast** | Live wind (knopen, UTC, 3 dagen) | `lib/openmeteo.ts` | on-demand, TTL-cache |
| **RWS Matroos (`dcsm7_harmonie_bf_f2w`)** | Getijstroom-veld u/v (Noordzee-100m) | `ingest/stroom.py` | ~4,5 u vertraging; horizon ~48 u; **NaN=droog, nooit 0** |
| **RWS WaterWebservices** | Astronomisch + verwacht getij (NAP) | `lib/tide.ts` | alleen getijpunten |
| **waterinfo.be (HIC KiWIS)** | Vlaamse Schelde-getijstations | `getij_verschillen.py` | alleen posters, niet de app |

Modellen in de fit (`wm/config.py`): ECMWF IFS, GFS, ICON Global/EU/D2, UKMO
Global, HARMONIE NL, ECMWF AIFS (vanaf 2025-02-20). Fit-periode 2024-07-01…2025-05-31.

## Database schema (Neon)

**Wind/serving** (`windapp/sql/schema.sql`, geseed door `scripts/seed.mjs`):
- `locations` — gekalibreerd punt (key, naam, station, area, lat/lon).
- `serving` — beste enkele gecorrigeerde model per `(location, lead)`; v1 = geen blend.
- `bias_speed` / `bias_gust` — gefitte JSONB-correctietabel per `(location, model, lead)`
  (hiërarchische cellen sector×seizoen×band + fallback).
- `forecast_cache` — TTL-cache van rauwe live forecasts, `{time,speed,dir,gust}`.
- `tide_astro_cache` — laatst bekende astronomisch getij per RWS-code.
- `routes` — opgeslagen gebruikersroutes (optioneel in v1).

**Getijstroom** (`ingest/stroom_db.py`):
- `stroom_box_grid` — grid-as (nx, ny, lat/lon) per box; blijft na retentie.
- `stroom_run` + `stroom_veld` — legacy runs/velden (float16 u/v), gehouden voor
  hindcast-georeferentie.
- `stroom_hindcast` — continue uurreeks (leads 0/1/2), append-only, geen retentie.
- `stroom_punt_forecast` — u/v per routesamplepunt × valid_time (dit voedt de app);
  idempotente upsert, retentie = laatste 3 runs/box.
- `stroom_run_log` — permanent geheugen van verwerkte runs.

**Routenetwerk** (`ingest/netwerk.py`):
- `netwerk_havens` (19), `netwerk_routes` (21, met LineString-geojson + `lengte_nm`),
  `netwerk_samplepunten` (per NM, `route_id`×`volgnr` → lat/lon).

Permanent: `locations`, `serving`, `bias_*`, `netwerk_*`, `stroom_hindcast`,
`stroom_run_log`. Overschreven/geroteerd per run: `forecast_cache` (TTL),
`stroom_punt_forecast` + forecast-grids (retentie 3), `tide_astro_cache`.

## Pipeline

**Offline analyse** (root, handmatig): `run_full.py` (volledige fit + CV + bias),
`run_fase1b.py` (out-of-fold ranking + blend), `run_fase2.py` (richtingcorrectie),
`run_gust.py`, en per-station toevoegingen (`run_texel/schiphol/zeeland/newstations/
getij_stations.py`). `build_serving.py` + `finalize_artifacts.py` produceren de
app-artefacten in `outputs/`. Forecast-pulls zijn gecachet onder `data/raw/` (reruns
netwerkvrij). `getij_verschillen.py` staat los: het rekent getij-offsets/verval voor
vier posters (niet voor de app).

**Getijstroom-cron** (`windapp/.github/workflows/stroom-ingest.yml`): elk heel uur
(UTC) + handmatig. Matrix `[inshore, offshore]` als **twee losse jobs**,
`max-parallel: 1` (strikt sequentieel; `finalize_hindcast` doet read-modify-write per
dag-parquet), `fail-fast: false`, elk **55 min** budget. De splitsing garandeert de
offshore-tegels tijd (anders slurpen de geul-tegels bij een cold start het hele uur op).
Stappen: checkout → Python 3.11 → `pip install -r ingest/requirements.txt` →
`python -m ingest.stroom_cron --inshore|--offshore`.

**Foutafhandeling/logging:** ingest logt op INFO, telt mislukte runs en `exit(1)` bij
falen; sentinels "STILTE" (geen Matroos-tijden) en ">9 u oude run". `storage.py`
faalt hard (geen stille no-op). DB-idempotentie via `UNIQUE` + `ON CONFLICT`.
`ingest/restore_punt_forecast.py` is een vangnet dat `stroom_punt_forecast`
her-sampelt uit intacte R2-grids.

## Frontend

- **Schermen:** één pagina, `app/page.tsx` (client), met vier schermen in een vaste
  volgorde uit `app/screens.ts`: **ROUTE** (advies GA NU/VERTREK/ONZEKER/GEEN VENSTER/
  ZONDER STROOM + alle vertrekken 48 u), **NU** (live wind op één locatie, 12 u, 4/7
  dagen), **GETIJDEN** (weekstrip, vertrektijden op stroom zonder wind, 24-uurs
  stroomkromme) en **VAARPLAN** (gekozen vertrek: KPI's, etappes, haveninfo). Mobiel
  (<768px) één scherm per tab met vaste tabbar; 768–1400px 2 kolommen; ≥1400px 4
  kolommen. `?tab=` en `?vertrek=` staan in de URL. Geen kaart-widget — alles is SVG.
- **Structuur:** data + logica in `app/use-tocht.ts` (`useTocht`, `useNu`) en pure
  afleidingen in `lib/tocht.ts` (beste vertrek, advies, LET OP, etappes),
  `lib/getij.ts` (datumbereik, ISO-week, ranking op stroom, kromme) en `lib/verdict.ts`
  (GOED/FRIS/LICHT/LET OP). Presentatie in `app/components/*Screen.tsx` + CSS-modules;
  schil (tabbar, kiezerchip, skeleton) in `app/components/Shell.tsx`.
- **Vormgeving:** "nautisch instrument" — tokens (kleur, radius, typografie, ruimte)
  uitsluitend in `app/globals.css`; Space Grotesk (cijfers/labels) + Inter (tekst) via
  `next/font`. Ontwerpbron: `design_handoff_tidan_nautisch/`.
- **GETIJDEN-historie (fase 2):** het datumbereik komt uit één functie
  (`lib/getij.ts` `datumBereik`, gevoed in `useTocht`); nu het venster van de geladen
  stroom- en getijreeksen, straks aangevuld met het R2-hindcastbereik.
- **API-routes** (`app/api/*`, alle `force-dynamic`): `forecast/[key]`,
  `week/[key]`, `tide/[key]`, `tide/haven/[slug]`, `locations`, `stroom?box=…`
  (R2-arrows), `route-stroom?routes=…` (Neon punt-forecast), `routes`
  (havens+routes+dichtstbijzijnd station).
- **Dataophaling:** `lib/planner-data.ts` wrapt `fetch` met `cache:"no-store"`
  (elke load vers); geen client-cache-laag. Kern-libs: `serving`/`correction`
  (bias), `tide`, `polar`/`passage`/`tripsim` (ETA), `route`/`netwerk-path`,
  `gates`, `leads` (`hoursToLead`: uren→dag1/2/3).
- **Tests:** `npm test` draait alle `test/*.test.ts` (tsx, geen framework).

## Routenetwerk

Opgebouwd uit `data/routes/routes-R01-R21.geojson` + `havens.json` door
`ingest/netwerk.py`: 20 havens (canoniek punt = gem. eindpunten <500 m), 26 routes
(LineStrings met `lengte_nm`), en samplepunten per ~1 NM. Pathfinding zit
**client-side** in `lib/netwerk-path.ts`: `shortestPath()` is Dijkstra op een gewogen
buur-graaf van havens en ketent buurroutes tot een multi-leg tocht (`RouteLeg` met
reversed-vlag + bearing). Stroom per route komt uit `/api/route-stroom` (Neon
punt-forecast, nieuwste run), en `planner-data.fetchRouteCurrent` projecteert `u/v`
langs de routekoers → `alongKn` (>0 mee, <0 tegen). Alle 26 routes hebben
punt-stroomforecast (gecontroleerd 2026-09-18); `DEFAULT_ROUTE_ID = "R09"` (Den Helder →
Oudeschild) is alleen de standaardkeuze bij openen.

## Polaire ETA

`lib/polar.ts`: `BoatProfile` (archetype, diepgang, kielspeling, performance 0–1,
motorsnelheid). `boatSpeed()` = bilineaire interpolatie in een TWA×TWS-polairematrix ×
performancefactor; `bestVmgUpwind/Downwind()` zoeken per graad het VMG-optimum;
`toPlr()` exporteert een Garmin `.plr`. `lib/passage.ts` integreert de ETA in **5-min
stappen** met wind-over-water-aftrek en stroomvector per dichtstbijzijnd samplepunt
(gaten blijven gaten, geen 0). `lib/tripsim.ts` dupliceert die integratie maar
registreert elke stap voor de grafiek. **Getijpoort** (`lib/gates.ts`):
`depthOverSill = sillDepthChart + NAP-waterstand + reductievlakOnderNap`; `gateWindows()`
levert vensters waar diepte ≥ vereiste diepgang; `evaluateGate()` → status
gehaald/net-aan/niet-gehaald/onbekend. `GATE_DATUMS` wordt opgebouwd uit
`data/havens-info.json` (havens met drempel én `rws_getij_code`): nu alleen **Vlissingen**
(drempel −3,30 m NAP, reductievlak 0). Voor alle andere havens is de poort "onbekend".

## Conventies

- **Kleuren per datatype** (tokens in `app/globals.css`): wind + waarschuwing + getij-chip
  = oker `--ochre`, meestroom = `--sea-green`, tegenstroom = oker `--ochre-line` (balkjes)
  / `--slate` (kromme), neutraal/UI = `--slate`, nadruk = gevuld `--parchment`. Geen paars.
- **Eenheden:** wind in **knopen** (`kn`) + Beaufort; afstand in **NM**; stroom-`u/v`
  in **m/s** in de API, `alongKn` in de UI; richting in graden (16-sector labels N/NNO/…).
- **NAP/getij:** getijhoogtes t.o.v. NAP; getijpoort combineert kaartdiepte (ALAT/LAT)
  met NAP-waterstand via `reductievlakOnderNapM`.
- **NaN/NULL:** droge/ontbrekende stroomcellen zijn **altijd NaN/NULL, nooit 0** — door
  de hele keten (Matroos → float16 → Neon → UI); de sim laat gaten vallen i.p.v. te vullen.
- **Tijd:** intern UTC; UI in Europe/Amsterdam (`lib/tz.ts`).
- **Taal:** UI volledig Nederlands.

## Huidige staat

- **Wind (fase 1):** af en operationeel. ~20 gekalibreerde stations in `wm/config.py`
  (o.a. Texel, Vlissingen, Hoek van Holland en de Zeeuwse Delta zijn eigen gekalibreerde
  stations geworden); best-single-per-lead serving, geen blend in v1. De live picker
  toont ~16 locaties.
- **Getijstroom (fase 3):** uurlijkse cron operationeel met inshore/offshore-splitsing;
  grids in R2, punt-forecast in Neon voor alle 26 routes; hindcast-punten per dag in R2.
  De routekiezer (ROUTE/GETIJDEN/VAARPLAN) kan elke haven-combinatie kiezen.
- **Getij:** live RWS-laag met astronomische cache, alleen voor Wad-/getijpunten.
- **Bekende gaten / open punten:**
  watertemperatuur heeft geen databron (niet getoond); golfhoogte komt uit de
  Open-Meteo Marine API (`—` op landpunten); stroom-forecast reikt ~2 dagen vooruit —
  vertrekken met stroom voorbij de reeks krijgen de vlag `voorbijHorizon` (UI: ONZEKER);
  getijpoort alleen voor Vlissingen (zie Polaire ETA); `tripsim.ts` dupliceert
  `passage.ts` (consolidatie voorgesteld). Ontwerp → data-koppeling: `app/KOPPELING.md`.
- Onduidelijk uit code: exacte deploy-URL en of er buiten `stroom-ingest.yml` andere
  gescheduelde jobs draaien.

## Omgevingsvariabelen

**App (`windapp/.env.local`, Vercel):**
- `DATABASE_URL` — Neon pooled connection string (vereist).
- `FORECAST_TTL_MINUTES` — TTL live-forecastcache (optioneel, default 60).

**Ingest / GitHub Actions secrets:**
- `DATABASE_URL`
- `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`,
  `STORAGE_SECRET_ACCESS_KEY` — R2 (S3-compatibel).
- `STROOM_KEEP_RUNS` (default 3), `STROOM_STALE_H` (default 9) — retentie/monitoring
  (optioneel).

**Offline analyse:** KNMI EDR-key voor `wm/knmi.py` (EDR-scoped) — onduidelijk uit code
of dit via env of config-bestand gaat.
