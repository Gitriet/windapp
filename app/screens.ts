// Volgorde en labels van de schermen. Herschikken = deze array wijzigen; tabbar,
// desktopkolommen en URL (?tab=) lezen allemaal hieruit. label = paneeltitel, kort = tabbar.
export const SCREENS = [
  { id: "route", label: "ROUTE", kort: "ROUTE" },
  { id: "weertocht", label: "WIND & GETIJ", kort: "WIND & GETIJ" },
  { id: "vaarplan", label: "VAARPLAN", kort: "VAARPLAN" },
] as const;

export type ScreenId = (typeof SCREENS)[number]["id"];
export const DEFAULT_SCREEN: ScreenId = "route";
