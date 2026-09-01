import { describe, expect, it } from "vitest";
import { handleDashboard } from "../src/dashboard";
import type { Env } from "../src/env";

/**
 * Minimal fake D1Database covering the query shapes dashboard.ts issues:
 * env.DB.batch(...) for stats, and prepare().bind().all()/.run() for rules.
 * Aggregation correctness of the stats queries is not the concern here (that's
 * SQL, exercised end-to-end against local D1 per README) — this file exists to
 * guard the thing that previously had zero coverage: that every /api/* route
 * on the dashboard actually enforces the bearer token, and that the rules
 * write path validates its input.
 */
function makeFakeDb() {
  const rules = new Map<string, { action: string; updated_at: number }>();
  const emptyBatchResult = { results: [], success: true, meta: {} } as unknown as D1Result;

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              return null as T | null;
            },
            async all<T>() {
              if (sql.includes("FROM bot_rules")) {
                const results = [...rules.entries()].map(([key, v]) => ({
                  bot_name: key.split(":")[1],
                  action: v.action,
                }));
                return { results, success: true, meta: {} } as unknown as D1Result<T>;
              }
              return { results: [], success: true, meta: {} } as unknown as D1Result<T>;
            },
            async run() {
              if (sql.includes("INSERT INTO bot_rules")) {
                const [siteId, botName, action, updatedAt] = args as [
                  string,
                  string,
                  string,
                  number,
                ];
                rules.set(`${siteId}:${botName}`, { action, updated_at: updatedAt });
              }
              return {} as D1Result;
            },
          };
        },
      };
    },
    async batch<T>(stmts: unknown[]) {
      return stmts.map(() => emptyBatchResult) as D1Result<T>[];
    },
  } as unknown as D1Database;

  return { db, rules };
}

function makeEnv(): Env {
  const { db } = makeFakeDb();
  return { DB: db, DASHBOARD_TOKEN: "secret-token", SITE_ID: "site1" };
}

function req(path: string, opts: RequestInit & { authed?: boolean } = {}) {
  const { authed, headers, ...rest } = opts;
  const h = new Headers(headers);
  if (authed) h.set("Authorization", "Bearer secret-token");
  return new Request(`https://example.com/botwatch-dashboard${path}`, { ...rest, headers: h });
}

describe("handleDashboard — HTML shell", () => {
  it("serves the shell without auth (no customer data embedded)", async () => {
    const res = await handleDashboard(req(""), makeEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("serves the shell at the trailing-slash form too", async () => {
    const res = await handleDashboard(req("/"), makeEnv());
    expect(res.status).toBe(200);
  });
});

describe("handleDashboard — auth is enforced on every API route", () => {
  it("rejects GET /api/stats with no token", async () => {
    const res = await handleDashboard(req("/api/stats"), makeEnv());
    expect(res.status).toBe(401);
  });

  it("rejects GET /api/rules with no token", async () => {
    const res = await handleDashboard(req("/api/rules"), makeEnv());
    expect(res.status).toBe(401);
  });

  it("rejects POST /api/rules with no token", async () => {
    const res = await handleDashboard(
      req("/api/rules", { method: "POST", body: JSON.stringify({ bot_name: "GPTBot", action: "block" }) }),
      makeEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("rejects an unknown/wrong token on every API route", async () => {
    const env = makeEnv();
    const wrong = new Headers({ Authorization: "Bearer nope" });
    for (const path of ["/api/stats", "/api/rules"]) {
      const res = await handleDashboard(new Request(`https://example.com/botwatch-dashboard${path}`, { headers: wrong }), env);
      expect(res.status).toBe(401);
    }
  });

  it("rejects an unknown authenticated subpath with 404, not a bypass", async () => {
    const res = await handleDashboard(req("/api/does-not-exist", { authed: true }), makeEnv());
    expect(res.status).toBe(404);
  });
});

describe("handleDashboard — authenticated API behavior", () => {
  it("GET /api/stats succeeds with a valid token", async () => {
    const res = await handleDashboard(req("/api/stats", { authed: true }), makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { site_id: string };
    expect(body.site_id).toBe("site1");
  });

  it("GET /api/rules defaults unset bots to allow", async () => {
    const res = await handleDashboard(req("/api/rules", { authed: true }), makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rules: { bot_name: string; action: string }[] };
    expect(body.rules.find((r) => r.bot_name === "GPTBot")?.action).toBe("allow");
  });

  it("POST /api/rules persists a valid rule change", async () => {
    const res = await handleDashboard(
      req("/api/rules", {
        method: "POST",
        authed: true,
        body: JSON.stringify({ bot_name: "GPTBot", action: "block" }),
      }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { action: string };
    expect(body.action).toBe("block");
  });

  it("POST /api/rules rejects an unknown bot_name", async () => {
    const res = await handleDashboard(
      req("/api/rules", {
        method: "POST",
        authed: true,
        body: JSON.stringify({ bot_name: "NotARealBot", action: "block" }),
      }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/rules rejects an invalid action", async () => {
    const res = await handleDashboard(
      req("/api/rules", {
        method: "POST",
        authed: true,
        body: JSON.stringify({ bot_name: "GPTBot", action: "delete-everything" }),
      }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/rules returns 501 for throttle (valid schema value, not implemented in v1)", async () => {
    const res = await handleDashboard(
      req("/api/rules", {
        method: "POST",
        authed: true,
        body: JSON.stringify({ bot_name: "GPTBot", action: "throttle" }),
      }),
      makeEnv(),
    );
    expect(res.status).toBe(501);
  });

  it("POST /api/rules rejects a malformed JSON body", async () => {
    const res = await handleDashboard(
      req("/api/rules", { method: "POST", authed: true, body: "not json" }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });
});
