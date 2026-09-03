import { classifyBot } from "./bot-list";
import type { Env } from "./env";

export type RuleAction = "allow" | "throttle" | "block";

/**
 * Handle a request to the protected site: classify the UA, look up the rule,
 * log the classified request (non-blocking), and either 403 or proxy through.
 *
 * NOTE: kept out of worker.ts on purpose. Cloudflare's module Worker format
 * treats every top-level export of the `main` entry file as a potential
 * handler binding — a plain function or constant export there (other than
 * `default`) makes workerd fail to start with "Incorrect type for map entry
 * ... not of type 'function or ExportedHandler'". Confirmed locally with
 * `wrangler dev`. Everything testable lives in importable modules like this
 * one; worker.ts only re-exports the default fetch handler.
 */
export async function handleSiteRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const bot = classifyBot(request.headers.get("User-Agent"));

  // Not a known AI crawler (regular visitor, search engine, or an unlisted bot):
  // pass straight through, no logging. Logging every human request would make
  // requests_log useless noise and blow through D1 row budgets for nothing.
  if (!bot) {
    return fetch(request);
  }

  const path = new URL(request.url).pathname;
  const configuredAction = await resolveRuleAction(env.DB, env.SITE_ID, bot.name);

  // 'throttle' enforcement is explicitly deferred to v1.1 (ADR Decision 3 — real
  // rate limiting needs shared state across the edge, e.g. Durable Objects). A
  // throttle rule can't currently be created via the dashboard API (it's rejected
  // with 501), so this only matters for manually-edited rows. We fail OPEN: pass
  // the request through rather than silently dropping traffic nobody asked to block.
  const blocked = configuredAction === "block";

  ctx.waitUntil(logRequest(env.DB, env.SITE_ID, bot.name, path, configuredAction));

  if (blocked) {
    return new Response(
      "Blocked by BotWatch: this crawler is not permitted to access this site.\n",
      {
        status: 403,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "x-botwatch-action": "block",
          "x-botwatch-bot": bot.name,
        },
      },
    );
  }

  // Subrequests made with `fetch()` from inside a Worker attached via a Worker
  // Route go to the zone's origin directly — they do not re-enter this Worker,
  // so this is a plain proxy pass-through, not a loop.
  return fetch(request);
}

export async function resolveRuleAction(
  db: D1Database,
  siteId: string,
  botName: string,
): Promise<RuleAction> {
  const row = await db
    .prepare("SELECT action FROM bot_rules WHERE site_id = ? AND bot_name = ?")
    .bind(siteId, botName)
    .first<{ action: RuleAction }>();
  // No row = customer hasn't set a rule for this bot yet = default allow (ADR Decision 2).
  return row?.action ?? "allow";
}

export async function logRequest(
  db: D1Database,
  siteId: string,
  botName: string,
  path: string,
  action: RuleAction,
): Promise<void> {
  try {
    await db
      .prepare(
        "INSERT INTO requests_log (ts, site_id, bot_name, path, action_taken) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(Date.now(), siteId, botName, path, action)
      .run();
  } catch (err) {
    // Logging must never take the site down. Swallow and move on — worst case
    // is a gap in analytics, not a broken response to a real visitor/crawler.
    console.error("botwatch: failed to write requests_log", err);
  }
}
