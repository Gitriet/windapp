// Synthetic locations: getij points that are NOT in the Neon `locations` table.
// Client-safe (no DB import) so both the serving layer and the client page read it.
// Two flavours, both driven by SYNTHETIC_LOCATIONS below:
//
//  1. Borrowed wind (BORROWED_WIND) — a point with no calibrated series of its own,
//     shown with the wind of the nearest calibrated station, labelled as borrowed.
//     General mechanism, currently unused: Texel used to borrow De Kooy, but since
//     the KNMI EDR migration Texelhors has a validated series and is now its own
//     calibrated station (in the Neon `locations` table), so it no longer belongs here.
//
//  2. Uncorrected local wind (UNCORRECTED_WIND) — a point with no calibrated station,
//     shown with the raw global-model wind on its OWN coordinate (no fase-1 bias
//     correction), labelled "ongecorrigeerd". Vlissingen and Hoek van Holland are not
//     (yet) calibrated, and the nearest calibrated donor (IJmuiden) is 55–130 km away
//     in a different sea area, so borrowing would misrepresent them. Tide is each
//     point's own (RWS).
import type { Location } from "./types";

// Empty for now — Texel graduated to a real calibrated station. Kept as the seam for
// any future point that must borrow a neighbour's calibrated wind.
export const BORROWED_WIND: Record<string, { donor: string; donorName: string }> = {};

// Synthetic points served with uncorrected local wind (see flavour 2 above). The
// serving layer gives these a default served model per lead with no bias table, so
// the wind is the raw model value at the point's coordinate.
export const UNCORRECTED_WIND = new Set(["vlissingen", "hoekvanholland"]);

// Identity for a synthetic point (not in the Neon `locations` table).
export const SYNTHETIC_LOCATIONS: Record<string, Location> = {
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
