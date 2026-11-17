/**
 * In-memory round store.
 *
 * Holds all per-round state for the lifetime of the Render process:
 * config (public-safe), redaction terms (private, env-sourced), responses,
 * status, and the assembled board. No database — fine for a single-day event.
 */

const fs = require("fs");
const path = require("path");
const { parseTermsEnv } = require("./redact");

const STATUSES = ["pending", "open", "closed", "clustered"];

function loadRoundsConfig() {
  const configPath = path.join(__dirname, "..", "rounds.config.json");
  const raw = fs.readFileSync(configPath, "utf-8");
  return JSON.parse(raw);
}

function buildStore() {
  const configs = loadRoundsConfig();
  const store = new Map();

  configs.forEach((cfg, idx) => {
    const envKey = `REDACT_ROUND_${idx + 1}`;
    const redactionTerms = parseTermsEnv(process.env[envKey]);

    store.set(cfg.id, {
      config: cfg, // public-safe: id, label, question, fallback_list
      redactionTerms, // private: never exposed via any API response
      responses: [], // [{ text, submitted_at }]
      status: "pending",
      board: null, // { clusters, excluded_count, board: [...] } once clustered
    });
  });

  return store;
}

const store = buildStore();

function getRound(id) {
  return store.get(id);
}

function listRoundSummaries() {
  return [...store.values()].map((r) => ({
    id: r.config.id,
    label: r.config.label,
    status: r.status,
    response_count: r.responses.length,
    board_ready: !!r.board,
  }));
}

function publicRoundInfo(id) {
  const r = getRound(id);
  if (!r) return null;
  return { id: r.config.id, label: r.config.label, question: r.config.question, status: r.status };
}

module.exports = { getRound, listRoundSummaries, publicRoundInfo, STATUSES };
