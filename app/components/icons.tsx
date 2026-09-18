// Kleine SVG-iconen; kleur via currentColor (de ouder zet de kleur in CSS).
import { wxGroup, type WxGroup } from "@/lib/weather";

// Windpijl: wijst naar waar de wind VANDAAN komt (0° = noord), zoals overal in de app.
// Eén maat voor alle windpijlen.
export const WIND_ARROW_PX = 16;
export function WindArrow({ dir }: { dir: number }) {
  const size = WIND_ARROW_PX;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ transform: `rotate(${dir}deg)`, flex: "0 0 auto" }}>
      <path d="M12 3 L16 15 L12 12 L8 15 Z" fill="currentColor" />
    </svg>
  );
}

const CLOUD = "M6 17a4 4 0 0 1 .5-8 5 5 0 0 1 9.7-1.3A4.5 4.5 0 0 1 17.5 17H6Z";
const SUN = (
  <>
    <circle cx={12} cy={12} r={4} />
    {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
      <line key={a} x1={12} y1={3} x2={12} y2={5} transform={`rotate(${a} 12 12)`} />
    ))}
  </>
);
const DROPS = <path d="M8 20v1M12 20v1M16 20v1" />;

// Weericoon uit de WMO-code (via wxGroup). Lijnicoon, 2px.
export function WxIcon({ code, size }: { code: number | null; size: number }) {
  const g: WxGroup = wxGroup(code);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden style={{ flex: "0 0 auto" }}>
      {g === "clear" ? SUN
        : g === "fewclouds" ? <><g transform="translate(-3 -3) scale(.8)">{SUN}</g><path d={CLOUD} transform="translate(2 2) scale(.85)" /></>
        : <path d={CLOUD} transform={g === "overcast" || g === "fog" ? undefined : "translate(0 -2)"} />}
      {(g === "rain" || g === "drizzle" || g === "showers" || g === "thunder") && DROPS}
      {g === "snow" && <path d="M8 20h.01M12 20h.01M16 20h.01" strokeWidth={2.4} />}
    </svg>
  );
}
