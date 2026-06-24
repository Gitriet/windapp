"use client";
import { useEffect, useState } from "react";
import LocationPicker from "@/components/LocationPicker";
import Nav from "@/components/Nav";
import WeekTable from "@/components/WeekTable";
import type { Location, WeekDay } from "@/lib/types";

export default function Week() {
  const [locs, setLocs] = useState<Location[]>([]);
  const [key, setKey] = useState("");
  const [days, setDays] = useState<WeekDay[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/locations", { cache: "no-store" }).then((r) => r.json()).then((l: Location[]) => {
      setLocs(l);
      const wanted = new URLSearchParams(window.location.search).get("loc");
      const initial = l.find((x) => x.location_key === wanted) ?? l[0];
      if (initial) setKey(initial.location_key);
    }).catch((e) => setErr(String(e)));
  }, []);

  // keep the location in the URL so the Punt tab inherits it on switch.
  // build a fully-qualified URL — Safari rejects a bare relative "?loc=" query.
  useEffect(() => {
    if (!key) return;
    const url = new URL(window.location.href);
    url.search = `loc=${key}`;
    window.history.replaceState(null, "", url.href);
  }, [key]);

  useEffect(() => {
    if (!key) return;
    setLoading(true); setErr("");
    fetch(`/api/week/${key}`, { cache: "no-store" }).then((r) => r.json()).then((d) => {
      if (d.error) setErr(d.error); else setDays(d.days);
    }).catch((e) => setErr(String(e))).finally(() => setLoading(false));
  }, [key]);

  return (
    <>
      <header className="top">
        <h1>Windvoorspelling</h1>
        <Nav active="week" locKey={key} />
      </header>

      <div className="panel">
        <div className="flbl">Gekalibreerde locatie</div>
        <LocationPicker locations={locs} value={key} onChange={setKey} />
      </div>

      {err && <div className="panel"><span className="badge warn">fout</span> <span className="muted">{err}</span></div>}
      {loading && <div className="panel muted">Laden…</div>}

      {days && (
        <div className="panel">
          <div className="hdr"><span className="flbl">7 dagen</span><span className="loc">wind voorop</span></div>
          <WeekTable days={days} locKey={key} />
          <div className="legend">
            <div className="lgi"><span className="lgsw" style={{ background: "var(--good)" }} />tot 15 kn</div>
            <div className="lgi"><span className="lgsw" style={{ background: "var(--gust)" }} />15–25 kn</div>
            <div className="lgi"><span className="lgsw" style={{ background: "var(--hw)" }} />boven 25 kn</div>
          </div>
          <div className="note">
            daggemiddelden uit het globale model, zonder stationscorrectie · balk = laagste tot vlaag op schaal 0–40 kn ·
            tik een dag aan voor het detail op de Punt-kaart
          </div>
        </div>
      )}
    </>
  );
}
