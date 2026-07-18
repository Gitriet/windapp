import { NextResponse } from "next/server";
import { buildStroom } from "@/lib/stroom";

export const dynamic = "force-dynamic";

// GET /api/stroom?box=marsdiep&from=<iso>&to=<iso>
// Georefereerd u/v-grid (m/s) per valid_time, latest-wins, met model_unvalidated.
// Buiten de horizon: expliciet lege `times: []` — geen verzonnen nullen.
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const box = q.get("box");
    const from = q.get("from");
    const to = q.get("to");
    if (!box || !from || !to)
      return NextResponse.json(
        { error: "box, from en to zijn verplicht (from/to als ISO-tijd)" }, { status: 400 });
    if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)))
      return NextResponse.json(
        { error: "from/to moeten geldige ISO-tijden zijn" }, { status: 400 });

    const data = await buildStroom(box, new Date(from).toISOString(), new Date(to).toISOString());
    if (!data) return NextResponse.json({ error: `onbekende box '${box}'` }, { status: 404 });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
