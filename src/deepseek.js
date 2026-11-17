/**
 * DeepSeek clustering + fallback-fill client.
 *
 * Single LLM call per round: given the redacted audience responses and the
 * round's (fully generic) fallback list, return ranked semantic clusters
 * plus an assembled 5-row board that fills gaps from the fallback list only
 * when fewer than 5 organic clusters exist.
 *
 * If DEEPSEEK_API_KEY is not set, falls back to a naive local clustering
 * heuristic (exact-match grouping) so the pipeline is still testable without
 * API credits during development. Set the key before the real event.
 */

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const MIN_CLUSTER_THRESHOLD = 2;

function buildSystemPrompt() {
  return `You are helping run a live "guess the top answers" game at an internal company event.

You will be given:
- a single question that was asked to an audience
- a list of anonymous short free-text audience responses to that question
- a pre-approved fallback list of plausible generic answers for the same question

Your job:
1. Group the audience responses into semantically distinct answer categories (merge paraphrases of the same idea into one category).
2. Count how many responses map to each category. Rank categories by count, highest first.
3. A category counts as "organic" only if it has at least ${MIN_CLUSTER_THRESHOLD} supporting responses. Drop categories with fewer supporting responses than that.
4. If 5 or more organic categories remain, return only the top 5 as the board.
5. If fewer than 5 organic categories remain, keep all real organic categories (ranked), then fill the remaining slots up to 5 using items from the supplied fallback list, in the order given. Skip any fallback item that semantically duplicates an already-included organic category.
6. Never invent an answer that isn't grounded in either the audience responses or the fallback list.
7. Treat the literal text "[client]" appearing in any response as an already-redacted placeholder for a company/client name. Never attempt to guess, infer, or reproduce an actual company or client name in any cluster label or board output, even if the surrounding context seems to imply one.
8. Exclude spam, nonsense, or offensive responses from clustering entirely. Do not create a "junk" category for them — just count how many were excluded.
9. Output strict JSON only, matching exactly this schema, with no prose before or after:

{
  "clusters": [{ "label": string, "count": number, "example_quotes": string[] }],
  "excluded_count": number,
  "board": [{ "rank": number, "label": string, "source": "organic" | "fallback", "count": number | null }]
}

The "board" array must have exactly 5 entries, ranked 1 through 5.`;
}

function buildUserPayload({ question, fallbackList, responses }) {
  return JSON.stringify(
    {
      question,
      fallback_list: fallbackList,
      responses,
      min_cluster_threshold: MIN_CLUSTER_THRESHOLD,
    },
    null,
    2
  );
}

async function clusterWithDeepSeek({ question, fallbackList, responses }) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return naiveLocalFallback({ question, fallbackList, responses });
  }

  const body = {
    model: "deepseek-chat",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPayload({ question, fallbackList, responses }) },
    ],
  };

  const res = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`DeepSeek API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek API returned no content");

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error(`Failed to parse DeepSeek JSON output: ${e.message}`);
  }

  return sanitizeResult(parsed, fallbackList);
}

/** Code-side safety net: enforce exactly 5 rows, no duplicate labels, valid sources. */
function sanitizeResult(result, fallbackList) {
  const clusters = Array.isArray(result.clusters) ? result.clusters : [];
  let board = Array.isArray(result.board) ? result.board.slice(0, 5) : [];

  const seen = new Set();
  board = board.filter((row) => {
    const key = (row.label || "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Top up from fallback list if the model returned fewer than 5 valid rows.
  let fallbackIdx = 0;
  while (board.length < 5 && fallbackIdx < fallbackList.length) {
    const candidate = fallbackList[fallbackIdx];
    fallbackIdx += 1;
    const key = candidate.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    board.push({ rank: board.length + 1, label: candidate, source: "fallback", count: null });
  }

  board = board.slice(0, 5).map((row, idx) => ({
    rank: idx + 1,
    label: row.label,
    source: row.source === "organic" ? "organic" : "fallback",
    count: row.source === "organic" && Number.isFinite(row.count) ? row.count : null,
    revealed: false,
  }));

  return {
    clusters,
    excluded_count: Number.isFinite(result.excluded_count) ? result.excluded_count : 0,
    board,
  };
}

/**
 * Dev-only heuristic used when no DEEPSEEK_API_KEY is configured: groups
 * exact-match (case-insensitive, trimmed) responses, ranks by count, tops up
 * from the fallback list. No semantic merging of paraphrases — just enough
 * to exercise the pipeline end-to-end locally.
 */
function naiveLocalFallback({ fallbackList, responses }) {
  const counts = new Map();
  for (const r of responses) {
    const key = r.trim().toLowerCase();
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const clusters = [...counts.entries()]
    .map(([label, count]) => ({ label, count, example_quotes: [label] }))
    .filter((c) => c.count >= MIN_CLUSTER_THRESHOLD)
    .sort((a, b) => b.count - a.count);

  const result = {
    clusters,
    excluded_count: 0,
    board: clusters.slice(0, 5).map((c, idx) => ({
      rank: idx + 1,
      label: c.label,
      source: "organic",
      count: c.count,
    })),
  };

  return sanitizeResult(result, fallbackList);
}

module.exports = { clusterWithDeepSeek };
