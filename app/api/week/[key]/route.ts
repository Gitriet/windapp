import { NextResponse } from "next/server";
import { buildWeek } from "@/lib/serving";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { key: string } }) {
  try {
    const data = await buildWeek(params.key);
    if (!data) return NextResponse.json({ error: "unknown location" }, { status: 404 });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
