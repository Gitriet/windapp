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
| Data + logica | `app/use-tocht.ts` | `useTocht` (havens, keten, wind/stroom/getij, 48u-sweep, beste vertrek) en `useHaven` (forecast, week, getij van één route-haven). |
| Pure afleidingen | `lib/tocht.ts` | Beste vertrek/vensters, advies (5 toestanden), LET OP, stroomverloop, uitlegzin, etappes. |
| | `lib/getij.ts` | Datumbereik (enige bron), dagstrip vanaf vandaag, ranking op stroom, stroomkromme. |
| | `lib/verdict.ts` | GOED/FRIS/LICHT/LET OP — ook de staafkleur in NU. |
| | `lib/format.ts` | Kompaslabels, Beaufort-label, duur. |
| Presentatie | `app/components/{Route,Nu,Getijden,Vaarplan}Screen.tsx` + `.module.css` | Alleen weergave; tokens uit `app/globals.css`. |
| | `app/components/HavenSelector.tsx` | Havenkiezer met toegangsstatus (in de routechip). |

## Blok voor blok: prototype → echte bron

### ROUTE
| Blok | Bron | Afleiding |
|---|---|---|
| GA NU / VERTREK / ONZEKER / GEEN VENSTER / ZONDER STROOM / MINST SLECHT | `useTocht.bestOption` (sweep van `simulateTrip` elk half uur, 48 u) | `pickBest()`: vroegste lokale duur-minimum waar de stroom netto tijd wint (`effectMin < 0`), anders het snelste vertrek. `adviesState()`: eerste slot = GA NU; `voorbijHorizon` = ONZEKER; geen stroomdata = ZONDER STROOM; beste met stroom tegen = MINST SLECHT (label "Minst slecht · komende N u", N = `useTocht.horizonUur`). Tijd = venster `vertrekVenster()`: aaneengesloten vertrekken ≤ 5 % (`VENSTER_PCT`) langer dan het beste, zelfde zekerheid, meestroom als het beste meestroom heeft → "VERTREK 18:00–19:00 · snelst 18:30"; bij GA NU "vertrek vóór HH:MM" |
| "ETA · N min sneller/langer" | `SimResult.effectMin` (= tocht mét − zónder stroom, zelfde wind) | `effectLabel()` |
| Chip wind | eerste sim-stap `wDir`/`wSpd` | `dirLabel16` |
| Chip MEE/TEGEN TOT | eerste stap `cur` + `kentMs` | `stroomVerloop()`; MEE-chip alleen als `effectMin ≤ 0` |
| Chip HW | `/api/tide/haven/{vertrekhaven}` → `extremes` | eerste HW ≥ vertrek |
| LET OP | sim-stappen + vlaagpunten van de stations langs de route | `letOp()`: `WARN.hardWind` (oker-drempel) of `windAgainstCurrent` |
| Weerregel | `/api/forecast/{station vertrekhaven}` → `weather` | `weatherAt()` op het vertrekuur |
| Alle vertrekken | zelfde sweep | `pickVensters()`; rechts de tochtduur (`fmtDuurKort`: "48m", "1u 15m", ≥24u "1d 3u") |

### WEER & GETIJ (per haven: schakelaar VERTREK / AANKOMST)
| Blok | Bron | Afleiding |
|---|---|---|
| Kiesbare dagen | weekreeks + getijreeks van beide havens | `datumBereik()`; de strip begint altijd bij vandaag (`stripDagen`) |
| Kompas, knopen, BFT, vlaag | `/api/forecast/{station haven}` → `points[0]` (gekalibreerd) | `beaufort`, `bftLabel` |
| Chips temp / golf | `weather.temp[0]`; `weather.wave[0]` (Open-Meteo Marine) | golf ontbreekt → "—" + reden |
| Komende 12 uur | `points[0..12]` | kleur via `verdict()`; mobiel even uren, desktop elk uur |
| Dagblok: weer | `/api/week/{station haven}` (ongecorrigeerd, Open-Meteo daily) | `verdict(speedMax, gust)` |
| Dagblok: HW/LW + getijcurve | `/api/tide/haven/{haven}` → `extremes`, `expected`, `astro` (8 dagen) | verwachting waar die reikt, astronomisch daarbuiten; alleen de gekozen dag wordt getoond |

### VAARPLAN
| Blok | Bron | Afleiding |
|---|---|---|
| Tijdblok + KPI's | gekozen `SimResult`; `chain.totalNm`; peiling | `fmtDuurKort` |
| Etappes | sim-stappen per leg + vlaagpunten van de leg-stations | `etappes()`: stroom per segment, kentering, wind/vlaag, tijdvenster op de leg |
| Stroomkromme (gekozen etappe) | `/api/route-stroom` van die leg | `krommeSegmenten()` (null = gat), `krommePieken()`; dag = start van de leg, lijn = vertrek op de etappe |
| Haveninfo | `data/havens-info.json` via `/api/routes` | eerste VHF-kanaal + havennaam |
| Getijpoort | `GATE_DATUMS` (nu alleen Vlissingen) + getijcurve vertrekhaven | `gateWindows` → OPEN / DICHT / ONBEKEND |
| VHF-posten, uitwijk | vaste lijst verkeersposten (breedtegraad), tussenhavens van de keten | — |

## Bewust niet getoond (staat niet in de data)
- **Diepgang per haven** ("3,2 m", "2,8 m bij LW" in het prototype): bestaat niet.
- **Luchtdruk(tendens)**: data bestaat (`pressure`), maar is bewust niet opgenomen.
- **Watertemperatuur**: geen bron; weggelaten.
- **VHF-kanalen uit het prototype** (09/12) zijn voorbeeldwaarden; de app toont `havens-info`.

## WEER & GETIJ toont geen verleden
Besluit 2026-09-18: de dagstrip begint altijd bij vandaag en toont nooit oude dagen. De
eerder geplande GETIJDEN-historie uit de R2-hindcast vervalt daarmee.
