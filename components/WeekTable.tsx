"use client";
import { Fragment } from "react";
import Link from "next/link";
import WeatherIcon from "./WeatherIcon";
import { wxGroup } from "@/lib/weather";
import { localWeekdayShort } from "@/lib/tz";
import type { WeekDay } from "@/lib/types";

// Fixed wind scale and the strength thresholds shared by the needle + the bar.
const WIND_MAX = 40; // kn — full width of the wind bar
function strengthColor(kn: number | null): string {
  if (kn == null) return "var(--faint)";
  if (kn < 15) return "var(--good)";
  if (kn < 25) return "var(--gust)";
  return "var(--hw)";
}

const rad = (d: number) => (d * Math.PI) / 180;
const pt = (cx: number, cy: number, r: number, deg: number) =>
  [cx + r * Math.sin(rad(deg)), cy - r * Math.cos(rad(deg))] as const;

// Small compass rose: needle points to the SOURCE (dominant direction), coloured
// by wind strength, with a north tick on top.
function Rose({ dir, color }: { dir: number | null; color: string }) {
  const s = 32, c = s / 2, R = c - 2;
  if (dir == null) return <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} />;
  const [tx, ty] = pt(c, c, R - 3, dir);
  const [bx, by] = pt(c, c, R - 3, dir + 180);
  const [l1x, l1y] = pt(tx, ty, 4, dir + 150);
  const [l2x, l2y] = pt(tx, ty, 4, dir - 150);
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} role="img"
         aria-label={`windrichting ${Math.round(dir)} graden`}>
      <circle cx={c} cy={c} r={R} fill="none" stroke="var(--line2)" strokeWidth={1} />
      <line x1={c} y1={1.5} x2={c} y2={4.5} stroke="var(--faint)" strokeWidth={1.2} />
      <line x1={bx} y1={by} x2={tx} y2={ty} stroke={color} strokeWidth={1.6} />
      <polygon points={`${tx},${ty} ${l1x},${l1y} ${l2x},${l2y}`} fill={color} />
      <circle cx={c} cy={c} r={1.6} fill="var(--panel2)" stroke={color} strokeWidth={1} />
    </svg>
  );
}

function dayLabel(date: string, i: number): string {
  if (i === 0) return "Vandaag";
  const [, mo, dd] = date.split("-").map(Number);
  return `${localWeekdayShort(Date.parse(date + "T12:00:00Z"))} ${dd}/${mo}`;
}

export default function WeekTable({ days, locKey }: { days: WeekDay[]; locKey: string }) {
  return (
    <div className="wk">
      {days.map((d, i) => {
        const col = strengthColor(d.speedMax);
        const lo = d.windMin ?? 0, hi = d.speedMax ?? 0;
        const left = (Math.max(0, lo) / WIND_MAX) * 100;
        const width = (Math.max(0, Math.min(WIND_MAX, hi) - Math.max(0, lo)) / WIND_MAX) * 100;
        return (
          <Fragment key={d.date}>
            {i === 3 && <div className="wk-div">verder vooruit · globaal model · minder zeker</div>}
            <Link className={"wk-row" + (i >= 3 ? " dim" : "")}
                  href={`/?loc=${locKey}&day=${i}&range=1`}>
              <span className="wk-day">{dayLabel(d.date, i)}</span>
              <span className="wk-wx">
                <WeatherIcon group={wxGroup(d.code)} size={22} />
                {d.pop != null && d.pop >= 20 && <span className="wk-pop">{d.pop}%</span>}
              </span>
              <Rose dir={d.dir} color={col} />
              <span className="wk-bar">
                <span className="wk-track">
                  <span className="wk-fill" style={{ left: `${left}%`, width: `${width}%`, background: col }} />
                </span>
                <span className="wk-nums">
                  <span className="wk-spd" style={{ color: col }}>{d.speedMax != null ? Math.round(d.speedMax) : "–"}<span className="wk-u">kn</span></span>
                  {d.gust != null && <span className="wk-peak">piek {Math.round(d.gust)}</span>}
                </span>
              </span>
              <span className="wk-temp">
                {d.tmax != null ? Math.round(d.tmax) : "–"}°
                <span className="wk-tmin">{d.tmin != null ? Math.round(d.tmin) : "–"}°</span>
              </span>
            </Link>
          </Fragment>
        );
      })}
    </div>
  );
}
