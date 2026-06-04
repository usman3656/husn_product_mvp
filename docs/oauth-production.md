# OAuth production setup — husn.io

Step-by-step checklist for updating production OAuth registration and callback
URLs for the four providers, plus the order to do them in.

Callback pattern: `https://api.husn.io/auth/<provider>/callback`
App URL: `https://app.husn.io`
Privacy URL: `https://husn.io/privacy` (placeholder page until lawyer review)
Terms URL: `https://husn.io/terms` (placeholder)

---

## 1. Atlassian / Jira (3LO)

1. Open https://developer.atlassian.com/console/myapps/ and click the existing
   `husn.io local dev` app.
2. Authorization → OAuth 2.0 (3LO) → Configure → add Callback URL:
   `https://api.husn.io/auth/jira/callback`. Keep the localhost one for dev.
3. Recommendation: keep the single app, add the prod callback. Atlassian 3LO
   supports multiple callbacks on one client; a separate prod app would force
   two client IDs and a second consent flow with no security benefit until
   we're at scale.
4. Rename the app to `husn.io` and upload a real icon.
5. Distribution controls → Distribution status: **Sharing**. Required so users
   outside your Atlassian org can authorize. Fill avatar, vendor name,
   privacy/terms URLs. Tick the data-storage/security/incident checkboxes.
6. Scopes: `read:jira-work`, `read:jira-user`, `manage:jira-webhook`,
   `offline_access`.
7. Rotate client secret (Settings → New secret) and store in the prod secret
   manager.
8. Marketplace listing: defer. Not required for 3LO customer installs.

## 2. Slack

1. https://api.slack.com/apps → existing app, or Create New App → From an app
   manifest.
2. Per-workspace install pattern. Ship a manifest each customer applies in
   their own workspace:

   ```json
   {
     "display_information": { "name": "husn.io" },
     "oauth_config": {
       "redirect_urls": ["https://api.husn.io/auth/slack/callback"],
       "scopes": {
         "bot": [
           "channels:read",
           "channels:history",
           "users:read",
           "team:read"
         ]
       }
     },
     "settings": { "org_deploy_enabled": false, "socket_mode_enabled": false }
   }
   ```

3. Production app: keep Distribution OFF (private / single-workspace). This is
   the ToS-compliant path (knowledge.md §6A): persistent storage of Slack data
   is prohibited for non-Marketplace third-party apps; customer-owned installs
   sidestep this and earn higher rate-limit tiers.
4. Scopes (from `docs/slack-setup.md`): `channels:read`, `channels:history`,
   `users:read`, `team:read`.
5. OAuth & Permissions → Redirect URLs:
   `https://api.husn.io/auth/slack/callback`. Save. Copy Client ID, Client
   Secret, Signing Secret to prod secrets.
6. Marketplace: defer until ~20 customers.

## 3. Google (Gmail + Drive restricted)

1. https://console.cloud.google.com → create new project named `husn-prod`
   (keep the dev project clean for testing).
2. APIs & Services → Library: enable Gmail API, Drive API, Docs API, Sheets
   API.
3. OAuth consent screen:
   - User Type: **External**
   - App name: `husn.io`
   - User-support email + dev contact: `bawani@husn.io` (set up forwarding)
   - App logo: 120 × 120 PNG
   - App home: `https://app.husn.io`
   - Authorized domains: `husn.io`
   - Privacy: `https://husn.io/privacy`
   - Terms: `https://husn.io/terms`
4. Scopes (from `docs/google-setup.md`): `openid email profile`,
   `https://www.googleapis.com/auth/gmail.readonly`,
   `https://www.googleapis.com/auth/drive.readonly`. Both are restricted.
5. Test users: add Bawani + first 2 – 3 pilot customer Google addresses (cap
   100). Keep status **Testing** for now.
6. Credentials → Create OAuth Client ID → Web application: redirect
   `https://api.husn.io/auth/google/callback`. Save Client ID/Secret.
7. Pilot UX expectation: test users will hit "Google hasn't verified this app"
   → Advanced → Go to husn.io (unsafe) → consent. Brief each customer in
   advance. The 100-test-user cap is the waiver ceiling.
8. Verification (start today, runs in parallel):
   https://support.google.com/cloud/answer/13463073. Submit OAuth verification
   plus restricted-scope justification for `gmail.readonly` and
   `drive.readonly`. CASA Tier 2 vendor — use Leviathan Security or Bishop Fox
   (Google's listed assessors). Budget $500 – 1,500/yr. Expect **6 – 8 weeks**.
   Record a Loom of the consent flow + scope usage for the submission.

## 4. Microsoft / Entra Graph

1. https://entra.microsoft.com → Applications → App registrations → All
   applications → open the existing multi-tenant `husn.io` registration.
2. Authentication → Platform: Web → Add URI:
   `https://api.husn.io/auth/microsoft/callback`. Keep the localhost dev URI.
   Implicit grant: leave both ID tokens and access tokens unchecked (we use
   auth-code + PKCE). Save.
3. Certificates & secrets → New client secret → 24-month expiry → copy Value
   to prod secrets and calendar a rotation reminder for month 22. Retire the
   old secret after cutover.
4. Branding & properties: set Publisher domain to `husn.io` (verify via DNS
   TXT), Logo, Privacy, Terms.
5. API permissions (from `docs/microsoft-setup.md`, delegated): `openid`,
   `profile`, `offline_access`, `User.Read`, `Mail.Read`, `Files.Read`,
   `Sites.Read.All`.
6. Tenant admin consent: send each customer the admin-consent URL
   `https://login.microsoftonline.com/{tenant}/adminconsent?client_id={MS_CLIENT_ID}`
   so their Entra admin grants org-wide once. `Sites.Read.All` requires admin
   consent.
7. M365 App Certification: defer. We stay customer-installed for the first
   10 – 20; the 60-day onboarding is revisited at scale.

---

## Order of operations

1. **Today.** Start Google OAuth verification + CASA submission. It is the
   6 – 8-week long pole; everything else runs the test-user waiver in parallel.
2. **Once `api.husn.io` DNS + TLS is live** (one sitting): add prod callbacks
   to Atlassian, Slack, Microsoft, and the Google prod OAuth client. Rotate
   all prod secrets into the secret manager.
3. **Per-customer onboarding.** Slack manifest install, Microsoft admin-consent
   link, Google test-user add.
4. **Defer:** Slack Marketplace, M365 App Certification, Atlassian Marketplace
   listing. Revisit at ~20 customers.

## Pre-checks before opening any console

- `https://api.husn.io/auth/<provider>/callback` reachable over TLS, cert valid.
- `https://app.husn.io` reachable.
- `https://husn.io/privacy` and `https://husn.io/terms` placeholder pages live
  (Google and Microsoft both reject 404s on branding screens).
- OAuth correspondence inbox monitored (suggest `oauth@husn.io` → Bawani).
- DNS TXT verification ready for Microsoft Publisher Domain + Google
  authorized-domain checks.
- 120 × 120 PNG logo + favicon.
- Prod secret manager target chosen (sops + age recommended) before any
  secrets are generated.
- List of first 2 – 3 pilot customer Google addresses (for test-user
  allowlist).
