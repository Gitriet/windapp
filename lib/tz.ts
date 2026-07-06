// Presentation-only timezone helpers: data and maths stay in UTC, the point view
// shows Europe/Amsterdam local time. Uses Intl with a real IANA zone, so winter
// (UTC+1) and summer (UTC+2) — and the DST transitions between them — are handled
// from the date itself, never a fixed offset.
const TZ = "Europe/Amsterdam";

const fParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const fWeekday = new Intl.DateTimeFormat("nl-NL", { timeZone: TZ, weekday: "short" });

function parts(ms: number) {
  const o: Record<string, string> = {};
  for (const p of fParts.formatToParts(ms)) if (p.type !== "literal") o[p.type] = p.value;
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour, mi: +o.minute };
}

// Amsterdam UTC offset (ms) at an instant — always a whole number of hours for NL.
function offsetMs(ms: number): number {
  const p = parts(ms);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - Math.floor(ms / 60000) * 60000;
}

const msOf = (iso: string) => Date.parse(iso + (iso.endsWith("Z") ? "" : "Z"));

export function localHM(ms: number): string {
  const p = parts(ms);
  return String(p.h).padStart(2, "0") + ":" + String(p.mi).padStart(2, "0");
}

// Compact whole-hour label for dense axes: "6", "15", "0" (no leading zero, no
// ":00"). Used for the chart hour ticks so the labels take little width.
export function localHourShort(ms: number): string {
  return String(parts(ms).h);
}

export function localWeekdayShort(ms: number): string {
  return fWeekday.format(ms).replace(".", "").toLowerCase();
}

// Amsterdam-local calendar date "YYYY-MM-DD" from a UTC instant — matches the
// day keys Open-Meteo returns for the 7-day outlook (timezone=Europe/Amsterdam),
// so tide extrema can be grouped onto the same local days.
export function localDateISO(ms: number): string {
  const p = parts(ms);
  return `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

// Amsterdam-local time-of-day as decimal hours (e.g. 14.5 = 14:30). Used by the
// procedural stroom model, which works in hours-of-day around an HW reference.
export function localHourDecimal(ms: number): number {
  const p = parts(ms);
  return p.h + p.mi / 60;
}

// "ma 22:00" in Amsterdam local time, from a UTC ISO string.
export function fmtTimeNL(iso: string): string {
  const ms = msOf(iso);
  return `${localWeekdayShort(ms)} ${localHM(ms)}`;
}

// "wo 24/6" in Amsterdam local time — weekday + day/month, for the day stepper.
export function localDayLabel(ms: number): string {
  const p = parts(ms);
  return `${localWeekdayShort(ms)} ${p.d}/${p.mo}`;
}

// Epoch of the most recent Amsterdam local midnight at or before `ms`.
// Two passes so a DST change near the boundary resolves to the right offset.
export function localMidnight(ms: number): number {
  const p = parts(ms);
  const wall = Date.UTC(p.y, p.mo - 1, p.d, 0, 0);
  let guess = wall - offsetMs(ms);
  guess = wall - offsetMs(guess);
  return guess;
}

// Local midnights strictly inside (t0, endMs) — the day boundary positions.
// Stepping +25h then snapping handles the 23h/25h DST days.
export function dayMidnights(t0: number, endMs: number): number[] {
  const out: number[] = [];
  let m = localMidnight(t0);
  while (true) {
    const next = localMidnight(m + 25 * 3600000);
    if (next >= endMs) break;
    if (next > t0) out.push(next);
    m = next;
  }
  return out;
}
