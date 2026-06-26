import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// Lazy client: constructing neon() needs DATABASE_URL, which is absent during
// `next build` page-data collection. Build the real client on first query so the
// module imports cleanly and only fails (clearly) if a request runs without a DB.
let client: NeonQueryFunction<false, false> | null = null;
function get(): NeonQueryFunction<false, false> {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set (see .env.example).");
    // cache: "no-store" — the Neon HTTP driver queries via fetch(), which Next.js
    // caches in its Data Cache by default. Without this, list reads (e.g. all
    // locations) keep serving stale rows after a re-seed, even on a force-dynamic
    // route. The app does its own TTL caching in forecast_cache, so DB reads must
    // always be live.
    client = neon(url, { fetchOptions: { cache: "no-store" } });
  }
  return client;
}

export const sql: NeonQueryFunction<false, false> = new Proxy((() => {}) as never, {
  apply: (_t, _this, args: unknown[]) => (get() as (...a: unknown[]) => unknown)(...args),
}) as NeonQueryFunction<false, false>;
