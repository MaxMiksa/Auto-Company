/**
 * Known AI-crawler User-Agent signatures.
 *
 * v1 detection strategy (see docs/cto/adr-botwatch-v1-architecture.md, Decision 1):
 * match the request's `User-Agent` header against this list. This is the same
 * trust model as robots.txt — spoofable in theory, honest in practice today
 * because misrepresenting UA risks being blocked wholesale by publishers.
 *
 * Keep this list boring and easy to extend: one entry per crawler, matched by
 * case-insensitive substring against the raw UA string. Do not over-engineer
 * this into a rules engine — append a row when a new bot shows up.
 */
export interface KnownBot {
  /** Canonical name used in D1 (bot_rules.bot_name, requests_log.bot_name) and the dashboard UI. */
  name: string;
  /** Case-insensitive substring to match against the User-Agent header. */
  uaSignature: string;
  /** Company/product operating the crawler, shown in the dashboard for context. */
  operator: string;
}

export const KNOWN_BOTS: KnownBot[] = [
  { name: "GPTBot", uaSignature: "GPTBot", operator: "OpenAI" },
  { name: "ChatGPT-User", uaSignature: "ChatGPT-User", operator: "OpenAI" },
  { name: "ClaudeBot", uaSignature: "ClaudeBot", operator: "Anthropic" },
  { name: "Claude-Web", uaSignature: "Claude-Web", operator: "Anthropic" },
  { name: "anthropic-ai", uaSignature: "anthropic-ai", operator: "Anthropic" },
  { name: "PerplexityBot", uaSignature: "PerplexityBot", operator: "Perplexity" },
  { name: "Google-Extended", uaSignature: "Google-Extended", operator: "Google" },
  { name: "CCBot", uaSignature: "CCBot", operator: "Common Crawl" },
  { name: "Bytespider", uaSignature: "Bytespider", operator: "ByteDance" },
  { name: "Amazonbot", uaSignature: "Amazonbot", operator: "Amazon" },
  { name: "Applebot-Extended", uaSignature: "Applebot-Extended", operator: "Apple" },
  { name: "Meta-ExternalAgent", uaSignature: "Meta-ExternalAgent", operator: "Meta" },
  { name: "Diffbot", uaSignature: "Diffbot", operator: "Diffbot" },
];

/**
 * Classify a raw User-Agent header against the known-bot list.
 *
 * Order matters only in the pathological case where one signature is a
 * substring of another (none currently are) — first match wins.
 * Returns null for missing UA or UA that doesn't match any known crawler
 * (i.e. regular human/browser traffic, or an unlisted bot).
 */
export function classifyBot(userAgent: string | null | undefined): KnownBot | null {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();
  for (const bot of KNOWN_BOTS) {
    if (ua.includes(bot.uaSignature.toLowerCase())) {
      return bot;
    }
  }
  return null;
}
