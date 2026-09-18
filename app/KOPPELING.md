# Ontwerp → data: koppeling "nautisch instrument"

Het prototype (`design_handoff_tidan_nautisch/Tidan Redesign.dc.html`) toont vaste
voorbeeldwaarden. Deze pagina legt vast welke **echte** bron elk blok voedt, welke afleiding
ertussen zit, en welke velden bewust ontbreken. Lees dit vóór je een scherm wijzigt of een
nieuw ontwerp aansluit: het voorkomt dat er waarden verschijnen die niet in de data staan.

## Structuur

| Laag | Bestand | Rol |
|---|---|---|
| Schil | `app/page.tsx` | Verbindt hooks en schermen; geen logica. |
| | `app/screens.ts` | Volgorde + labels van de schermen (tabbar, kolommen, `?tab=`). |
| | `app/use-app-url.ts` | `?tab=` / `?vertrek=` (replaceState) + scrollpositie per tab. |
| | `app/components/Shell.tsx` | Merkbalk, tabbar, kiezerchip, skeleton. |
| Data + logica | `app/use-tocht.ts` | `useTocht` (havens, keten, wind/stroom/getij, 48u-sweep, beste vertrek, datumbereik) en `useNu` (locatie, forecast, week, getij). |
| Pure afleidingen | `lib/tocht.ts` | Beste vertrek/vensters, advies (5 toestanden), LET OP, stroomverloop, uitlegzin, etappes. |
| | `lib/getij.ts` | Datumbereik (enige bron), ISO-week, ranking op stroom, stroomkromme. |
| | `lib/verdict.ts` | GOED/FRIS/LICHT/LET OP — ook de staafkleur in NU. |
| | `lib/format.ts` | Kompaslabels, Beaufort-label, duur. |
| Presentatie | `app/components/{Route,Nu,Getijden,Vaarplan}Screen.tsx` + `.module.css` | Alleen weergave; tokens uit `app/globals.css`. |
| | `app/components/HavenSelector.tsx` | Havenkiezer met toegangsstatus (in de routechip). |

## Blok voor blok: prototype → echte bron

### ROUTE
| Blok | Bron | Afleiding |
|---|---|---|
| GA NU / VERTREK / ONZEKER / GEEN VENSTER / ZONDER STROOM | `useTocht.bestOption` (sweep van `simulateTrip` elk half uur, 48 u) | `adviesState()`: eerste slot = GA NU; `voorbijHorizon` = ONZEKER; geen stroomdata = ZONDER STROOM |
| "ETA · N min sneller/langer" | `SimResult.effectMin` (= tocht mét − zónder stroom, zelfde wind) | `effectLabel()` |
| Chip wind | eerste sim-stap `wDir`/`wSpd` | `dirLabel16` |
| Chip MEE/TEGEN TOT | eerste stap `cur` + `kentMs` | `stroomVerloop()`; MEE-chip alleen als `effectMin ≤ 0` |
| Chip HW | `/api/tide/haven/{vertrekhaven}` → `extremes` | eerste HW ≥ vertrek |
| LET OP | sim-stappen + vlaagpunten van de stations langs de route | `letOp()`: `WARN.hardWind` (oker-drempel) of `windAgainstCurrent` |
| Weerregel | `/api/forecast/{station vertrekhaven}` → `weather` | `weatherAt()` op het vertrekuur |
| Alle vertrekken | zelfde sweep | `pickVensters()`; rechts het verschil met het beste venster |

### NU
| Blok | Bron | Afleiding |
|---|---|---|
| Kompas, knopen, BFT, vlaag | `/api/forecast/{locatie}` → `points[0]` (gekalibreerd) | `beaufort`, `bftLabel` |
| Chips HW / temp / golf | tide-extremes; `weather.temp[0]`; `weather.wave[0]` (Open-Meteo Marine) | golf ontbreekt → "—" + reden |
| Komende 12 uur | `points[0..12]` | kleur via `verdict()`; mobiel even uren, desktop elk uur |
| 4/7 dagen | `/api/week/{locatie}` (ongecorrigeerd, Open-Meteo daily) | `verdict(speedMax, gust)` |

### GETIJDEN
| Blok | Bron | Afleiding |
|---|---|---|
| Kiesbare dagen | geladen stroomreeks + getijreeks vertrekhaven | `datumBereik()` — **fase 2: R2-hindcastbereik als extra span** |
| Beste vertrektijden | `/api/route-stroom` per leg | `rankOpStroom()`: tripsim met motorprofiel op 5 kn, zónder wind; alleen vertrekken waarbij de stroom helpt |
| Stroomkromme | zelfde reeks, lengte-gewogen over de legs | `krommeSegmenten()` (null = gat), `krommePieken()` |

### VAARPLAN
| Blok | Bron | Afleiding |
|---|---|---|
| Tijdblok + KPI's | gekozen `SimResult`; `chain.totalNm`; peiling | `fmtDuurKort` |
| Etappes | sim-stappen per leg + vlaagpunten van de leg-stations | `etappes()`: stroom per segment, kentering, wind/vlaag |
| Haveninfo | `data/havens-info.json` via `/api/routes` | eerste VHF-kanaal + havennaam |
| Getijpoort | `GATE_DATUMS` (nu alleen Vlissingen) + getijcurve vertrekhaven | `gateWindows` → OPEN / DICHT / ONBEKEND |
| VHF-posten, uitwijk | vaste lijst verkeersposten (breedtegraad), tussenhavens van de keten | — |

## Bewust niet getoond (staat niet in de data)
- **Diepgang per haven** ("3,2 m", "2,8 m bij LW" in het prototype): bestaat niet.
- **Luchtdruk(tendens)**: data bestaat (`pressure`), maar is bewust niet opgenomen.
- **Watertemperatuur**: geen bron; weggelaten.
- **VHF-kanalen uit het prototype** (09/12) zijn voorbeeldwaarden; de app toont `havens-info`.

## Fase 2 — GETIJDEN-historie
Hindcast staat alleen in R2 (`hindcast-punten/YYYY/MM/DD.parquet`; Neon `stroom_hindcast` is
leeg). Nodig: één alleen-lezen API-route die de parquet leest (pure-JS lezer) + een
tide-functie met vrije periode. Aansluiten = een extra span doorgeven aan `datumBereik()` in
`useTocht` en de reeksen voor de gekozen dag laden; weekstrip en kromme veranderen niet.
