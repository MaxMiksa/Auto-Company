/**
 * Bearer-token gate for the dashboard (docs/cto/adr-botwatch-v1-architecture.md,
 * Decision 4). One shared secret, checked on every dashboard route — no
 * unauthenticated read/write API ships.
 *
 * Two ways to present the token, both checked, header taking priority:
 *   1. `Authorization: Bearer <token>` header — used by the dashboard's own
 *      JS for every /api/* call.
 *   2. `?token=<token>` query param — used only so the HTML shell route
 *      itself (a plain browser navigation, which can't set headers) is also
 *      gated per the ADR. The shell's JS immediately moves the token into
 *      localStorage and strips it from the URL bar (see dashboard-html.ts)
 *      so it doesn't linger in browser history/referrer headers.
 */
export function extractToken(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (authHeader) {
    const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    if (match) return match[1] ?? null;
  }
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token");
  if (queryToken) return queryToken;
  return null;
}

/** Constant-time string compare to avoid leaking token length/prefix via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function isAuthorized(request: Request, dashboardToken: string): boolean {
  if (!dashboardToken) return false; // secret not configured yet — fail closed
  const token = extractToken(request);
  if (!token) return false;
  return timingSafeEqual(token, dashboardToken);
}
