# Staging environment + dev workflow

A second, isolated stack on the **same box** as prod so you can build features
without touching the live URL.

| | URL | Branch | Compose project | DB/Redis |
|---|---|---|---|---|
| **prod** | app.husn.io / api.husn.io | `main` | `husn` | `husn_*` volumes |
| **staging** | staging.husn.io / api-staging.husn.io | `staging` | `husn-staging` | `husn-staging_*` volumes (separate!) |

The prod Caddy stays the single entrypoint; it reverse-proxies the staging
subdomains to the staging containers (published on `127.0.0.1:3001` / `:8001`).
Staging has its **own database** — a bad migration on staging can never touch
prod.

## Branch workflow (the day-to-day)

1. `git checkout -b feat/whatever` off `main`; build the feature.
2. Merge/push to **`staging`** → the staging box auto-deploys → test on
   `staging.husn.io`.
3. When happy, open a PR `staging` → **`main`** → prod auto-deploys.

Never push WIP straight to `main` — that's the live site.

---

## One-time setup (do this once)

### 1. DNS (registrar)
Add A records → the box's public IP:
```
staging.husn.io       A   <BOX_IP>
api-staging.husn.io   A   <BOX_IP>
```

### 2. Separate integrations (so staging can't disturb prod)
- **Slack:** a separate Slack app (or a test workspace). Set its OAuth redirect,
  Events Request URL (`https://api-staging.husn.io/slack/events`) and
  Interactivity URL (`https://api-staging.husn.io/slack/interactivity`).
- **Google / Microsoft / Jira:** add the `https://api-staging.husn.io/auth/<p>/callback`
  redirect URIs (to the same apps, or separate staging apps).
- **Groq:** a separate API key (so staging never spends prod's daily token cap).

### 3. Box: create the staging checkout
```bash
git clone <repo-url> ~/husn-staging
cd ~/husn-staging && git checkout staging
cp ~/husn/.env.prod .env.staging      # start from prod, then override:
$EDITOR .env.staging                  # set the values from .env.staging.example
chmod 600 .env.staging
```

### 4. First staging deploy
```bash
cd ~/husn-staging && ./scripts/deploy-staging.sh
```
This brings up the staging stack on `127.0.0.1:3001` (web) and `:8001` (api),
runs migrations against the **staging** DB, and smoke-checks it.

### 5. Point the prod Caddy at staging (the only prod-touching change)
**a.** In `docker-compose.prod.yml`, add to the `caddy` service so it can reach
the host ports:
```yaml
    extra_hosts:
      - "host.docker.internal:host-gateway"
```
**b.** Append to `Caddyfile`:
```caddyfile
# ---------- staging.husn.io ----------
staging.husn.io {
	import security_headers
	encode zstd gzip
	reverse_proxy host.docker.internal:3001 {
		header_up X-Real-IP {remote_host}
		header_up X-Forwarded-For {remote_host}
		header_up X-Forwarded-Proto {scheme}
		header_up X-Forwarded-Host {host}
		flush_interval -1
		transport http { read_timeout 5m  write_timeout 5m }
	}
}
# ---------- api-staging.husn.io ----------
api-staging.husn.io {
	import security_headers
	encode zstd gzip
	@oauth_callback path_regexp ^/auth/[^/]+/callback
	header @oauth_callback Cache-Control "no-store"
	reverse_proxy host.docker.internal:8001 {
		header_up X-Real-IP {remote_host}
		header_up X-Forwarded-For {remote_host}
		header_up X-Forwarded-Proto {scheme}
		header_up X-Forwarded-Host {host}
		flush_interval -1
		transport http { read_timeout 5m  write_timeout 5m }
	}
}
```
**c.** Apply (do this AFTER step 1's DNS resolves, so Caddy can issue certs):
```bash
cd ~/husn && ./scripts/deploy.sh        # recreates caddy with the new routes
```
Commit these two prod-file edits to `main` once verified, so they survive future
deploys.

### 6. Install the staging auto-deploy cron (root crontab)
```
*/2 * * * * /home/<user>/husn-staging/scripts/auto-deploy-staging.sh
```

## Verify
```bash
curl -fsS https://api-staging.husn.io/health/lite      # {"status":"ok",...}
curl -fsS https://staging.husn.io/healthz
```

## Notes
- Resource: two full stacks on an 8 GB box is tight; staging limits are smaller
  (see docker-compose.staging.yml). Watch `docker stats` after first bring-up.
- Staging cookies are host-only (`COOKIE_DOMAIN=` empty) so a staging session is
  never sent to prod.
