import { NextResponse } from "next/server";
import { buildMap } from "@/lib/serving";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await buildMap());
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
