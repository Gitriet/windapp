"use client";
// Laatst gekozen havens, bewaard op het toestel (zie lib/start-haven.ts voor de termijn).
import { useCallback, useEffect, useState } from "react";

const KEY = "wa.havens";

// opgeslagen: undefined = nog niet gelezen, null = niets (of geen opslag)
export function useStartHavens() {
  const [opgeslagen, setOpgeslagen] = useState<unknown>(undefined);
  useEffect(() => {
    try {
      const r = localStorage.getItem(KEY);
      setOpgeslagen(r ? JSON.parse(r) : null);
    } catch { setOpgeslagen(null); /* geen of kapotte opslag: altijd vragen */ }
  }, []);
  const bewaar = useCallback((van: string, naar: string) => {
    try { localStorage.setItem(KEY, JSON.stringify({ van, naar, ts: Date.now() })); } catch { /* alleen deze sessie */ }
  }, []);
  return { opgeslagen, bewaar };
}
