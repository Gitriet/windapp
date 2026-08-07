# RAPPORT — Haveninfo v2 (Fase 0)

Alleen gelezen. Vijf punten, plus twee integratie-realiteiten die de opdracht-aannames bijstellen.

## 1. Havenselector in `page.tsx`

Component **`RouteHavenPicker`** (`app/page.tsx:545`), 2× gerenderd in `DepartureView` — "Van" en "Naar" (`:716`, `:718`), in een flex-rij met een "→" ertussen.

Per picker:
- **Label** — mini-uppercase ("VAN"/"NAAR"), `fontSize 9`, `color rgba(233,233,237,.4)`.
- **Trigger-div** (`onClick` toggelt dropdown): flex met een violet locatiepin-SVG (`stroke COLORS.weer`), de **havennaam** (`fontSize 14, fontWeight 600`), en een **chevron** (▾). Achtergrond `alpha(COLORS.weer, .08)`, border `alpha(COLORS.weer, .18)`, `borderRadius 8`, `minWidth 176`.
- **Dropdown** (`open`): absolute overlay (`top 60, zIndex 20`), donker paneel `#1e2035`, lijst met havennamen + vinkje bij de actieve; sluit op klik-buiten (mousedown-listener).

Direct onder de picker-rij staat een **windstation-regel** (`:721-725`): "wind: {stationNaam} · {km}" per haven, `fontSize 11`. Daaronder de nm/koers/stroom-KPI's (`:726`).

De picker kent alléén `value` (haven-key), `options`, `naamOf`, `onSelect`. Géén haveninfo of gate-status.

## 2. Huidige `HavenInfoCard.tsx` (wordt vervangen)

`app/components/HavenInfoCard.tsx` — losse kaart, props `{ havenInfo, bootDiepgang, havenNaam? }`. Inhoud: header (ankericoon + naam + `havenNaam`), badge "Getijgebonden" (koraal) / "Vrij toegankelijk" (groen), koraal drempelwaarschuwing met statische benodigde-waterstand (`diepte_m_nap + bootDiepgang`), infotabel (drempel / je boot / VHF / sluis / getij), opmerkingen. Ingebouwde fade-in.

**Integratie (wordt verwijderd):** `page.tsx:743-753` — twee losse `HavenInfoCard`'s onder de picker-header, buiten de selector, `key={van-/naar-...}` voor remount. Import op `:19`.

De v2 verplaatst deze info **in de selector zelf** met een dynamische statusbadge; de losse kaarten + component verdwijnen.

## 3. `lib/gates.ts` — types + signaturen

```ts
export type GateDatum = { sillDepthChartM: number; reductievlakOnderNapM: number };
export const GATE_DATUMS: Record<string, GateDatum> = {};   // nu LEEG
export function gateDatumFor(locationKey: string): GateDatum | null;
export function requiredDepthM(boat: BoatProfile): number;   // draftM + keelClearanceM
export function depthOverSillM(datum: GateDatum, napCm: number): number;
//   = datum.sillDepthChartM + napCm/100 + datum.reductievlakOnderNapM
export type GateWindow = { fromMs: number; toMs: number };
export function gateWindows(
  tide: TideData | null, datum: GateDatum | null, requiredM: number, fromMs: number, toMs: number,
): GateWindow[];
export function windowContains(windows: GateWindow[], ms: number): boolean;
export function evaluateGate(
  tide, datum, boat, passageMs, fromMs, toMs,
): GateVerdict;   // status: "gehaald" | "net-aan" | "niet-gehaald" | "onbekend"
```

`gateWindows` kern: `minCm = (requiredM − sillDepthChartM − reductievlakOnderNapM) * 100`; venster open zolang de verwachte stand (cm NAP) `>= minCm`, lineair interpolerend op de randen, geknipt op `[fromMs,toMs]`.

**Consumenten:** buiten `gates.ts` wordt alléén het *type* `GateStatus` geïmporteerd (`lib/route.ts:6`). Geen enkele runtime-functie of `GateDatum`-literal wordt elders gebruikt → `GATE_DATUMS` vullen en een veld aan `GateDatum` toevoegen is veilig.

## 4. `lib/tide.ts` — getijdata

- **Bron:** RWS WaterWebservices (`ddapi20-waterwebservices`), POST per ProcesType `verwachting` + `astronomisch`, `WATHTE`/`NAP`. `buildTide(key)` → `TideData | null`.
- **`TideData`**: `{ code, name, expected: TidePoint[], astro: TidePoint[], extremes: TideExtreme[], ... }`, waarbij **`TidePoint = { t: string (ISO), v: number (cm NAP) }`**. `gateWindows` leest `tide.expected`.
- **`/api/tide/[key]`** → `buildTide(params.key)`; `null` levert `{ tide: null }`.
- **Belangrijk — de sleutel is een WIND-stationkey, niet de RWS-code.** `buildTide` mapt via **`TIDE_STATIONS: Record<windKey, {code, name}>`**. Beschikbare keys: `dekooy, texel, vlieland, hoorn, lauwersoog, huibertgat, harlingen, ijmuiden, hoekvanholland, vlissingen`. De RWS-`code` daarbinnen is een lowercase gepunt formaat (`vlissingen`, `denhelder.marsdiep`), **niet** de klassieke code (`VLISSGN`).
- **Client-fetch:** `fetchTide(key)` in `lib/planner-data.ts` → `Promise<TideData | { tide: null }>`; guard `isTide()` in `page.tsx:29`.

## 5. `rws_getij_code` in `havens-info.json`

Bevestigd: Vlissingen heeft `"rws_getij_code": "VLISSGN"`, en de andere getijhavens hebben elk een code (`CADZD, DELFZL, DENHDR, DENOVBTN, EEMSHVN, HARLGN, IJMDBTHVN, KORNWDZBTN, LAUWOG, NES, OUDSD, ROOMPBTN, SCHEVNGN, SCHIERMNOG, STELLDBTN, TERNZN, VLIELHVN, WESTTSLG`). Alleen **Vlissingen** heeft óók een concrete `drempel` (−3,30 m NAP). Dus GATE_DATUMS krijgt in de praktijk **één** entry (Vlissingen); de overige drempel-loze havens vallen af.

---

## ⚠️ Twee bijstellingen op de opdracht-aannames

**A. Tide-fetch: haven-stationkey i.p.v. `rws_getij_code`.**
De opdracht zegt "fetch via `/api/tide/[rws_getij_code]`", maar dat endpoint accepteert een `TIDE_STATIONS`-key, niet de klassieke RWS-code. `"VLISSGN"` werkt daar niet. De Vlissingen-haven levert echter via `/api/routes` al `RouteHaven.key = "vlissingen"` (dichtstbijzijnd station), en die key zit **wél** in `TIDE_STATIONS`. Dus de selector fetcht met `RouteHaven.key`. `tideStation` (= `rws_getij_code`) komt wel in `GATE_DATUMS` als referentie (opdracht-eis), maar drijft de live-fetch niet — tot `/api/tide` ooit RWS-codes accepteert.

**B. Tekencorrectie in GATE_DATUMS.**
`depthOverSillM` verwacht `sillDepthChartM` als *positieve kaartdiepte bóven het reductievlak*. De drempel staat in `havens-info.json` als NAP-niveau (`diepte_m_nap = −3,30`, negatief). Om de bestaande formule ongewijzigd correct te houden zet ik `sillDepthChartM = −drempel.diepte_m_nap = +3,30` en `reductievlakOnderNapM = 0`. Controle: `minCm = (1,95 − 3,30 − 0)·100 = −135` → dicht bij stand < −1,35 m NAP. Klopt met het succescriterium. (Letterlijk `sillDepthChart = diepte_m_nap` zou de formule omkeren en Vlissingen altijd dicht melden.) De gate-logica zelf blijft ongemoeid — alleen de invoerwaarde wordt correct getekend.
