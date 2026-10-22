import { geldigeStart, START_TERMIJN_MS } from "../lib/start-haven";

let fail = 0;
const ok = (name: string, cond: boolean) => { if (!cond) fail++; console.log(`${cond ? "ok  " : "FAIL"} ${name}`); };
const nu = Date.UTC(2026, 9, 22, 12);
const bekend = ["harlingen", "vlieland", "terschelling"];

ok("vers", geldigeStart({ van: "harlingen", naar: "vlieland", ts: nu - 3_600_000 }, nu, bekend)?.naar === "vlieland");
ok("net binnen 48u", geldigeStart({ van: "harlingen", naar: "vlieland", ts: nu - START_TERMIJN_MS }, nu, bekend) !== null);
ok("net over 48u", geldigeStart({ van: "harlingen", naar: "vlieland", ts: nu - START_TERMIJN_MS - 1 }, nu, bekend) === null);
ok("ts in de toekomst", geldigeStart({ van: "harlingen", naar: "vlieland", ts: nu + 1 }, nu, bekend) === null);
ok("onbekende haven", geldigeStart({ van: "harlingen", naar: "weg", ts: nu }, nu, bekend) === null);
ok("van == naar", geldigeStart({ van: "harlingen", naar: "harlingen", ts: nu }, nu, bekend) === null);
ok("niets", geldigeStart(null, nu, bekend) === null);
ok("kapot", geldigeStart({ van: 1, naar: "vlieland", ts: "x" }, nu, bekend) === null);

if (fail) process.exit(1);
