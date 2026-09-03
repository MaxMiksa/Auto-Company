import { handleDashboard } from "./dashboard";
import { handleSiteRequest } from "./enforcement";
import { DASHBOARD_PREFIX } from "./constants";
import type { Env } from "./env";

export type { Env } from "./env";

/**
 * Entry module (see wrangler.toml `main`). Deliberately exports ONLY the
 * default fetch handler — Cloudflare's module Worker runtime (workerd)
 * inspects every top-level export of this specific file as a candidate
 * handler binding, and errors on startup if it finds a plain value/function
 * export that isn't a recognized handler shape. All actual logic lives in
 * enforcement.ts / dashboard.ts / bot-list.ts, which are ordinary importable
 * modules with no such restriction.
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === DASHBOARD_PREFIX || url.pathname.startsWith(`${DASHBOARD_PREFIX}/`)) {
      return handleDashboard(request, env);
    }

    return handleSiteRequest(request, env, ctx);
  },
};
