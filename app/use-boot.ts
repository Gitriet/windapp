"use client";
// Bootprofiel van deze gebruiker, bewaard op het toestel. Zelfde sleutel als de oude
// app ("wa.boat"), zodat eerder ingestelde waarden terugkomen.
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_BOAT, type BoatProfile } from "@/lib/polar";

const KEY = "wa.boat";

export function useBoot(): [BoatProfile, (patch: Partial<BoatProfile>) => void] {
  const [boat, setState] = useState<BoatProfile>(DEFAULT_BOAT);
  useEffect(() => {
    try {
      const b = localStorage.getItem(KEY);
      if (b) setState({ ...DEFAULT_BOAT, ...JSON.parse(b) });
    } catch { /* geen of kapotte opslag: standaardprofiel */ }
  }, []);
  const setBoat = useCallback((patch: Partial<BoatProfile>) => setState((prev) => {
    const next = { ...prev, ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* alleen deze sessie */ }
    return next;
  }), []);
  return [boat, setBoat];
}
