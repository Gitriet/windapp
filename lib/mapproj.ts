// Static coastline asset (one-time preprocessed, NOT fetched at runtime) plus the
// projection. The projection is a linear bbox->pixel map: the latitude aspect
// correction is baked into the W:H ratio (760:486 = lon-span*cos(53°) : lat-span),
// so projecting real station coordinates with this exact formula lands them on the
// coast. Same formula that generated `paths`.
import mapdata from "./mapdata.json";

export const MAP = mapdata as {
  W: number; H: number; paths: string[];
  proj: { lonMin: number; lonMax: number; latMin: number; latMax: number };
};

export function project(lon: number, lat: number): { x: number; y: number } {
  const p = MAP.proj;
  return {
    x: (lon - p.lonMin) / (p.lonMax - p.lonMin) * MAP.W,
    y: (p.latMax - lat) / (p.latMax - p.latMin) * MAP.H,
  };
}
