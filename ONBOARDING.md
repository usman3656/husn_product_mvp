# Husn — Onboarding

You're working on the same codebase, against the same production server
(Hetzner CX32 behind `app.husn.io` / `api.husn.io`). Nothing new to stand up —
just get your laptop wired in.

## What you need first

1. **GitHub access.** Either push access to `usman3656/husn_product_mvp`, or
   fork it and clone your fork. Either works — `main` is what auto-deploys.
2. **Your SSH pubkey added to the server.** Send your `~/.ssh/id_*.pub` (the
   `.pub` one — never the private key) to whoever holds root on the box, and
   they'll append it to `/root/.ssh/authorized_keys`.
3. **(Optional) `.env.prod`** — only if you'll run the full prod stack on your
   own machine. Get it from 1Password / Bitwarden, not chat. For day-to-day
   coding you don't need it.

## 1 — Clone

```bash
git clone https://github.com/usman3656/husn_product_mvp.git husn
cd husn
```

(Or `git clone https://github.com/<your-fork>/husn_product_mvp.git husn` if
you forked.)

## 2 — Wire up SSH to the production box

```bash
bash scripts/init-mac-ssh.sh
```

That writes `~/.ssh/config` with a `husn` Host alias pointing at the live
server. It does **not** pin a specific private key — ssh will try every
`~/.ssh/id_*` you have. Test it:

```bash
ssh husn
```

You should land in a root shell on the prod box. If you get
`Permission denied (publickey)`, your pubkey hasn't been added to the server
yet — go back to "What you need first" step 2.

## 3 — Install the deploy wrapper (recommended)

```bash
bash scripts/init-mac-deploy.sh
# open a NEW terminal window after this (so PATH picks up ~/.local/bin)
husn-deploy
```

`husn-deploy` runs `git pull && deploy.sh` on the server and drops you into an
interactive shell on the box. Use it whenever you want to force a redeploy
without waiting on the auto-deploy cron.

## 4 — Day-to-day

```bash
# code, then:
git add <files>
git commit -m "what changed"
git push origin main
# auto-deploy on the server picks it up within ~2 minutes
```

To force-redeploy, debug, or peek at logs:

```bash
husn-deploy                                              # one-shot redeploy
ssh husn                                                 # interactive shell
ssh husn 'cd ~/husn && ./scripts/diag.sh'                # diagnostic dump
ssh husn 'cd ~/husn && docker compose -f docker-compose.prod.yml \
  --env-file .env.prod logs -f api'                      # tail any service
```

## 5 — Local dev (optional)

```bash
cp .env.example .env
# put your own GROQ_API_KEY / ANTHROPIC_API_KEY in .env (not prod keys)
docker compose up --build
```

- App: <http://localhost:3000>
- API: <http://localhost:8000/health>

## 6 — What's live for you to explore

Once you're on `https://app.husn.io` (or `http://localhost:3000` locally), the
side-nav has six destinations:

- **Briefing** (`/`) — homepage. Six sections ranked by consequence.
- **Ask Husn** (`/ask`) — document Q&A; cites sources.
- **Explore** (`/explore`) — seven lenses (Projects · Teams · Risks · Ownership · Dependencies · Decisions · Resolved).
- **Organization** (`/organization`) — the digital twin: Workstreams + People × Workstreams matrix + Decision network.
- **Connections** (`/connections`) — every source with a Show files toggle (read / fetched per file).
- **Settings** (`/settings`) — workspace, briefing cadence, legal.

Top-left of the side-nav footer is the **Light / Auto / Dark theme toggle.**

Cross-cutting: **Reach Out For Me** — purple button wherever Husn surfaces uncertainty. Opens a modal with the person, the reason, a draft message, and a Send. Click it on the Briefing hero to see what it does.

## That's the whole loop.

The server, DNS, certs, OAuth callbacks, secrets, auto-deploy cron — all
already configured. You don't change any of them. If something is broken,
read `DEPLOY.md` / `PROGRESS.md`; for context, `README.md` / `plan.md`.
