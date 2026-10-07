// Gedeelde afleidingen voor de tijdgrafieken (VAARPLAN-tegels, getijkromme): een reeks afvlakken en
// een subtiel raster met nette waarden.

// Gemiddelde van een reeks over een venster rond elk punt, op een vast tijdraster van van..tot.
// Sprongen (bv. de stroom op een etappegrens) verdwijnen; begin en eind blijven op van en tot.
export function gladReeks(raw: { ms: number; v: number }[], van: number, tot: number, venster = 60 * 60_000, stap = 10 * 60_000): { ms: number; v: number }[] {
  if (!raw.length) return [];
  const n = Math.max(2, Math.ceil((tot - van) / stap) + 1);
  return Array.from({ length: n }, (_, i) => {
    const ms = Math.min(tot, van + i * stap);
    const w = raw.filter((q) => Math.abs(q.ms - ms) <= venster / 2);
    const bij = w.length ? w : [raw.reduce((m, q) => (Math.abs(q.ms - ms) < Math.abs(m.ms - ms) ? q : m), raw[0])];
    return { ms, v: bij.reduce((a, q) => a + q.v, 0) / bij.length };
  });
}

const STAPPEN = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200];
// Rasterwaarden (veelvouden van een nette stap, zonder 0) binnen [lo, hi], hooguit maxLijnen per kant.
// top/bodem = de schaal afgerond op de stap, zodat de hoogste lijn precies de rand van de grafiek is.
export function rasterWaarden(lo: number, hi: number, maxLijnen = 4): { stap: number; waarden: number[]; top: number; bodem: number } {
  const ruim = Math.max(hi, -lo, 1e-9);
  const stap = STAPPEN.find((s) => Math.ceil(ruim / s - 1e-9) <= maxLijnen) ?? STAPPEN[STAPPEN.length - 1];
  const top = hi > 0 ? Math.ceil(hi / stap - 1e-9) * stap : 0, bodem = lo < 0 ? Math.floor(lo / stap + 1e-9) * stap : 0;
  const waarden: number[] = [];
  for (let v = stap; v <= top + 1e-9; v += stap) waarden.push(Math.round(v * 1e6) / 1e6);
  for (let v = -stap; v >= bodem - 1e-9; v -= stap) waarden.push(Math.round(v * 1e6) / 1e6);
  return { stap, waarden: waarden.sort((a, b) => b - a), top, bodem };
}
