"use client";
import type { WaypointForecast } from "@/lib/types";
import { compass, fmtTime } from "@/lib/format";

export default function RouteTable({ waypoints }: { waypoints: WaypointForecast[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>#</th><th>Waypoint</th><th>Passage (UTC)</th><th>Lead</th>
          <th>Wind</th><th>Spreiding</th><th>Vlagen</th><th>Model</th>
        </tr>
      </thead>
      <tbody>
        {waypoints.map((w) => (
          <tr key={w.order}>
            <td>{w.order + 1}</td>
            <td>{w.name}</td>
            <td>{fmtTime(w.passage_iso)}<div className="sub">+{w.hours_ahead} u</div></td>
            <td className={`lead${w.lead}`}>day{w.lead}</td>
            {w.point ? (
              <>
                <td><b>{w.point.speed_kn} kn</b><div className="sub">{compass(w.point.dir_deg)} {w.point.dir_deg}°</div></td>
                <td>{w.point.band_low_kn}–{w.point.band_high_kn} kn</td>
                <td>{w.point.gust_kn} kn</td>
                <td>{w.point.model_label}<div className="sub">{w.point.corrected ? "gecorrigeerd" : "ongecorrigeerd"}</div></td>
              </>
            ) : (
              <td colSpan={4} className="muted">buiten 3-daagse horizon — ongedekt</td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
