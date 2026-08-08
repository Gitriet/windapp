import { COLORS } from "@/lib/colors";

interface WindRoseIconProps {
  /** Windsnelheid in knopen (afgerond geheel getal) */
  speed: number;
  /** Relatieve windhoek in graden: 0 = in de wind (van voren),
      90 = halve wind sb, 180 = voor de wind, 270 = halve wind bb.
      Dit is de hoek waar de wind VANDAAN komt t.o.v. de boeg.
      null/undefined → geen windpunt (alleen cirkel + getal). */
  angle?: number | null;
  /** Renderbreedte in px. Hoogte schaalt mee (verhouding 60:72). Default 56. */
  size?: number;
  /** Toon het koerspijltje boven de cirkel. Default true.
      Op false zetten voor mini-varianten (7-daagse strip). */
  showCourseArrow?: boolean;
}

export function WindRoseIcon({ speed, angle, size = 56, showCourseArrow = true }: WindRoseIconProps) {
  // Windpunt op de cirkelrand: 0° = N (boven, in de wind), 90° = O (sb).
  // SVG-hoek 0° wijst naar rechts, dus -90° roteren voor N=boven.
  let dot: { cx: number; cy: number } | null = null;
  if (angle != null) {
    const rad = ((angle - 90) * Math.PI) / 180;
    dot = { cx: 30 + 22 * Math.cos(rad), cy: 42 + 22 * Math.sin(rad) };
  }

  // Zonder koerspijl valt de bovenste ~12px weg; viewBox meeschuiven en verhouding aanpassen.
  const viewBox = showCourseArrow ? "0 0 60 72" : "0 12 60 60";
  const height = showCourseArrow ? size * (72 / 60) : size;

  return (
    <svg width={size} height={height} viewBox={viewBox} xmlns="http://www.w3.org/2000/svg">
      {showCourseArrow && (
        <g stroke={COLORS.wind} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.6} fill="none">
          <path d="M26,4 L30,0 L34,4" />
          <line x1={30} y1={0} x2={30} y2={8} />
        </g>
      )}
      <circle cx={30} cy={42} r={22} fill="none" stroke={COLORS.wind} strokeWidth={1.5} opacity={0.25} />
      {/* kardinale streepjes N/O/Z/W */}
      <g stroke={COLORS.wind} strokeWidth={1.2} opacity={0.4}>
        <line x1={30} y1={20} x2={30} y2={24} />
        <line x1={52} y1={42} x2={48} y2={42} />
        <line x1={30} y1={64} x2={30} y2={60} />
        <line x1={8} y1={42} x2={12} y2={42} />
      </g>
      {/* interkardinale streepjes NO/ZO/ZW/NW */}
      <g stroke={COLORS.wind} strokeWidth={1} opacity={0.25}>
        <line x1={45.6} y1={26.4} x2={43.4} y2={28.6} />
        <line x1={45.6} y1={57.6} x2={43.4} y2={55.4} />
        <line x1={14.4} y1={57.6} x2={16.6} y2={55.4} />
        <line x1={14.4} y1={26.4} x2={16.6} y2={28.6} />
      </g>
      <text x={30} y={47} textAnchor="middle" fill={COLORS.wind} fontFamily="Inter, system-ui" fontSize={18} fontWeight={700}>
        {Math.round(speed)}
      </text>
      {dot && <circle cx={dot.cx} cy={dot.cy} r={4.5} fill={COLORS.wind} />}
    </svg>
  );
}
