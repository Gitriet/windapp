"use client";
import { Fragment } from "react";
import Link from "next/link";
import WeatherIcon from "./WeatherIcon";
import { wxGroup } from "@/lib/weather";
import { localWeekdayShort } from "@/lib/tz";
import { dirColor } from "@/lib/sailing";
import { compass } from "@/lib/format";
import { WARN } from "@/lib/constants";
import type { WeekDay } from "@/lib/types";

// One colour language across the app: the bar's LENGTH (on a fixed 0–40 kn scale)
// says how hard it blows, its HUE (= direction, via the shared dirColor) says where
// from. No separate strength colour band — colour means direction everywhere.
const WIND_MAX = 40; // kn — full width of the wind bar
const pct = (kn: number) => (Math.max(0, Math.min(WIND_MAX, kn)) / WIND_MAX) * 100;

// Hard-wind triangle uses the SAME thresholds as the Punt warning, keyed on the
// day's peak (gust): amber from 6 bft (≥28 kn), red from 7 bft (≥34 kn).
function warnLevel(peak: number | null): "amber" | "red" | null {
  if (peak == null) return null;
  if (peak >= WARN.hardWind.redGust) return "red";
  if (peak >= WARN.hardWind.amberGust) return "amber";
  return null;
}

const TRI = (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
    <path d="M8 1.5 L15 14 L1 14 Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <line x1="8" y1="6" x2="8" y2="10.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="8" cy="12.3" r="0.9" fill="currentColor" />
  </svg>
);

// Small vane pointing to where the wind comes FROM (same convention as the Punt
// chart), coloured by direction.
function Arrow({ dir }: { dir: number }) {
  return (
    <svg width={20} height={20} viewBox="0 0 20 20" role="img"
         aria-label={`windrichting ${Math.round(dir)} graden`}>
      <g transform={`rotate(${dir} 10 10)`}>
        <path d="M10 3 L10 16 M6 7 L10 3 L14 7" fill="none"
              stroke={dirColor(dir)} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

function dayParts(date: string, i: number): { main: string; sub: string } {
  if (i === 0) return { main: "Vandaag", sub: "" };
  const [, mo, dd] = date.split("-").map(Number);
  return { main: localWeekdayShort(Date.parse(date + "T12:00:00Z")), sub: `${dd}/${mo}` };
}

export default function WeekTable({ days, locKey }: { days: WeekDay[]; locKey: string }) {
  return (
    <div className="wk">
      {days.map((d, i) => {
        const { main, sub } = dayParts(d.date, i);
        const hasDir = d.dir != null;
        const col = hasDir ? dirColor(d.dir!) : "var(--faint)";
        const lo = d.windMin ?? 0;
        const hi = d.gust ?? d.speedMax ?? 0;   // the day's "piek" = bar high end
        const wl = warnLevel(hi);
        return (
          <Fragment key={d.date}>
            {i === 3 && (
              <div className="wk-split">
                <span className="ln" /><span className="tx">verder vooruit · globaal model · minder zeker</span><span className="ln" />
              </div>
            )}
            <Link className={"wk-row" + (i >= 3 ? " far" : "")}
                  href={`/?loc=${locKey}&day=${i}&range=1`}>
              <span className="wk-day">{main}{sub && <small>{sub}</small>}</span>

              <span className="wk-wx">
                <WeatherIcon group={wxGroup(d.code)} size={20} />
                {d.pop != null && d.pop >= 20 && <span className="wk-pop">{d.pop}%</span>}
              </span>

              <span className="wk-dir">
                {hasDir && <Arrow dir={d.dir!} />}
                <span className="wk-dlbl">{hasDir ? compass(d.dir!) : "–"}</span>
              </span>

              <span className="wk-bar">
                <span className="wk-track" />
                <span className="wk-fill" style={{ left: `${pct(lo)}%`, width: `${Math.max(0, pct(hi) - pct(lo))}%`, background: col }} />
                {d.speedMax != null && <span className="wk-avg" style={{ left: `${pct(d.speedMax)}%` }} />}
              </span>

              <span className="wk-nums">
                <span className="wk-big">{d.speedMax != null ? Math.round(d.speedMax) : "–"}<span className="wk-u"> kn</span></span>
                <span className="wk-sub">
                  {wl && <span className={"wk-warn " + wl}>{TRI}</span>}
                  piek {Math.round(hi)}{d.tmax != null && <> · {Math.round(d.tmax)}°</>}
                </span>
              </span>
            </Link>
          </Fragment>
        );
      })}
    </div>
  );
}
