"use client";
import { useRoute } from "./RouteProvider";
import { certaintyLabel, type Certainty } from "@/lib/route";

// Route-context bovenaan elk scherm: VAN → (VIA) → NAAR + datum/tijd, en optioneel
// een zekerheidspill. Weghalen of inkorten is een bewuste ontwerpkeuze — niet doen.
export default function RouteHeader({ certainty }: { certainty?: Certainty }) {
  const { waypoints, trip } = useRoute();
  const first = waypoints[0], last = waypoints[waypoints.length - 1];
  const mids = waypoints.slice(1, -1);
  return (
    <div className="routehead">
      <div className="line">
        {first && <span className="end">{first.name}</span>}
        {mids.map((m) => (
          <span key={m.location_key} style={{ display: "contents" }}>
            <span className="arr">→</span>
            <span className="mid">{m.name}</span>
          </span>
        ))}
        {last && first !== last && <><span className="arr">→</span><span className="end">{last.name}</span></>}
      </div>
      <div className="meta">
        <span className="dt">{fmtDate(trip.date)} · vertrek {trip.time}</span>
        {certainty && <span className={`pill ${certainty}`}>{certainty}</span>}
      </div>
    </div>
  );
}

const WD = ["zo", "ma", "di", "wo", "do", "vr", "za"];
const MO = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${WD[dt.getDay()]} ${d} ${MO[m - 1]}`;
}

export { certaintyLabel };
