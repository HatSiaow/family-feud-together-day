/**
 * Server-side denylist redaction.
 *
 * De-identification requirement: client-identifying terms must never be
 * stored or forwarded to the LLM in identifiable form. Redaction happens
 * immediately on receipt, before anything is persisted or sent onward.
 *
 * Terms come from REDACT_ROUND_<n> environment variables (comma-separated),
 * never from rounds.config.json, and are never exposed via any API response.
 */

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a single case-insensitive regex that matches any of the given terms,
 * longest terms first so "Commonwealth Bank" is matched before "Bank" alone
 * would partially consume it.
 */
function buildRedactionRegex(terms) {
  const cleaned = terms
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .sort((a, b) => b.length - a.length);

  if (cleaned.length === 0) return null;

  const pattern = cleaned.map(escapeRegExp).join("|");
  return new RegExp(`\\b(?:${pattern})\\b`, "gi");
}

/**
 * Redact any configured term in `text`, replacing matches with "[client]".
 * Returns { text, redacted } where `redacted` is true if any replacement
 * occurred (useful for internal audit logging only — never shown on stage).
 */
function redactText(text, terms) {
  if (!text) return { text: text || "", redacted: false };
  const regex = buildRedactionRegex(terms || []);
  if (!regex) return { text, redacted: false };

  let redacted = false;
  const out = text.replace(regex, () => {
    redacted = true;
    return "[client]";
  });
  return { text: out, redacted };
}

/** Parse "CBA, Commonwealth Bank,Commbank" -> ["CBA","Commonwealth Bank","Commbank"] */
function parseTermsEnv(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

module.exports = { redactText, parseTermsEnv, buildRedactionRegex };
