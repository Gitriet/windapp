"use client";
// WEER & GETIJ TOCHT — weer en getij van vertrek- én aankomsthaven tegelijk, op het moment van het gekozen vertrek
// (vertrekhaven op het vertrekmoment, aankomsthaven op de ETA): vergelijkingskaart, wind langs de route en één
// getijgrafiek met beide havens. Weer en getij zijn eigenschappen van de haven; stroom hoort bij de etappe
// (VAARPLAN). Alleen presentatie.
import { localDateISO } from "@/lib/tz";
import type { UurPunt, WindOnderweg } from "@/lib/tocht";
import type { ForecastResponse, RouteHaven, WeekResponse } from "@/lib/planner-data";
import type { TideData } from "@/lib/types";
import TochtGetij from "./TochtGetij";
import TochtVergelijk from "./TochtVergelijk";
import UrenStrook from "./UrenStrook";
import { dagVenster } from "@/lib/dagweer";
import { Skeleton } from "./Shell";
import s from "./WeerGetijScreen.module.css";

export type HavenData = { fc?: ForecastResponse; week?: WeekResponse; tide?: TideData | null };
type Rol = "van" | "naar";

export interface WeerGetijScreenProps {
  nowMs: number;
  havens: Record<Rol, RouteHaven | null>;
  data: Record<Rol, HavenData>;
  onderweg?: WindOnderweg | null;   // wind en vlagen onderweg vanaf het vertrekmoment (hero)
  onderwegUren?: UurPunt[];         // wind en vlagen per uur langs de route
  trip?: { vertrekMs: number; aankomstMs: number | null } | null;
}

export default function WeerGetijScreen({ nowMs, havens, data, onderweg, onderwegUren, trip }: WeerGetijScreenProps) {
  const vandaag = localDateISO(nowMs || Date.now());
  if (!trip) return <div className={s.noot}>Kies eerst een route en vertrek.</div>;
  const geladen = (["van", "naar"] as Rol[]).every((r) => havens[r] && data[r].fc);
  if (!geladen) return <Skeleton rows={3} height={120} label="weer en getij laden" tekst="Weer en getij ophalen…" />;

  // per haven het anker: vertrekmoment resp. ETA
  const delen = (["van", "naar"] as Rol[]).map((r) => {
    const ankerMs = r === "van" ? trip.vertrekMs : trip.aankomstMs ?? trip.vertrekMs;
    const fc = data[r].fc!;
    const dag = localDateISO(ankerMs);
    return {
      r, naam: havens[r]!.naam, ankerMs, dag, fc, tide: data[r].tide ?? null,
      rol: r === "van" ? "OP VERTREK" : "BIJ AANKOMST", ankerLabel: r === "van" ? "VERTREK" : "ETA",
      venster: dagVenster(fc.points, dag, vandaag, ankerMs),
    };
  });

  return (
    <>
      <TochtVergelijk delen={delen.map((d) => ({ rol: d.rol, naam: d.naam, ankerMs: d.ankerMs, venster: d.venster, weather: d.fc.weather }))} onderweg={onderweg} />
      {onderwegUren && onderwegUren.length > 0 && (
        <section className={s.haven} aria-label="onderweg">
          <div className={s.havenKop}>ONDERWEG · {delen[0].naam.toUpperCase()} → {delen[1].naam.toUpperCase()}</div>
          <UrenStrook pts={onderwegUren} kop="WIND LANGS DE ROUTE" tocht={null} alleUren />
        </section>
      )}
      <section className={s.haven} aria-label="getij">
        <div className={s.havenKop}>GETIJ · {delen[0].naam.toUpperCase()} &amp; {delen[1].naam.toUpperCase()}</div>
        <div className={`card ${s.blok}`}>
          <TochtGetij vanMs={trip.vertrekMs} totMs={trip.aankomstMs ?? trip.vertrekMs}
            delen={delen.map((d) => ({ naam: d.naam, tide: d.tide, ankerMs: d.ankerMs, ankerLabel: d.ankerLabel }))} />
        </div>
      </section>
    </>
  );
}
