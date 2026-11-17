# Runbook — Together Day Live Feud Showcase

How to actually run this: local testing, deploying, and operating it live on the day. You are the sole operator (organizer + AV).

## ⚠️ Important finding: DeepSeek is blocked on the Deloitte corporate network

Testing locally confirmed **Deloitte's Zscaler policy explicitly blocks `api.deepseek.com`** with the reason *"Not allowed the use of this AI/ML site."* This is a corporate security block, not a technical bug — a valid API key and correct TLS config won't get past it.

**This does not break the event.** The real clustering call happens from **Render's servers** once deployed, not from your corporate laptop — that's exactly why Render hosting was chosen (see `QR LLM Pipeline Architecture.md`): LLM traffic never routes through the corporate network at all. Your laptop only ever talks to the Render-hosted app over normal HTTPS (not an AI/ML-categorized domain), which Zscaler does not block.

**Practical implications:**
- You **cannot** verify the real DeepSeek clustering call by running `node server.js` on your own corporate laptop/network — it'll fail with the Zscaler block page, not a useful error.
- You **can** fully test everything else locally (submission flow, redaction, fallback-fill logic, reveal mechanics) — the server falls back to a naive local clustering heuristic automatically when it can't reach DeepSeek, so the rest of the pipeline is still testable.
- **You must verify the real clustering call against the deployed Render instance** (Step 3 below) before trusting it on the day — don't assume it "just works" because local testing passed.
- If your venue wifi/guest network is also behind the same corporate Zscaler policy, that's irrelevant here too — only your own device's submissions to DeepSeek would be blocked, and your device never calls DeepSeek directly in this architecture.

## 1. One-time local setup (already done, for reference)

```bash
cd together-day-feud
cp .env.example .env     # then fill in ADMIN_TOKEN, DEEPSEEK_API_KEY, REDACT_ROUND_1
npm install
```

`.npmrc` already points at `~/zscaler-root.pem` for npm's own CA trust — needed once per machine, already configured in this project.

## 2. Local testing (safe to do anytime, won't touch DeepSeek successfully)

```bash
NODE_EXTRA_CA_CERTS=~/zscaler-root.pem npm start
```

(The `NODE_EXTRA_CA_CERTS` prefix matters for any *other* outbound HTTPS call Node makes — doesn't help with the DeepSeek block itself, but keep it for consistency/any future non-blocked API calls.)

Then in a browser:
- `http://localhost:3000/host` → enter your `ADMIN_TOKEN` → click **Open / Show QR** on Round 1
- `http://localhost:3000/r/round-1` → submit a few test answers (try typing the real client name — confirm it gets redacted; check via the admin `responses` endpoint)
- Click **Close & Cluster** on the host panel → expect either a DeepSeek error (Zscaler block, expected locally) or the naive fallback board if `DEEPSEEK_API_KEY` isn't set for this test run
- `http://localhost:3000/display/round-1` → confirm hidden rows, then click **Reveal** per row on the host panel and watch the display update live

Use **Reset** on the host panel between test runs to clear a round's state.

## 3. Deploy to Render (required before the real clustering call can be verified)

1. Push the project to a git repo (GitHub/GitLab). `.env` is gitignored — your real API key and redaction terms never get committed.
2. Render → **New → Web Service** → connect the repo.
   - Build command: `npm install`
   - Start command: `npm start`
3. In Render's dashboard, set environment variables (not in any committed file):
   - `ADMIN_TOKEN`
   - `DEEPSEEK_API_KEY`
   - `BASE_URL` → the Render URL, once assigned (e.g. `https://together-day-feud.onrender.com`) — redeploy after setting this so QR codes point correctly
   - `REDACT_ROUND_1`, `REDACT_ROUND_2`, `REDACT_ROUND_3`
4. **Use a paid/always-on plan**, not free tier (free tier spin-down risk — see §6 below).
5. Once deployed, repeat the test flow from §2 but against the Render URL instead of localhost. **This is the real verification step** — confirm Close & Cluster returns a genuinely clustered board (not an error, not just the fallback-only board unless you intentionally tested with <2 matching responses).

## 4. Day-of runbook (per round)

Run this sequence for each of the 3 teams, back-to-back:

1. **Before the team's showcase starts**: on `/host`, click **Show QR** for that round — this fetches and displays the QR code (doesn't open submissions yet). Have it ready to project.
2. **Team gives their ~5 min showcase.**
3. **Click Open** on the host panel for that round, and project/display the QR code + read the question aloud.
4. **Wait ~60-90 seconds** while the audience scans and submits. Watch the live response counter on the host panel.
5. **Click Close & Cluster.** This closes submissions and immediately calls DeepSeek — should return in a few seconds. The resulting board (with `source`/`count` visible) appears only on your host panel, never on the public display yet.
6. **~2-3 min buffer**: do your transition banter / intro the reveal round while the board sits ready.
7. **Switch the public screen to `/display/:roundId`** for that round (if not already showing it).
8. **Reveal round**: as the contestant guesses correctly, click **Reveal** next to the matching row on your host panel — it flips live on the public display. Apply the 3-strikes rule yourself as host.
9. Move to the next team and repeat from step 1 for the next round.

## 5. If something breaks live (fallback plan)

- **DeepSeek call fails or times out during Close & Cluster**: the host panel will show an error and the round reopens for submissions — you can retry Close & Cluster once things settle, or:
- **Manual Plan B**: have the fully pre-built fallback-only board for each round ready as a plain slide/printout. If the live pipeline fails entirely, narrate the reveal manually from that prepared list instead of the live display.
- **Render instance unresponsive**: check if it's a cold-start delay (see §6) — give it ~30-60s and retry. If still down, fall back to Plan B.

## 6. Cold-start / "wake up ping" question

This was flagged as an open item — now answerable:

- **If you're on Render's free tier**, the instance spins down after ~15 minutes of inactivity and takes 30-60s to wake on the next request — bad if that first request is your Round 1 "Close & Cluster" in front of a live room.
- **Recommended**: upgrade to a paid Render plan that stays always-on, avoiding this entirely. This also matters for the DeepSeek verification step in §3 — you don't want cold-start latency confusing a timing test.
- **If staying on free tier for any reason**: send a simple warm-up request (e.g., open `https://your-app.onrender.com/host` in a browser tab) 5-10 minutes before the event starts, and again during any long gap between rounds, to keep the instance awake.

## Quick reference

| Action | Where |
|---|---|
| Show/open a round, monitor responses, cluster, reveal | `/host` (needs `ADMIN_TOKEN`) |
| Audience submission page (what the QR points to) | `/r/:roundId` |
| Public reveal screen (project this on the big screen) | `/display/:roundId` |
| Raw response + clustering audit log (debugging only) | `GET /api/rounds/:id/responses` (admin) |
