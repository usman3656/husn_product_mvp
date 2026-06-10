# husn — Multi-tenancy + Authentication Plan

> Status: **PROPOSED — awaiting founder sign-off. No code written yet.**
> Written 2026-06-10 after a two-agent audit (codebase tenancy inventory + auth architecture research).

---

## 1. Goal

Turn the live single-tenant deploy into a real multi-company app:

1. Each company gets its own workspace. No data ever crosses companies.
2. Each person logs in (magic link or Google). Signed-out = login page, nothing else.
3. Inside a company, people see only their projects (viewer scoping becomes real).
4. Connections (Slack/Jira/Google/Microsoft) are per-company.
5. Signup flow: create workspace → invite teammates → connect tools → pick scope → briefs.

**Acceptance criteria (from the founder, kept verbatim as the definition of done):**
- Fresh incognito window → login page.
- Sign up as a brand-new company → empty, clean workspace.
- Invite a teammate → they log in → see only what their role allows.
- Connect Slack to my company → stays mine.
- If a second company signs up tomorrow, our data doesn't touch theirs in any way.

**Explicitly out of scope:** Stripe billing · SAML/WorkOS · per-customer servers · legal copy rewrites.

---

## 2. Ground truth (what the audit found — corrects the docs)

- **`tenant_id` exists on ZERO tables.** plan.md/DEPLOY.md claimed otherwise; that claim is removed. 16 tables in `api/husn/db/models.py`; migrations run 0001–0008, next is **0009**.
- **No user auth anywhere.** No login, no sessions, no users table. `SESSION_SECRET` is only the HMAC key for OAuth `state` signing (`core/oauth.py`). Only middleware is CORS (already `allow_credentials=True` — convenient).
- **Every data endpoint leaks.** All 19 routers unauthenticated; `GET /api/connections` returns all rows; anyone can DELETE connections, trigger backfills, burn LLM spend via `POST /api/agent/run`, read/delete chat sessions, and call the Atlassian personal-data **delete** endpoint.
- **Connections have no owner.** Created on OAuth callback keyed `(source, account_id)` — two companies connecting the same Slack workspace would silently overwrite each other's tokens.
- **`viewer_id` is a no-op.** Plumbed through `build_skeleton()` but always `None`, used in no query.
- **Six unique constraints are global and must be re-keyed per tenant:** `uq_connection_source_account`, `uq_raw_artifact_source_extid_ver`, `uq_identity_source_user`, `uq_project_source_scope`, `projects.slug`, `uq_claim_group_project_kind_key`.
- **Worker shape is friendly:** backfills already iterate per-Connection (natural tenant boundary once Connection carries tenant_id). The global sweeps (normalize / extract / drift) work on rows that will carry tenant_id; the one real cross-tenant bleed risk is **person identity merge by email** — must become `(tenant_id, email)`.
- **Web fetch split:** 4 SSR pages + ~10 server components fetch via internal `http://api:8000` (must forward the user's cookie); ~8 client components fetch `https://api.husn.io` directly (cookie flows automatically once `Domain=.husn.io`).

---

## 3. Architecture decisions

### D1 — FastAPI owns auth. No Auth.js.
Login endpoints live on the API. Session = opaque random ID in **Redis** (`session:{id}` → `{user_id, tenant_id, role}`, ~30-day sliding TTL). Cookie: `HttpOnly; Secure; Domain=.husn.io; SameSite=Lax; Path=/`. Because `app.` and `api.` are same-site siblings, the browser sends the cookie on XHR with no `SameSite=None` hacks; SSR forwards the incoming `Cookie` header to `http://api:8000`.
*Why:* one auth system instead of two. The API already runs four OAuth dances; Redis is already in the stack; revocation is `DEL` one key. Auth.js v5 would add a JWT bridge + a second source of session truth. (This supersedes the "Auth.js v5" earmark in DEPLOY.md — docs updated at ship time.)

**CSRF posture:** cookie+Lax still needs care on state-changing requests → require header `X-Husn-Csrf: 1` on non-GET + verify `Origin == https://app.husn.io`. No token dance.

### D2 — Magic links via Resend, DB-row tokens.
`login_tokens(token_hash sha256, email, expires_at 15min, used_at)`. Single-use enforced atomically (`UPDATE … WHERE used_at IS NULL RETURNING`). Rate limit 3/email/15min via Redis. Always answer "check your email" (no user enumeration). Email-scanner safe: the link lands on a page with a "Sign in" button that POSTs the token (Outlook SafeLinks prefetch can't burn it).
*Founder action required:* create Resend account, add DNS records (DKIM/SPF on a sending subdomain + DMARC). Free tier (3K emails/mo) is plenty.

### D3 — Google login uses a NEW OAuth client (same GCP project).
Scopes `openid email profile` only — non-sensitive, no verification, no unverified-app warning on every login. The existing connector client (restricted Gmail/Drive scopes) stays for connectors only. Distinct redirect: `/auth/login/google/callback`.
*Founder action required:* register the client, paste ID/secret into `.env.prod`.

### D4 — Enforcement: tenant-scoped session dependency now; RLS backstop immediately after, same workstream.
- **Layer 1 (functional walls, ships first):** `require_user()` FastAPI dependency resolves the session cookie → `{user, tenant_id, role}` and 401s otherwise. All data routers depend on it. A `tenant_session()` dependency yields the DB session + `tenant_id`; every query in routers/services takes `tenant_id` as a required argument. One CI check asserts no model with `tenant_id` is queried outside scoped helpers.
- **Layer 2 (defense in depth, honors the knowledge.md §11.C commitment):** Postgres RLS policies on every tenant-scoped table. App connects as a new non-owner role `husn_app` (RLS applies naturally — avoids the FORCE-RLS owner footgun); Alembic keeps the owner role for migrations. The same `tenant_session()` dependency runs `SET LOCAL app.tenant_id = :t` at transaction start — `SET LOCAL` is transaction-scoped, safe on a plain asyncpg pool. Arq jobs get tenant context from the Connection/Project row they're processing and use the same helper.
- Layer 2 ships **before this work is declared done** — it's the backstop that makes a scoping bug a non-event instead of a breach. (Alternative considered and rejected: defer RLS entirely. Rejected because §11.C is a locked commitment and the marginal cost — one DB role + one SET LOCAL in a dependency we need anyway + per-table policies in one migration — is contained.)

### D5 — Roles: `owner / admin / member`, plus `project_members`.
- **owner** — everything incl. delete workspace (billing later).
- **admin** — invites, connectors, allowlists; sees all projects.
- **member** — sees only projects they're a member of (`project_members(project_id, user_id)`).
- `viewer_id` in the brief pipeline becomes the logged-in user's id; `build_skeleton()` filters to projects the viewer can see. Personas stay as-is (a persona is a lens, not an identity).

### D6 — Tenancy roots and derivation.
Direct `tenant_id` column on: `tenants` (new), `users`/`memberships`/`invites`/`login_tokens` (new), `connections`, `raw_artifacts`, `persons`, `person_identities`, `projects`, `claim_groups`, `agent_runs`, `chat_sessions` (+`user_id`), `briefs`. Transitively derivable but stamped anyway for query simplicity + RLS: `artifacts`, `claims`, `findings`. Pure join tables (`artifact_mentions`, `claim_group_members`, `finding_evidence`, `chat_messages`, `project_sources`) derive through their parent and get RLS via EXISTS-policies.
All six global unique constraints re-keyed to include `tenant_id`.

---

## 4. New schema (migration 0009, one migration)

```
tenants(id, name, slug unique, created_at)
users(id, email unique, name, avatar_url, created_at, last_login_at)   -- last_login_at is for security/audit only; never surfaced in product UI (anti-monitoring)
memberships(user_id, tenant_id, role enum[owner|admin|member], created_at)  PK(user_id, tenant_id)
invites(id, tenant_id, email, role, token_hash, expires_at 7d, accepted_at, created_by)
       UNIQUE(tenant_id, email) WHERE accepted_at IS NULL
login_tokens(id, email, token_hash, expires_at, used_at)
project_members(project_id, user_id)  PK both
+ tenant_id columns + constraint re-keys per D6
```

Backfill in the same migration: create tenant #1 (founder's workspace), user #1 (founder's email), owner membership, stamp every existing row with tenant #1, add founder to every existing project, then set NOT NULL.

---

## 5. Auth flows

- `POST /auth/login/magic` — accepts email → token row → Resend send.
- `GET  /auth/login/magic/confirm?token=` — renders confirm page (web) → `POST /auth/login/magic/consume` → session + cookie → redirect.
- `GET  /auth/login/google/start` + `/callback` — standard code flow, login client.
- New email with no membership and no invite → **signup**: name-your-workspace page → creates tenant + owner membership.
- New email with a pending invite → membership created on accept (collision-safe: keyed on email at accept time).
- `POST /auth/logout` — DEL session key + expire cookie.
- `GET /auth/me` — `{user, tenant, role}` for the web shell.

OAuth **connector** flows: `/auth/{provider}/start` now requires an authenticated admin/owner; `tenant_id` + acting user are embedded in the already-HMAC-signed `state`; callback stamps them onto the Connection row. The on-conflict key becomes `(tenant_id, source, account_id)`.

---

## 6. Frontend work

1. **Login page** (`/login`) — email field (magic link) + "Continue with Google". Editorial style, consistent with the design system.
2. **Auth guard** — Next middleware checks the session cookie's presence; server components use a shared `apiFetch()` helper that forwards `cookies()` and redirects to `/login` on 401. (Centralizes the 14 fetch sites; they currently each hand-roll fetch.)
3. **Signup wizard** (`/welcome`) — name workspace → invite teammates (optional, skippable) → connect tools (links to existing connector flows) → pick channels/folders (existing allowlist UIs) → "Your first briefing is being prepared."
4. **Invite accept** (`/invite/[token]`) — sign in with the invited email → lands in the workspace.
5. **Workspace switcher stub** — top of side-nav shows tenant name (multi-workspace switching deferred; one membership per user is fine for v1, schema already supports more).
6. **Settings → Members** — list members + roles, invite form, revoke invite. (Owner/admin only. Shows name + role ONLY — no activity data, no "last seen". Anti-monitoring rules apply to admin surfaces too.)
7. **Project membership UI** — minimal: admins assign members to projects from Settings.

---

## 7. Worker changes

- Backfills: per-Connection (already) — stamp `tenant_id` from the connection onto every `raw_artifact`.
- Normalize: derive tenant from the raw row; person identity merge keys on `(tenant_id, email)` — the one real bleed risk, fixed at the root.
- Extract / drift: rows carry tenant_id; claim grouping + findings keyed per tenant.
- Agent renderer: iterates projects (which carry tenant_id); `viewer_id`-scoped briefs filter by `project_members`.
- All worker DB access goes through the same scoped-session helper (sets `SET LOCAL` for the RLS backstop).

---

## 8. Migration & rollout (live deploy must not break)

Sequenced commits, each deployable; auto-deploy picks them up one at a time:

1. **C1 — Schema + backfill (0009).** Additive only; nothing reads the new columns yet. Existing app keeps working unauthenticated. Verify on prod: founder tenant exists, all rows stamped.
2. **C2 — Auth endpoints + session plumbing.** Magic link, Google login, logout, /auth/me. Nothing enforced yet. Founder action gate: Resend DNS + Google login client must be done before this lands (else magic links can't send).
3. **C3 — Scoped reads/writes.** All routers take `require_user()` + tenant-scoped queries; connector `state` carries tenant; workers stamp tenant. **Enforcement flag** `AUTH_REQUIRED=0` honored for exactly one deploy so the founder can log in and sanity-check before the wall goes up.
4. **C4 — Frontend: login page, apiFetch with cookie forwarding, auth guard, /welcome wizard, members UI.** Flip `AUTH_REQUIRED=1` in the same deploy. From this moment: incognito → login page. Founder logs in with their email; their workspace is tenant #1 with all existing data.
5. **C5 — RLS backstop.** `husn_app` role + policies (0010) + `SET LOCAL` already in place from C3's helper. Switch app's DATABASE_URL to the new role.
6. **C6 — viewer scoping.** `project_members` enforcement in `build_skeleton()` + chat dossier; member-role UI differences.

Smoke checklist after C4 and C5 mirrors the acceptance criteria, plus: second test tenant created end-to-end (signup → connect nothing → empty briefing → invite a second test email → member sees nothing until added to a project).

**Rollback posture:** C1–C2 are inert if reverted. C3+C4 roll back together via `AUTH_REQUIRED=0` + previous image. C5 rolls back by switching DATABASE_URL back to the owner role.

---

## 9. What I need from you (founder actions, can be done while C1–C2 are being built)

1. **Resend**: create account, I'll give you the exact DNS records to add at Hostinger.
2. **Google sign-in client**: 5 minutes in the existing GCP project; I'll give the exact settings.
3. **Decide:** is `admin sees all projects` correct for your taste? (Recommended yes — avoids a self-grant dead-end.)
4. **Your workspace name + the email you'll log in with** (becomes tenant #1 / user #1 in the backfill).

---

## 10. Anti-monitoring guardrails carried through (non-negotiable, restated)

- No "last active" on people anywhere in product UI. (`users.last_login_at` exists for security audit only and is rendered nowhere.)
- Members UI shows name/email/role — nothing behavioral.
- Briefs and findings keep naming artifacts and teams, never individuals.
- No admin surface gains visibility into another member's chat sessions (chat is per-user: `chat_sessions.user_id` scoping, admins included).

---

## 11. Effort estimate

| Chunk | Size |
|---|---|
| C1 schema + backfill | 1 day |
| C2 auth endpoints + session | 1–1.5 days |
| C3 scoped routers + workers + connector state | 1.5–2 days |
| C4 frontend (login, guard, wizard, members) | 1.5–2 days |
| C5 RLS backstop | 0.5–1 day |
| C6 viewer scoping | 0.5–1 day |
| **Total** | **~6–8 focused days** |
