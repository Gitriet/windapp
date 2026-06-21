# windapp — bias-gecorrigeerde windvoorspelling (v1)

Toont per **gekalibreerde locatie** de live windvoorspelling, gecorrigeerd met de
in fase 1 geleerde **snelheid**-bias, plus de modelspreiding als onzekerheidsband.
Eén punt of een route van aaneengeregen gekalibreerde punten. De app rekent niets
opnieuw — hij gebruikt de analyse-artefacten.

Bewust **niet** in v1 (komt later als de praktijk erom vraagt): blend,
richtingcorrectie, interpolatie naar willekeurige coördinaten.

## Stack
Next.js (App Router) · Neon Postgres · Open-Meteo **reguliere** forecast API ·
Vercel. On-demand fetch met korte TTL-cache in Neon.

## Datastromen
- **Offline (seed):** `recommendation`→`serving` (beste enkele gecorrigeerde model
  per locatie×lead, uit `outputs/app_serving.csv`), `locations`
  (`outputs/app_locations.csv`) en de snelheid-biastabellen
  (`outputs/artifacts/bias_*.json`). Richtingtabellen worden niet geladen.
- **Live:** per locatie de aanbevolen + overige modellen uit de reguliere
  Open-Meteo API (knopen, UTC, 3 dagen), snelheid-correctie toegepast, resultaat
  in `forecast_cache` met TTL, dan naar de UI.

## Architectuur (losgekoppeld voor latere uitbreiding)
- `lib/correction.ts` — **pure** snelheid-biascorrectie; identiek aan de Python-fit
  (geverifieerd via `npm test` tegen een cross-language golden file).
- `lib/openmeteo.ts` — live fetcher. `lib/serving.ts` — cache + correctie + band.
- `lib/leads.ts` — afstand + passagemoment→lead voor de routeweergave.
- `app/api/*` — forecast per locatie, en route. `app/*` — UI.

Cel-keuze gebeurt live op de **voorspelde** sector/seizoen/sterkte (offline gefit op
waargenomen cellen) — een onvermijdelijke benadering. Lege cel → grovere cel → ruw,
net als bij de fit.

## Lokaal draaien
```bash
cd windapp
cp .env.example .env.local          # vul DATABASE_URL (Neon) in
npm install
npm run typecheck && npm test       # geen DB nodig
npm run seed                        # laadt artefacten in Neon (DB nodig)
npm run dev                         # http://localhost:3000
```

## Deploy (Vercel + Neon)
1. Maak een Neon-database, zet de connection string als `DATABASE_URL`.
2. `npm run seed` (eenmalig + bij herijking).
3. Importeer de repo in Vercel, root = `windapp/`, env `DATABASE_URL`
   (+ optioneel `FORECAST_TTL_MINUTES`). Deploy.

## Herijking
De biastabellen verouderen. Vervang de artefacten in `outputs/` en draai
`npm run seed` opnieuw — de app hoeft niet herbouwd te worden.

## Locatiedekking
v1 = vaste lijst van de vijf gekalibreerde punten (datagedreven uit de
`locations`-tabel, dus later uit te breiden). Buiten de meetpunten is de bias niet
onderbouwd; vrije-kaartdekking met expliciet "ongecorrigeerd"-label is een latere stap.
