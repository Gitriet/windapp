// Synthetic locations: getij points that are NOT in the Neon `locations` table.
// Client-safe (no DB import) so both the serving layer and the client page read it.
// Two flavours, both driven by SYNTHETIC_LOCATIONS below:
//
//  1. Borrowed wind (BORROWED_WIND) — a point with no calibrated series of its own,
//     shown with the wind of the nearest calibrated station, labelled as borrowed.
//     Texel (Oudeschild): Texelhors has no KNMI validated historical wind series —
//     its klimatologie number (229) is rejected like a non-existent station and its
//     North-Sea decade file is empty — so it borrows De Kooy's calibrated wind
//     (~5 km across the Marsdiep); only the tide is Texel's own (texel.oudeschild).
//
//  2. Uncorrected local wind (UNCORRECTED_WIND) — a point with no calibrated station
//     anywhere near, shown with the raw global-model wind on its OWN coordinate (no
//     fase-1 bias correction), labelled "ongecorrigeerd". Vlissingen and Hoek van
//     Holland: their KNMI wind stations can't be calibrated (the klimatologie source
//     is retired and the EDR successor isn't reachable yet), and the nearest
//     calibrated donor (IJmuiden) is 55–130 km away in a different sea area, so
//     borrowing would misrepresent them. The tide is each point's own (RWS).
import type { Location } from "./types";

export const BORROWED_WIND: Record<string, { donor: string; donorName: string }> = {
  texel: { donor: "dekooy", donorName: "De Kooy" },
};

// Synthetic points served with uncorrected local wind (see flavour 2 above). The
// serving layer gives these a default served model per lead with no bias table, so
// the wind is the raw model value at the point's coordinate.
export const UNCORRECTED_WIND = new Set(["vlissingen", "hoekvanholland"]);

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
  // Uncorrected local-wind points (no calibrated station). Coordinate = the RWS
  // getij point, so the wind/weather overlay and the tide sit at the same spot.
  // station "" — no backing KNMI station. area includes "Noordzee" so the picker
  // groups them under the Noordzee-kust block (west→east by lon: Vlissingen, HvH).
  vlissingen: {
    location_key: "vlissingen",
    name: "Vlissingen",
    station: "",
    area: "Noordzee (Westerschelde)",
    lat: 51.442,
    lon: 3.600,
  },
  hoekvanholland: {
    location_key: "hoekvanholland",
    name: "Hoek van Holland",
    station: "",
    area: "Noordzee-kust",
    lat: 51.977,
    lon: 4.120,
  },
};
