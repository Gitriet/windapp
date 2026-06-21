import { NextResponse } from "next/server";
import { getLocations } from "@/lib/serving";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getLocations());
}
