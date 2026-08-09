import { NextResponse } from "next/server";
import { buildHavenTide } from "@/lib/tide";

export const dynamic = "force-dynamic";

// Arrival-harbour tide: resolves the haven slug to its OWN nearest RWS getij
// station (see HAVEN_TIDE_STATIONS in lib/tide.ts), not the shared wind-station key.
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  try {
    const data = await buildHavenTide(params.slug);
    if (!data) return NextResponse.json({ tide: null });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
