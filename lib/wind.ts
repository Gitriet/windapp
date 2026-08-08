/**
 * Bereken de relatieve windhoek t.o.v. de vaarkoers.
 * @param windDir - Ware windrichting in graden (waar de wind VANDAAN komt, 0=N)
 * @param courseDir - Vaarkoers in graden (0=N)
 * @returns Hoek 0–360 waar 0=in de wind, 90=halve wind sb, 180=voor de wind, 270=halve wind bb
 */
export function relativeWindAngle(windDir: number, courseDir: number): number {
  return ((windDir - courseDir) % 360 + 360) % 360;
}
