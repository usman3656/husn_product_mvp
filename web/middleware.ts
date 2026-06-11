/**
 * Auth guard (TENANCY.md C4).
 *
 * Fast cookie-presence check at the edge of every page navigation: no
 * session cookie → /login. Validity is enforced by the API itself (per-request
 * membership re-validation); an invalid cookie yields 401s which clientFetch
 * turns into a /login redirect. This middleware just keeps signed-out
 * users from ever seeing the app shell.
 *
 * AUTH_REQUIRED=0 bridge: middleware stays dormant. The web container loads
 * the same .env.prod as the API, so one flag controls both sides and they
 * flip together in the C4 deploy.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/login",
  "/healthz",
  "/privacy",
  "/terms",
  "/subprocessors",
];

const COOKIE_NAME = "husn_session";

function authRequired(): boolean {
  // Be liberal about how the flag is set in the env: docker-compose may pass
  // quoted/whitespace values, ops may type `true` instead of `1`. Anything
  // not explicitly "0" / "false" / empty counts as on.
  const raw = (process.env.AUTH_REQUIRED ?? "").trim().replace(/^["']|["']$/g, "").toLowerCase();
  return raw !== "" && raw !== "0" && raw !== "false";
}

export function middleware(request: NextRequest) {
  if (!authRequired()) {
    return NextResponse.next();
  }
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }
  if (!request.cookies.get(COOKIE_NAME)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Everything except Next internals + static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)).*)"],
};
