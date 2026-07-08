// AI-tab (Deel B): server-side vraag-antwoord over de EIGEN gekalibreerde data.
// Bij elke vraag krijgt het model de gecorrigeerde wind/vlagen/spreiding van alle
// stations, de getij-extremes van de getijstations, en de looprichting-feiten uit
// Deel A mee. Het model is een tolk van die data — het verzint niets. Sleutel uit de
// omgeving (ANTHROPIC_API_KEY), alleen aangeroepen op een expliciete vraag.
import { NextResponse } from "next/server";
import { getLocations, buildSeries } from "@/lib/serving";
import { buildTide, TIDE_STATIONS } from "@/lib/tide";
import { buildWavePairs, type WaveStation } from "@/lib/wave";
import { compass } from "@/lib/format";
import { fmtTimeNL } from "@/lib/tz";
import { UNCORRECTED_WIND } from "@/lib/borrowed";

export const dynamic = "force-dynamic";

const MODEL = "claude-opus-4-8";

// De systeem-instructie bewaakt de eerlijkheid: uitsluitend uit de data antwoorden,
// niets verzinnen, en voor stroming alleen over looprichting/kentering praten.
const SYSTEM = `Je bent de assistent van een persoonlijke windvoorspelapp voor de Nederlandse kust en Waddenzee. Je beantwoordt vragen uitsluitend uit de meegeleverde data (in het blok DATA). Alle cijfers in je antwoord komen daaruit — je verzint niets en voegt geen algemene kennis, aannames of eigen voorspelling toe.

Regels:
- Antwoord in het Nederlands, kort en concreet. Tijden staan al in Nederlandse tijd (NL) — neem ze over zoals ze in de data staan.
- Wind is in knopen (kn). "spreiding" is de bandbreedte tussen de modellen (laag–hoog). "vlaag" is de windvlaag. Sommige stations zijn "ongecorrigeerd" (ruw model, geen stationscorrectie) — zeg dat erbij als je zo'n station gebruikt.
- Voor stroming: je kent ALLEEN de looprichting van de getijgolf tussen stations en het moment van kentering (rond HW/LW), afgeleid uit de HW/LW-tijden. Je kent NIET de werkelijke stroomsnelheid of -richting in de zeegaten en geulen. Spreek dus over "de vloedgolf loopt in deze periode van X naar Y en kentert rond dit tijdstip" en zeg expliciet dat je de precieze stroomsterkte in de zeegaten niet kent. Maak er geen stroompijl of snelheid van.
- Bij een routevraag tussen twee stations: noem de wind langs de route (uit de winddata van de betrokken stations) en de looprichting/kentering van de getijgolf tussen die stations, met de expliciete kanttekening dat de exacte stroomsterkte in de zeegaten onbekend is.
- Kun je iets niet uit de data halen, zeg dan eerlijk dat je dat niet weet. Verzin nooit een cijfer dat niet in de data staat.`;

type ReqBody = { messages?: { role: "user" | "assistant"; content: string }[] };

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY ontbreekt in de omgeving." }, { status: 500 });
  }

  let body: ReqBody;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "ongeldige aanvraag" }, { status: 400 }); }
  const messages = (body.messages ?? []).filter((m) => m && m.content?.trim());
  if (!messages.length) return NextResponse.json({ error: "geen vraag" }, { status: 400 });

  try {
    const data = await buildContext();
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      cache: "no-store",
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: `${SYSTEM}\n\nDATA (${data.nu}):\n${JSON.stringify(data)}`,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      return NextResponse.json({ error: `Anthropic HTTP ${res.status}: ${txt.slice(0, 300)}` }, { status: 502 });
    }
    const j = await res.json();
    const reply = (j.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("").trim();
    return NextResponse.json({ reply: reply || "(leeg antwoord)" });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// Verzamelt de eigen data: gecorrigeerde wind van alle stations, getij-extremes van
// de getijstations, en de looprichting-feiten uit Deel A. Alles in NL-tijd.
async function buildContext() {
  const locs = await getLocations();

  const stations = await Promise.all(locs.map(async (l) => {
    const s = await buildSeries(l.location_key).catch(() => null);
    if (!s) return null;
    return {
      key: l.location_key,
      naam: l.name,
      gebied: l.area,
      ongecorrigeerd: UNCORRECTED_WIND.has(l.location_key) || undefined,
      wind: s.points.map((p) => ({
        t: fmtTimeNL(p.time),
        kn: p.speed_kn,
        vlaag: p.gust_kn,
        laag: p.band_low_kn,
        hoog: p.band_high_kn,
        ri: compass(p.dir_deg),
        gr: p.dir_deg,
        ...(p.beyond ? { verderVooruit: true } : {}),
      })),
    };
  }));

  const tides = await Promise.all(Object.keys(TIDE_STATIONS).map(async (key) => {
    const t = await buildTide(key).catch(() => null);
    if (!t || !t.extremes.length) return null;
    return {
      key,
      naam: t.name,
      extremes: t.extremes.map((e) => ({ soort: e.kind, t: fmtTimeNL(e.t), cm: Math.round(e.v) })),
      raw: t.extremes,   // for the wave layer, dropped before serialising
    };
  }));

  const validTides = tides.filter((t): t is NonNullable<typeof t> => !!t);
  const waveStations: WaveStation[] = validTides.map((t) => ({ key: t.key, name: t.naam, extremes: t.raw }));
  const getijgolf = buildWavePairs(waveStations).map((p) => ({
    van: p.upstreamName, naar: p.downstreamName, hwVerschilMin: p.lagMinutes,
  }));

  return {
    nu: fmtTimeNL(new Date().toISOString()),
    toelichting: "wind in kn (kn=snelheid, vlaag=windvlaag, laag/hoog=spreiding tussen modellen, ri/gr=richting waar de wind vandaan komt). getij: HW/LW met tijd (NL) en waterstand in cm t.o.v. NAP. getijgolf: afgeleide looprichting van de getijgolf uit de HW-tijden (van=bovenstrooms/eerder HW, naar=later HW); hwVerschilMin=tijdsverschil. Stroomsterkte in de zeegaten is onbekend.",
    stations: stations.filter(Boolean),
    getij: validTides.map(({ raw, ...rest }) => rest),
    getijgolf,
  };
}
