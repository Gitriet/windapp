// Handmatig vastgelegde alternatieve routes naast de kortste keten (ROUTE-keuze onder VERTREK/AANKOMST).
// Geen heuristiek: een tocht heeft alleen een alternatief als het hier staat. `havens` zijn haven-slugs
// (inclusief knooppunten) in vaarvolgorde van het netwerk; elk opeenvolgend paar moet een bestaand segment zijn.
// Een alternatief geldt ook in omgekeerde richting. Aanvullen = een regel erbij.
// `vervangKortste`: deze keten wordt de standaard (eerste keuze) en de kortste keten valt weg.
export type Alternatief = { naam: string; havens: string[]; vervangKortste?: boolean };

export const ALTERNATIEVEN: Alternatief[] = [
  // Binnendoor via de Waddenzee en Harlingen, in plaats van buitenom langs Texel. Bron: eigen Navionics-route
  // Den Helder → Vlieland (47,5 nm), die langs Oudeschild en Kornwerderzand (zonder de havens in te varen: via de knooppunten) naar Harlingen en over de Vliestroom loopt.
  { naam: "binnendoor via Harlingen", havens: ["den-helder", "k-texelstroom", "k-kornwerderzand", "harlingen", "k-vliestroom", "vlieland"] },
  // Afgeleid daarvan: dezelfde route tot de Vliestroom, dan door naar West-Terschelling.
  { naam: "binnendoor via Harlingen", havens: ["den-helder", "k-texelstroom", "k-kornwerderzand", "harlingen", "k-vliestroom", "west-terschelling"] },
  // Buitenom naar West-Terschelling via Marsdiep, Molengat en Stortemelk (eigen Navionics-route, 35,6 nm).
  // Vervangt de kortste keten (binnendoor via Oudeschild en de Inschot), die voor 2 m diepgang niet bedoeld is.
  { naam: "buitenom", havens: ["den-helder", "k-marsdiep", "k-molengat", "k-stortemelk", "west-terschelling"], vervangKortste: true },
];

// Havens die een route alleen passeert: op het routekaartje geen stip of naam als ze tussen begin en eind liggen.
// (Ze blijven wel een uitwijkhaven in de lijst onder de route.)
export const DOORVAART: string[] = ["oudeschild"];
