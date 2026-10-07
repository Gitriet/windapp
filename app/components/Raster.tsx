// Subtiel raster voor de tijdgrafieken: gestippelde lijnen met de waarden in een smalle marge links
// (RASTER_GUT breed), zodat een label nooit over de lijn van de grafiek loopt. Opmaak in globals.css.
export const RASTER_GUT = 20;

export function Raster({ waarden, y, x1, fmt = (v) => String(Math.abs(v)).replace(".", ",") }: {
  waarden: number[]; y: (v: number) => number; x1: number; fmt?: (v: number) => string;
}) {
  return (
    <>
      {waarden.map((v) => (
        <g key={v}>
          <line x1={RASTER_GUT} x2={x1} y1={y(v)} y2={y(v)} className="grafiek-raster" />
          <text x={RASTER_GUT - 3} y={y(v) + 3} className="grafiek-as">{fmt(v)}</text>
        </g>
      ))}
    </>
  );
}
