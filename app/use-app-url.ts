"use client";
// URL-state van de app: ?tab= (actief scherm, mobiel) en ?vertrek= (gekozen vertrek,
// ISO UTC op de minuut). replaceState — geen history-stapel per tik. Scrollpositie
// wordt per tab bewaard en bij terugkeer hersteld.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { SCREENS, DEFAULT_SCREEN, type ScreenId } from "./screens";
import type { DepOption } from "@/lib/tocht";

const isScreen = (s: string | null): s is ScreenId => SCREENS.some((x) => x.id === s);
const toParam = (ms: number) => new Date(ms).toISOString().slice(0, 16) + "Z";   // 2026-09-18T11:00Z

function writeParams(update: Record<string, string | null>) {
  const u = new URL(window.location.href);
  for (const [k, v] of Object.entries(update)) {
    if (v == null) u.searchParams.delete(k); else u.searchParams.set(k, v);
  }
  window.history.replaceState(null, "", u.toString());
}

export function useScreenTab(): [ScreenId, (t: ScreenId) => void] {
  const [tab, setTabState] = useState<ScreenId>(DEFAULT_SCREEN);
  const scrollByTab = useRef<Partial<Record<ScreenId, number>>>({});
  const restore = useRef(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (isScreen(t)) setTabState(t);
  }, []);

  const setTab = useCallback((t: ScreenId) => {
    setTabState((cur) => {
      if (cur !== t) { scrollByTab.current[cur] = window.scrollY; restore.current = true; }
      return t;
    });
    writeParams({ tab: t });
  }, []);

  useLayoutEffect(() => {
    if (!restore.current) return;
    restore.current = false;
    window.scrollTo(0, scrollByTab.current[tab] ?? 0);
  }, [tab]);

  return [tab, setTab];
}

// Gekozen vertrek ⇄ ?vertrek=. Bij laden: de URL-waarde overnemen; zodra de sweep er
// is valt een waarde die geen kandidaat (meer) is terug op het beste vertrek (null).
export function useVertrekUrl(depMs: number | null, setDepMs: (ms: number | null) => void, depOptions: DepOption[]) {
  const checked = useRef(false);
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("vertrek");
    const ms = v ? Date.parse(v) : NaN;
    if (!Number.isNaN(ms)) setDepMs(ms);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (checked.current || !depOptions.length || depMs == null) return;
    checked.current = true;
    if (!depOptions.some((o) => o.depMs === depMs)) setDepMs(null);
  }, [depOptions, depMs, setDepMs]);

  useEffect(() => {
    if (depMs != null) writeParams({ vertrek: toParam(depMs) });
  }, [depMs]);
}
