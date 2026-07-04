"use client";
import { Fragment } from "react";
import Link from "next/link";
import WeatherIcon from "./WeatherIcon";
import { wxGroup } from "@/lib/weather";
import { localWeekdayShort } from "@/lib/tz";
import { compass } from "@/lib/format";
import { sailBand } from "@/lib/sailing";
import type { WeekDay } from "@/lib/types";

// 7-day day rows in the meteogram visual language (light theme, hairline dividers,
// mono numbers). Uncorrected daily global-model aggregates — one row per day:
// weekday + date, a subtle weather glyph + max temp, the dominant wind direction as
// an ink compass-style vane, the day's wind range (min hourly → daily max) as mono
// numbers + a slim bar on a fixed 0–40 kn scale, the peak gust, and a
// vaarbaarheids-verdict dot in the nav colours (from sailBand on the gust — the same
// rule as the meteogram spine). Wind-only: HW/LW only reaches ~4 days, so the tide
// stays on Punt. Tapping a row opens that day on the Punt meteogram.
const WIND_MAX = 40;                       // kn — full width of the range bar
const pct = (kn: number) => (Math.max(0, Math.min(WIND_MAX, kn)) / WIND_MAX) * 100;

// sailBand's three classes -> nav-colour verdict (matches the meteogram spine)
const NAV = {
  ok:    { cls: "go",    label: "Vaarbaar" },
  krap:  { cls: "tight", label: "Krap" },
  storm: { cls: "no",    label: "Niet" },
} as const;

// Ink vane pointing to where the wind comes FROM (N = up) — same convention as the
// meteogram's direction arrows.
function Vane({ dir }: { dir: number }) {
  return (
    <svg width={20} height={20} viewBox="0 0 20 20" role="img"
         aria-label={`windrichting ${Math.round(dir)} graden`}>
      <g transform={`rotate(${dir} 10 10)`}>
        <path d="M10 3 L10 16 M6 7 L10 3 L14 7" fill="none"
              stroke="var(--ink)" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
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
    <div className="wd">
      {days.map((d, i) => {
        const { main, sub } = dayParts(d.date, i);
        const hasDir = d.dir != null;
        const lo = d.windMin ?? 0;
        const hi = d.speedMax ?? 0;
        const nav = d.gust != null ? NAV[sailBand(d.gust).cls] : null;
        return (
          <Fragment key={d.date}>
            {i === 3 && (
              <div className="wd-split"><span className="tx">verder vooruit · minder zeker</span></div>
            )}
            <Link className={"wd-row" + (i >= 3 ? " far" : "")}
                  href={`/?loc=${locKey}&day=${i}&range=1`}>
              <span className="wd-day"><b>{main}</b>{sub && <small>{sub}</small>}</span>

              <span className="wd-wx">
                <WeatherIcon group={wxGroup(d.code)} size={18} />
                {d.tmax != null && <span className="wd-temp">{Math.round(d.tmax)}°</span>}
              </span>

              <span className="wd-dir">
                {hasDir ? <Vane dir={d.dir!} /> : <span className="wd-dash">–</span>}
                {hasDir && <span className="wd-dlbl">{compass(d.dir!)}</span>}
              </span>

              <span className="wd-range">
                <span className="wd-kn">
                  {d.windMin != null ? Math.round(d.windMin) : "–"}–{d.speedMax != null ? Math.round(d.speedMax) : "–"}
                  <small> kn</small>
                </span>
                <span className="wd-bar" aria-hidden="true">
                  <span className="wd-track" />
                  <span className="wd-fill" style={{ left: `${pct(lo)}%`, width: `${Math.max(1.5, pct(hi) - pct(lo))}%` }} />
                </span>
                <span className="wd-gust">vlaag {d.gust != null ? Math.round(d.gust) : "–"}</span>
              </span>

              {nav && (
                <span className={"wd-verdict " + nav.cls}>
                  <span className="wd-dot" />{nav.label}
                </span>
              )}
            </Link>
          </Fragment>
        );
      })}
    </div>
  );
}
