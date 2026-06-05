# Husn — Onboarding

You're going to work on the same codebase, with access to the same production
server (Hetzner CX32, behind `app.husn.io` / `api.husn.io`). You don't need to
stand anything new up — just get your laptop wired to it.

## What you need from the team before starting

1. **Push access to the GitHub repo** (or your fork pointed at the same `main`).
2. **The `.env.prod` file**, sent over 1Password / Bitwarden — not Slack/email.
   Drop it at the repo root and `chmod 600 .env.prod`. You only need this if
   you'll run prod locally; for day-to-day you don't open it.
3. **The SSH key** the server accepts (or have someone add yours to
   `/root/.ssh/authorized_keys`).

## 1 — Clone

```bash
git clone https://github.com/usman3656/husn_product_mvp.git husn
cd husn
```

## 2 — Wire up SSH to the production box

One command from your Mac:

```bash
bash scripts/init-mac-ssh.sh
```

That writes `~/.ssh/config` with a `husn` Host alias pointing at the live
server. Test it:

```bash
ssh husn        # drops you into a root shell on the prod box
```

## 3 — Install the deploy wrapper (optional but nice)

```bash
bash scripts/init-mac-deploy.sh
```

Adds `husn-deploy` to your `PATH`. Running it from anywhere does
`git pull && deploy.sh` on the server.

## 4 — That's it. Day-to-day:

```bash
# Make code changes locally, push to main
git add <files> && git commit -m "..." && git push origin main

# Auto-deploy cron picks it up within ~2 minutes.
# If you want to force-redeploy:
husn-deploy

# Or jump on the box:
ssh husn
cd ~/husn
./scripts/deploy.sh        # rebuild + redeploy
./scripts/diag.sh          # one-shot diagnostic dump
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f api    # tail any service
```

## 5 — Want to iterate locally too? (optional)

```bash
cp .env.example .env
# put your own GROQ_API_KEY / ANTHROPIC_API_KEY in .env — don't use prod keys
docker compose up --build
```

- App: <http://localhost:3000>
- API: <http://localhost:8000/health>

That's all. There is no separate setup for you — the server, DNS, certs,
secrets, and OAuth callbacks are already configured.

For the deeper context: `README.md`, `DEPLOY.md`, `PROGRESS.md`, `plan.md`.
