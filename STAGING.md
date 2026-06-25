# Staging environment — DEDICATED box, fully isolated from production

Staging runs on its **own Hetzner box**, with its own Caddy, TLS certs,
Postgres, Redis, secrets, and OAuth apps. It shares **nothing** with prod
except the source repo and DNS. A staging mistake cannot reach prod.

> Why a separate box: a previous same-box attempt put staging containers on
> prod's Docker network, where they inherited the `web`/`api` aliases and prod's
> Caddy load-balanced live traffic onto staging. Physical separation makes that
> class of failure structurally impossible.

```
 prod box  (existing)            staging box  (new)
 ─────────────────────           ──────────────────────
 app.husn.io   ─┐                staging.husn.io     ─┐
 api.husn.io   ─┤ Caddy          api-staging.husn.io ─┤ Caddy (own certs)
   web/api/worker                  web/api/worker
   postgres/redis                  postgres/redis  (separate data)
   .env.prod  (main)               .env.staging   (staging branch)
```

Branch flow: feature → **`staging`** branch → auto-deploys to the staging box →
PR to **`main`** → auto-deploys to the prod box.

---

## One-time setup

### 1. Provision the box (you)
- Create a Hetzner Cloud server, **same class as prod (CX33, 4 vCPU / 8 GB)**,
  same region + same Ubuntu version as prod.
- Install Docker + the compose plugin; create a `deploy`/root login you can SSH to.
- Enable the Hetzner firewall: allow `22` from your IP, `80` + `443` from anywhere.
- Note the box's public IP.

### 2. DNS (you)
Add two records pointing at the **new box IP** (leave `app.husn.io` /
`api.husn.io` on prod untouched):
- `staging.husn.io`      → A (and AAAA if using IPv6) → staging box IP
- `api-staging.husn.io`  → A (and AAAA) → staging box IP

### 3. Separate Slack app (you)
Create a **new** Slack app (do not reuse prod's — one app can point its
Events/Interactivity at only one URL). Set:
- OAuth Redirect URL: `https://api-staging.husn.io/auth/slack/callback`
- Event Subscriptions request URL: `https://api-staging.husn.io/slack/events`
- Interactivity request URL: `https://api-staging.husn.io/slack/interactivity`
- Scopes identical to the prod app.
- Copy its Client ID / Client Secret / Signing Secret for `.env.staging`.

(Same idea for Google/Microsoft/Jira: either separate staging apps, or add the
`api-staging.husn.io/auth/<provider>/callback` redirect URI to the existing app.)

### 4. Clone + configure on the staging box
```bash
git clone <repo-url> ~/husn-staging
cd ~/husn-staging
git checkout staging
cp .env.staging.example .env.staging
# fill in every CHANGE_ME (fresh POSTGRES_PASSWORD, fresh SESSION_SECRET via
# `openssl rand -hex 32`, separate GROQ key, the new Slack app creds, ACME_EMAIL)
chmod 600 .env.staging
```

### 5. First deploy
```bash
./scripts/deploy-staging.sh
```
Caddy will provision Let's Encrypt certs for `staging.husn.io` /
`api-staging.husn.io` on first hit. Verify:
```bash
curl -s -o /dev/null -w '%{http_code}\n' https://api-staging.husn.io/health/lite   # 200
curl -s -o /dev/null -w '%{http_code}\n' https://staging.husn.io/healthz           # 200
```

### 6. Auto-deploy (optional, on the staging box)
```bash
( crontab -l 2>/dev/null; \
  echo '*/3 * * * * /root/husn-staging/scripts/auto-deploy-staging.sh  # husn-staging-auto-deploy' ) | crontab -
```
Now every push to `staging` ships to the staging box within ~3 min.

---

## Daily workflow
```bash
git checkout -b my-feature        # branch off main (or staging)
# ...build + commit...
git checkout staging && git merge my-feature && git push origin staging   # → staging box
# test on https://staging.husn.io, then open a PR my-feature/staging → main → prod
```

---

## Isolation guarantees (what makes this safe)
- **Separate host** — own kernel, Docker daemon, Caddy, `:443`, disk, and data.
  A staging build/OOM/disk-fill/cert error cannot touch prod.
- **Separate data** — own Postgres + Redis + volumes; staging never points at
  prod's DB.
- **Separate identity** — own `SESSION_SECRET`, DB password, Slack/OAuth apps,
  Groq/Resend keys. A leaked staging secret is useless against prod.
- **Host-only cookies** (`COOKIE_DOMAIN=` empty) — staging never sets a
  `.husn.io` cookie, so it can't interfere with prod sessions.
- **No prod files touched** — setting up staging never edits
  `docker-compose.prod.yml`, the prod `Caddyfile` usage, `.env.prod`, or any
  prod volume/network. Staging is additive only.

## Gotcha checklist
- `NEXT_PUBLIC_API_URL` is **build-time** — the web image must be built with
  `https://api-staging.husn.io` (handled: the staging compose passes it as a
  build arg from `${DOMAIN_API}`). A cached/wrong build makes the staging UI
  call the prod API.
- Register every OAuth redirect URI against `api-staging.husn.io` before testing.
- Always run a new DB migration on staging first; it rehearses the exact
  `alembic upgrade head` prod will run.
