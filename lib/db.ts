import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// Lazy client: constructing neon() needs DATABASE_URL, which is absent during
// `next build` page-data collection. Build the real client on first query so the
// module imports cleanly and only fails (clearly) if a request runs without a DB.
let client: NeonQueryFunction<false, false> | null = null;
function get(): NeonQueryFunction<false, false> {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set (see .env.example).");
    client = neon(url);
  }
  return client;
}

export const sql: NeonQueryFunction<false, false> = new Proxy((() => {}) as never, {
  apply: (_t, _this, args: unknown[]) => (get() as (...a: unknown[]) => unknown)(...args),
}) as NeonQueryFunction<false, false>;
