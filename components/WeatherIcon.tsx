import type { WxGroup } from "@/lib/weather";

// Compact monochrome weather glyphs (24×24, currentColor). Used standalone in the
// snapshot and nested (x/y) inside the weather strip. Deliberately understated.
const CLOUD = "M8 17.5 h8.2 a3.2 3.2 0 0 0 .3 -6.4 a4.8 4.8 0 0 0 -9.1 -1.3 a3.6 3.6 0 0 0 .6 7.7 z";

function Glyph({ group }: { group: WxGroup }) {
  const drops = (slanted: boolean) =>
    [9, 12.5, 16].map((x, i) => (
      <line key={i} x1={x} y1={19} x2={slanted ? x - 1.6 : x} y2={22} />
    ));
  switch (group) {
    case "clear":
      return (
        <g>
          <circle cx={12} cy={12} r={4.3} />
          {Array.from({ length: 8 }, (_, i) => {
            const a = (i * Math.PI) / 4, c = Math.cos(a), s = Math.sin(a);
            return <line key={i} x1={12 + c * 6.4} y1={12 + s * 6.4} x2={12 + c * 8.6} y2={12 + s * 8.6} />;
          })}
        </g>
      );
    case "fewclouds":
      return (
        <g>
          <circle cx={8.5} cy={8} r={2.7} />
          {[-1, 0, 1, 2].map((i) => {
            const a = (i * Math.PI) / 4 - Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
            return <line key={i} x1={8.5 + c * 3.8} y1={8 + s * 3.8} x2={8.5 + c * 5.4} y2={8 + s * 5.4} />;
          })}
          <path d={CLOUD} />
        </g>
      );
    case "fog":
      return (
        <g>
          <path d={CLOUD} />
          {[20, 22].map((y, i) => <line key={i} x1={6.5 + i} y1={y} x2={17.5 - i} y2={y} />)}
        </g>
      );
    case "drizzle":
      return <g><path d={CLOUD} />{[10, 14].map((x, i) => <line key={i} x1={x} y1={19.5} x2={x} y2={21.5} />)}</g>;
    case "rain":
      return <g><path d={CLOUD} />{drops(false)}</g>;
    case "showers":
      return <g><path d={CLOUD} />{drops(true)}</g>;
    case "snow":
      return <g><path d={CLOUD} />{[9, 12.5, 16].map((x, i) => <circle key={i} cx={x} cy={20.5} r={0.9} fill="currentColor" stroke="none" />)}</g>;
    case "thunder":
      return <g><path d={CLOUD} /><polyline points="12.5,18 10,22 13,22 11,25.5" /></g>;
    case "overcast":
    default:
      return <path d={CLOUD} />;
  }
}

export default function WeatherIcon(
  { group, size = 20, x, y, className }:
  { group: WxGroup; size?: number; x?: number; y?: number; className?: string },
) {
  const pos = x != null && y != null ? { x, y } : {};
  return (
    <svg {...pos} width={size} height={size} viewBox="0 0 24 24" className={className}
         fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <Glyph group={group} />
    </svg>
  );
}
