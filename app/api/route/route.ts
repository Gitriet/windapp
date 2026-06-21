import { NextResponse } from "next/server";
import { buildRoute } from "@/lib/serving";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const waypoints: string[] = body.waypoints;
    if (!Array.isArray(waypoints) || waypoints.length < 1) {
      return NextResponse.json({ error: "need at least one waypoint" }, { status: 400 });
    }
    const departureMs = body.departure ? Date.parse(body.departure) : Date.now();
    const boatSpeedKn = Number(body.boatSpeedKn) || 5;
    const data = await buildRoute(waypoints, departureMs, boatSpeedKn);
    return NextResponse.json({ waypoints: data, boatSpeedKn });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
