// Lead mapping for the point view: the lead per hour follows from how far ahead
// that hour is — so a far hour is read day2/day3 and automatically uses that
// lead's model + correction.

export function hoursToLead(hoursAhead: number): 1 | 2 | 3 {
  const lead = Math.ceil(hoursAhead / 24);
  return (Math.min(3, Math.max(1, lead)) as 1 | 2 | 3);
}
