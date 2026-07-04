// Borrowed-wind points: a getij location that has NO calibrated wind series of its
// own, so it is shown with the wind of the nearest calibrated station — clearly
// labelled in the UI as borrowed. Client-safe (no DB import) so both the serving
// layer and the client page can read it.
//
// Texel (Oudeschild): Texelhors has no KNMI validated historical wind series — its
// klimatologie station number (229) is rejected like a non-existent station and its
// North-Sea decade file is empty, leaving only an RWS near-real-time feed — so it
// cannot be bias-calibrated like the other water stations. Its wind is borrowed
// from De Kooy, the nearest calibrated station (~5 km across the Marsdiep); only the
// tide is Texel's own (RWS getij point texel.oudeschild, see lib/tide.ts).
import type { Location } from "./types";

export const BORROWED_WIND: Record<string, { donor: string; donorName: string }> = {
  texel: { donor: "dekooy", donorName: "De Kooy" },
};

// Identity for a borrowed-wind point (not in the Neon `locations` table). Uses the
// donor's coordinate so the uncorrected 7-day + weather overlay stay consistent
// with the borrowed wind; the wind itself comes from the donor's serving/bias via
// the alias in serving.ts, and the tide from lib/tide.ts by key.
export const SYNTHETIC_LOCATIONS: Record<string, Location> = {
  texel: {
    location_key: "texel",
    name: "Texel (Oudeschild)",
    station: "DeKooy",
    area: "Waddenzee (Texel)",
    lat: 52.928,
    lon: 4.781,
  },
};
