// AI day summary — the ONLY component that calls a language model. Server-side,
// cached per (location, course, forecast-run). The model is given ONLY the
// corrected forecast (+ course) and is told to verbalise only what is in those
// numbers: no advice, no invented certainty, and to name the uncertainty when
// the model spread is large. Falls back to a deterministic, data-only summary
// when ANTHROPIC_API_KEY is absent or the call fails — the honesty rule holds
// either way.
import { sql } from "./db";
import { compass } from "./format";
import { relAngle, sail, signedDelta } from "./sailing";
import type { CorrectedPoint } from "./types";

const MODEL = "claude-haiku-4-5-20251001";

export type Summary = { text: string; uncertainty: string; source: "cache" | "model" | "fallback" };

async function ensureTable() {
  await sql`CREATE TABLE IF NOT EXISTS summary_cache (
    cache_key TEXT PRIMARY KEY, text TEXT NOT NULL, uncertainty TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
}

// ± half the model-spread band, averaged per lead — the honest uncertainty line.
function uncertaintyLine(points: CorrectedPoint[]): string {
  const half = (lead: number) => {
    const w = points.filter((p) => p.lead === lead).map((p) => (p.band_high_kn - p.band_low_kn) / 2);
    return w.length ? w.reduce((a, b) => a + b, 0) / w.length : 0;
  };
  const d1 = half(1), d3 = half(3);
  return `Modelspreiding ≈ ±${d1.toFixed(0)} kn op day1, oplopend tot ±${d3.toFixed(0)} kn op day3 — `
    + `verder vooruit is indicatief, geen zekerheid.`;
}

function sample(points: CorrectedPoint[], course: number | null) {
  // every ~6h to keep the prompt small. With a course we feed the ALREADY
  // computed point-of-sail label so the prose can't contradict the badge/band.
  return points.filter((_, i) => i % 6 === 0).map((p) => {
    const row: Record<string, unknown> = {
      t: p.time, kn: p.speed_kn, dir: `${compass(p.dir_deg)} ${p.dir_deg}°`,
      gust: p.gust_kn, spread: `${p.band_low_kn}-${p.band_high_kn}`, lead: p.lead,
    };
    if (course !== null) row.pos = sail(relAngle(p.dir_deg, course)).label;
    return row;
  });
}

function deterministic(loc: string, points: CorrectedPoint[], course: number | null): string {
  const a = points[0], m = points[Math.floor(points.length / 2)], e = points[points.length - 1];
  const veer = signedDelta(a.dir_deg, m.dir_deg) > 8;
  const drop = e.speed_kn < a.speed_kn - 2;
  let s = `Bij ${loc}: wind uit ${compass(a.dir_deg)} rond ${Math.round(a.speed_kn)} kn. `;
  s += veer ? `De wind ruimt door de dag naar ${compass(m.dir_deg)}`
            : `De richting blijft rond ${compass(m.dir_deg)}`;
  s += drop ? ` en zakt naar ${Math.round(e.speed_kn)} kn aan het eind.` : `.`;
  if (course !== null) {
    const ps = sail(relAngle(a.dir_deg, course)), pe = sail(relAngle(e.dir_deg, course));
    s += ` Op koers ${compass(course)} vaar je ${ps.label}`;
    s += ps.label !== pe.label ? `, later draait het naar ${pe.label}.` : ` en dat blijft zo.`;
    if (!ps.sailable || !pe.sailable) {
      s += ` Een deel van de tocht komt de wind te recht op om te zeilen (afhankelijk van je boot).`;
    }
  }
  return s;
}

async function callClaude(loc: string, points: CorrectedPoint[], course: number | null): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("no ANTHROPIC_API_KEY");

  const courseLine = course === null
    ? "Er is GEEN koers gekozen: beschrijf de wind in windrichting-termen."
    : `Koers: ${compass(course)} (${course}°). Beschrijf koers-relatief. De point of sail per `
      + `moment is AL berekend in het veld 'pos' (in de wind, aan de wind, halve wind, ruimschoots, `
      + `voor de wind): gebruik die exacte labels en bereken ze niet zelf. Benoem wanneer het `
      + `verandert. 'In de wind' / niet zeilbaar is relatief aan het boottype, presenteer het niet `
      + `als absoluut feit.`;

  const system =
    "Je bent een nuchtere zeil-weerassistent. Vat de gecorrigeerde windvoorspelling samen in "
    + "MAXIMAAL 3 korte Nederlandse zinnen. Platte tekst: geen markdown, geen kop, geen opsomming, "
    + "geen emoji. Beschrijf UITSLUITEND wat in de gegeven cijfers zit: geen advies, geen verzonnen "
    + "details, en suggereer geen zekerheid die er niet is. Windrichting is de richting waar de wind "
    + "VANDAAN komt. Bij grote modelspreiding (spread) benoem je de onzekerheid expliciet in plaats "
    + "van een gladde zin. Geef alleen de samenvattingstekst terug.";

  const user = `Locatie: ${loc}\n${courseLine}\n`
    + `Gecorrigeerde voorspelling (elke ~6u; kn, dir vanwaar, gust, spread=modelspreiding lo-hi`
    + `${course === null ? "" : ", pos=point of sail"}):\n`
    + JSON.stringify(sample(points, course));

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 320, temperature: 0.3,
      system, messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic HTTP ${res.status}`);
  const j = await res.json();
  const text = j?.content?.[0]?.text?.trim();
  if (!text) throw new Error("empty model response");
  return text;
}

export async function getSummary(
  loc: string, points: CorrectedPoint[], course: number | null,
): Promise<Summary> {
  if (!points.length) return { text: "Geen data beschikbaar.", uncertainty: "", source: "fallback" };
  await ensureTable();
  const runKey = points[0].time;                       // advances hourly => refresh per run
  const cacheKey = `${loc}|${course ?? "none"}|${runKey}`;

  const hit = (await sql`SELECT text, uncertainty FROM summary_cache WHERE cache_key = ${cacheKey}`) as
    { text: string; uncertainty: string }[];
  if (hit.length) return { text: hit[0].text, uncertainty: hit[0].uncertainty, source: "cache" };

  const uncertainty = uncertaintyLine(points);
  let text: string, source: "model" | "fallback";
  try { text = await callClaude(loc, points, course); source = "model"; }
  catch { text = deterministic(loc, points, course); source = "fallback"; }

  await sql`INSERT INTO summary_cache (cache_key, text, uncertainty)
            VALUES (${cacheKey}, ${text}, ${uncertainty})
            ON CONFLICT (cache_key) DO UPDATE SET text = EXCLUDED.text, uncertainty = EXCLUDED.uncertainty`;
  return { text, uncertainty, source };
}
