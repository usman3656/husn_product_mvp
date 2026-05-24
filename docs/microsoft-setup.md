# Microsoft (Outlook + OneDrive + SharePoint) — OAuth 2.0 setup

One Entra app registration covers Outlook mail + OneDrive + SharePoint. Microsoft Graph routes by API path; the same access token + scopes are reused.

## Required env vars (in `.env`)

```
MS_CLIENT_ID=...                     # Application (client) ID GUID from Entra
MS_CLIENT_SECRET=...                 # client secret VALUE (not the ID)
MS_TENANT=common                     # 'common' works for personal + any-work-tenant.
                                     # Use a specific tenant GUID for single-tenant lockdown.
MS_REDIRECT_URI=http://localhost:8000/auth/microsoft/callback
```

## Registering the app (one-time)

1. <https://entra.microsoft.com> → **Applications** → **App registrations** → **+ New registration**
2. Name: `husn.io local dev`.
   Supported account types: **Accounts in any organizational directory + personal Microsoft accounts** (multitenant).
   Redirect URI: Web, `http://localhost:8000/auth/microsoft/callback`. Register.
3. Overview → copy **Application (client) ID** into `MS_CLIENT_ID`.
4. **Certificates & secrets** → **+ New client secret** → copy the Value (shown once) into `MS_CLIENT_SECRET`.
5. **API permissions** → **+ Add permission** → **Microsoft Graph** → **Delegated permissions**:
   - `User.Read` (default)
   - `offline_access` — required for refresh tokens
   - `Mail.Read` — Outlook messages
   - `Files.Read` — OneDrive files
   - `Sites.Read.All` — SharePoint sites + items
6. Grant admin consent if your tenant requires it. Personal accounts skip this.

## Scopes requested by husn.io

```
openid
profile
offline_access
User.Read
Mail.Read
Files.Read
Sites.Read.All
```

All but `Sites.Read.All` are **non-sensitive** (no Microsoft 365 Certification needed for testing). `Sites.Read.All` is **sensitive** at the consent layer; in test mode and personal accounts it works without certification, but production multi-tenant distribution will need Microsoft 365 App Certification (see `knowledge.md` §6 C). That's a 60-day onboarding with documented security + GDPR — defer until ready to sell.

## How the flow works (auto-discovery)

1. User clicks "Connect Microsoft" → `/auth/microsoft/start` redirects to
   `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize` with `client_id`, scopes above, `response_type=code`, `response_mode=query`, `prompt=select_account`, and a signed state nonce.
2. User logs in to Microsoft, picks an account, accepts the consent screen.
3. Microsoft redirects to `/auth/microsoft/callback?code=...&state=...`.
4. API exchanges the code at `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` for an access token + refresh token + id_token.
5. API calls `https://graph.microsoft.com/v1.0/me` to identify the account (`id`, `userPrincipalName`, `mail`, `displayName`).
6. A row per `me.id` is persisted in `connections` (source=`microsoft`).
7. User picks Outlook folders + OneDrive folders in the dashboard allowlist UI — same pattern as Google.

## Token lifetime

- **Access token:** 60–90 min (varies by tenant policy).
- **Refresh token:** rotates on use. ~24h inactivity expiry for some scopes; usually long-lived.
- Auto-refresh on 401, same pattern as Jira / Google.

## Rate limits (relevant from Sep 30 2025)

- **Outlook:** 10,000 req / 10-min per app+mailbox (~16 rps), recommended 4–10 rps. Per-tenant cap halved Sep 30, 2025.
- **Teams:** 4 rps per team, 1 rps per channel/chat (not used in v1).
- **OneDrive / SharePoint:** more generous but still throttled.

See `knowledge.md` §7 row 4. Our backfill stays well under via paging + Retry-After.

## Allowlist guardrail (mandatory)

Mail and OneDrive ingestion are **folder-allowlist only**. The user picks specific Outlook folders (Inbox, Sent, custom) and OneDrive folders in the dashboard after OAuth completes. Nothing else is read. Same privacy-by-default pattern as Slack channels and Google labels/folders.
