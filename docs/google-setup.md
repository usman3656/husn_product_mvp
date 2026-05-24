# Google (Gmail + Drive + Docs + Sheets) — OAuth 2.0 setup

One OAuth client covers all four APIs. Drive is the gateway to Docs/Sheets — content APIs read those file types via the file IDs Drive returns.

## Required env vars (in `.env`)

```
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
GOOGLE_REDIRECT_URI=http://localhost:8000/auth/google/callback
```

## Registering the OAuth client (one-time)

1. <https://console.cloud.google.com> → create project (or pick existing).
2. **APIs & Services → Library** — enable all four:
   - Gmail API
   - Google Drive API
   - Google Docs API
   - Google Sheets API
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**
   - Publishing status: **Testing** (skips verification + CASA; you can authorize up to 100 test users)
   - Test users: add your own Google email + any others who'll connect
   - Skip the scopes screen here — we declare scopes per-request in code
4. **APIs & Services → Credentials → Create OAuth Client ID**:
   - Application type: **Web application**
   - Authorized redirect URIs: `http://localhost:8000/auth/google/callback`
   - Copy **Client ID** and **Client Secret** into `.env`

## Scopes requested by husn.io

```
openid
email
profile
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/drive.readonly
```

`drive.readonly` is sufficient to read Docs + Sheets content via their respective APIs — no extra scopes needed. `documents.readonly` / `spreadsheets.readonly` could be requested for explicit narrowing but offer no practical benefit when `drive.readonly` is already granted.

**Both Gmail and Drive scopes are classified RESTRICTED.** In Testing mode they work for any test user you list. To switch to "In production" for real customers, husn.io must pass:
- App Verification (~6 weeks)
- CASA Tier 2 security assessment (~$500–1,500/yr; see knowledge.md §6 C)

This is a production-rollout concern, not a local-dev concern.

## Flow

1. User clicks "Connect Google" → `/auth/google/start` redirects to `https://accounts.google.com/o/oauth2/v2/auth` with our `client_id`, the scopes above, `access_type=offline` (so we get a refresh token), `prompt=consent` (so we *always* get one), and a signed state nonce.
2. User picks their Google account, sees the scope-consent screen, clicks Allow.
3. Google redirects to `/auth/google/callback?code=...&state=...`.
4. API exchanges the code at `https://oauth2.googleapis.com/token` → `{access_token, refresh_token, expires_in, id_token, scope}`.
5. API calls `userinfo` endpoint to get `email` + `sub` (Google user id) → stored as `connections.account_id = sub`, `account_label = email`.
6. **Allowlist UI** opens: user picks 1–3 Gmail labels + 1–3 Drive folders. Persisted as `project_sources(source="google", scope_kind="label"|"folder", scope_id=...)`.
7. Auto-enqueue Gmail + Drive backfill jobs for the selected scopes.

## Token lifetime + refresh

- Access token: ~1 hour
- Refresh token: long-lived, but invalidated if user revokes access or if app stays in Testing mode and the refresh token wasn't used in 7 days (test-mode quirk)
- Auto-refresh on 401, same pattern as Jira

## Rate limits (for production planning, not local dev)

- **Gmail:** 250 quota units/user/second; `messages.list` = 5 units, `messages.get` = 5 units → effective ~25 message fetches/sec/user
- **Drive:** quota-units model rolling out from May 1 2026, metered billing later 2026; current default is generous for MVP
- **Docs/Sheets:** 300 read/user/min — fine for incremental sync

See knowledge.md §7 row 3 for full numbers.

## Ingestion guardrail (mandatory)

Gmail and Drive ingestion are **allowlist-only** in this codebase. The user picks specific labels + folders in the dashboard after OAuth; nothing else is read. This is the same privacy-by-default pattern as Slack channels.

Bypassing the allowlist is intentionally not supported — see knowledge.md §6 (data minimization + EU AI Act surveillance-risk guardrail).
