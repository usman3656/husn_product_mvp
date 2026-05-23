# Slack — OAuth v2 setup

husn.io installs as a custom workspace app per workspace (see knowledge.md §6A: this is the ToS-compliant pattern post the May 29, 2025 Slack API ToS changes).

## Required env vars (in `.env`)

```
SLACK_CLIENT_ID=...
SLACK_CLIENT_SECRET=...
SLACK_SIGNING_SECRET=...
SLACK_REDIRECT_URI=http://localhost:8000/auth/slack/callback
```

## Registering the app (one-time)

1. <https://api.slack.com/apps> → **Create New App** → **From scratch**.
2. Name: `husn.io local dev`. Workspace: the one you want to ingest from.
3. **OAuth & Permissions** (left sidebar):
   - **Redirect URLs** → add `http://localhost:8000/auth/slack/callback` → Save.
   - **Bot Token Scopes** → add:
     - `channels:read` — list public channels
     - `channels:history` — read messages in public channels
     - `users:read` — resolve message authors
     - `team:read` — workspace metadata for connection label
4. **Basic Information** → copy **Client ID**, **Client Secret**, **Signing Secret** into `.env`.

## How the flow works

1. User clicks "Connect Slack" → `/auth/slack/start` redirects to <https://slack.com/oauth/v2/authorize> with our `client_id`, scopes, signed state nonce, and `redirect_uri`.
2. Slack shows the consent screen with the requested scopes.
3. User approves → Slack redirects to `/auth/slack/callback?code=...&state=...`.
4. API calls `https://slack.com/api/oauth.v2.access` to exchange the code for a bot token, team id, team name.
5. One row per workspace persisted in `connections` (source=`slack`, account_id=team_id).
6. Auto-enqueue backfill: list channels → fetch messages → upsert into `raw_artifacts`.

## ToS & rate limits (relevant for production, not local MVP)

- Per Slack ToS (May 29, 2025): persistent storage of API data is **prohibited for non-Marketplace third-party apps**. For local dev / single-tenant installs the customer-owns-the-app pattern is the path. For multi-tenant production, husn.io must either pursue Marketplace approval (3–9mo) or ship as a customer-installed app.
- Non-Marketplace apps get **Tier 1: 1 req/min** on `conversations.history` with 15 msgs/call. Custom workspace apps get higher tiers. We honour 429 + `Retry-After`.

See knowledge.md §6A and §7 row 1.
