# Husn — Onboarding

Hand-off doc. By the end of this you'll have **Husn running on your machine
locally** and (optionally) **Husn running on your own server** with your own
domain + IP.

Assumes you've been given access to:

1. The **GitHub repo** (fork, or push access to the original).
2. The **secrets bundle** — sent to you over 1Password / Bitwarden / Signal —
   containing `.env.prod` values (Postgres password, session secret, token
   encryption key, Groq API key, and OAuth client IDs/secrets for
   Jira / Slack / Google / Microsoft). **Don't paste these into Slack / email /
   ChatGPT.** Keep them in a password manager.

If you're missing either, ask before continuing.

---

## 0 · Prerequisites (your laptop)

| Tool | Why | Install |
|---|---|---|
| Docker Desktop (or OrbStack) | Local dev runs in containers | <https://www.docker.com/products/docker-desktop> |
| Git | Clone + push | macOS: `xcode-select --install` |
| ssh | Connect to the server (only if you'll run prod) | preinstalled on macOS / Linux |
| Node.js 20+ *(optional)* | Faster `web/` iteration outside Docker | `brew install node@20` |
| Python 3.12 *(optional)* | Faster `api/` iteration outside Docker | `brew install python@3.12` |

On macOS, **start Docker Desktop and let it finish booting** before running anything else.

---

## 1 · Clone

```bash
git clone https://github.com/<the-owner>/husn_product_mvp.git husn
cd husn
```

If you forked, use your fork's URL. After cloning, add the original as `upstream`
so you can pull updates:

```bash
git remote add upstream https://github.com/<original-owner>/husn_product_mvp.git
git fetch upstream
```

---

## 2 · Run it locally

The fastest path. No production secrets needed — local dev uses a
self-contained Postgres + Redis in Docker.

### 2.1 — Create a local env file

```bash
cp .env.example .env
```

Open `.env` and fill in **only what you actually need to test**:

- For the **frontend + API + briefing engine** without real OAuth: leave the
  `*_CLIENT_ID` / `*_CLIENT_SECRET` blank. The OAuth flows won't work, but the
  rest of the app does.
- For the **LLM-powered surfaces** (Ask Husn, briefs, NLI verifier), you need
  `GROQ_API_KEY` and `ANTHROPIC_API_KEY`. Get your own from
  <https://console.groq.com> and <https://console.anthropic.com>. **Don't use
  production keys for local dev** — billing comes back to whoever owns the key.

### 2.2 — Boot the stack

```bash
docker compose up --build
```

First boot takes ~5 minutes (image pulls + builds). Subsequent boots are seconds.

You should see logs from `api`, `web`, `worker`, `postgres`, `redis` interleaved.
Once it settles:

| Surface | URL |
|---|---|
| App | <http://localhost:3000> |
| API health | <http://localhost:8000/health> |
| API docs (Swagger) | <http://localhost:8000/docs> |

### 2.3 — Connect a source (optional)

OAuth callbacks for the dev OAuth apps need to come back to `localhost`. Each
provider's setup is documented in `docs/`:

- Jira: `docs/jira-setup.md`
- Slack: `docs/slack-setup.md`
- Google: `docs/google-setup.md`
- Microsoft: `docs/microsoft-setup.md`

For local-only testing you can mostly skip OAuth and just look at the UI shell —
the redesign (Briefing, Ask Husn, Investigations, Organization) renders with
no data and shows its empty states.

### 2.4 — Stop / reset

```bash
docker compose down              # stop
docker compose down -v           # stop + nuke Postgres + Redis volumes (fresh DB)
```

---

## 3 · Run it in production (your own server)

Skip this section if you're only iterating locally.

The production stack is a single Hetzner CX32 (4 vCPU / 8 GB / Ubuntu 24.04)
running `docker-compose.prod.yml` behind Caddy with auto Let's Encrypt.
**Any cloud VM with at least 4 GB RAM and Docker installed will work** — DigitalOcean
$24 droplet, Linode, Vultr, AWS Lightsail, etc.

### 3.1 — Provision the server

1. **Spin up a VM** running Ubuntu 22.04 or 24.04. Note its public IPv4 — you'll
   need it everywhere below. Throughout this doc that IP is called `<SERVER_IP>`.
2. **SSH in as root** (most providers let you set an SSH key at create time):
   ```bash
   ssh root@<SERVER_IP>
   ```
3. **Install Docker + compose plugin**:
   ```bash
   apt-get update && apt-get install -y docker.io docker-compose-plugin git
   systemctl enable --now docker
   ```
4. **Clone the repo** to `/root/husn`:
   ```bash
   cd /root && git clone https://github.com/<your-owner>/husn_product_mvp.git husn
   ```

### 3.2 — Point DNS at the server

The compose stack expects **two subdomains** of any domain you own — defaults
are `app.<your-domain>` and `api.<your-domain>`. In your registrar's DNS:

| Record | Type | Value |
|---|---|---|
| `app.<your-domain>` | A | `<SERVER_IP>` |
| `api.<your-domain>` | A | `<SERVER_IP>` |

Wait until `dig app.<your-domain> +short` returns `<SERVER_IP>` before continuing —
Caddy will fail to mint TLS certs until DNS resolves.

### 3.3 — Create `.env.prod` on the server

Either upload the file your teammate sent you, or generate fresh secrets and
fill in the OAuth credentials manually:

```bash
cd /root/husn
./scripts/init-env.sh                # generates random POSTGRES_PASSWORD,
                                     # SESSION_SECRET, TOKEN_ENCRYPTION_KEY
vi .env.prod                         # fill in everything else
chmod 600 .env.prod
```

**Set these explicitly:**

| Variable | What to put |
|---|---|
| `DOMAIN_APP` | `app.<your-domain>` |
| `DOMAIN_API` | `api.<your-domain>` |
| `ACME_EMAIL` | a real email — Let's Encrypt sends cert-expiry warnings here |
| `CORS_ALLOWED_ORIGINS` | `https://app.<your-domain>` |
| `PUBLIC_API_BASE_URL` | `https://api.<your-domain>` |
| `PUBLIC_WEB_BASE_URL` | `https://app.<your-domain>` |
| `GROQ_API_KEY` | from <https://console.groq.com> |
| `ANTHROPIC_API_KEY` | from <https://console.anthropic.com> |
| `*_CLIENT_ID` / `*_CLIENT_SECRET` | one set per OAuth provider you want enabled |

For OAuth, each provider's callback URL must be `https://api.<your-domain>/auth/<provider>/callback`.
See `docs/oauth-production.md` for the full checklist per provider.

### 3.4 — First deploy

```bash
cd /root/husn
./scripts/deploy.sh
```

This pulls main, builds all images, runs Alembic migrations, smoke-checks
`/health`. Takes ~5–8 min the first time.

Verify:
- `curl https://api.<your-domain>/health` → `{"status":"ok"}`
- Open `https://app.<your-domain>/` in a browser → Briefing surface loads.

### 3.5 — Auto-deploy from `main` (recommended)

The repo has a cron-driven auto-deploy that pulls `origin/main` every 2 min and
re-runs `deploy.sh` if there are new commits:

```bash
cd /root/husn
./scripts/install-auto-deploy.sh
```

After this, any push to `main` lands in production within ~3–5 min.

---

## 4 · Connecting from your laptop to the new server

Once the server is up at `<SERVER_IP>`, set up the `husn` SSH alias on your
laptop so you don't have to remember the IP:

```bash
# From your laptop (NOT the server):
bash scripts/init-mac-ssh.sh
```

The script writes `~/.ssh/config` with a `husn` Host alias. **Edit the
`HostName` line to your `<SERVER_IP>`** — the script ships with a default IP
that points at the original production box; you don't want that:

```bash
sed -i.bak 's/HostName .*/HostName <SERVER_IP>/' ~/.ssh/config
```

Then test:

```bash
ssh husn   # should drop you into a root shell on your server
```

A one-touch redeploy wrapper is available too:

```bash
bash scripts/init-mac-deploy.sh    # installs ~/.local/bin/husn-deploy
husn-deploy                         # runs git pull + deploy.sh on the server
```

---

## 5 · What to change when the IP changes

The server IP shows up in **exactly three places**. If you migrate to a new VM,
update all three:

1. **DNS** — change the A records for `app.<your-domain>` and
   `api.<your-domain>` to the new IP. Wait until `dig +short` confirms before
   redeploying.
2. **Your `~/.ssh/config`** — update `HostName` under `Host husn`.
3. **(If you used `init-mac-deploy.sh`)** — the wrapper at
   `~/.local/bin/husn-deploy` uses the `husn` SSH alias, so step 2 is enough.

Nothing in `.env.prod` references the IP directly — it uses domain names.
Nothing in the repo references the IP either, except the default in
`scripts/init-mac-ssh.sh` (which is just an example for first-time setup).

---

## 6 · Day-to-day commands

All these run from `/root/husn` on the server (or via `ssh husn '<cmd>'` from
your laptop).

| Goal | Command |
|---|---|
| Redeploy after pushing to `main` | `./scripts/deploy.sh` *(or auto-deploy cron)* |
| Redeploy without rebuilding images | `./scripts/deploy.sh --no-build` |
| Tail all logs | `docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f` |
| Tail one service | `docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f api` |
| Container status | `docker ps --format "table {{.Names}}\t{{.Status}}"` |
| One-shot diagnostics dump | `./scripts/diag.sh` |
| Run a backfill now (skip cron) | `curl -X POST https://api.<your-domain>/api/admin/backfill-now` |
| Reset stuck sync cursors | `curl -X POST https://api.<your-domain>/api/connections/reset-sync-all` |
| Open a psql shell | `docker compose -f docker-compose.prod.yml --env-file .env.prod exec postgres psql -U husn -d husn` |
| Restart just the worker | `docker compose -f docker-compose.prod.yml --env-file .env.prod restart worker` |
| Disk usage | `df -h && docker system df` |
| Free up Docker space | `docker system prune -af` |

If you're SSH'd in often, drop these in `/root/.bashrc` as aliases:

```bash
alias dc='docker compose -f docker-compose.prod.yml --env-file .env.prod'
alias redeploy='/root/husn/scripts/deploy.sh'
```

---

## 7 · Where the secrets live

| Secret | Where | How to rotate |
|---|---|---|
| `POSTGRES_PASSWORD` | `.env.prod` + Postgres data dir | Generate a new one, update `.env.prod`, then `ALTER USER husn WITH PASSWORD '...'` in psql, then `dc up -d` |
| `SESSION_SECRET` | `.env.prod` | Replace + redeploy. Invalidates all sessions. |
| `TOKEN_ENCRYPTION_KEY` | `.env.prod` | **Don't rotate casually** — it decrypts stored OAuth refresh tokens. Rotating means every user has to re-auth. |
| `GROQ_API_KEY` | `.env.prod` | Rotate in <https://console.groq.com>, paste new value, redeploy. |
| `ANTHROPIC_API_KEY` | `.env.prod` | Rotate in <https://console.anthropic.com>, paste new value, redeploy. |
| OAuth client secrets | `.env.prod` | Rotate in each provider's developer console. |

`.env.prod` is `chmod 600 root:root`. Don't copy it anywhere; if you need to share
it again with another teammate, use 1Password Send or a similar one-time-link
tool — never email / Slack / chat.

---

## 8 · Troubleshooting

**Caddy can't get a cert.** Almost always DNS — `dig app.<your-domain> +short`
must return `<SERVER_IP>` before Caddy will get past Let's Encrypt's
http-01 challenge. Check `docker logs caddy` for the error.

**`ConnectError: Temporary failure in name resolution` in worker logs.** The
worker container isn't on the `edge` network. Confirm `docker-compose.prod.yml`
has both `edge` and `internal` under `worker.networks` — this was a real bug,
fixed in commit `327f068`.

**`/health` is fine but `/` (browser) shows "API URL not configured".**
`NEXT_PUBLIC_API_URL` must be passed as a **build arg** (Next inlines it at
build time, runtime env doesn't reach the browser). `docker-compose.prod.yml`
already does this — just make sure you rebuild after changing `DOMAIN_API`.

**Briefing always shows "All clear" with nothing.** Either you have no findings
yet (normal until backfills run), or the API is unreachable from the SSR
process. Tail `dc logs web` and look for fetch errors. The Briefing page
intentionally fails open with "All clear" today — verify with
`curl https://api.<your-domain>/api/findings?status=open` from your laptop.

**Auto-deploy hasn't picked up a commit.** Tail
`/var/log/husn-auto-deploy.log` on the server. If empty, the cron isn't
installed — re-run `./scripts/install-auto-deploy.sh`.

---

## 9 · What to read next

- `DEPLOY.md` — the long-form deploy plan (Wave 0 → Wave 1 → Wave 2)
- `PROGRESS.md` — living state log
- `plan.md` — strategic build plan
- `knowledge.md` — architecture decisions (esp. §11)
- `docs/oauth-production.md` — per-provider OAuth callback checklist

Welcome aboard.
