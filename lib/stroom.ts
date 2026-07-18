// Fase 4 lees-laag voor de stroom-ingestie: geeft een georefereerd u/v-grid per
// valid_time uit Neon, latest-wins (nieuwste analysis_time die het tijdstip dekt).
// Leest spoor 1 (de operationele forecast in stroom_veld); de hindcast (spoor 2) is
// grondstof voor latere harmonische analyse en wordt hier niet geserveerd.
//
// Deze laag blijft dom: u/v gaan in m/s naar buiten zoals opgeslagen, NaN -> null.
// Geen knopen-conversie, magnitude of richting hier — dat doet de frontend.
import type { StroomData, StroomSlice } from "./types";
import { sql } from "./db";

const SOURCE = "dcsm7_harmonie_bf_f2w";

// neon geeft bytea als Buffer terug; wees defensief mocht een runtime Uint8Array leveren.
function asBuffer(x: unknown): Buffer {
  return Buffer.isBuffer(x) ? x : Buffer.from(x as ArrayBufferLike);
}

// IEEE-754 half-precision (float16) -> number, met NaN/Inf behouden. Handmatig
// zodat het onafhankelijk is van Float16Array (pas vanaf Node 22 aanwezig).
function halfToFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h & 0x7c00) >> 10;
  const frac = h & 0x03ff;
  if (exp === 0) return sign * Math.pow(2, -14) * (frac / 1024);        // subnormaal / nul
  if (exp === 0x1f) return frac ? NaN : sign * Infinity;               // NaN / ±Inf
  return sign * Math.pow(2, exp - 15) * (1 + frac / 1024);
}

// float32[n] little-endian -> number[] (de assen; nooit NaN).
function decodeF32(buf: Buffer, n: number): number[] {
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = buf.readFloatLE(i * 4);
  return out;
}

// float16[n] little-endian -> (number|null)[]; droge/ontbrekende cel (NaN) -> null.
function decodeF16Field(buf: Buffer, n: number): (number | null)[] {
  const out = new Array<number | null>(n);
  for (let i = 0; i < n; i++) {
    const v = halfToFloat(buf.readUInt16LE(i * 2));
    out[i] = Number.isNaN(v) ? null : v;
  }
  return out;
}

const iso = (t: string | Date) => new Date(t).toISOString();

export async function buildStroom(
  box: string, fromISO: string, toISO: string,
): Promise<StroomData | null> {
  // grid-referentie (los van de runs; blijft staan als forecast-runs worden opgeruimd)
  const g = (await sql`
    SELECT nx, ny, lat, lon FROM stroom_box_grid WHERE box_id = ${box}`) as
    { nx: number; ny: number; lat: unknown; lon: unknown }[];
  if (!g.length) return null;                       // onbekende / nog nooit ingelezen box
  const { nx, ny } = g[0];
  const lat = decodeF32(asBuffer(g[0].lat), ny);
  const lon = decodeF32(asBuffer(g[0].lon), nx);
  const grid = {
    nx, ny, lat, lon,
    bbox: [Math.min(...lon), Math.min(...lat), Math.max(...lon), Math.max(...lat)] as
      [number, number, number, number],
  };

  // latest-wins: per valid_time de rij van de meest recente analysis_time
  const rows = (await sql`
    SELECT DISTINCT ON (f.valid_time)
           f.valid_time AS valid_time, r.analysis_time AS analysis_time, f.u AS u, f.v AS v
    FROM stroom_veld f JOIN stroom_run r ON f.run_id = r.id
    WHERE r.box_id = ${box} AND r.source = ${SOURCE}
      AND f.valid_time >= ${fromISO} AND f.valid_time <= ${toISO}
    ORDER BY f.valid_time, r.analysis_time DESC`) as
    { valid_time: string | Date; analysis_time: string | Date; u: unknown; v: unknown }[];

  const n = nx * ny;
  const times: StroomSlice[] = rows.map((r) => ({
    valid_time: iso(r.valid_time),
    analysis_time: iso(r.analysis_time),
    u: decodeF16Field(asBuffer(r.u), n),
    v: decodeF16Field(asBuffer(r.v), n),
  }));

  // headline analysis_time = nieuwste run in het venster (null bij lege respons)
  const analysis_time = times.reduce<string | null>(
    (mx, t) => (mx === null || t.analysis_time > mx ? t.analysis_time : mx), null);

  return { box, source: SOURCE, units: "m/s", model_unvalidated: true, analysis_time, grid, times };
}
