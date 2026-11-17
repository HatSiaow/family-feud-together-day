require("dotenv").config();

const express = require("express");
const path = require("path");
const QRCode = require("qrcode");

const { getRound, listRoundSummaries, publicRoundInfo } = require("./src/rounds");
const { redactText } = require("./src/redact");
const { clusterWithDeepSeek } = require("./src/deepseek");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// Admin auth (single-operator design — one shared token, no accounts/roles)
// ---------------------------------------------------------------------------
function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) return next(); // no token configured -> open (local dev only)
  const token = req.header("X-Admin-Token");
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: "unauthorized" });
  next();
}

// ---------------------------------------------------------------------------
// Audience-facing pages
// ---------------------------------------------------------------------------
app.get("/r/:roundId", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "submit.html"));
});

app.get("/display/:roundId", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "display.html"));
});

app.get("/host", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "host.html"));
});

// ---------------------------------------------------------------------------
// Public API (safe subset — no fallback list, no redaction terms, no source/count)
// ---------------------------------------------------------------------------
app.get("/api/rounds/:id/public", (req, res) => {
  const info = publicRoundInfo(req.params.id);
  if (!info) return res.status(404).json({ error: "round not found" });
  res.json(info);
});

app.post("/api/rounds/:id/submit", (req, res) => {
  const round = getRound(req.params.id);
  if (!round) return res.status(404).json({ error: "round not found" });
  if (round.status !== "open") {
    return res.status(409).json({ error: "round is not currently open for submissions" });
  }

  const raw = (req.body && req.body.text ? String(req.body.text) : "").trim();
  if (!raw) return res.status(400).json({ error: "empty response" });
  const text = raw.slice(0, 200);

  // De-identification: redact before anything is stored.
  const { text: safeText } = redactText(text, round.redactionTerms);

  round.responses.push({ text: safeText, submitted_at: new Date().toISOString() });
  res.json({ ok: true, count: round.responses.length });
});

/** Public-safe board view: only revealed labels, never source/count. */
app.get("/api/rounds/:id/display-board", (req, res) => {
  const round = getRound(req.params.id);
  if (!round) return res.status(404).json({ error: "round not found" });
  if (!round.board) return res.json({ status: round.status, rows: null });

  const rows = round.board.board.map((row) => ({
    rank: row.rank,
    label: row.revealed ? row.label : null,
    revealed: row.revealed,
  }));
  res.json({ status: round.status, rows });
});

// ---------------------------------------------------------------------------
// Host/admin API
// ---------------------------------------------------------------------------
app.get("/api/rounds", requireAdmin, (req, res) => {
  res.json(listRoundSummaries());
});

app.get("/api/rounds/:id/qr", requireAdmin, async (req, res) => {
  const round = getRound(req.params.id);
  if (!round) return res.status(404).json({ error: "round not found" });
  const url = `${BASE_URL}/r/${round.config.id}`;
  try {
    const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 320 });
    res.json({ url, dataUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/rounds/:id/open", requireAdmin, (req, res) => {
  const round = getRound(req.params.id);
  if (!round) return res.status(404).json({ error: "round not found" });
  round.status = "open";
  res.json({ ok: true, status: round.status });
});

app.post("/api/rounds/:id/close", requireAdmin, async (req, res) => {
  const round = getRound(req.params.id);
  if (!round) return res.status(404).json({ error: "round not found" });
  if (round.status !== "open") {
    return res.status(409).json({ error: "round is not open" });
  }
  round.status = "closed";

  try {
    const result = await clusterWithDeepSeek({
      question: round.config.question,
      fallbackList: round.config.fallback_list,
      responses: round.responses.map((r) => r.text),
    });
    round.board = result;
    round.status = "clustered";
    res.json({ ok: true, status: round.status, board: round.board });
  } catch (e) {
    round.status = "open"; // re-open so host can retry or collect more responses
    res.status(500).json({ error: `clustering failed: ${e.message}` });
  }
});

app.get("/api/rounds/:id/board", requireAdmin, (req, res) => {
  const round = getRound(req.params.id);
  if (!round) return res.status(404).json({ error: "round not found" });
  res.json({ status: round.status, board: round.board });
});

app.post("/api/rounds/:id/reveal/:rank", requireAdmin, (req, res) => {
  const round = getRound(req.params.id);
  if (!round || !round.board) return res.status(404).json({ error: "round/board not found" });
  const rank = Number(req.params.rank);
  const row = round.board.board.find((r) => r.rank === rank);
  if (!row) return res.status(404).json({ error: "row not found" });
  row.revealed = true;
  res.json({ ok: true, board: round.board });
});

app.post("/api/rounds/:id/reset", requireAdmin, (req, res) => {
  const round = getRound(req.params.id);
  if (!round) return res.status(404).json({ error: "round not found" });
  round.responses = [];
  round.board = null;
  round.status = "pending";
  res.json({ ok: true });
});

app.get("/api/rounds/:id/responses", requireAdmin, (req, res) => {
  const round = getRound(req.params.id);
  if (!round) return res.status(404).json({ error: "round not found" });
  res.json({
    responses: round.responses,
    clusters: round.board ? round.board.clusters : null,
    excluded_count: round.board ? round.board.excluded_count : null,
  });
});

app.listen(PORT, () => {
  console.log(`Together Day Feud server listening on port ${PORT}`);
  console.log(`BASE_URL=${BASE_URL}`);
  if (!process.env.DEEPSEEK_API_KEY) {
    console.log("WARNING: DEEPSEEK_API_KEY not set — using naive local clustering fallback (dev only).");
  }
  if (!ADMIN_TOKEN) {
    console.log("WARNING: ADMIN_TOKEN not set — host/admin API is unauthenticated (dev only).");
  }
});
