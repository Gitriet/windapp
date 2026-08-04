import { NextResponse } from "next/server";
import { listKeys, getText } from "@/lib/r2";

export const dynamic = "force-dynamic";

// GET /api/stroom?box=marsdiep
//  → het nieuwste voorberekende pijlenveld (arrows-JSON) voor deze box uit R2, voor
//    de stroomkaart. De gridvelden staan als parquet in R2; de kaart leest dit
//    compacte veld direct. model_unvalidated + analysis_time reizen in het JSON mee.
//
// Vervangt het oude endpoint dat het volledige u/v-grid uit Neon (stroom_veld) las —
// die tabel wordt geleegd zodra alle lezers op R2/Neon-punten draaien.
export async function GET(req: Request) {
  try {
    const box = new URL(req.url).searchParams.get("box");
    if (!box) return NextResponse.json({ error: "box verplicht" }, { status: 400 });

    const keys = await listKeys(`arrows/${box}/`);
    if (!keys.length)
      return NextResponse.json({ error: `geen arrows voor box '${box}'` }, { status: 404 });

    const latest = keys.sort()[keys.length - 1]; // bestandsnaam sorteert chronologisch
    const body = await getText(latest);
    return new NextResponse(body, { headers: { "content-type": "application/json" } });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
