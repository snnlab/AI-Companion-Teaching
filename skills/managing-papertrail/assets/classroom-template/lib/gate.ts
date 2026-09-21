export const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

// Unlike web-template (one route set, one credential), this server has two:
// the instructor's browser cookie, and the student's bearer token. This
// decision table only governs the COOKIE gate — it says nothing about bearer
// verification, which api/submissions.ts does itself.
export function gateDecision(
  pathname: string,
  _method: string,
  authed: boolean,
): { action: "allow" | "loginPage" | "unauthorizedJson" } {
  if (pathname === "/api/login" || pathname === "/api/logout") return { action: "allow" };
  // Student bearer-token intake: no instructor cookie is required or even
  // relevant here. api/submissions.ts verifies Authorization itself via
  // lib/roster.ts's resolveToken; an invalid/missing token gets its own
  // 401 { error: "invalid_token" } from that handler, not this gate.
  if (pathname === "/api/submissions") return { action: "allow" };
  // GET/POST /api/comments serves BOTH an instructor's browser session and a
  // student's own bearer token (their own comments only, checked in
  // api/comments.ts against the submission-index — never trusted from the
  // request alone). Like /api/submissions, the cookie gate has nothing
  // useful to say here; api/comments.ts enforces the real authorization
  // (instructor session, or a bearer token scoped to its own shareHash) and
  // returns its own 401/403 when neither holds.
  if (pathname === "/api/comments") return { action: "allow" };
  // GET /api/my-comments is bearer-only (no instructor session concept at
  // all) — api/my-comments.ts resolves and checks the token itself. Same
  // reasoning as the two exemptions above.
  if (pathname === "/api/my-comments") return { action: "allow" };
  // POST/DELETE /api/push-subscribe — bearer-only (the student's own token),
  // same reasoning as /api/my-comments.
  if (pathname === "/api/push-subscribe") return { action: "allow" };
  // The student feedback page and its assets: a static shell with no
  // instructor session and no server-rendered secret. It authenticates its
  // own /api/my-comments and /api/push-subscribe fetches with the student's
  // bearer token; /api/vapid-public-key returns only the public key.
  // Served at /me via a vercel.json rewrite to /me.html — allow both. Keep
  // in sync with middleware.ts's isStudentPageRoute.
  if (
    pathname === "/me" ||
    pathname === "/me.html" ||
    pathname === "/sw.js" ||
    pathname === "/api/vapid-public-key"
  ) {
    return { action: "allow" };
  }
  if (authed) return { action: "allow" };
  if (pathname.startsWith("/api/")) return { action: "unauthorizedJson" };
  return { action: "loginPage" };
}
