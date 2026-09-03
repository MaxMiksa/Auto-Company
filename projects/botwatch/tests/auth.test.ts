import { describe, expect, it } from "vitest";
import { extractToken, isAuthorized } from "../src/auth";

function reqWith(opts: { header?: string; query?: string; url?: string }) {
  const url = new URL(opts.url ?? "https://example.com/botwatch-dashboard/api/stats");
  if (opts.query) url.searchParams.set("token", opts.query);
  const headers = new Headers();
  if (opts.header) headers.set("Authorization", opts.header);
  return new Request(url.toString(), { headers });
}

describe("extractToken", () => {
  it("reads a Bearer header", () => {
    expect(extractToken(reqWith({ header: "Bearer secret123" }))).toBe("secret123");
  });

  it("is case-insensitive on the Bearer scheme", () => {
    expect(extractToken(reqWith({ header: "bearer secret123" }))).toBe("secret123");
  });

  it("falls back to the ?token= query param", () => {
    expect(extractToken(reqWith({ query: "secret123" }))).toBe("secret123");
  });

  it("prefers the header over the query param when both are present", () => {
    expect(extractToken(reqWith({ header: "Bearer from-header", query: "from-query" }))).toBe("from-header");
  });

  it("returns null when neither is present", () => {
    expect(extractToken(reqWith({}))).toBeNull();
  });
});

describe("isAuthorized", () => {
  it("accepts a matching token", () => {
    expect(isAuthorized(reqWith({ header: "Bearer correct-token" }), "correct-token")).toBe(true);
  });

  it("rejects a wrong token", () => {
    expect(isAuthorized(reqWith({ header: "Bearer wrong-token" }), "correct-token")).toBe(false);
  });

  it("rejects when no token is presented", () => {
    expect(isAuthorized(reqWith({}), "correct-token")).toBe(false);
  });

  it("fails closed when DASHBOARD_TOKEN isn't configured", () => {
    expect(isAuthorized(reqWith({ header: "Bearer anything" }), "")).toBe(false);
  });

  it("rejects tokens differing only in length or case", () => {
    expect(isAuthorized(reqWith({ header: "Bearer correct-tok" }), "correct-token")).toBe(false);
    expect(isAuthorized(reqWith({ header: "Bearer CORRECT-TOKEN" }), "correct-token")).toBe(false);
  });
});
