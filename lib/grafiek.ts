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

// Getijfases van een stroomreeks (kn, >0 mee) voor labels: een piek per fase en een kentering tussen fases.
// Kleine wisselingen (een fase met een piek onder max(minPiek, relMin × sterkste) of korter dan minDuur)
// tellen niet mee: ze worden in de omliggende fase opgenomen, zodat een lange tocht niet vol labels staat.
export type StroomFase = { sign: 1 | -1; i0: number; i1: number };
export function stroomFasen(seg: { ms: number; v: number }[], minPiek = 0.25, relMin = 0.2, minDuurMs = 45 * 60_000): {
  pieken: { ms: number; v: number; soort: "mee" | "tegen" }[];
  kenteringen: { ms: number; naarMee: boolean }[];
} {
  if (seg.length < 2) return { pieken: [], kenteringen: [] };
  const sterkste = Math.max(...seg.map((q) => Math.abs(q.v)));
  const drempel = Math.max(minPiek, relMin * sterkste);
  let fasen: StroomFase[] = [];
  seg.forEach((q, i) => {
    const sign = q.v >= 0 ? 1 : -1, l = fasen[fasen.length - 1];
    if (l && l.sign === sign) l.i1 = i; else fasen.push({ sign, i0: i, i1: i });
  });
  const piek = (f: StroomFase) => Math.max(...seg.slice(f.i0, f.i1 + 1).map((q) => Math.abs(q.v)));
  const duur = (f: StroomFase) => seg[f.i1].ms - seg[f.i0].ms;
  const klein = (f: StroomFase) => piek(f) < drempel || duur(f) < minDuurMs;
  for (let k = fasen.findIndex(klein); k >= 0 && fasen.length > 1; k = fasen.findIndex(klein)) {
    const f = fasen[k], v = fasen[k - 1], n = fasen[k + 1];
    if (v && n) fasen = [...fasen.slice(0, k - 1), { sign: v.sign, i0: v.i0, i1: n.i1 }, ...fasen.slice(k + 2)];
    else if (v) fasen = [...fasen.slice(0, k - 1), { ...v, i1: f.i1 }];
    else fasen = [{ ...n, i0: f.i0 }, ...fasen.slice(2)];
  }
  const pieken = fasen.flatMap((f) => {
    const top = seg.slice(f.i0, f.i1 + 1).reduce((m, q) => (Math.abs(q.v) > Math.abs(m.v) ? q : m));
    return Math.abs(top.v) >= drempel ? [{ ms: top.ms, v: top.v, soort: (f.sign > 0 ? "mee" : "tegen") as "mee" | "tegen" }] : [];
  });
  // kentering tussen twee fases: de laatste nulpassage vóór de piek van de volgende fase, in die richting
  const kenteringen = fasen.slice(1).flatMap((f, k) => {
    const naarMee = f.sign > 0;
    for (let i = f.i0; i > fasen[k].i0; i--) {
      const a = seg[i - 1], b = seg[i];
      if (a.v * b.v < 0 && (b.v > 0) === naarMee) return [{ ms: a.ms + (a.v / (a.v - b.v)) * (b.ms - a.ms), naarMee }];
    }
    return [];
  });
  return { pieken, kenteringen };
}
