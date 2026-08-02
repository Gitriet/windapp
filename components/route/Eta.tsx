"use client";
import { passageOrigin, type PassageResult } from "@/lib/passage";
import type { BoatProfile } from "@/lib/polar";
import { localHM } from "@/lib/tz";

// Eén plek waar een ETA getoond wordt, zodat nergens een kaal tijdstip kan ontstaan:
// het tijdstip draagt altijd zijn herkomst-regel mee.
export default function Eta({ ms, boat, source, prefix, inline }: {
  ms: number | null;
  boat: BoatProfile;
  source: PassageResult["currentSource"];
  prefix?: string;
  inline?: boolean;
}) {
  return (
    <div className={"eta" + (inline ? " inline" : "")}>
      <span className={"t" + (ms == null ? " none" : "")}>
        {prefix ? `${prefix} ` : ""}{ms == null ? "onhaalbaar" : localHM(ms)}
      </span>
      <span className="src">{ms == null ? "binnen de horizon niet te halen" : passageOrigin(boat, source)}</span>
    </div>
  );
}
