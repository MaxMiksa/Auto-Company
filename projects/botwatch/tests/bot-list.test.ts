import { describe, expect, it } from "vitest";
import { classifyBot, KNOWN_BOTS } from "../src/bot-list";

const REQUIRED_BOTS = [
  "GPTBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-Web",
  "anthropic-ai",
  "PerplexityBot",
  "Google-Extended",
  "CCBot",
  "Bytespider",
  "Amazonbot",
  "Applebot-Extended",
  "Meta-ExternalAgent",
  "Diffbot",
];

describe("KNOWN_BOTS", () => {
  it("includes every bot required by the v1 spec", () => {
    for (const name of REQUIRED_BOTS) {
      expect(KNOWN_BOTS.some((b) => b.name === name)).toBe(true);
    }
  });
});

describe("classifyBot", () => {
  it("matches a known bot from a realistic UA string", () => {
    const ua = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot";
    expect(classifyBot(ua)?.name).toBe("GPTBot");
  });

  it("is case-insensitive", () => {
    expect(classifyBot("mozilla/5.0 claudebot/1.0")?.name).toBe("ClaudeBot");
  });

  it("returns null for a normal browser UA", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
    expect(classifyBot(ua)).toBeNull();
  });

  it("returns null for missing UA", () => {
    expect(classifyBot(null)).toBeNull();
    expect(classifyBot(undefined)).toBeNull();
    expect(classifyBot("")).toBeNull();
  });

  it("returns null for an unlisted bot", () => {
    expect(classifyBot("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBeNull();
  });

  it("distinguishes ClaudeBot from Claude-Web", () => {
    expect(classifyBot("SomeAgent Claude-Web/1.0")?.name).toBe("Claude-Web");
    expect(classifyBot("SomeAgent ClaudeBot/1.0")?.name).toBe("ClaudeBot");
  });

  it("every known bot's own UA is classified as itself", () => {
    for (const bot of KNOWN_BOTS) {
      expect(classifyBot(`SomeAgent ${bot.uaSignature}/1.0`)?.name).toBe(bot.name);
    }
  });
});
