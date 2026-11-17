# Together Day — Live Feud Showcase

Live QR-code survey + LLM semantic clustering + director-approved fallback-fill, feeding a Feud-style reveal board for Together Day project spotlights.

Architecture decisions and rationale live in the Obsidian vault:
`20-Projects/Together Day/QR LLM Pipeline Architecture.md`

## How it works

1. A team gives their ~5 min showcase.
2. Host clicks **Open / Show QR** on `/host` — displays a QR code pointing audience phones to `/r/:roundId`.
3. Audience scans and submits free-text answers (~60-90s window).
4. Host clicks **Close & Cluster** — submissions close, responses are sent to DeepSeek for semantic clustering, with generic fallback answers filling any gap below 5 organic clusters.
5. Host reveals rows live on `/host` as the contestant guesses correctly; `/display/:roundId` (big screen) flips each row in real time.

De-identification is built in: round config/questions/fallback answers are fully generic (no client name), and any client-identifying term typed by the audience is redacted server-side (`REDACT_ROUND_n` env vars) before it's stored or sent to the LLM.

## Project layout

```
server.js            Express app + all API routes
src/rounds.js         In-memory round store, loads rounds.config.json + redaction env vars
src/redact.js         Denylist redaction utility
src/deepseek.js       DeepSeek clustering + fallback-fill call (+ naive local dev fallback)
rounds.config.json    Public-safe round config (generic questions + generic fallback lists) — OK to commit
public/submit.html    Audience-facing submission page (served at /r/:roundId)
public/display.html   Public reveal screen (served at /display/:roundId)
public/host.html      Host control panel (served at /host)
.env.example          Template for required environment variables
```

## Local development

```bash
cp .env.example .env
# edit .env: set ADMIN_TOKEN, DEEPSEEK_API_KEY, REDACT_ROUND_1 (real client terms, never commit)
npm install
npm start
```

Then open:
- `http://localhost:3000/host` — host control panel (enter your `ADMIN_TOKEN`)
- `http://localhost:3000/r/round-1` — simulates the audience submission page
- `http://localhost:3000/display/round-1` — simulates the big-screen reveal

**Without `DEEPSEEK_API_KEY` set**, the server uses a naive local exact-match clustering fallback — enough to exercise the full pipeline end-to-end locally, but it won't semantically merge paraphrased answers the way DeepSeek will. Set the real key before the event.

### Corporate network note (Zscaler / corporate CA)

If `npm install` hangs on a corporate machine, it's almost certainly because npm doesn't automatically trust the corporate root CA the way `curl`/browsers do. This repo's `.npmrc` already points `cafile` at `~/zscaler-root.pem` — adjust that path if your corporate cert lives elsewhere.

## Deploying to Render

1. Push this project to a Git repo (GitHub/GitLab) — `.env` is gitignored, so real redaction terms and API keys never get committed.
2. In Render: **New → Web Service**, connect the repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Set environment variables in the Render dashboard (not in a committed file):
   - `ADMIN_TOKEN` — your host-panel passcode
   - `DEEPSEEK_API_KEY` — your DeepSeek API key
   - `BASE_URL` — the Render-assigned URL once known (e.g. `https://together-day-feud.onrender.com`) — needed so generated QR codes point to the right place
   - `REDACT_ROUND_1`, `REDACT_ROUND_2`, `REDACT_ROUND_3` — comma-separated client-identifying terms per round (real client name/aliases — enter directly in Render's dashboard, never in a committed file)
5. Use a **paid/always-on plan**, not the free tier — free instances spin down after inactivity, which would add cold-start latency right when you click "Close & Cluster" for the first round of the day. (We flagged this as something to test — see Pre-Event Checklist below.)
6. Before the event: edit `rounds.config.json` with the real (generic) question text + fallback list for Round 2 and Round 3 once those spotlights are confirmed, and set each round's real `REDACT_ROUND_n` terms in Render's dashboard.

## Pre-Event Checklist

- [ ] Confirm Round 2 / Round 3 spotlights, fill in their `rounds.config.json` fallback lists (generic wording) and `REDACT_ROUND_2` / `REDACT_ROUND_3` terms
- [ ] Set real `ADMIN_TOKEN` and `DEEPSEEK_API_KEY` in Render
- [ ] Set `BASE_URL` to the final Render URL and redeploy so QR codes are correct
- [ ] **Test for cold-start delay**: hit the deployed URL a few minutes before the event starts to "wake" the instance; confirm the plan doesn't spin down mid-event
- [ ] Rehearse the full flow once with dummy responses, including a deliberate attempt to type the real client name, to confirm redaction works
- [ ] Test the deployed URL from the actual venue wifi/network beforehand
- [ ] Prepare a manual fallback-only board slide per round as Plan B
- [ ] Print/display QR codes (generate from `/host` → "Show QR" per round, or fetch `GET /api/rounds/:id/qr` ahead of time)
