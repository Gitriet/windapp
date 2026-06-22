import { NextResponse } from "next/server";
import { buildTide } from "@/lib/tide";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { key: string } }) {
  try {
    const data = await buildTide(params.key);
    if (!data) return NextResponse.json({ tide: null });   // not a Wad station
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
