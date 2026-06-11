/**
 * Shared API access (TENANCY.md C4).
 *
 * Two paths, one module:
 *  - serverFetch(path)  — server components / SSR. Forwards the incoming
 *    session cookie to the internal API origin so tenant-scoped endpoints
 *    return the signed-in user's data.
 *  - clientFetch(path)  — "use client" components. Sends credentials
 *    cross-subdomain (app. → api.) and stamps the CSRF header on mutations.
 *    Redirects to /login on 401 when the wall is up.
 */

const SERVER_API_URL = process.env.API_URL ?? "http://api:8000";
const BROWSER_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** Server-side fetch with cookie forwarding. Never throws on HTTP errors —
 * callers keep their existing `if (!r.ok)` handling. */
export async function serverFetch(path: string, init?: RequestInit): Promise<Response> {
  // next/headers is server-only; dynamic import keeps this module importable
  // from client components that only use clientFetch.
  const { cookies } = await import("next/headers");
  const cookieHeader = (await cookies()).toString();
  return fetch(`${SERVER_API_URL}${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
  });
}

/** Convenience: server-side JSON fetch returning null on any failure. */
export async function serverJson<T>(path: string): Promise<T | null> {
  try {
    const r = await serverFetch(path);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Client-side fetch: credentials + CSRF header; 401 → /login redirect. */
export async function clientFetch(path: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (MUTATING.has(method)) {
    headers["X-Husn-Csrf"] = "1";
    if (!headers["Content-Type"] && init?.body) headers["Content-Type"] = "application/json";
  }
  const r = await fetch(`${BROWSER_API_URL}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  if (r.status === 401 && typeof window !== "undefined") {
    // Session gone and the wall is up — send the user to sign in.
    // EXCEPTIONS (the redirect-loop guard):
    //  * /auth/* endpoints handle their own unauthenticated states — /auth/me
    //    401s by design on the login page itself; redirecting there would
    //    reload /login forever and destroy magic-link tokens on /login/confirm.
    //  * already on an auth page → nothing to redirect to.
    const p = window.location.pathname;
    const onAuthPage = p.startsWith("/login") || p.startsWith("/welcome");
    const isAuthEndpoint = path.startsWith("/auth/");
    if (!onAuthPage && !isAuthEndpoint) {
      window.location.href = "/login";
    }
  }
  return r;
}

export type Me = {
  authenticated: boolean;
  auth_required: boolean;
  user?: { id: number; email: string };
  workspace?: { tenant_id: number; name: string; slug: string; role: "owner" | "admin" | "member" } | null;
};

export async function fetchMe(): Promise<Me | null> {
  try {
    const r = await clientFetch("/auth/me");
    if (!r.ok) return null;
    return (await r.json()) as Me;
  } catch {
    return null;
  }
}
