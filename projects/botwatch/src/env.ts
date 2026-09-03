export interface Env {
  /** D1 binding — see wrangler.toml [[d1_databases]]. */
  DB: D1Database;
  /** Bearer token for the dashboard, set via `wrangler secret put DASHBOARD_TOKEN`. */
  DASHBOARD_TOKEN: string;
  /** Identifier for the zone this Worker protects. v1 is single-tenant: one Worker
   *  + one D1 database per customer, so this is a plain var, not a lookup. */
  SITE_ID: string;
}
