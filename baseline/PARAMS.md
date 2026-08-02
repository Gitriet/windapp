# Baseline-parameters — API-snapshot vóór de strip

Vaste parameters waarmee de 6 endpoints zijn gedumpt naar `baseline/api/*.json`.
Dezelfde parameters worden na elke stripstap opnieuw gebruikt om de responses te
vergelijken. Machine-leesbaar in `baseline/params.json`.

| Parameter | Waarde | Gebruikt door |
|-----------|--------|---------------|
| `KEY` | `texel` | forecast, tide, week (gekalibreerd station mét getij) |
| `BOX` | `marsdiep` | stroom (enige ingelezen box) |
| `ROUTE_KEYS` | `dekooy,texel` | route-stroom (route-midden valt binnen de marsdiep-box) |
| `FROM` | `2026-08-02T12:00:00Z` | stroom, route-stroom (nu, op het uur afgerond) |
| `TO` | `2026-08-04T12:00:00Z` | stroom, route-stroom (FROM + 48u) |
| `AT` | `2026-08-02T18:00:00Z` | route-stroom (pijlenveld, FROM + 6u) |

## Endpoints en aanroep

- `GET /api/locations`
- `GET /api/forecast/texel`
- `GET /api/tide/texel`
- `GET /api/week/texel`
- `GET /api/stroom?box=marsdiep&from=<FROM>&to=<TO>`
- `GET /api/route-stroom?keys=dekooy,texel&from=<FROM>&to=<TO>&at=<AT>`

## Aard van de verificatie (belangrijk)

Alleen `/api/locations` is puur uit Neon en dus byte-voor-byte reproduceerbaar.
De overige vijf hangen aan **live bovenstroom** (Open-Meteo, RWS, Matroos-run) die
tussen twee dumps verschuift; twee dumps minuten later verschillen dan al, ook
zónder codewijziging. De **gezaghebbende** verificatie per stripstap is daarom
structureel: *geen enkel bestand onder `app/api/**` of de server-libs is gewijzigd*
(`git diff` op die set = leeg), aangevuld met een live spot-check op http-status en
top-level shape. Zie `RAPPORT.md` → sectie 6.

## Afwijking: stroom-dump niet als blob gecommit

`baseline/api/stroom.json` is ~19 MB (dense u/v-grid) en inherent niet-reproduceerbaar
(live grid). Die blob blijft op schijf voor sessie-vergelijking maar wordt **niet**
gecommit (`baseline/.gitignore`). In plaats daarvan is `baseline/api/stroom.meta.json`
gecommit: box, bron, units, `analysis_time`, grid-bbox/nx/ny, aantal tijdstappen,
eerste/laatste tijd, byte-lengte en sha256 van de volledige dump.
