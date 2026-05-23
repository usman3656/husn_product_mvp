# Jira (Atlassian) — OAuth 2.0 (3LO) setup

The husn.io API uses Atlassian's [OAuth 2.0 (3LO)](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/) flow to read Jira data. This doc explains what's already done and what to do if you need to re-register the app.

## Required env vars (in `.env`)

```
JIRA_CLIENT_ID=...
JIRA_CLIENT_SECRET=...
JIRA_REDIRECT_URI=http://localhost:8000/auth/jira/callback
HUSN_SESSION_SECRET=...   # used to sign OAuth state nonces
```

## Registering the app (one-time)

1. Open <https://developer.atlassian.com/console/myapps/> → **Create** → **OAuth 2.0 integration**.
2. **Permissions** → add **Jira API** with scopes:
   - `read:jira-work` — read issues, projects, comments, status transitions
   - `read:jira-user` — resolve users for ownership/mentions
   - `manage:jira-webhook` — register webhook subscriptions on connect
   - `offline_access` — receive a refresh token (required; access tokens expire in 1 hour)
3. **Authorization** → **OAuth 2.0 (3LO)** → set callback URL to
   `http://localhost:8000/auth/jira/callback`
4. **Settings** → copy **Client ID** and **Client Secret** into `.env`.

## How the flow works (auto-discovery)

You never need to enter your site URL or project key by hand.

1. User clicks "Connect Jira" → API redirects to Atlassian's `authorize` endpoint with our `client_id` and a signed `state` nonce.
2. User logs in to Atlassian, approves the scopes for one or more Cloud sites.
3. Atlassian redirects back to `/auth/jira/callback` with an authorization code.
4. API exchanges code for access + refresh tokens.
5. API calls `GET https://api.atlassian.com/oauth/token/accessible-resources` to discover which Cloud sites (and `cloudId`s) the user granted.
6. A row per (cloudId, site URL) is persisted in `connections` and the connection becomes "ready."

## Token lifetime

- **Access token:** 1 hour. Refreshed automatically by the API on 401.
- **Refresh token:** rotates on each use (Atlassian rotates them — the new one must be stored).
- **Inactivity expiry:** if a refresh token isn't used for 90 days, the user must re-consent.

## Rate limits (relevant in later steps)

Jira Cloud uses a **points-based** rate limiter — 65,000 points/hour shared across all apps on a site, plus per-endpoint burst limits. Enforced from **March 2, 2026**. Backfill paginates at low priority to avoid 429s on large instances. See `knowledge.md` §7 row 2.
