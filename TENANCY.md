# husn — Multi-tenancy + Authentication Plan (v2)

> Status: **PROPOSED — awaiting founder sign-off. No code written yet.**
> v2, 2026-06-10: switched from open-signup+invites to the **Jira-style admin-provisioned directory** model per founder direction, validated by a third research pass.

---

## 1. The model (founder's words, made precise)

- **One admin (or more) controls the company.** They create the workspace, manage an admin panel, add team members' emails with roles, and connect all data sources (Slack / Jira / Google / Microsoft) **once, at the org level**.
- **A regular member just logs in with their email.** Their email is already in the company directory (the admin put it there), so login routes them straight into the company workspace. They can use Ask Husn, see the Briefing / Explore / Organization / Investigations — but cannot touch org configuration. That's the admin's.
- **Connectors are company-level, not per-user.** Acme's admin connects Acme's Slack; every Acme member's intelligence is fed from it. Members never see an OAuth screen.

**Acceptance criteria:**
- Fresh incognito window → login page, nothing else.
- New company: log in with an unknown email → "No workspace found → Create a workspace" → empty clean workspace, you're the owner/admin.
- Admin adds `teammate@acme.com` with role *member* in Settings → teammate logs in with just their email → lands in Acme's workspace, sees dashboards + chat, sees **no** admin controls.
- Admin connects Slack → it's Acme's connection. Second company's data never touches Acme's.

**Out of scope:** Stripe · SAML/WorkOS · per-customer servers · domain capture (auto-join by @acme.com — deferred; without DNS verification it's an account-takeover primitive).

---

## 2. Ground truth (from the codebase audit — corrects the docs)

- `tenant_id` exists on **zero** of the 16 tables (docs claimed all). No users table. Next migration: 0009.
- **No auth anywhere.** All 19 routers unauthenticated; `SESSION_SECRET` is only the OAuth-state HMAC key. Only middleware is CORS (already `allow_credentials=True`).
- Connections have no owner; keyed `(source, account_id)` globally — must become per-tenant.
- `viewer_id` in the brief pipeline is a no-op (always None).
- Six global unique constraints need per-tenant re-keying (`uq_connection_source_account`, `uq_raw_artifact_source_extid_ver`, `uq_identity_source_user`, `uq_project_source_scope`, `projects.slug`, `uq_claim_group_project_kind_key`).
- Cross-tenant bleed risk in workers: person identity merge by email must become `(tenant_id, email)`.
- Web fetch split: 4 SSR pages + ~10 server components fetch internally (must forward session cookie); ~8 client components fetch the API directly (cookie flows once `Domain=.husn.io`).

---

## 3. Architecture decisions

### D1 — FastAPI owns auth. No Auth.js.
Sessions: opaque ID in Redis (`session:{id}` → `{user_id, tenant_id, role}`, 30-day sliding TTL) + a `user_sessions:{user_id}` set for instant revocation. Cookie `HttpOnly; Secure; Domain=.husn.io; SameSite=Lax`. CSRF: custom header required on non-GET + Origin check.
**Per-request membership re-validation** — the session names the tenant, but each request re-checks `memberships WHERE user+tenant AND status='active'`. A removed member's live session dies immediately even if Redis cleanup races.

### D2 — Magic links only at v1. Google sign-in button optional, later.
Resend; `login_tokens` DB rows (sha256 hash, 15-min expiry, atomic single-use); landing page with a "Sign in" button that POSTs (email-scanner-safe); 3/email/15min rate limit; no user enumeration.
*Founder console work shrinks to:* **Resend DNS only.** (The separate Google sign-in client is shelved until we want the convenience button.)

### D3 — Admin-provisioned directory (the Jira model)
```
memberships(id, tenant_id, email NORMALIZED, role enum[owner|admin|member],
            user_id NULLABLE, status enum[invited|active|removed],
            added_by, created_at, first_login_at)
UNIQUE (tenant_id, email)
```
- Admin adds an email → row with `status='invited'`, `user_id=NULL`.
- First login with that email → `users` row created just-in-time, linked by email match, `status → 'active'`, `first_login_at` stamped.
- Email normalization: lowercase + trim, exact-match after that. **No** gmail dot/plus canonicalization (Atlassian/Slack treat `a+x@` as distinct; canonicalizing mis-links people). Admin UI warns on plus-addresses.
- Removal: `status='removed'` (soft) + kill all their sessions via the Redis set. User row + chat history retained ("Deactivated user" attribution — it's org work product). Hard-delete only on explicit GDPR request.
- Recycled email (new hire reuses a departed person's address): re-adding creates a **fresh membership**; old chat sessions are not auto-relinked.
- Typo'd email: harmless — row sits `invited` forever; the magic link only ever goes to the typo'd address. Admin sees "never logged in" and deletes.

### D4 — Login flow: one screen, fork after verification
1. `app.husn.io` → `/login` → email → magic link → click → verify.
2. Memberships found = 1 → straight into that workspace.
3. Memberships > 1 (consultant case) → workspace picker; choice stored as `active_tenant_id` in the session. Tenant **never** accepted from request params — session only.
4. Memberships = 0 → one screen: *"No workspace found for x@y.com — **Create a workspace** / Ask your admin to add you."* The create path is the new-company self-serve funnel (creates tenant + owner membership). No separate `/signup` URL — same plumbing, no "which page do I use" confusion. (This is Atlassian's and Notion's exact flow.)

### D5 — Role gates (two dependencies, every router)
- `require_member()` → `(user, tenant, role)` for any active member. Gates **all tenant-scoped reads + chat**.
- `require_admin()` → asserts role ∈ {owner, admin}. Gates **all org mutations**.

| Endpoint group | Gate |
|---|---|
| `chat.py` (Ask Husn), `agent.py` GETs, `graph.py`, `findings.py`, `claims.py`, `artifacts.py`, `slack_feed.py`, `connections.py` GET (read-only status) | member |
| `connections.py` DELETE / reset-sync / reset-sync-all, `google_admin` + `microsoft_admin` allowlists + folder browse, `jira_admin` + `slack_admin` backfills, `admin_diag` backfill-now, all four connector OAuth start/callback, members CRUD (new), workspace settings (new) | admin |
| `POST /api/agent/run` | **admin** (org-shared output, LLM spend control; per-tenant rate limit). Chat stays member — that's the product. |
| `atlassian_personal_data.py` | provider JWT verification (separate fix, included in C3) |

Admins see all projects (founder confirmed default unless overridden). Members see only `project_members` projects; `viewer_id` in `build_skeleton()` becomes the real user and filters accordingly.

### D6 — Enforcement layers
1. Tenant-scoped session dependency — every query takes `tenant_id` from the session-resolved membership. CI check: no tenant-scoped model queried outside scoped helpers.
2. **Postgres RLS backstop** (honors knowledge.md §11.C): non-owner `husn_app` role, `SET LOCAL app.tenant_id` in the same dependency, policies per table (EXISTS-policies for join tables). Alembic keeps the owner role. Ships before this work is declared done.

### D7 — Tenancy roots (unchanged from v1 plan)
Direct `tenant_id` on: connections, raw_artifacts, persons, person_identities, projects, claim_groups, agent_runs, chat_sessions (+`user_id`), briefs, artifacts, claims, findings + the new tables. Join tables derive. All six global unique constraints re-keyed per tenant.

---

## 4. New schema (migration 0009)

```
tenants(id, name, slug unique, created_at)
users(id, email unique normalized, name, avatar_url, created_at, last_login_at)
     -- last_login_at: security audit only; rendered NOWHERE (anti-monitoring)
memberships(…)                          -- as D3
login_tokens(id, email, token_hash, expires_at, used_at)
project_members(project_id, user_id)    PK both
+ tenant_id columns (nullable at C1) + constraint re-keys per D7
```

**No founder bootstrap. Existing production data is wiped at cutover** (founder decision 2026-06-10): the C4 deploy truncates all data tables (connections, raw_artifacts, graph, claims, findings, briefs, agent_runs, chat) and sets `tenant_id NOT NULL`. The founder then signs up through the normal create-workspace flow like any other company, reconnects the four tools, re-picks allowlists; backfills repopulate within the hour. This removes the entire backfill/stamping complexity from 0009 — columns are added nullable at C1, the app keeps running on existing data until C4, and the wipe + login wall land in the same deploy.

*(No `invites` table — the directory model absorbs it. "Notify by email" checkbox on add-member just fires a magic link.)*

---

## 5. Admin panel — expand Settings, no separate /admin route

`web/app/settings/page.tsx` is already grouped sections; the side-nav already has a "Workspace" group. Changes:

- **Settings → Members** (admin-only group): table of members — name, email, role, status (`invited` = never logged in / `active`) — add-member form (email + role + optional "send them a sign-in link"), change-role, remove. **Shows nothing behavioral — no last-active, no usage counts** (anti-monitoring applies to admin surfaces).
- **Settings → Workspace** (admin-only): rename workspace.
- **Connections page**: stays at `/connections`; mutating controls (connect, disconnect, reset, allowlists) render only for admins; members get a read-only "what's connected" view.
- **Side-nav**: Workspace section items render by role (from `GET /auth/me`).
- **Login page** (`/login`) + **no-workspace fork screen** + **workspace picker** (only shown when >1) + **create-workspace screen** — all editorial style.
- **`apiFetch()` helper**: centralizes the 14 fetch sites; SSR forwards `cookies()`; 401 → redirect `/login`.

---

## 6. Worker changes (unchanged from v1 plan)

Backfills stamp `tenant_id` from their Connection. Normalize derives per-row; person identity merge keys `(tenant_id, email)`. Drift + agent iterate per-tenant naturally via stamped rows/projects. All worker DB access uses the same scoped helper (sets `SET LOCAL` for RLS).

---

## 7. Rollout (live deploy must not break)

1. **C1 — Migration 0009.** Additive only (new tables + nullable tenant_id columns). App keeps running on existing data, unauthenticated, unchanged.
2. **C2 — Auth endpoints** (magic send/landing/consume, logout, /auth/me, create-workspace, workspace picker). Nothing enforced. *Gate: Resend DNS done.*
3. **C3 — Scoping.** All routers gated per D5 table; connector `state` carries tenant + acting admin; workers stamp tenant; Atlassian JWT verification. `AUTH_REQUIRED=0` honored so the live app stays open until C4.
4. **C4 — Cutover.** Frontend (login, fork screen, apiFetch, role-aware nav, Settings → Members, read-only connections for members) + migration 0010 (**truncate all data tables, set tenant_id NOT NULL, re-key unique constraints**) + flip `AUTH_REQUIRED=1` — one deploy. From this moment: incognito → login page; founder signs up fresh, creates their company, reconnects tools.
5. **C5 — RLS backstop** (husn_app role + policies, switch app DATABASE_URL).
6. **C6 — viewer scoping** (`project_members` in `build_skeleton()` + chat dossier + member UI differences).

Smoke after C4 + C5: full acceptance list + a second test tenant end-to-end (create workspace → add member email → member logs in → sees empty briefing, no admin controls).

**Rollback:** C1–C2 inert. C3 via `AUTH_REQUIRED=0`. C4 is the point of no return for the old data (wipe is intentional, founder-approved); the app itself rolls back via previous image + `AUTH_REQUIRED=0` if the login flow breaks. C5 via DATABASE_URL switch back.

---

## 8. Founder actions

1. **Resend**: account + DNS records at Hostinger. *Done per founder (2026-06-10). Verify domain shows "Verified" before C2 deploys.*
2. ~~Workspace name + login email~~ — not needed; existing data is wiped at C4 and the founder signs up through the normal flow like any other company.
3. ~~Google sign-in client~~ — deferred (magic links only at v1; "sign up with Gmail" = magic link to a Gmail address, no console work). The "Continue with Google" button is a 5-minute additive follow-up whenever wanted.

## 9. Anti-monitoring guardrails (restated, non-negotiable)

- Members UI: name/email/role/invited-or-active only. No last-active, no usage data, no behavioral anything.
- `users.last_login_at` is security audit data; rendered nowhere.
- Admins cannot see other members' chat sessions (chat scoped `user_id`, no admin override).
- Briefs and findings keep naming artifacts and teams, never individuals.

## 10. Effort

| Chunk | Size |
|---|---|
| C1 schema + backfill | 1 day |
| C2 auth endpoints | 1–1.5 days |
| C3 scoping (routers + workers + connector state) | 1.5–2 days |
| C4 frontend | 1.5–2 days |
| C5 RLS backstop | 0.5–1 day |
| C6 viewer scoping | 0.5–1 day |
| **Total** | **~6–8 focused days** |
