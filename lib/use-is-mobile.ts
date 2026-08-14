"use client";
import { useEffect, useState } from "react";

// Mobiele breakpoint = 640px — exact de fundament-conventie uit
// app/globals.css (`@media (max-width: 640px)`). Eén bron van waarheid; CSS
// kan geen custom-property in een media-conditie gebruiken, dus de waarde staat
// hier letterlijk gespiegeld. Wijzig je 'm, wijzig 'm dan op beide plekken.
const MOBILE_QUERY = "(max-width: 640px)";

// Volgt of het scherm ≤640px is. SSR/eerste render defaulten naar desktop
// (false) zodat er geen hydration-mismatch of layout-flash ontstaat; pas na
// mount schakelt de waarde om naar de echte match.
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isMobile;
}
