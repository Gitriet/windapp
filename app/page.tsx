"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useRoute } from "@/components/route/RouteProvider";
import { fmtDate } from "@/components/route/RouteHeader";
import TabBar from "@/components/route/TabBar";
import LocationSheet from "@/components/route/LocationSheet";
import BoatSheet from "@/components/route/BoatSheet";
import { roleOf, routeDistanceNm } from "@/lib/route";
import { requiredDepthM } from "@/lib/gates";

const ROLE_LABEL = { van: "VAN", via: "VIA", naar: "NAAR" } as const;

export default function TochtPage() {
  const router = useRouter();
  const { locations, waypoints, trip, setWaypointAt, addWaypoint, removeWaypoint, setDate, setTime, recent, saveRecent, loadRecent, boat } = useRoute();
  // sheet: index = welke waypoint we bewerken; -1 = nieuw waypoint toevoegen; null = dicht
  const [sheet, setSheet] = useState<number | null>(null);
  const [boatOpen, setBoatOpen] = useState(false);

  const usedKeys = trip.waypointKeys;
  const onPick = (key: string) => {
    if (sheet === -1) addWaypoint(key);
    else if (sheet !== null) setWaypointAt(sheet, key);
    setSheet(null);
  };

  const go = () => { saveRecent(); router.push("/vensters"); };

  return (
    <>
      <div className="app-scroll">
        <div className="apphead">
          <div>
            <div className="kicker">Windapp</div>
            <h1>Mijn tocht</h1>
          </div>
          <div className="avatar" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="12" cy="8" r="4" /><path d="M5,20 Q5,15 12,15 Q19,15 19,20" />
            </svg>
          </div>
        </div>

        <div className="section" style={{ marginTop: 6 }}>
          <div className="seclabel">Mijn route</div>
          {waypoints.map((w, i) => {
            const role = roleOf(i, waypoints.length);
            return (
              <div key={`${w.location_key}-${i}`}>
                {i > 0 && <div className="connector"><i /></div>}
                <button type="button" className="wp" onClick={() => setSheet(i)}>
                  <div className={`ic ${role}`}>
                    {role === "van" && <span className="dot" />}
                    {role === "via" && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="var(--water)" strokeWidth="1.5">
                        <rect x="1.5" y="1.5" width="9" height="9" rx="2" />
                      </svg>
                    )}
                    {role === "naar" && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M6,1 L11,6 L6,11 L1,6 Z" stroke="var(--cur)" strokeWidth="1.5" />
                      </svg>
                    )}
                  </div>
                  <div className="body">
                    <div className="nm">{w.name}</div>
                    <div className="sub">{w.area}</div>
                  </div>
                  {waypoints.length > 2 && role === "via" ? (
                    <span className="rm" role="button" tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); removeWaypoint(i); }}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); removeWaypoint(i); } }}
                          aria-label={`Verwijder ${w.name}`}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </span>
                  ) : (
                    <span className="role">{ROLE_LABEL[role]}</span>
                  )}
                </button>
              </div>
            );
          })}
          <button type="button" className="addwp" onClick={() => setSheet(-1)}>
            <span className="plus">+</span>
            <span>Voeg waypoint toe</span>
          </button>
        </div>

        <div className="hr" />

        <div className="section">
          <div className="seclabel" style={{ marginBottom: 10 }}>Vertrek</div>
          <div className="dtrow">
            <label className="dtcell">
              <div className="k">datum</div>
              <div className="v">
                <span>{fmtDate(trip.date)}</span>
                {/* dekt de hele cel, zodat het raakvlak niet de tekstregel maar het kader is */}
                <input type="date" value={trip.date} onChange={(e) => setDate(e.target.value)}
                       className="overlay-input" aria-label="Vertrekdatum" />
              </div>
            </label>
            <label className="dtcell time">
              <div className="k">vertrek</div>
              <input type="time" value={trip.time} onChange={(e) => setTime(e.target.value)} aria-label="Vertrektijd" />
            </label>
          </div>
        </div>

        <div className="hr" />

        <div className="section">
          <div className="seclabel" style={{ marginBottom: 10 }}>Boot</div>
          <button type="button" className="wp tap" onClick={() => setBoatOpen(true)}>
            <div className="ic via" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--water)" strokeWidth="1.4"
                   strokeLinecap="round" strokeLinejoin="round">
                <path d="M2,10 L14,10 L12,14 L4,14 Z" /><path d="M8,10 L8,2 L12.5,8 L8,8" />
              </svg>
            </div>
            <div className="body">
              <div className="nm">{ARCHETYPE_LABEL[boat.archetype]}</div>
              <div className="sub">
                {boat.archetype === "motor"
                  ? `${boat.motorSpeedKn.toFixed(1)} kn · diepgang ${boat.draftM.toFixed(2)} m`
                  : `performance ${boat.performance.toFixed(2)} · nodig ${requiredDepthM(boat).toFixed(2)} m`}
              </div>
            </div>
            <svg className="chev" width="7" height="13" viewBox="0 0 7 13" fill="none" stroke="var(--t3)"
                 strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1,1 L6,6.5 L1,12" /></svg>
          </button>
        </div>

        <div className="hr" />

        <div className="section">
          <div className="seclabel" style={{ marginBottom: 10 }}>Recent</div>
          {recent.length ? (
            <div className="recent">
              {recent.map((r, i) => (
                <button key={r.savedAt} type="button" className="row" onClick={() => loadRecent(r)}>
                  <span className="n">{r.waypointKeys.length}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="rt">{recentTitle(r.waypointKeys, locations)}</div>
                    <div className="rs">{fmtDate(r.date)} · {r.waypointKeys.length} waypoints{nmSuffix(r.waypointKeys, locations)}</div>
                  </div>
                  <svg className="chev" width="7" height="13" viewBox="0 0 7 13" fill="none" stroke="currentColor"
                       strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1,1 L6,6.5 L1,12" /></svg>
                </button>
              ))}
            </div>
          ) : (
            <div className="emptyhint">Nog geen recente tochten — bereken een tocht om hem hier terug te vinden.</div>
          )}
        </div>

        <div style={{ flex: 1 }} />
      </div>

      <div className="cta-foot">
        <button className="cta" onClick={go} disabled={waypoints.length < 2}>Bereken vertrekvensters →</button>
      </div>

      <TabBar />

      <LocationSheet open={sheet !== null} locations={locations} exclude={usedKeys}
                     value={sheet !== null && sheet >= 0 ? waypoints[sheet]?.location_key : undefined}
                     title={sheet === -1 ? "Voeg waypoint toe" : "Kies locatie"}
                     onPick={onPick} onClose={() => setSheet(null)} />
      <BoatSheet open={boatOpen} onClose={() => setBoatOpen(false)} />
    </>
  );
}

const ARCHETYPE_LABEL = {
  "cruiser-racer": "Cruiser-racer", toerder: "Toerder", platbodem: "Platbodem", motor: "Motor",
} as const;

function recentTitle(keys: string[], locations: { location_key: string; name: string }[]): string {
  const nm = (k: string) => locations.find((l) => l.location_key === k)?.name ?? k;
  if (keys.length <= 2) return `${nm(keys[0])} → ${nm(keys[keys.length - 1])}`;
  return `${nm(keys[0])} → ${nm(keys[keys.length - 1])}`;
}
function nmSuffix(keys: string[], locations: { location_key: string; name: string; lat: number; lon: number }[]): string {
  const pts = keys.map((k) => locations.find((l) => l.location_key === k)).filter(Boolean) as { lat: number; lon: number }[];
  if (pts.length < 2) return "";
  const nm = Math.round(routeDistanceNm(pts));
  return nm > 0 ? ` · ${nm} nm` : "";
}
