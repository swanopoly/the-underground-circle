// Oversized client tool-result content is now SUMMARIZED — head + tail kept
// verbatim (line-boundary-snapped) with error-signal lines surfaced from the
// omitted middle — via summarizeToolResultForModel, a Deno LOCKSTEP mirror of
// the client core src/lib/toolResultSummaryCore.ts. This replaced the previous
// DUMB hard truncation (slice to SWANBOT_MAX_CLIENT_TOOL_RESULT_CONTENT_CHARS +
// a "[client tool result truncated from N chars]" suffix) so the v2 edge loop
// and the client show the model the exact same thing. Summarization is a no-op
// below TOOL_RESULT_SUMMARY_THRESHOLD_CHARS (20k) and a head+tail+signal summary
// above it.
import { summarizeToolResultForModel } from "./tool-result-summary.ts";

export type SwanBotResumeToolResult = {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};

export const SWANBOT_MAX_CLIENT_TOOL_RESULTS = 40;
// Retained for backward-compat imports. NO LONGER the truncation mechanism:
// summarization (summarizeToolResultForModel above) replaced the hard cap, and
// it keys off TOOL_RESULT_SUMMARY_THRESHOLD_CHARS (20k), not this value.
export const SWANBOT_MAX_CLIENT_TOOL_RESULT_CONTENT_CHARS = 16_000;

function normalizeClientToolResultContent(value: unknown): string {
  if (typeof value === "string") return summarizeToolResultForModel(value);
  try {
    return summarizeToolResultForModel(JSON.stringify(value ?? {}));
  } catch {
    return summarizeToolResultForModel(String(value ?? ""));
  }
}

export function validateSwanBotResumeToolResults(
  rawResults: unknown,
  pendingToolUseIds: string[],
): { ok: true; results: SwanBotResumeToolResult[] } | { ok: false; error: string } {
  if (!Array.isArray(rawResults)) {
    return { ok: false, error: "toolResults must be an array" };
  }
  if (pendingToolUseIds.length === 0) {
    return { ok: false, error: "continuation has no pending tool ids" };
  }
  if (pendingToolUseIds.length > SWANBOT_MAX_CLIENT_TOOL_RESULTS) {
    return { ok: false, error: `too many pending client tool calls (${pendingToolUseIds.length})` };
  }
  const expected = new Set(pendingToolUseIds);
  if (expected.size !== pendingToolUseIds.length) {
    return { ok: false, error: "continuation contains duplicate pending tool ids" };
  }
  if (rawResults.length > SWANBOT_MAX_CLIENT_TOOL_RESULTS) {
    return { ok: false, error: `too many toolResults (${rawResults.length})` };
  }

  const byId = new Map<string, SwanBotResumeToolResult>();
  for (const item of rawResults) {
    const row = (item || {}) as Record<string, unknown>;
    const toolUseId = String(row.tool_use_id || row.id || "").trim();
    if (!toolUseId) return { ok: false, error: "toolResults entries must include tool_use_id" };
    if (!expected.has(toolUseId)) {
      return { ok: false, error: `unexpected tool_result id: ${toolUseId}` };
    }
    if (byId.has(toolUseId)) {
      return { ok: false, error: `duplicate tool_result id: ${toolUseId}` };
    }
    byId.set(toolUseId, {
      tool_use_id: toolUseId,
      content: normalizeClientToolResultContent(Object.prototype.hasOwnProperty.call(row, "content") ? row.content : {}),
      is_error: !!row.is_error,
    });
  }

  const missing = pendingToolUseIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    return { ok: false, error: `missing tool_result id(s): ${missing.join(", ")}` };
  }

  return { ok: true, results: pendingToolUseIds.map((id) => byId.get(id)!) };
}
