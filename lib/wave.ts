// Getijgolf-looprichting (Deel A): een pure rekenlaag die uit de HW/LW-tijden van
// de getijstations afleidt welke kant de getijgolf op loopt. GEEN nieuwe bron, GEEN
// correctie, GEEN aanname over stroomsnelheid — puur het tijdsverschil tussen de
// hoogwaters van twee stations. Het station dat eerder HW heeft ligt "bovenstrooms";
// de golf loopt van daar naar het station dat later HW heeft. De ketermomenten per
// station zijn de HW/LW-tijden zelf (rond HW/LW kentert de stroom).
//
// Deze laag heeft geen eigen scherm; hij levert de AI-tab gestructureerde feiten.
import type { TideExtreme } from "./types";

// Eén getijstation met zijn HW/LW-extremen (zoals buildTide ze oplevert).
export type WaveStation = { key: string; name: string; extremes: TideExtreme[] };

// De afgeleide looprichting voor één paar getijstations.
export type WavePair = {
  a: string; aName: string;
  b: string; bName: string;
  upstream: string; upstreamName: string;      // station met het eerdere HW
  downstream: string; downstreamName: string;  // station met het latere HW
  lagMinutes: number;   // mediaan tijdsverschil van HW tussen de twee (minuten)
  samples: number;      // aantal HW-paren dat is vergeleken
};

const HALF_CYCLE_MS = 6 * 3600000;   // ~halve getijcyclus — grens om HW's als "hetzelfde tij" te koppelen

const hwTimes = (ex: TideExtreme[]): number[] =>
  ex.filter((e) => e.kind === "HW").map((e) => Date.parse(e.t)).sort((x, y) => x - y);

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Mediaan getekend tijdsverschil (b - a) tussen de HW's van twee stations: elk HW
// van a wordt aan het dichtstbijzijnde HW van b gekoppeld (binnen een halve cyclus,
// zodat opeenvolgende tijen niet verwisseld worden). null als er niets te koppelen is.
function medianHwLag(aHW: number[], bHW: number[]): number | null {
  const lags: number[] = [];
  for (const ta of aHW) {
    let best = Infinity, lag = 0;
    for (const tb of bHW) {
      const d = Math.abs(tb - ta);
      if (d < best) { best = d; lag = tb - ta; }
    }
    if (best <= HALF_CYCLE_MS) lags.push(lag);
  }
  return lags.length ? median(lags) : null;
}

// Voor elk paar getijstations de looprichting van de getijgolf. Alleen stations met
// bruikbare HW-extremen doen mee; een paar zonder koppelbare HW's valt weg.
export function buildWavePairs(stations: WaveStation[]): WavePair[] {
  const usable = stations
    .map((s) => ({ ...s, hw: hwTimes(s.extremes) }))
    .filter((s) => s.hw.length > 0);

  const pairs: WavePair[] = [];
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      const a = usable[i], b = usable[j];
      const lag = medianHwLag(a.hw, b.hw);
      if (lag == null) continue;
      // lag = t_b - t_a. lag > 0 => b heeft later HW => golf loopt a -> b (a bovenstrooms).
      const aUpstream = lag >= 0;
      const samples = Math.min(a.hw.length, b.hw.length);
      pairs.push({
        a: a.key, aName: a.name,
        b: b.key, bName: b.name,
        upstream: aUpstream ? a.key : b.key,
        upstreamName: aUpstream ? a.name : b.name,
        downstream: aUpstream ? b.key : a.key,
        downstreamName: aUpstream ? b.name : a.name,
        lagMinutes: Math.round(Math.abs(lag) / 60000),
        samples,
      });
    }
  }
  return pairs;
}
