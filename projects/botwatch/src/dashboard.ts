import { KNOWN_BOTS } from "./bot-list";
import { isAuthorized } from "./auth";
import { DASHBOARD_HTML } from "./dashboard-html";
import { DASHBOARD_PREFIX } from "./constants";
import type { Env } from "./env";

const MIN_RANGE_DAYS = 1;
const MAX_RANGE_DAYS = 30;
const DEFAULT_RANGE_DAYS = 7;

type RuleAction = "allow" | "throttle" | "block";
const VALID_ACTIONS: RuleAction[] = ["allow", "throttle", "block"];
// Only these are implemented in v1 (ADR Decision 3). 'throttle' is a valid
// schema/API value that we deliberately reject with 501, not silently coerce.
const IMPLEMENTED_ACTIONS: RuleAction[] = ["allow", "block"];

export async function handleDashboard(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const subPath = url.pathname.slice(DASHBOARD_PREFIX.length); // "", "/", "/api/stats", ...

  // The shell is static markup with zero embedded customer data — it only knows
  // how to call the JSON API, which IS gated below. Requiring a header on this
  // route too is a non-starter: a plain browser navigation can't set one, and
  // there'd be no way to reach the token-entry screen in the first place. This
  // satisfies the ADR's actual intent ("no unauthenticated read/write API
  // ships") without a chicken-and-egg UX. See README "Auth model" section.
  if (subPath === "" || subPath === "/") {
    return new Response(DASHBOARD_HTML, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  if (!isAuthorized(request, env.DASHBOARD_TOKEN)) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  if (subPath === "/api/stats" && request.method === "GET") {
    return getStats(request, env);
  }

  if (subPath === "/api/rules" && request.method === "GET") {
    return getRules(env);
  }

  if (subPath === "/api/rules" && request.method === "POST") {
    return postRule(request, env);
  }

  return jsonResponse({ error: "not found" }, 404);
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function parseRangeDays(url: URL): number {
  const raw = Number.parseInt(url.searchParams.get("days") ?? "", 10);
  if (Number.isNaN(raw)) return DEFAULT_RANGE_DAYS;
  return Math.min(MAX_RANGE_DAYS, Math.max(MIN_RANGE_DAYS, raw));
}

/** YYYY-MM-DD, UTC, ordered oldest -> newest, inclusive of today. */
function lastNDates(n: number): string[] {
  const dates: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

interface TotalsRow {
  action_taken: RuleAction;
  c: number;
}
interface PerBotRow {
  bot_name: string;
  action_taken: RuleAction;
  c: number;
}
interface DailyRow {
  bot_name: string;
  day: string;
  action_taken: RuleAction;
  c: number;
}

async function getStats(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const rangeDays = parseRangeDays(url);
  const sinceTs = Date.now() - rangeDays * 24 * 60 * 60 * 1000;

  const batchResults = await env.DB.batch<TotalsRow | PerBotRow | DailyRow>([
    env.DB.prepare(
      `SELECT action_taken, COUNT(*) as c FROM requests_log
       WHERE site_id = ?1 AND ts >= ?2 GROUP BY action_taken`,
    ).bind(env.SITE_ID, sinceTs),
    env.DB.prepare(
      `SELECT bot_name, action_taken, COUNT(*) as c FROM requests_log
       WHERE site_id = ?1 AND ts >= ?2 GROUP BY bot_name, action_taken`,
    ).bind(env.SITE_ID, sinceTs),
    env.DB.prepare(
      `SELECT bot_name, date(ts / 1000, 'unixepoch') as day, action_taken, COUNT(*) as c
       FROM requests_log WHERE site_id = ?1 AND ts >= ?2
       GROUP BY bot_name, day, action_taken`,
    ).bind(env.SITE_ID, sinceTs),
  ]) as [
    D1Result<TotalsRow>,
    D1Result<PerBotRow>,
    D1Result<DailyRow>,
  ];
  const [totalsResult, perBotResult, dailyResult] = batchResults;

  const totals = { total: 0, allowed: 0, blocked: 0 };
  for (const row of (totalsResult.results ?? []) as TotalsRow[]) {
    totals.total += row.c;
    if (row.action_taken === "block") totals.blocked += row.c;
    else totals.allowed += row.c;
  }

  const perBotTotals = new Map<string, { total: number; blocked: number }>();
  for (const row of (perBotResult.results ?? []) as PerBotRow[]) {
    const entry = perBotTotals.get(row.bot_name) ?? { total: 0, blocked: 0 };
    entry.total += row.c;
    if (row.action_taken === "block") entry.blocked += row.c;
    perBotTotals.set(row.bot_name, entry);
  }

  const dates = lastNDates(rangeDays);
  const dailyOverall = new Map<string, { allowed: number; blocked: number }>();
  for (const date of dates) dailyOverall.set(date, { allowed: 0, blocked: 0 });

  const dailyByBot = new Map<string, Map<string, number>>();
  for (const row of (dailyResult.results ?? []) as DailyRow[]) {
    const overall = dailyOverall.get(row.day);
    if (overall) {
      if (row.action_taken === "block") overall.blocked += row.c;
      else overall.allowed += row.c;
    }
    const botDaily = dailyByBot.get(row.bot_name) ?? new Map<string, number>();
    botDaily.set(row.day, (botDaily.get(row.day) ?? 0) + row.c);
    dailyByBot.set(row.bot_name, botDaily);
  }

  const bots = KNOWN_BOTS.map((bot) => {
    const totalsForBot = perBotTotals.get(bot.name) ?? { total: 0, blocked: 0 };
    const botDaily = dailyByBot.get(bot.name);
    return {
      name: bot.name,
      operator: bot.operator,
      total: totalsForBot.total,
      blocked: totalsForBot.blocked,
      daily: dates.map((date) => botDaily?.get(date) ?? 0),
    };
  }).sort((a, b) => b.total - a.total);

  return jsonResponse({
    site_id: env.SITE_ID,
    range_days: rangeDays,
    generated_at: new Date().toISOString(),
    dates,
    totals: {
      ...totals,
      distinct_bots_seen: bots.filter((b) => b.total > 0).length,
    },
    daily: dates.map((date) => ({ date, ...dailyOverall.get(date)! })),
    bots,
  });
}

async function getRules(env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    "SELECT bot_name, action FROM bot_rules WHERE site_id = ?1",
  )
    .bind(env.SITE_ID)
    .all<{ bot_name: string; action: RuleAction }>();

  const ruleByBot = new Map((result.results ?? []).map((r) => [r.bot_name, r.action]));

  const rules = KNOWN_BOTS.map((bot) => ({
    bot_name: bot.name,
    operator: bot.operator,
    action: ruleByBot.get(bot.name) ?? "allow",
  }));

  return jsonResponse({ site_id: env.SITE_ID, rules });
}

async function postRule(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }

  const { bot_name, action } = (body ?? {}) as { bot_name?: unknown; action?: unknown };

  if (typeof bot_name !== "string" || !KNOWN_BOTS.some((b) => b.name === bot_name)) {
    return jsonResponse({ error: "bot_name must be one of the known crawlers" }, 400);
  }
  if (typeof action !== "string" || !VALID_ACTIONS.includes(action as RuleAction)) {
    return jsonResponse({ error: `action must be one of: ${VALID_ACTIONS.join(", ")}` }, 400);
  }
  if (!IMPLEMENTED_ACTIONS.includes(action as RuleAction)) {
    return jsonResponse(
      { error: "throttle is not implemented in v1 (see ADR Decision 3) — use allow or block" },
      501,
    );
  }

  const updatedAt = Date.now();
  await env.DB.prepare(
    `INSERT INTO bot_rules (site_id, bot_name, action, updated_at) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(site_id, bot_name) DO UPDATE SET action = excluded.action, updated_at = excluded.updated_at`,
  )
    .bind(env.SITE_ID, bot_name, action, updatedAt)
    .run();

  return jsonResponse({ site_id: env.SITE_ID, bot_name, action, updated_at: updatedAt });
}
