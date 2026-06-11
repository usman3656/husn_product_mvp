# Watch the UI submit hit the API

Two terminals — first one streams the API logs live, second is your browser.

## Terminal: start the log tail (leave it running)

```bash
ssh husn 'cd ~/husn && docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f --tail=5 api 2>&1 | grep -E "magic|POST /auth"'
```

## Now in your browser
- Open `https://app.husn.io/login` in a **fresh incognito window**.
- Open DevTools (⌥⌘I) → **Network** tab, leave it open.
- Type `usman120ghani@gmail.com` → click "Send sign-in link".
- Whatever appears in the API-logs terminal AND in DevTools → Network for the `magic` row, paste here.

## What I'll do based on what you paste

| What you see in logs | Diagnosis |
|---|---|
| `POST /auth/login/magic ... 200` AND `magic_link.sent` | API worked, Resend accepted. Email is delivered → check Resend → Emails dashboard for the row |
| `POST /auth/login/magic ... 200` AND `magic_link.send_failed` | Resend rejected — error in the log tells me which |
| `POST /auth/login/magic ... 403` | CSRF check rejected the request — I'll fix headers |
| Nothing appears | Browser request never reached the API. DevTools Network row will show why (CORS error, network error, 4xx). Paste the row's Status + Response |
| Browser shows red "Could not send the link" but API logs show 200 | Frontend `.ok` check bug; I'll fix |
