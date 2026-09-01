import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleSiteRequest, resolveRuleAction } from "../src/enforcement";
import type { Env } from "../src/env";

interface LoggedRow {
  ts: number;
  siteId: string;
  botName: string;
  path: string;
  action: string;
}

/** Minimal fake D1Database satisfying only the two query shapes worker code issues. */
function makeFakeDb(initialRules: Record<string, string> = {}) {
  const log: LoggedRow[] = [];
  const rules = { ...initialRules };

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes("FROM bot_rules")) {
                const botName = args[1] as string;
                const action = rules[botName];
                return (action ? { action } : null) as T | null;
              }
              return null as T | null;
            },
            async run() {
              if (sql.includes("INSERT INTO requests_log")) {
                const [ts, siteId, botName, path, action] = args as [number, string, string, string, string];
                log.push({ ts, siteId, botName, path, action });
              }
              return {} as D1Result;
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return { db, log, rules };
}

function fakeCtx() {
  const promises: Promise<unknown>[] = [];
  return {
    ctx: { waitUntil: (p: Promise<unknown>) => promises.push(p) } as unknown as ExecutionContext,
    flush: () => Promise.all(promises),
  };
}

describe("resolveRuleAction", () => {
  it("defaults to allow when no rule row exists", async () => {
    const { db } = makeFakeDb({});
    expect(await resolveRuleAction(db, "site1", "GPTBot")).toBe("allow");
  });

  it("returns the stored action when a rule exists", async () => {
    const { db } = makeFakeDb({ GPTBot: "block" });
    expect(await resolveRuleAction(db, "site1", "GPTBot")).toBe("block");
  });
});

describe("handleSiteRequest", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response("origin ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeEnv(rules: Record<string, string> = {}) {
    const { db, log } = makeFakeDb(rules);
    const env: Env = { DB: db, DASHBOARD_TOKEN: "token", SITE_ID: "site1" };
    return { env, log };
  }

  it("passes non-bot traffic straight through without logging", async () => {
    const { env, log } = makeEnv();
    const { ctx, flush } = fakeCtx();
    const request = new Request("https://example.com/", {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh) Safari/605.1.15" },
    });

    const res = await handleSiteRequest(request, env, ctx);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await res.text()).toBe("origin ok");
    expect(log).toHaveLength(0);
  });

  it("proxies and logs an allowed bot when no rule is set (default allow)", async () => {
    const { env, log } = makeEnv();
    const { ctx, flush } = fakeCtx();
    const request = new Request("https://example.com/blog/post", {
      headers: { "User-Agent": "GPTBot/1.2 (+https://openai.com/gptbot)" },
    });

    const res = await handleSiteRequest(request, env, ctx);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(log).toEqual([
      expect.objectContaining({ botName: "GPTBot", path: "/blog/post", action: "allow" }),
    ]);
  });

  it("returns 403 and does not call origin when the rule is block", async () => {
    const { env, log } = makeEnv({ GPTBot: "block" });
    const { ctx, flush } = fakeCtx();
    const request = new Request("https://example.com/blog/post", {
      headers: { "User-Agent": "GPTBot/1.2" },
    });

    const res = await handleSiteRequest(request, env, ctx);
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.status).toBe(403);
    expect(res.headers.get("x-botwatch-action")).toBe("block");
    expect(log).toEqual([
      expect.objectContaining({ botName: "GPTBot", action: "block" }),
    ]);
  });

  it("fails open (passes through) for an unenforced throttle rule, but logs it as throttle", async () => {
    const { env, log } = makeEnv({ GPTBot: "throttle" });
    const { ctx, flush } = fakeCtx();
    const request = new Request("https://example.com/", {
      headers: { "User-Agent": "GPTBot/1.2" },
    });

    const res = await handleSiteRequest(request, env, ctx);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(log).toEqual([expect.objectContaining({ action: "throttle" })]);
  });
});
