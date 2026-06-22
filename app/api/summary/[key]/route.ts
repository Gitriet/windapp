import { NextResponse } from "next/server";
import { buildSeries } from "@/lib/serving";
import { getSummary } from "@/lib/summary";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { key: string } }) {
  try {
    const data = await buildSeries(params.key);
    if (!data) return NextResponse.json({ error: "unknown location" }, { status: 404 });
    const c = new URL(req.url).searchParams.get("course");
    const course = c === null || c === "" ? null : Number(c);
    const summary = await getSummary(data.location.name, data.points, course);
    return NextResponse.json(summary);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
