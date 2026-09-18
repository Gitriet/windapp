// Volgorde en labels van de schermen. Herschikken = deze array wijzigen; tabbar,
// desktopkolommen en URL (?tab=) lezen allemaal hieruit.
export const SCREENS = [
  { id: "route", label: "ROUTE" },
  { id: "nu", label: "WEER" },
  { id: "getijden", label: "GETIJDEN" },
  { id: "vaarplan", label: "VAARPLAN" },
] as const;

export type ScreenId = (typeof SCREENS)[number]["id"];
export const DEFAULT_SCREEN: ScreenId = "route";
