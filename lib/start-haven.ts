// Laatst gebruikte havens, 48 uur bruikbaar als startstand. De termijn loopt vanaf het
// laatste gebruik (elke start en elke havenwissel zet `ts` opnieuw), niet vanaf de keuze.
export const START_TERMIJN_MS = 48 * 3_600_000;

export interface StartHavens { van: string; naar: string }

// Opgeslagen waarde ({van, naar, ts}) -> havens om mee te starten, of null (nog nooit
// gekozen, verlopen, kapot, of een haven die niet meer bestaat).
export function geldigeStart(raw: unknown, nu: number, bekend: readonly string[]): StartHavens | null {
  if (!raw || typeof raw !== "object") return null;
  const { van, naar, ts } = raw as Record<string, unknown>;
  if (typeof van !== "string" || typeof naar !== "string" || typeof ts !== "number") return null;
  if (van === naar || !bekend.includes(van) || !bekend.includes(naar)) return null;
  if (nu - ts > START_TERMIJN_MS || ts > nu) return null;
  return { van, naar };
}
